"use client";

/**
 * Sequential conversion queue.
 *
 * Files convert one at a time on purpose: there is a single ffmpeg worker with
 * a single heap, so running jobs concurrently would multiply peak memory
 * without making anything faster (the work is I/O- and codec-bound, not
 * parallel). One job at a time also keeps progress reporting unambiguous.
 *
 * The queue's state lives *outside* React, in a module-level store keyed by
 * tool. Two things need that. The async pump runs outside the render cycle and
 * must never read a stale snapshot, which a ref would also solve; and moving
 * between tools unmounts the page, which a ref would not survive. Trimming a
 * file, glancing at the GIF maker and pressing Back used to lose the file, the
 * markers and both finished cuts without a word, because the state and the
 * object URLs went with the component. Now the component is a view onto a
 * store that outlives it, and going back finds the work where it was left.
 *
 * ffmpeg emits log lines and progress events far faster than a UI needs to
 * repaint, so both are coalesced before they reach React state.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { getEngine, resetEngine } from "./engine/ffmpegEngine";
import {
  DEFAULT_FORMAT_IDS,
  findFormat,
  isFormatAvailable,
  OUTPUT_FORMATS,
} from "./engine/formats";
import { DEFAULT_SILENCE_OPTIONS, sameTrimRange } from "./engine/trim";
import { ExtractionError } from "./engine/types";
import type {
  EngineCapabilities,
  EngineLoadStage,
  ExtractOutput,
  FailureSeverity,
  MediaExpectation,
  OutputFormat,
  ProbeResult,
  SilenceScanOptions,
  SilenceScanResult,
  TrimRange,
  WaveformData,
} from "./engine/types";
import { canPreviewSource } from "./format-utils";
import { rejectFile } from "./mediaTypes";
import { readStored, storageKey, writeStored } from "./persist";

/**
 * "ready" is a file that has been read but has nothing queued: the state a
 * trimmer leaves a file in until a range is chosen.
 */
export type JobStatus =
  | "queued"
  | "preparing"
  | "converting"
  | "ready"
  | "done"
  | "error"
  | "cancelled";

export type OutputStatus = "pending" | "running" | "done" | "error" | "cancelled";

export interface JobFailure {
  message: string;
  hint?: string;
  /** "info" is a job with nothing to do rather than one that went wrong. */
  severity?: FailureSeverity;
  /** False when running the same job again can only produce the same result. */
  retryable?: boolean;
}

export interface JobOutput {
  /**
   * Identity of this output.
   *
   * The format alone is not enough once a file can be clipped: "MP3 of the
   * whole thing" and "MP3 of 1:30-2:15" are two outputs of the same format.
   */
  id: string;
  formatId: string;
  /**
   * The format itself, captured when the output was queued. A tool whose
   * settings shape the plan bakes them in here, so a later change to the
   * panel never alters a job already in the queue.
   */
  format: OutputFormat;
  label: string;
  /** Portion of the source this output covers; null means all of it. */
  trim: TrimRange | null;
  status: OutputStatus;
  /** 0..1, or null while ffmpeg cannot report a meaningful ratio. */
  ratio: number | null;
  processedSeconds: number;
  result?: ExtractOutput;
  /** Object URL for playback and download; revoked when the job is removed. */
  url?: string;
  error?: JobFailure;
}

export interface Job {
  id: string;
  file: File;
  status: JobStatus;
  /** Human-readable description of what is happening right now. */
  phase: string;
  /** Progress of a phase that is not an output conversion, e.g. a silence scan. */
  phaseRatio: number | null;
  probe?: ProbeResult;
  /**
   * Object URL of a still frame from the video, revoked with the job.
   *
   * Absent for audio-only files, and absent when the frame could not be taken:
   * a thumbnail is decoration, so failing to get one is not worth reporting.
   */
  posterUrl?: string;
  /**
   * Object URL of the source file itself, for a video preview to scrub
   * before anything has been produced. Only set when the browser says it can
   * play the container, and revoked with the job. It is a reference to the
   * File, not a copy of it.
   */
  sourceUrl?: string;
  /** Range the trim panel currently proposes for new outputs. */
  trim: TrimRange | null;
  /** When true, the next run detects silence and derives `trim` from it. */
  autoTrim: boolean;
  silenceOptions: SilenceScanOptions;
  /** Result of the last silence scan, once one has run. */
  silence?: SilenceScanResult;
  /** Envelope for the clip panel, once someone has asked to see it. */
  waveform?: WaveformData;
  /** Set while a waveform has been asked for but not yet drawn. */
  wantsWaveform?: boolean;
  outputs: JobOutput[];
  error?: JobFailure;
  logs: string[];
}

export type TrimMode = "full" | "silence";

/**
 * Trim settings for files added next, alongside the format selection.
 *
 * Clipping to an explicit range is deliberately not here. A range means
 * nothing until the file has been probed and can be heard, so it belongs on
 * the file card, where there is a duration to validate against and a preview
 * to scrub. These settings only carry the two decisions that can be made
 * before a file exists: take the whole track, or find the silence.
 */
export interface TrimSettings {
  mode: TrimMode;
  silence: SilenceScanOptions;
}

/**
 * What one tool asks of the queue.
 *
 * The queue itself knows nothing about audio or video; the tool hands it a
 * catalogue and says what a new file should get from it. The audio extractor
 * is one configuration of this, the video converter another.
 */
export interface QueueOptions {
  /**
   * Which store this tool's work lives in. One per tool, so switching tools
   * shows that tool's queue and coming back shows this one's, untouched.
   */
  key?: string;
  /**
   * Every format this tool can produce. Read through a ref, so a tool whose
   * settings shape its formats can pass a fresh catalogue on each render and
   * a file added next gets the current one.
   */
  formats: readonly OutputFormat[];
  /** Ids from the catalogue a newly added file is converted to. May be empty. */
  defaultFormatIds: readonly string[];
  /**
   * True when the visitor picks from the catalogue by hand.
   *
   * The audio extractor and the converter offer a list of formats and
   * remember which are ticked. The others generate their catalogue from a
   * settings panel, where the choice is baked into the format's id - and a
   * remembered id then means the wrong thing entirely: picking 8 MB in the
   * compressor left a stored "compress-25mb-auto-2pass" that still resolved,
   * because every preset is in the catalogue so a file can be re-compressed
   * from its card, and the job quietly ran at 25 MB.
   */
  formatPicker?: boolean;
  /** Which stream the file must have. Defaults to "audio". */
  expects?: MediaExpectation;
  /**
   * Open and probe a file even when nothing is queued for it, so a tool that
   * needs a range first still shows the length and a preview. Defaults to
   * false: the audio extractor never mounts a file it will produce nothing from.
   */
  openWithoutOutputs?: boolean;
  /** Decode the audio envelope for the clip panel. Defaults to true. */
  waveform?: boolean;
  /** Keep a playable URL of the source for a video preview. Defaults to false. */
  sourcePreview?: boolean;
  /** Verb for the running phase: "Extracting MP3...", "Converting MP4...". */
  verb?: string;
  /**
   * The card's phase line while an output runs, for tools whose format label
   * does not read well after a verb. Overrides `verb`.
   */
  phase?: (output: { label: string; trim: TrimRange | null }) => string;
}

/** The audio extractor's configuration, and the default. */
export const AUDIO_QUEUE_OPTIONS: QueueOptions = {
  key: "extract-audio",
  formats: OUTPUT_FORMATS,
  defaultFormatIds: DEFAULT_FORMAT_IDS,
  formatPicker: true,
  expects: "audio",
  waveform: true,
  verb: "Extracting",
};

/**
 * Whether running this job would actually do anything.
 *
 * Every reason to wake the engine belongs here, and missing one does not fail
 * loudly: the job settles straight back to the state it was in and whatever
 * was asked for silently never happens.
 *
 * A wanted waveform is deliberately not on the list. It rides along with a run
 * that was going to happen anyway rather than justifying one, so cancelling
 * every format of a queued file still means that file is never mounted - which
 * is the whole point of settling here instead of downloading a core and
 * opening a file to produce nothing.
 */
function needsEngine(job: Job, openWithoutOutputs: boolean): boolean {
  if (job.autoTrim) return true;
  if (openWithoutOutputs && !job.probe) return true;
  return job.outputs.some((output) => output.status === "pending");
}

/**
 * Releases every object URL a job holds.
 *
 * There are three places a job can be discarded, so this exists to keep them
 * from drifting: a URL added to Job needs freeing here and nowhere else.
 */
function releaseJobUrls(job: Job): void {
  for (const output of job.outputs) {
    if (output.url) URL.revokeObjectURL(output.url);
  }
  if (job.posterUrl) URL.revokeObjectURL(job.posterUrl);
  if (job.sourceUrl) URL.revokeObjectURL(job.sourceUrl);
}

export const DEFAULT_TRIM_SETTINGS: TrimSettings = {
  mode: "full",
  silence: DEFAULT_SILENCE_OPTIONS,
};

export interface EngineState {
  stage: EngineLoadStage | "error";
  ratio: number | null;
  receivedBytes: number;
  totalBytes: number;
  capabilities: EngineCapabilities | null;
  error?: JobFailure;
  /**
   * How many times a crashed engine has been replaced this session.
   *
   * Shown once as a note rather than counted at the visitor: what matters is
   * that the restart was deliberate and their other files are unaffected.
   */
  restarts: number;
}

const MAX_JOB_LOG_LINES = 500;
/** How often buffered ffmpeg output is pushed into React state. */
const LOG_FLUSH_MS = 300;
/** Minimum gap between progress-driven re-renders. */
const PROGRESS_THROTTLE_MS = 100;

const INITIAL_ENGINE_STATE: EngineState = {
  stage: "idle",
  ratio: null,
  receivedBytes: 0,
  totalBytes: 0,
  capabilities: null,
  restarts: 0,
};

function toFailure(error: unknown): JobFailure {
  if (error instanceof ExtractionError) {
    return {
      message: error.message,
      hint: error.hint,
      severity: error.severity,
      retryable: error.retryable,
    };
  }
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "string") return { message: error };
  return { message: "Something went wrong." };
}

/** True for a failure that took the ffmpeg instance down with it. */
function isFatal(error: unknown): boolean {
  return error instanceof ExtractionError && error.fatal;
}

let outputCounter = 0;
const nextOutputId = () => `output-${(outputCounter += 1)}`;

function makeOutputs(formats: readonly OutputFormat[], trim: TrimRange | null): JobOutput[] {
  return formats.map((format) => ({
    id: nextOutputId(),
    formatId: format.id,
    format,
    label: format.label,
    trim,
    status: "pending" as const,
    ratio: null,
    processedSeconds: 0,
  }));
}

let jobCounter = 0;
const nextJobId = () => `job-${(jobCounter += 1)}-${Date.now().toString(36)}`;

/**
 * Formats a new file will be converted to.
 *
 * The picker greys out formats the loaded core cannot produce, but the
 * selection can still hold one chosen before the core reported in, and an
 * output built from it would fail on the spot. Anything unavailable is dropped;
 * an empty result falls back to the tool's defaults and, failing that, to a
 * stream copy, which needs no encoder at all. A tool with no defaults gets an
 * empty list, which is a file that is read and then waits.
 */
export function availableFormats(
  wanted: readonly string[],
  capabilities: EngineCapabilities | null,
  options: Pick<QueueOptions, "formats" | "defaultFormatIds">,
): OutputFormat[] {
  const available = (ids: readonly string[]) =>
    ids
      .map((id) => findFormat(options.formats, id))
      .filter((format): format is OutputFormat => format !== undefined)
      .filter((format) => isFormatAvailable(format, capabilities));
  for (const candidates of [wanted, options.defaultFormatIds]) {
    const formats = available(candidates);
    if (formats.length > 0) return formats;
  }
  if (options.defaultFormatIds.length === 0) return [];
  return options.formats.filter((format) => format.requiredEncoder === null).slice(0, 1);
}

/** The state a job settles into once every one of its outputs has had its turn. */
export function summarizeOutputs(
  outputs: readonly JobOutput[],
): Pick<Job, "status" | "phase" | "error"> {
  // Read, and waiting for a range: nothing has been asked for yet.
  if (outputs.length === 0) return { status: "ready", phase: "Ready", error: undefined };

  const anyDone = outputs.some((output) => output.status === "done");
  const firstError = outputs.find((output) => output.error)?.error;
  const failed = !anyDone && firstError !== undefined;
  // Nothing produced and nothing broken: the formats were cancelled.
  const cancelled =
    !anyDone && !failed && outputs.some((output) => output.status === "cancelled");

  if (failed) {
    // A file that was already small enough has nothing to report as broken.
    const phase = firstError.severity === "info" ? "Nothing to do" : "Failed";
    return { status: "error", phase, error: firstError };
  }
  if (cancelled) return { status: "cancelled", phase: "Cancelled", error: undefined };
  return { status: "done", phase: "Done", error: undefined };
}

/* ---- The stores --------------------------------------------------------- */

/**
 * One tool's queue, and the bookkeeping the pump needs.
 *
 * Everything here has to outlive the component: `jobs` because the visitor's
 * work does, and the rest because a conversion that is running when they
 * navigate away carries on, and has to find the same flags when it finishes.
 */
interface QueueStore {
  jobs: Job[];
  /**
   * The tool's options as of the last render.
   *
   * A run that outlives its page still needs the catalogue and the phase
   * wording it started with, and a settings panel can hand over a fresh
   * catalogue on every render.
   */
  options: QueueOptions;
  selectedFormats: string[];
  trimSettings: TrimSettings;
  /** Whether outputs are written without the source's tags. See ExtractOptions. */
  stripMetadata: boolean;
  /** Set once stored settings have had their chance to load. */
  hydrated: boolean;
  pumping: boolean;
  activeJobId: string | null;
  cancelled: Set<string>;
  /**
   * Jobs that need a fresh engine before anything else of theirs can run:
   * their worker was killed to stop one output, or it died on its own.
   */
  restart: Set<string>;
  /**
   * The subset of those whose engine *crashed* rather than being killed
   * deliberately. Only these are worth telling the visitor about; a cancel
   * they asked for needs no explanation.
   */
  crashed: Set<string>;
  listeners: Set<() => void>;
}

/**
 * Outputs are stripped of the source's metadata by default.
 *
 * A phone writes the time, the model and the GPS fix of every clip into its
 * container, and an extracted MP3 used to carry all three out of a site whose
 * entire promise is that files stay private. Keeping the tags is one checkbox
 * away; leaking them should not be.
 */
export const DEFAULT_STRIP_METADATA = true;

const stores = new Map<string, QueueStore>();

function getStore(key: string, options: QueueOptions): QueueStore {
  let store = stores.get(key);
  if (!store) {
    store = {
      jobs: [],
      options,
      selectedFormats: [...options.defaultFormatIds],
      trimSettings: DEFAULT_TRIM_SETTINGS,
      stripMetadata: DEFAULT_STRIP_METADATA,
      hydrated: false,
      pumping: false,
      activeJobId: null,
      cancelled: new Set(),
      restart: new Set(),
      crashed: new Set(),
      listeners: new Set(),
    };
    stores.set(key, store);
  }
  return store;
}

function notify(store: QueueStore): void {
  for (const listener of store.listeners) listener();
}

/* ---- Engine state, shared by every tool --------------------------------- */

/*
 * There is one ffmpeg worker for the page, so there is one engine state for
 * the page: the core downloaded on the convert page is loaded when the trimmer
 * opens, and its banner should say so rather than starting again at "idle".
 */
let engineState: EngineState = INITIAL_ENGINE_STATE;
const engineListeners = new Set<() => void>();

function setEngineState(patch: (previous: EngineState) => EngineState): void {
  engineState = patch(engineState);
  for (const listener of engineListeners) listener();
}

function subscribeEngine(listener: () => void): () => void {
  engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

const getEngineState = () => engineState;

/** @internal - lets tests start from a clean page. */
export function resetQueueStores(): void {
  for (const store of stores.values()) {
    for (const job of store.jobs) releaseJobUrls(job);
  }
  stores.clear();
  engineState = INITIAL_ENGINE_STATE;
}

/* ---- The hook ----------------------------------------------------------- */

export function useConversionQueue(options: QueueOptions = AUDIO_QUEUE_OPTIONS) {
  const store = getStore(options.key ?? "default", options);

  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [store],
  );

  const getJobs = useCallback(() => store.jobs, [store]);
  const getSelected = useCallback(() => store.selectedFormats, [store]);
  const getTrimSettings = useCallback(() => store.trimSettings, [store]);
  const getStripMetadata = useCallback(() => store.stripMetadata, [store]);

  const jobs = useSyncExternalStore(subscribe, getJobs, getJobs);
  const selectedFormats = useSyncExternalStore(subscribe, getSelected, getSelected);
  const trimSettings = useSyncExternalStore(subscribe, getTrimSettings, getTrimSettings);
  const stripMetadata = useSyncExternalStore(subscribe, getStripMetadata, getStripMetadata);
  const engine = useSyncExternalStore(subscribeEngine, getEngineState, getEngineState);

  /*
   * The tool's catalogue as it stands on this render. A settings change is
   * visible to the next file added, never to one already in the queue: those
   * captured their format when they were queued.
   */
  store.options = options;

  const commit = useCallback(
    (next: Job[]) => {
      store.jobs = next;
      notify(store);
    },
    [store],
  );

  const patchJob = useCallback(
    (id: string, patch: Partial<Job> | ((job: Job) => Partial<Job>)) => {
      commit(
        store.jobs.map((job) =>
          job.id === id ? { ...job, ...(typeof patch === "function" ? patch(job) : patch) } : job,
        ),
      );
    },
    [commit, store],
  );

  const patchOutput = useCallback(
    (jobId: string, outputId: string, patch: Partial<JobOutput>) => {
      patchJob(jobId, (job) => ({
        outputs: job.outputs.map((output) =>
          output.id === outputId ? { ...output, ...patch } : output,
        ),
      }));
    },
    [patchJob],
  );

  const setSelectedFormats = useCallback(
    (next: string[] | ((previous: string[]) => string[])) => {
      store.selectedFormats = typeof next === "function" ? next(store.selectedFormats) : next;
      notify(store);
    },
    [store],
  );

  const setTrimSettings = useCallback(
    (next: TrimSettings) => {
      store.trimSettings = next;
      notify(store);
    },
    [store],
  );

  const setStripMetadata = useCallback(
    (next: boolean) => {
      store.stripMetadata = next;
      notify(store);
    },
    [store],
  );

  /**
   * Settles every output of a file that is not going to run.
   *
   * A file that failed to probe, or was cancelled, used to leave its formats
   * sitting at "Waiting" with a live Cancel button under a red error, waiting
   * for a run that would never come. Nothing may stay pending once the file
   * itself is finished with.
   */
  const settleOutputs = useCallback(
    (jobId: string, status: "error" | "cancelled", failure?: JobFailure) => {
      patchJob(jobId, (job) => ({
        outputs: job.outputs.map((output) =>
          output.status === "pending" || output.status === "running"
            ? {
                ...output,
                status,
                ratio: null,
                error: status === "error" ? (output.error ?? failure) : undefined,
              }
            : output,
        ),
      }));
    },
    [patchJob],
  );

  /** Runs one job to completion; never throws. */
  const runJob = useCallback(
    async (jobId: string) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      if (!job) return;

      // The tool's options as they stand when the job starts.
      const {
        expects = "audio",
        openWithoutOutputs = false,
        verb = "Extracting",
        phase: describePhase = (output) =>
          output.trim ? `${verb} ${output.label} clip...` : `${verb} ${output.label}...`,
      } = store.options;

      // Nothing to do: settle without waking the engine. Cancelling every
      // format of a file still in the queue lands here, and downloading the
      // core and mounting the file only to then do nothing would be a long
      // wait for no output.
      if (!needsEngine(job, openWithoutOutputs)) {
        patchJob(jobId, { ...summarizeOutputs(job.outputs), phaseRatio: null });
        return;
      }

      const ffmpeg = getEngine();
      store.activeJobId = jobId;
      patchJob(jobId, {
        status: "preparing",
        phase: ffmpeg.loaded ? "Reading file details..." : "Loading the ffmpeg engine...",
        error: undefined,
      });

      // ffmpeg logs several lines per second; batch them so the log panel does
      // not re-render the whole queue on every line.
      const logBuffer: string[] = [];
      const flushLogs = () => {
        if (logBuffer.length === 0) return;
        const chunk = logBuffer.splice(0, logBuffer.length);
        patchJob(jobId, (current) => {
          const logs = [...current.logs, ...chunk];
          return {
            logs: logs.length > MAX_JOB_LOG_LINES ? logs.slice(-MAX_JOB_LOG_LINES) : logs,
          };
        });
      };
      ffmpeg.setLogListener(({ message }) => {
        logBuffer.push(message);
      });
      const logTimer = setInterval(flushLogs, LOG_FLUSH_MS);

      const isCancelled = () => store.cancelled.has(jobId);

      let session: Awaited<ReturnType<typeof ffmpeg.openSession>> | null = null;
      try {
        let lastEngineTick = 0;
        const capabilities = await ffmpeg.load((progress) => {
          const now = Date.now();
          const isMilestone = progress.stage !== "downloading-core" || progress.ratio === 1;
          if (!isMilestone && now - lastEngineTick < PROGRESS_THROTTLE_MS) return;
          lastEngineTick = now;
          setEngineState((previous) => ({
            ...previous,
            stage: progress.stage,
            ratio: progress.ratio,
            receivedBytes: progress.receivedBytes,
            totalBytes: progress.totalBytes,
          }));
        });
        setEngineState((previous) => ({
          ...previous,
          stage: "ready",
          capabilities,
          error: undefined,
        }));
        if (isCancelled()) throw new ExtractionError("Cancelled.");

        patchJob(jobId, { phase: "Reading file details..." });
        session = await ffmpeg.openSession(job.file, { expects });
        if (isCancelled()) throw new ExtractionError("Cancelled.");

        patchJob(jobId, { status: "converting", probe: session.probe });

        /*
         * The thumbnail is taken here, while the file is already mounted, so it
         * costs one seek rather than a second mount later. It is deliberately
         * not awaited for its errors: runPoster resolves to null on any
         * failure, because a card without a picture is a much smaller problem
         * than a conversion that did not run.
         *
         * Taken once per file, not once per run. Every "also convert to" click
         * hands the job back to the pump, and re-seeking and re-encoding a
         * frame the card is already showing is pure waste.
         */
        const beforePoster = store.jobs.find((entry) => entry.id === jobId);
        if (session.probe.hasVideo && !beforePoster?.posterUrl) {
          try {
            const poster = await session.poster();
            if (poster && !isCancelled()) {
              patchJob(jobId, { posterUrl: URL.createObjectURL(poster.blob) });
            }
          } catch (error) {
            // Decoration only - unless the engine itself died taking the frame,
            // in which case nothing after this would work either.
            if (isFatal(error)) throw error;
          }
        }
        if (isCancelled()) throw new ExtractionError("Cancelled.");

        const current = store.jobs.find((entry) => entry.id === jobId);

        // Automatic trimming has to happen here rather than at queue time: the
        // range is not knowable until the audio has been listened to, and the
        // outputs waiting behind it inherit whatever the scan finds.
        if (current?.autoTrim) {
          patchJob(jobId, { phase: "Listening for silence...", phaseRatio: 0 });

          let lastScanTick = 0;
          const silence = await session.detectSilence(current.silenceOptions, (progress) => {
            const now = Date.now();
            if (now - lastScanTick < PROGRESS_THROTTLE_MS) return;
            lastScanTick = now;
            patchJob(jobId, { phaseRatio: progress.ratio });
          });
          if (isCancelled()) throw new ExtractionError("Cancelled.");

          patchJob(jobId, (latest) => ({
            silence,
            autoTrim: false,
            trim: silence.suggested,
            phaseRatio: null,
            outputs: latest.outputs.map((output) =>
              output.status === "pending" ? { ...output, trim: silence.suggested } : output,
            ),
          }));
        }

        /*
         * Outer pass: outputs, then the envelope, then round again.
         *
         * Drawing the envelope is a full decode of a long file, and the card
         * is live throughout it - the visitor can press Retry on a cancelled
         * format, or add another one. Those land as pending outputs on a job
         * whose output loop has already ended, and without coming back round
         * they would sit at "Waiting" until the page was reloaded: the job
         * settles as done and the pump has nothing queued to pick up.
         */
        for (;;) {
          // Re-read the pending output each pass rather than iterating a snapshot:
          // an output can be cancelled, retried back into the queue, or added,
          // while the job it belongs to is still running.
          for (;;) {
            if (isCancelled()) throw new ExtractionError("Cancelled.");

            const output = store.jobs
              .find((entry) => entry.id === jobId)
              ?.outputs.find((entry) => entry.status === "pending");
            if (!output) break;

            patchJob(jobId, {
              phase: describePhase({ label: output.label, trim: output.trim }),
            });
            patchOutput(jobId, output.id, {
              status: "running",
              ratio: 0,
              processedSeconds: 0,
            });

            try {
              let lastTick = 0;
              const result = await session.extract(output.format, {
                trim: output.trim,
                stripMetadata: store.stripMetadata,
                onProgress: (progress) => {
                  const now = Date.now();
                  if (now - lastTick < PROGRESS_THROTTLE_MS) return;
                  lastTick = now;
                  patchOutput(jobId, output.id, {
                    ratio: progress.ratio,
                    processedSeconds: progress.processedSeconds,
                  });
                },
              });
              patchOutput(jobId, output.id, {
                status: "done",
                ratio: 1,
                // The engine clamps the requested range to the file, so record
                // what was actually produced rather than what was asked for.
                trim: result.trim,
                result,
                url: URL.createObjectURL(result.blob),
              });
            } catch (error) {
              if (isCancelled()) throw error;

              // cancelOutput marks the output before killing the worker, so this
              // is how a per-format cancel is told apart from a real failure.
              // Outputs already finished are JS Blobs and are untouched by the
              // termination; whatever is still pending re-runs below.
              const latest = store.jobs
                .find((entry) => entry.id === jobId)
                ?.outputs.find((entry) => entry.id === output.id);
              if (latest?.status === "cancelled") break;

              // One failed format should not abandon the others.
              patchOutput(jobId, output.id, {
                status: "error",
                ratio: null,
                error: toFailure(error),
              });

              /*
               * A wasm trap is not this format's failure alone: the heap is
               * gone, so the mount, the probe and every command after it are
               * gone with it. The format that crashed keeps its error, the
               * engine is rebuilt below, and everything still pending is handed
               * back to the pump to run on the new one.
               */
              if (isFatal(error)) {
                store.restart.add(jobId);
                store.crashed.add(jobId);
                break;
              }
            }
          }

          if (isCancelled()) throw new ExtractionError("Cancelled.");

          /*
           * The envelope is drawn last, after every output. It costs a full
           * decode, and the audio someone actually asked for should not wait
           * behind a picture of it.
           *
           * Like the thumbnail it is presentational: failing to draw it must not
           * fail the file, so the flag is cleared either way and the error goes
           * no further than the panel.
           */
          const beforeWaveform = store.jobs.find((entry) => entry.id === jobId);
          if (
            beforeWaveform?.wantsWaveform &&
            !beforeWaveform.waveform &&
            !store.restart.has(jobId)
          ) {
            patchJob(jobId, {
              phase: "Reading the audio shape...",
              phaseRatio: 0,
            });
            try {
              let lastWaveTick = 0;
              const waveform = await session.waveform((progress) => {
                const now = Date.now();
                if (now - lastWaveTick < PROGRESS_THROTTLE_MS) return;
                lastWaveTick = now;
                patchJob(jobId, { phaseRatio: progress.ratio });
              });
              patchJob(jobId, {
                waveform,
                wantsWaveform: false,
                phaseRatio: null,
              });
            } catch (error) {
              patchJob(jobId, { wantsWaveform: false, phaseRatio: null });
              if (isFatal(error)) {
                store.restart.add(jobId);
                store.crashed.add(jobId);
              }
            }
            if (isCancelled()) throw new ExtractionError("Cancelled.");
          }

          // Anything that arrived while the envelope was being drawn goes round
          // again; a job that needs a new engine leaves and is re-queued below.
          const arrived = store.jobs
            .find((entry) => entry.id === jobId)
            ?.outputs.some((entry) => entry.status === "pending");
          if (!arrived || store.restart.has(jobId)) break;
        }

        const outputs = store.jobs.find((entry) => entry.id === jobId)?.outputs ?? [];

        // The mount died with the worker, so formats that never got their turn
        // need a fresh session. Re-queueing hands the job straight back to the
        // pump, which is already looping.
        if (store.restart.has(jobId) && outputs.some((o) => o.status === "pending")) {
          patchJob(jobId, {
            status: "queued",
            phase: "Waiting...",
            phaseRatio: null,
          });
        } else {
          patchJob(jobId, { ...summarizeOutputs(outputs), phaseRatio: null });
        }
      } catch (error) {
        if (isCancelled()) {
          patchJob(jobId, {
            status: "cancelled",
            phase: "Cancelled",
            phaseRatio: null,
          });
          settleOutputs(jobId, "cancelled");
        } else {
          const failure = toFailure(error);
          const phase = failure.severity === "info" ? "Nothing to do" : "Failed";
          patchJob(jobId, {
            status: "error",
            phase,
            phaseRatio: null,
            error: failure,
          });
          // Nothing is going to run for this file, so nothing may still say it
          // is waiting to.
          settleOutputs(jobId, "error", failure);
          if (isFatal(error)) {
            store.restart.add(jobId);
            store.crashed.add(jobId);
          }
          // A failure to load the engine is global, not specific to this file.
          if (!ffmpeg.loaded) {
            setEngineState((previous) => ({
              ...previous,
              stage: "error",
              error: failure,
            }));
          }
        }
      } finally {
        clearInterval(logTimer);
        ffmpeg.setLogListener(null);
        flushLogs();
        store.activeJobId = null;

        // Both deletes must run: a file can be cancelled outright while one of
        // its formats is already being cancelled on its own.
        const wasCancelled = store.cancelled.delete(jobId);
        const needsRestart = store.restart.delete(jobId);
        // A cancel is something the visitor did; a crash is something that
        // happened to them, and only the second is worth a banner.
        const crashed = store.crashed.delete(jobId) || ffmpeg.poisoned;

        if (wasCancelled || needsRestart || crashed) {
          // The worker was killed mid-command, or it died on its own; either
          // way the next job needs a fresh one.
          resetEngine();
          setEngineState((previous) => ({
            ...previous,
            stage: "idle",
            capabilities: null,
            restarts: previous.restarts + (crashed ? 1 : 0),
          }));
        } else if (session) {
          await session.close().catch(() => {});
        }
      }
    },
    [patchJob, patchOutput, settleOutputs, store],
  );

  /** Drains the queue; safe to call any number of times. */
  const pump = useCallback(async () => {
    if (store.pumping) return;
    store.pumping = true;
    try {
      for (;;) {
        const next = store.jobs.find((entry) => entry.status === "queued");
        if (!next) break;
        await runJob(next.id);
      }
    } finally {
      store.pumping = false;
    }
  }, [runJob, store]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const current = store.options;
      const formats = availableFormats(
        // A tool whose formats come from a settings panel has no selection to
        // honour: the panel is the selection, and it is already in the ids.
        current.formatPicker ? store.selectedFormats : current.defaultFormatIds,
        engineState.capabilities,
        current,
      );
      const settings = store.trimSettings;
      /*
       * Newly added files are never pre-clipped. A range is chosen per file on
       * the card, where there is a duration to validate against; and in silence
       * mode the range is not known yet either, because the run fills it in for
       * every pending output once it has listened to the file.
       */
      const trim: TrimRange | null = null;

      const newJobs: Job[] = files.map((file) => {
        /*
         * A text file dropped on a video tool is answerable now. Letting it
         * through means a 31 MB core download and a mount before ffmpeg says
         * the same thing, which is a long wait for an answer that was never in
         * doubt.
         */
        const rejection = rejectFile(file);
        if (rejection) {
          return {
            id: nextJobId(),
            file,
            status: "error" as const,
            phase: "Failed",
            phaseRatio: null,
            trim,
            autoTrim: false,
            silenceOptions: settings.silence,
            outputs: [],
            error: { ...rejection, retryable: false },
            logs: [],
          };
        }

        return {
          id: nextJobId(),
          file,
          status: "queued" as const,
          phase: "Waiting...",
          phaseRatio: null,
          trim,
          autoTrim: settings.mode === "silence",
          silenceOptions: settings.silence,
          outputs: makeOutputs(formats, trim),
          // The clip panel is always open, so the envelope is always wanted.
          wantsWaveform: current.waveform ?? true,
          sourceUrl:
            current.sourcePreview && canPreviewSource(file)
              ? URL.createObjectURL(file)
              : undefined,
          logs: [],
        };
      });
      commit([...store.jobs, ...newJobs]);
      void pump();
    },
    [commit, pump, store],
  );

  /**
   * Queues another output for a file, either the whole audio or a clip of it.
   *
   * A job still running picks the new output up on its next pass, so its
   * status is left alone; one that has finished is handed back to the pump.
   */
  const addFormatToJob = useCallback(
    (jobId: string, formatId: string, trim: TrimRange | null = null) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      if (!job) return;
      // The catalogue as it stands now, so a tool's current settings apply.
      const format = findFormat(store.options.formats, formatId);
      if (!format) return;
      // Same format over the same range is the output that already exists - but
      // a cancelled one has no audio behind it, so it does not block a re-add.
      const duplicate = job.outputs.some(
        (output) =>
          output.formatId === formatId &&
          output.status !== "cancelled" &&
          sameTrimRange(output.trim, trim),
      );
      if (duplicate) return;

      const isActive = store.activeJobId === jobId;
      patchJob(jobId, (current) => ({
        trim,
        error: undefined,
        outputs: [...current.outputs, ...makeOutputs([format], trim)],
        ...(isActive ? {} : { status: "queued" as const, phase: "Waiting..." }),
      }));
      if (!isActive) void pump();
    },
    [patchJob, pump, store],
  );

  /**
   * Runs a silence scan over a file that is already in the queue, without
   * producing any audio - the point is the suggested range it comes back with.
   */
  const detectSilence = useCallback(
    (jobId: string, silenceOptions?: Partial<SilenceScanOptions>) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      if (!job || job.status === "preparing" || job.status === "converting") return;

      patchJob(jobId, {
        status: "queued",
        phase: "Waiting...",
        error: undefined,
        autoTrim: true,
        silence: undefined,
        silenceOptions: { ...job.silenceOptions, ...silenceOptions },
      });
      void pump();
    },
    [patchJob, pump, store],
  );

  const retryJob = useCallback(
    (jobId: string) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      if (!job) return;
      patchJob(jobId, {
        status: "queued",
        phase: "Waiting...",
        error: undefined,
        logs: [],
        outputs: job.outputs.map((output) =>
          output.status === "done"
            ? output
            : { ...output, status: "pending", ratio: null, error: undefined },
        ),
      });
      void pump();
    },
    [patchJob, pump, store],
  );

  /**
   * Stops one output without disturbing the others.
   *
   * ffmpeg blocks its worker for the whole of a command, so a conversion that
   * has already started can only be stopped by killing the worker - there is no
   * cooperative interrupt. That is survivable here because a finished output is
   * a JS Blob that never lived in the worker: the downloads already on the card
   * keep working. What the termination does cost is the mount, so any format
   * still queued behind this one is re-run on a fresh engine, and the core is
   * cached by then, so the restart is a WebAssembly instantiation rather than a
   * 31 MB download.
   */
  const cancelOutput = useCallback(
    (jobId: string, outputId: string) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      const output = job?.outputs.find((entry) => entry.id === outputId);
      if (!job || !output) return;
      if (output.status === "done" || output.status === "cancelled") return;

      // Marked before the worker dies so the run loop can tell this apart from
      // a genuine failure, and so the row reacts immediately.
      patchOutput(jobId, outputId, {
        status: "cancelled",
        ratio: null,
        error: undefined,
      });

      if (output.status === "running") {
        store.restart.add(jobId);
        getEngine().terminate();
      }
    },
    [patchOutput, store],
  );

  /** Puts a cancelled or failed output back in the queue on its own. */
  const retryOutput = useCallback(
    (jobId: string, outputId: string) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      const output = job?.outputs.find((entry) => entry.id === outputId);
      if (!job || !output) return;
      if (output.status === "running" || output.status === "done") return;

      // A job that is still running picks this up on its next pass; one that
      // has finished has to be handed back to the pump.
      const isActive = store.activeJobId === jobId;

      patchJob(jobId, (current) => {
        const outputs = current.outputs.map((entry) =>
          entry.id === outputId
            ? {
                ...entry,
                status: "pending" as const,
                ratio: null,
                processedSeconds: 0,
                error: undefined,
              }
            : entry,
        );
        return isActive
          ? { outputs, error: undefined }
          : {
              outputs,
              error: undefined,
              status: "queued" as const,
              phase: "Waiting...",
            };
      });

      if (!isActive) void pump();
    },
    [patchJob, pump, store],
  );

  const cancelJob = useCallback(
    (jobId: string) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      if (!job) return;

      if (store.activeJobId === jobId) {
        // ffmpeg blocks its worker while running, so the only way to stop a
        // conversion in flight is to kill the worker. During the core download
        // there is no worker yet and nothing to kill: the download is left to
        // finish, since the next file needs it anyway, and the job is settled
        // the moment the engine comes back. Say so now, so the card does not
        // look ignored in the meantime, and stop every row that is still
        // waiting for a turn it will not get.
        store.cancelled.add(jobId);
        patchJob(jobId, { phase: "Cancelling...", phaseRatio: null });
        settleOutputs(jobId, "cancelled");
        getEngine().terminate();
        return;
      }

      // Still waiting its turn: nothing is running, so the outputs can be
      // settled along with the file rather than left saying "Waiting".
      patchJob(jobId, { status: "cancelled", phase: "Cancelled" });
      settleOutputs(jobId, "cancelled");
    },
    [patchJob, settleOutputs, store],
  );

  const removeJob = useCallback(
    (jobId: string) => {
      const job = store.jobs.find((entry) => entry.id === jobId);
      if (!job) return;
      if (store.activeJobId === jobId) cancelJob(jobId);
      store.restart.delete(jobId);
      store.crashed.delete(jobId);
      releaseJobUrls(job);
      commit(store.jobs.filter((entry) => entry.id !== jobId));
    },
    [cancelJob, commit, store],
  );

  const clearFinished = useCallback(() => {
    const remaining: Job[] = [];
    for (const job of store.jobs) {
      const isFinished =
        job.status === "done" || job.status === "cancelled" || job.status === "error";
      if (isFinished) {
        releaseJobUrls(job);
      } else {
        remaining.push(job);
      }
    }
    commit(remaining);
  }, [commit, store]);

  /*
   * Object URLs are deliberately *not* revoked when the page unmounts. The
   * store outlives the component precisely so a finished output survives a
   * visit to another tool, and revoking here would hand the visitor back a
   * card full of dead download links. The browser releases them when the
   * document does; "Remove" and "Clear finished" release them before that.
   */

  // Settings a tool remembers between visits.
  useEffect(() => {
    if (store.hydrated) return;
    store.hydrated = true;

    if (options.formatPicker) {
      const stored = readStored(storageKey("formats", options.key ?? "default"), isStringArray);
      const known = stored?.filter((id) => findFormat(options.formats, id) !== undefined) ?? [];
      if (known.length > 0) store.selectedFormats = known;
    }

    const strip = readStored(storageKey("strip-metadata"), isBoolean);
    if (strip !== null) store.stripMetadata = strip;

    const trim = readStored(storageKey("trim", options.key ?? "default"), isTrimSettings);
    if (trim) store.trimSettings = trim;

    notify(store);
    // Options are captured once; the store is created from the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    if (!store.hydrated || !options.formatPicker) return;
    writeStored(storageKey("formats", options.key ?? "default"), selectedFormats);
  }, [options.formatPicker, options.key, selectedFormats, store]);

  useEffect(() => {
    if (!store.hydrated) return;
    writeStored(storageKey("strip-metadata"), stripMetadata);
  }, [stripMetadata, store]);

  useEffect(() => {
    if (!store.hydrated) return;
    writeStored(storageKey("trim", options.key ?? "default"), trimSettings);
  }, [options.key, trimSettings, store]);

  // Warn before navigating away mid-conversion: the work cannot be resumed.
  useEffect(() => {
    const busy = jobs.some((job) => job.status === "converting" || job.status === "preparing");
    if (!busy) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Safari and Chrome only honour the legacy form.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [jobs]);

  const activeCount = jobs.filter(
    (job) => job.status === "queued" || job.status === "preparing" || job.status === "converting",
  ).length;

  return {
    jobs,
    engineState: engine,
    selectedFormats,
    setSelectedFormats,
    trimSettings,
    setTrimSettings,
    stripMetadata,
    setStripMetadata,
    addFiles,
    addFormatToJob,
    detectSilence,
    cancelOutput,
    retryOutput,
    cancelJob,
    removeJob,
    retryJob,
    clearFinished,
    activeCount,
  };
}

/* ---- Stored-value validators -------------------------------------------- */

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isTrimSettings(value: unknown): value is TrimSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TrimSettings>;
  return (
    (candidate.mode === "full" || candidate.mode === "silence") &&
    typeof candidate.silence === "object" &&
    candidate.silence !== null &&
    typeof candidate.silence.thresholdDb === "number" &&
    typeof candidate.silence.minDurationSeconds === "number"
  );
}
