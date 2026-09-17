"use client";

/**
 * The merger's state: a list of clips, read as they arrive, joined on request.
 *
 * Unlike the conversion queue this is one job over many files rather than one
 * job per file, so it has a store of its own. It lives at module level for
 * the same reason the queue's does: a visit to another tool and a press of
 * Back should find the clips where they were left.
 *
 * Reading and joining both hold the engine, and never at the same time: a
 * clip added while a join runs waits, and is read once the join is done.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { getEngine, resetEngine } from "./engine/ffmpegEngine";
import {
  DEFAULT_MERGE_SETTINGS,
  mergeBlocker,
  mergePlan,
  type MergeClip,
  type MergeSettings,
} from "./engine/merge";
import { ExtractionError } from "./engine/types";
import type { ExtractOutput, ProbeResult } from "./engine/types";
import {
  isFatal,
  loadEngine,
  markEngineFailed,
  markEngineRestarted,
  PROGRESS_THROTTLE_MS,
  toFailure,
  useEngineState,
  type JobFailure,
} from "./engineState";
import { rejectFile } from "./mediaTypes";
import { readStored, storageKey, writeStored } from "./persist";
import { DEFAULT_STRIP_METADATA } from "./useConversionQueue";

export type ClipStatus = "new" | "reading" | "ready" | "error";

export interface MergeClipState {
  id: string;
  file: File;
  status: ClipStatus;
  probe?: ProbeResult;
  /** Object URL of a frame from the clip, revoked with it. */
  posterUrl?: string;
  error?: JobFailure;
}

export interface MergeOutputState {
  /** Object URL for playback and download; revoked when replaced or cleared. */
  url: string;
  result: ExtractOutput;
}

export type MergeStatus = "idle" | "reading" | "merging";

interface MergeStore {
  clips: MergeClipState[];
  status: MergeStatus;
  /** Human-readable description of what is happening right now. */
  phase: string;
  ratio: number | null;
  processedSeconds: number;
  output: MergeOutputState | null;
  error: JobFailure | null;
  logs: string[];
  settings: MergeSettings;
  stripMetadata: boolean;
  hydrated: boolean;
  /** Set while the engine is held, by a read or a join. */
  busy: boolean;
  /** Set by cancel(); read by whatever holds the engine. */
  cancelled: boolean;
  listeners: Set<() => void>;
}

const MAX_LOG_LINES = 500;
const LOG_FLUSH_MS = 300;

const CANCELLED = "Cancelled.";

/**
 * True for the failure a cancel produces.
 *
 * Killing the worker makes whatever was awaiting it reject with ffmpeg's own
 * "called FFmpeg.terminate()", which is not something to show anyone; the
 * engine holder turns it into this, and the callers look for this.
 */
function isCancellation(error: unknown): boolean {
  return error instanceof ExtractionError && error.message === CANCELLED;
}

const INITIAL: Omit<MergeStore, "listeners"> = {
  clips: [],
  status: "idle",
  phase: "",
  ratio: null,
  processedSeconds: 0,
  output: null,
  error: null,
  logs: [],
  settings: DEFAULT_MERGE_SETTINGS,
  stripMetadata: DEFAULT_STRIP_METADATA,
  hydrated: false,
  busy: false,
  cancelled: false,
};

/** Which stream the tool wants every file to have, and where it keeps its state. */
export interface MergeQueueOptions {
  /** One store per tool: the video merger and the audio merger each keep their own list. */
  key?: string;
  expects?: "video" | "audio";
}

const DEFAULT_KEY = "merge-videos";

/**
 * A store per tool.
 *
 * The state is replaced whole on every change and the slot re-pointed at it,
 * so a snapshot compares by identity; the listeners travel with the slot.
 */
class MergeSlot {
  state: MergeStore;

  constructor() {
    this.state = { ...INITIAL, listeners: new Set() };
  }
}

const slots = new Map<string, MergeSlot>();

function getSlot(key: string): MergeSlot {
  let slot = slots.get(key);
  if (!slot) {
    slot = new MergeSlot();
    slots.set(key, slot);
  }
  return slot;
}

function notify(slot: MergeSlot): void {
  for (const listener of slot.state.listeners) listener();
}

function patchSlot(slot: MergeSlot, changes: Partial<MergeStore>): void {
  slot.state = { ...slot.state, ...changes };
  notify(slot);
}

function patchClipIn(slot: MergeSlot, id: string, changes: Partial<MergeClipState>): void {
  patchSlot(slot, { clips: slot.state.clips.map((clip) => (clip.id === id ? { ...clip, ...changes } : clip)) });
}

function releaseOutput(output: MergeOutputState | null): void {
  if (output) URL.revokeObjectURL(output.url);
}

function releaseClip(clip: MergeClipState): void {
  if (clip.posterUrl) URL.revokeObjectURL(clip.posterUrl);
}

/** @internal - lets tests start from a clean page. */
export function resetMergeStore(): void {
  for (const slot of slots.values()) {
    for (const clip of slot.state.clips) releaseClip(clip);
    releaseOutput(slot.state.output);
  }
  slots.clear();
}

let clipCounter = 0;
const nextClipId = () => `clip-${(clipCounter += 1)}-${Date.now().toString(36)}`;

function isMergeSettings(value: unknown): value is MergeSettings {
  if (typeof value !== "object" || value === null) return false;
  const mode = (value as Partial<MergeSettings>).mode;
  return mode === "auto" || mode === "encode";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** The clips a join would take, in order, as the planner sees them. */
export function readyClips(clips: readonly MergeClipState[]): MergeClipState[] {
  return clips.filter((clip) => clip.status === "ready" && clip.probe !== undefined);
}

/** What the planner would decide for the clips as they stand, for the summary line. */
export function describeClips(clips: readonly MergeClipState[]): MergeClip[] {
  return readyClips(clips).map((clip) => ({
    fileName: clip.file.name,
    fileBytes: clip.file.size,
    probe: clip.probe!,
    inputPath: "",
  }));
}

export function useMergeQueue(options: MergeQueueOptions = {}) {
  const key = options.key ?? DEFAULT_KEY;
  const expects = options.expects ?? "video";
  const slot = getSlot(key);
  const subscribe = useCallback(
    (listener: () => void) => {
      slot.state.listeners.add(listener);
      return () => slot.state.listeners.delete(listener);
    },
    [slot],
  );
  const getSnapshot = useCallback(() => slot.state, [slot]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const engineState = useEngineState();
  const patch = useCallback((changes: Partial<MergeStore>) => patchSlot(slot, changes), [slot]);
  const patchClip = useCallback((id: string, changes: Partial<MergeClipState>) => patchClipIn(slot, id, changes), [slot]);

  /**
   * Holds the engine for one piece of work, and puts it back whatever happened.
   *
   * A trap or a cancel kills the worker, so the engine is replaced rather
   * than closed; anything else closes the session, which is the unmount.
   */
  const withEngine = useCallback(
    async (
      files: File[],
      work: (session: Awaited<ReturnType<ReturnType<typeof getEngine>["openFiles"]>>) => Promise<void>,
    ): Promise<void> => {
      const engine = getEngine();
      slot.state.busy = true;
      slot.state.cancelled = false;

      const logBuffer: string[] = [];
      const flushLogs = () => {
        if (logBuffer.length === 0) return;
        const chunk = logBuffer.splice(0, logBuffer.length);
        const logs = [...slot.state.logs, ...chunk];
        patch({ logs: logs.length > MAX_LOG_LINES ? logs.slice(-MAX_LOG_LINES) : logs });
      };
      engine.setLogListener(({ message }) => {
        logBuffer.push(message);
      });
      const logTimer = setInterval(flushLogs, LOG_FLUSH_MS);

      let session: Awaited<ReturnType<typeof engine.openFiles>> | null = null;
      let crashed = false;
      try {
        await loadEngine(engine);
        if (slot.state.cancelled) throw new ExtractionError(CANCELLED);
        session = await engine.openFiles(files, { expects });
        if (slot.state.cancelled) throw new ExtractionError(CANCELLED);
        await work(session);
      } catch (error) {
        // A cancel kills the worker, and whatever was waiting on it rejects
        // with ffmpeg's own words; the cancel is the fact worth passing on.
        if (slot.state.cancelled) throw new ExtractionError(CANCELLED, undefined, { retryable: true });
        if (isFatal(error)) crashed = true;
        if (!engine.loaded) markEngineFailed(toFailure(error));
        throw error;
      } finally {
        clearInterval(logTimer);
        engine.setLogListener(null);
        flushLogs();
        const cancelled = slot.state.cancelled;
        slot.state.cancelled = false;
        slot.state.busy = false;
        if (cancelled || crashed || engine.poisoned) {
          resetEngine();
          markEngineRestarted(crashed || engine.poisoned);
        } else if (session) {
          await session.close().catch(() => {});
        }
      }
    },
    [expects, patch, slot],
  );

  /** Reads every clip that has not been read yet, in one session. */
  const readNewClips = useCallback(async () => {
    const pending = slot.state.clips.filter((clip) => clip.status === "new");
    if (pending.length === 0) return;
    const ids = new Set(pending.map((clip) => clip.id));
    patch({
      status: "reading",
      phase: `Reading ${pending.length === 1 ? "the clip" : `${pending.length} clips`}...`,
      ratio: null,
      clips: slot.state.clips.map((clip) => (ids.has(clip.id) ? { ...clip, status: "reading" } : clip)),
    });

    try {
      await withEngine(
        pending.map((clip) => clip.file),
        async (session) => {
          for (const [index, input] of session.inputs.entries()) {
            const clip = pending[index];
            // Removed while it was being read: nothing to record.
            if (!slot.state.clips.some((entry) => entry.id === clip.id)) continue;
            if (input.probe) {
              patchClip(clip.id, { status: "ready", probe: input.probe, error: undefined });
              try {
                const poster = await session.poster(index);
                if (poster && slot.state.clips.some((entry) => entry.id === clip.id)) {
                  patchClip(clip.id, { posterUrl: URL.createObjectURL(poster.blob) });
                }
              } catch (error) {
                if (isFatal(error)) throw error;
              }
            } else {
              patchClip(clip.id, {
                status: "error",
                error: input.error ? toFailure(input.error) : { message: "This file could not be read." },
              });
            }
            if (slot.state.cancelled) throw new ExtractionError(CANCELLED);
          }
        },
      );
    } catch (error) {
      const failure: JobFailure = isCancellation(error)
        ? {
            message: "Reading was cancelled.",
            hint: "Remove the clip and add it again to read it.",
            retryable: false,
          }
        : toFailure(error);
      patch({
        clips: slot.state.clips.map((clip) =>
          clip.status === "reading" ? { ...clip, status: "error", error: failure } : clip,
        ),
      });
    } finally {
      patch({ status: "idle", phase: "", ratio: null });
    }
  }, [patch, patchClip, slot, withEngine]);

  /** Reads whatever is waiting; safe to call any number of times. */
  const pump = useCallback(async () => {
    if (slot.state.busy) return;
    while (slot.state.clips.some((clip) => clip.status === "new")) {
      await readNewClips();
    }
  }, [readNewClips, slot]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const clips: MergeClipState[] = files.map((file) => {
        const rejection = rejectFile(file);
        return rejection
          ? { id: nextClipId(), file, status: "error", error: { ...rejection, retryable: false } }
          : { id: nextClipId(), file, status: "new" };
      });
      // A joined file is the join of a particular list; a new list needs a new join.
      releaseOutput(slot.state.output);
      patch({ clips: [...slot.state.clips, ...clips], output: null, error: null });
      void pump();
    },
    [patch, pump, slot],
  );

  const moveClip = useCallback((id: string, direction: -1 | 1) => {
    const index = slot.state.clips.findIndex((clip) => clip.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= slot.state.clips.length) return;
    const clips = [...slot.state.clips];
    [clips[index], clips[target]] = [clips[target], clips[index]];
    releaseOutput(slot.state.output);
    patch({ clips, output: null, error: null });
  }, [patch, slot]);

  const removeClip = useCallback((id: string) => {
    const clip = slot.state.clips.find((entry) => entry.id === id);
    if (!clip) return;
    releaseClip(clip);
    releaseOutput(slot.state.output);
    patch({ clips: slot.state.clips.filter((entry) => entry.id !== id), output: null, error: null });
  }, [patch, slot]);

  const clearClips = useCallback(() => {
    if (slot.state.busy) return;
    for (const clip of slot.state.clips) releaseClip(clip);
    releaseOutput(slot.state.output);
    patch({ clips: [], output: null, error: null, logs: [] });
  }, [patch, slot]);

  /** Joins every clip that has been read, in the order shown. */
  const merge = useCallback(async () => {
    if (slot.state.busy) return;
    const clips = readyClips(slot.state.clips);
    if (clips.length < 2) return;

    // The join is of this list, in this order; if the list changes underneath
    // it, the result belongs to nothing on the page and is dropped.
    const joinedList = slot.state.clips.map((clip) => clip.id).join("|");
    const listUnchanged = () => slot.state.clips.map((clip) => clip.id).join("|") === joinedList;

    releaseOutput(slot.state.output);
    patch({
      status: "merging",
      phase: `Joining ${clips.length} clips...`,
      ratio: 0,
      processedSeconds: 0,
      output: null,
      error: null,
      logs: [],
    });

    try {
      await withEngine(
        clips.map((clip) => clip.file),
        async (session) => {
          const unreadable = session.inputs.find((input) => !input.probe);
          if (unreadable) {
            throw (
              unreadable.error ??
              new ExtractionError(`${unreadable.file.name} could not be read.`)
            );
          }
          const planned: MergeClip[] = session.inputs.map((input) => ({
            fileName: input.file.name,
            fileBytes: input.file.size,
            probe: input.probe!,
            inputPath: input.inputPath,
          }));
          const blocker = mergeBlocker(planned, slot.state.settings);
          if (blocker) {
            throw new ExtractionError(blocker.message, blocker.hint, {
              severity: blocker.severity ?? "error",
              retryable: blocker.retryable ?? false,
            });
          }
          const plan = mergePlan(planned, slot.state.settings);
          patch({
            phase: plan.mode === "copy" ? `Joining ${clips.length} clips...` : `Re-encoding ${clips.length} clips into one...`,
          });

          let lastTick = 0;
          const result = await session.merge(plan, {
            stripMetadata: slot.state.stripMetadata,
            onProgress: (progress) => {
              const now = Date.now();
              if (now - lastTick < PROGRESS_THROTTLE_MS && progress.ratio !== 1) return;
              lastTick = now;
              patch({ ratio: progress.ratio, processedSeconds: progress.processedSeconds });
            },
          });
          if (slot.state.cancelled) throw new ExtractionError(CANCELLED);
          if (listUnchanged()) {
            patch({ output: { url: URL.createObjectURL(result.blob), result } });
          }
        },
      );
      patch({ status: "idle", phase: "", ratio: null });
    } catch (error) {
      // A cancel is something the visitor did, and needs no explaining.
      patch({
        status: "idle",
        phase: "",
        ratio: null,
        error: isCancellation(error) ? null : toFailure(error),
      });
    }
    // Clips that arrived during the join are read now that the engine is free.
    void pump();
  }, [patch, pump, slot, withEngine]);

  /**
   * Stops whatever holds the engine.
   *
   * ffmpeg blocks its worker for the whole of a command, so the only way to
   * stop a join in flight is to kill the worker; the next job builds a new
   * one from the cached core.
   */
  const cancel = useCallback(() => {
    if (!slot.state.busy) return;
    slot.state.cancelled = true;
    patch({ phase: "Cancelling..." });
    getEngine().terminate();
  }, [patch, slot]);

  const setSettings = useCallback((settings: MergeSettings) => {
    patch({ settings });
  }, [patch]);

  const setStripMetadata = useCallback((stripMetadata: boolean) => {
    patch({ stripMetadata });
  }, [patch]);

  // Settings remembered between visits; the metadata switch is shared with every tool.
  useEffect(() => {
    if (slot.state.hydrated) return;
    slot.state.hydrated = true;
    const settings = readStored(storageKey("settings", key), isMergeSettings);
    const strip = readStored(storageKey("strip-metadata"), isBoolean);
    patch({
      settings: settings ?? slot.state.settings,
      stripMetadata: strip ?? slot.state.stripMetadata,
    });
  }, [key, patch, slot]);

  useEffect(() => {
    if (!slot.state.hydrated) return;
    writeStored(storageKey("settings", key), state.settings);
  }, [key, slot, state.settings]);

  useEffect(() => {
    if (!slot.state.hydrated) return;
    writeStored(storageKey("strip-metadata"), state.stripMetadata);
  }, [slot, state.stripMetadata]);

  // Warn before navigating away mid-join: the work cannot be resumed.
  useEffect(() => {
    if (state.status !== "merging") return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.status]);

  return {
    clips: state.clips,
    status: state.status,
    phase: state.phase,
    ratio: state.ratio,
    processedSeconds: state.processedSeconds,
    output: state.output,
    error: state.error,
    logs: state.logs,
    settings: state.settings,
    setSettings,
    stripMetadata: state.stripMetadata,
    setStripMetadata,
    engineState,
    addFiles,
    moveClip,
    removeClip,
    clearClips,
    merge,
    cancel,
  };
}
