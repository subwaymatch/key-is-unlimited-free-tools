"use client";

/**
 * Sequential conversion queue.
 *
 * Files convert one at a time on purpose: there is a single ffmpeg worker with
 * a single heap, so running jobs concurrently would multiply peak memory
 * without making anything faster (the work is I/O- and codec-bound, not
 * parallel). One job at a time also keeps progress reporting unambiguous.
 *
 * Queue state lives in a ref that mirrors React state, because the async pump
 * runs outside the render cycle and must never read a stale snapshot.
 *
 * ffmpeg emits log lines and progress events far faster than a UI needs to
 * repaint, so both are coalesced before they reach React state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getEngine, resetEngine } from "./engine/ffmpegEngine";
import { DEFAULT_FORMAT_IDS, getFormat, type OutputFormatId } from "./engine/formats";
import { DEFAULT_SILENCE_OPTIONS, parseTrimInputs, sameTrimRange } from "./engine/trim";
import { ExtractionError } from "./engine/types";
import type {
  EngineCapabilities,
  EngineLoadStage,
  ExtractOutput,
  ProbeResult,
  SilenceScanOptions,
  SilenceScanResult,
  TrimRange,
} from "./engine/types";

export type JobStatus = "queued" | "preparing" | "converting" | "done" | "error" | "cancelled";

export type OutputStatus = "pending" | "running" | "done" | "error" | "cancelled";

export interface JobFailure {
  message: string;
  hint?: string;
}

export interface JobOutput {
  /**
   * Identity of this output.
   *
   * The format alone is not enough once a file can be clipped: "MP3 of the
   * whole thing" and "MP3 of 1:30–2:15" are two outputs of the same format.
   */
  id: string;
  formatId: OutputFormatId;
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
  /** Range the trim panel currently proposes for new outputs. */
  trim: TrimRange | null;
  /** When true, the next run detects silence and derives `trim` from it. */
  autoTrim: boolean;
  silenceOptions: SilenceScanOptions;
  /** Result of the last silence scan, once one has run. */
  silence?: SilenceScanResult;
  outputs: JobOutput[];
  error?: JobFailure;
  logs: string[];
  startedAt?: number;
  finishedAt?: number;
}

export type TrimMode = "full" | "silence" | "range";

/**
 * Trim settings for files added next, alongside the format selection.
 *
 * The markers are kept as raw text rather than seconds: the file has not been
 * probed yet, so "2:30" cannot be validated against a duration, and echoing
 * back a reformatted number while someone is still typing is hostile.
 */
export interface TrimSettings {
  mode: TrimMode;
  startText: string;
  endText: string;
  silence: SilenceScanOptions;
}

export const DEFAULT_TRIM_SETTINGS: TrimSettings = {
  mode: "full",
  startText: "",
  endText: "",
  silence: DEFAULT_SILENCE_OPTIONS,
};

export interface EngineState {
  stage: EngineLoadStage | "error";
  ratio: number | null;
  receivedBytes: number;
  totalBytes: number;
  capabilities: EngineCapabilities | null;
  error?: JobFailure;
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
};

function toFailure(error: unknown): JobFailure {
  if (error instanceof ExtractionError) return { message: error.message, hint: error.hint };
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "string") return { message: error };
  return { message: "Something went wrong." };
}

let outputCounter = 0;
const nextOutputId = () => `output-${(outputCounter += 1)}`;

function makeOutputs(
  formatIds: readonly OutputFormatId[],
  trim: TrimRange | null,
): JobOutput[] {
  return formatIds.map((formatId) => ({
    id: nextOutputId(),
    formatId,
    label: getFormat(formatId).label,
    trim,
    status: "pending" as const,
    ratio: null,
    processedSeconds: 0,
  }));
}

let jobCounter = 0;
const nextJobId = () => `job-${(jobCounter += 1)}-${Date.now().toString(36)}`;

export function useConversionQueue() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [engineState, setEngineState] = useState<EngineState>(INITIAL_ENGINE_STATE);
  const [selectedFormats, setSelectedFormats] = useState<OutputFormatId[]>(DEFAULT_FORMAT_IDS);
  const [trimSettings, setTrimSettings] = useState<TrimSettings>(DEFAULT_TRIM_SETTINGS);

  const jobsRef = useRef<Job[]>([]);
  const pumpingRef = useRef(false);
  const activeJobRef = useRef<string | null>(null);
  const cancelledRef = useRef<Set<string>>(new Set());
  /**
   * Jobs whose worker was killed to stop one output rather than the whole file.
   * The engine has to be rebuilt, and any formats still pending re-run on it.
   */
  const partialCancelRef = useRef<Set<string>>(new Set());
  const selectedFormatsRef = useRef<OutputFormatId[]>(selectedFormats);
  const trimSettingsRef = useRef<TrimSettings>(trimSettings);

  selectedFormatsRef.current = selectedFormats;
  trimSettingsRef.current = trimSettings;

  const commit = useCallback((next: Job[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const patchJob = useCallback(
    (id: string, patch: Partial<Job> | ((job: Job) => Partial<Job>)) => {
      commit(
        jobsRef.current.map((job) =>
          job.id === id ? { ...job, ...(typeof patch === "function" ? patch(job) : patch) } : job,
        ),
      );
    },
    [commit],
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

  /** Runs one job to completion; never throws. */
  const runJob = useCallback(
    async (jobId: string) => {
      const engine = getEngine();
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (!job) return;

      activeJobRef.current = jobId;
      patchJob(jobId, {
        status: "preparing",
        phase: engine.loaded ? "Reading file details…" : "Loading the ffmpeg engine…",
        startedAt: job.startedAt ?? Date.now(),
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
      engine.setLogListener(({ message }) => {
        logBuffer.push(message);
      });
      const logTimer = setInterval(flushLogs, LOG_FLUSH_MS);

      const isCancelled = () => cancelledRef.current.has(jobId);

      let session: Awaited<ReturnType<typeof engine.openSession>> | null = null;
      try {
        let lastEngineTick = 0;
        const capabilities = await engine.load((progress) => {
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
        setEngineState((previous) => ({ ...previous, stage: "ready", capabilities }));
        if (isCancelled()) throw new ExtractionError("Cancelled.");

        patchJob(jobId, { phase: "Reading file details…" });
        session = await engine.openSession(job.file);
        if (isCancelled()) throw new ExtractionError("Cancelled.");

        patchJob(jobId, { status: "converting", probe: session.probe });

        // Automatic trimming has to happen here rather than at queue time: the
        // range is not knowable until the audio has been listened to, and the
        // outputs waiting behind it inherit whatever the scan finds.
        if (jobsRef.current.find((entry) => entry.id === jobId)?.autoTrim) {
          const options = jobsRef.current.find((entry) => entry.id === jobId)!.silenceOptions;
          patchJob(jobId, { phase: "Listening for silence…", phaseRatio: 0 });

          let lastScanTick = 0;
          const silence = await session.detectSilence(options, (progress) => {
            const now = Date.now();
            if (now - lastScanTick < PROGRESS_THROTTLE_MS) return;
            lastScanTick = now;
            patchJob(jobId, { phaseRatio: progress.ratio });
          });
          if (isCancelled()) throw new ExtractionError("Cancelled.");

          patchJob(jobId, (current) => ({
            silence,
            autoTrim: false,
            trim: silence.suggested,
            phaseRatio: null,
            outputs: current.outputs.map((output) =>
              output.status === "pending" ? { ...output, trim: silence.suggested } : output,
            ),
          }));
        }

        // Re-read the pending output each pass rather than iterating a snapshot:
        // an output can be cancelled, or retried back into the queue, while the
        // job it belongs to is still running.
        for (;;) {
          if (isCancelled()) throw new ExtractionError("Cancelled.");

          const output = jobsRef.current
            .find((entry) => entry.id === jobId)
            ?.outputs.find((entry) => entry.status === "pending");
          if (!output) break;

          const format = getFormat(output.formatId);
          patchJob(jobId, {
            phase: output.trim ? `Extracting ${format.label} clip…` : `Extracting ${format.label}…`,
          });
          patchOutput(jobId, output.id, { status: "running", ratio: 0, processedSeconds: 0 });

          try {
            let lastTick = 0;
            const result = await session.extract(output.formatId, {
              trim: output.trim,
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
            const current = jobsRef.current
              .find((entry) => entry.id === jobId)
              ?.outputs.find((entry) => entry.id === output.id);
            if (current?.status === "cancelled") break;

            // One failed format should not abandon the others.
            patchOutput(jobId, output.id, {
              status: "error",
              ratio: null,
              error: toFailure(error),
            });
          }
        }

        if (isCancelled()) throw new ExtractionError("Cancelled.");

        const outputs = jobsRef.current.find((entry) => entry.id === jobId)?.outputs ?? [];

        // The mount died with the worker, so formats that never got their turn
        // need a fresh session. Re-queueing hands the job straight back to the
        // pump, which is already looping.
        if (partialCancelRef.current.has(jobId) && outputs.some((o) => o.status === "pending")) {
          patchJob(jobId, { status: "queued", phase: "Waiting…", phaseRatio: null });
        } else {
          const anyDone = outputs.some((output) => output.status === "done");
          const firstError = outputs.find((output) => output.error)?.error;
          const failed = !anyDone && firstError !== undefined;
          // Nothing produced and nothing broken: the formats were cancelled.
          const cancelled =
            !anyDone && !failed && outputs.some((output) => output.status === "cancelled");

          patchJob(jobId, {
            status: failed ? "error" : cancelled ? "cancelled" : "done",
            phase: failed ? "Failed" : cancelled ? "Cancelled" : "Done",
            phaseRatio: null,
            error: failed ? firstError : undefined,
            finishedAt: Date.now(),
          });
        }
      } catch (error) {
        if (isCancelled()) {
          patchJob(jobId, {
            status: "cancelled",
            phase: "Cancelled",
            phaseRatio: null,
            finishedAt: Date.now(),
          });
        } else {
          const failure = toFailure(error);
          patchJob(jobId, {
            status: "error",
            phase: "Failed",
            phaseRatio: null,
            error: failure,
            finishedAt: Date.now(),
          });
          // A failure to load the engine is global, not specific to this file.
          if (!engine.loaded) {
            setEngineState((previous) => ({ ...previous, stage: "error", error: failure }));
          }
        }
      } finally {
        clearInterval(logTimer);
        engine.setLogListener(null);
        flushLogs();
        activeJobRef.current = null;

        // Both deletes must run: a file can be cancelled outright while one of
        // its formats is already being cancelled on its own.
        const wasCancelled = cancelledRef.current.delete(jobId);
        const hadOutputCancelled = partialCancelRef.current.delete(jobId);

        if (wasCancelled || hadOutputCancelled) {
          // The worker was killed mid-command; the next job needs a fresh one.
          resetEngine();
          setEngineState((previous) => ({ ...previous, stage: "idle", capabilities: null }));
        } else if (session) {
          await session.close().catch(() => {});
        }
      }
    },
    [patchJob, patchOutput],
  );

  /** Drains the queue; safe to call any number of times. */
  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      for (;;) {
        const next = jobsRef.current.find((entry) => entry.status === "queued");
        if (!next) break;
        await runJob(next.id);
      }
    } finally {
      pumpingRef.current = false;
    }
  }, [runJob]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const formatIds = selectedFormatsRef.current;
      const settings = trimSettingsRef.current;
      // In silence mode the range is still unknown; the run fills it in for
      // every pending output once it has listened to the file.
      const trim =
        settings.mode === "range"
          ? parseTrimInputs(settings.startText, settings.endText).trim
          : null;

      const newJobs: Job[] = files.map((file) => ({
        id: nextJobId(),
        file,
        status: "queued",
        phase: "Waiting…",
        phaseRatio: null,
        trim,
        autoTrim: settings.mode === "silence",
        silenceOptions: settings.silence,
        outputs: makeOutputs(formatIds.length > 0 ? formatIds : DEFAULT_FORMAT_IDS, trim),
        logs: [],
      }));
      commit([...jobsRef.current, ...newJobs]);
      void pump();
    },
    [commit, pump],
  );

  /**
   * Queues another output for a file that has already been converted, either
   * the whole audio or a clip of it.
   */
  const addFormatToJob = useCallback(
    (jobId: string, formatId: OutputFormatId, trim: TrimRange | null = null) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (!job) return;
      // Same format over the same range is the output that already exists — but
      // a cancelled one has no audio behind it, so it does not block a re-add.
      const duplicate = job.outputs.some(
        (output) =>
          output.formatId === formatId &&
          output.status !== "cancelled" &&
          sameTrimRange(output.trim, trim),
      );
      if (duplicate) return;

      patchJob(jobId, {
        status: "queued",
        phase: "Waiting…",
        error: undefined,
        trim,
        outputs: [...job.outputs, ...makeOutputs([formatId], trim)],
      });
      void pump();
    },
    [patchJob, pump],
  );

  /**
   * Runs a silence scan over a file that is already in the queue, without
   * producing any audio — the point is the suggested range it comes back with.
   */
  const detectSilence = useCallback(
    (jobId: string, options?: Partial<SilenceScanOptions>) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (!job || job.status === "preparing" || job.status === "converting") return;

      patchJob(jobId, {
        status: "queued",
        phase: "Waiting…",
        error: undefined,
        autoTrim: true,
        silence: undefined,
        silenceOptions: { ...job.silenceOptions, ...options },
      });
      void pump();
    },
    [patchJob, pump],
  );

  const retryJob = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (!job) return;
      patchJob(jobId, {
        status: "queued",
        phase: "Waiting…",
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
    [patchJob, pump],
  );

  /**
   * Stops one output without disturbing the others.
   *
   * ffmpeg blocks its worker for the whole of a command, so a conversion that
   * has already started can only be stopped by killing the worker — there is no
   * cooperative interrupt. That is survivable here because a finished output is
   * a JS Blob that never lived in the worker: the downloads already on the card
   * keep working. What the termination does cost is the mount, so any format
   * still queued behind this one is re-run on a fresh engine, and the core is
   * cached by then, so the restart is a WebAssembly instantiation rather than a
   * 31 MB download.
   */
  const cancelOutput = useCallback(
    (jobId: string, outputId: string) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      const output = job?.outputs.find((entry) => entry.id === outputId);
      if (!job || !output) return;
      if (output.status === "done" || output.status === "cancelled") return;

      // Marked before the worker dies so the run loop can tell this apart from
      // a genuine failure, and so the row reacts immediately.
      patchOutput(jobId, outputId, { status: "cancelled", ratio: null, error: undefined });

      if (output.status === "running") {
        partialCancelRef.current.add(jobId);
        getEngine().terminate();
      }
    },
    [patchOutput],
  );

  /** Puts a cancelled or failed output back in the queue on its own. */
  const retryOutput = useCallback(
    (jobId: string, outputId: string) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      const output = job?.outputs.find((entry) => entry.id === outputId);
      if (!job || !output) return;
      if (output.status === "running" || output.status === "done") return;

      // A job that is still running picks this up on its next pass; one that
      // has finished has to be handed back to the pump.
      const isActive = activeJobRef.current === jobId;

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
          : { outputs, error: undefined, status: "queued" as const, phase: "Waiting…" };
      });

      if (!isActive) void pump();
    },
    [patchJob, pump],
  );

  const cancelJob = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (!job) return;

      if (activeJobRef.current === jobId) {
        // ffmpeg blocks its worker while running, so the only way to stop a
        // conversion in flight is to kill the worker.
        cancelledRef.current.add(jobId);
        getEngine().terminate();
        return;
      }

      patchJob(jobId, { status: "cancelled", phase: "Cancelled", finishedAt: Date.now() });
    },
    [patchJob],
  );

  const removeJob = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (!job) return;
      if (activeJobRef.current === jobId) cancelJob(jobId);
      partialCancelRef.current.delete(jobId);
      for (const output of job.outputs) {
        if (output.url) URL.revokeObjectURL(output.url);
      }
      commit(jobsRef.current.filter((entry) => entry.id !== jobId));
    },
    [cancelJob, commit],
  );

  const clearFinished = useCallback(() => {
    const remaining: Job[] = [];
    for (const job of jobsRef.current) {
      const isFinished =
        job.status === "done" || job.status === "cancelled" || job.status === "error";
      if (isFinished) {
        for (const output of job.outputs) {
          if (output.url) URL.revokeObjectURL(output.url);
        }
      } else {
        remaining.push(job);
      }
    }
    commit(remaining);
  }, [commit]);

  // Release every object URL when the page goes away.
  useEffect(
    () => () => {
      for (const job of jobsRef.current) {
        for (const output of job.outputs) {
          if (output.url) URL.revokeObjectURL(output.url);
        }
      }
    },
    [],
  );

  // Warn before navigating away mid-conversion: the work cannot be resumed.
  useEffect(() => {
    const busy = jobs.some((job) => job.status === "converting" || job.status === "preparing");
    if (!busy) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [jobs]);

  const activeCount = jobs.filter(
    (job) => job.status === "queued" || job.status === "preparing" || job.status === "converting",
  ).length;

  return {
    jobs,
    engineState,
    selectedFormats,
    setSelectedFormats,
    trimSettings,
    setTrimSettings,
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
