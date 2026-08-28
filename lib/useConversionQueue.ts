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
import { ExtractionError } from "./engine/types";
import type {
  EngineCapabilities,
  EngineLoadStage,
  ExtractOutput,
  ProbeResult,
} from "./engine/types";

export type JobStatus = "queued" | "preparing" | "converting" | "done" | "error" | "cancelled";

export type OutputStatus = "pending" | "running" | "done" | "error";

export interface JobFailure {
  message: string;
  hint?: string;
}

export interface JobOutput {
  formatId: OutputFormatId;
  label: string;
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
  probe?: ProbeResult;
  outputs: JobOutput[];
  error?: JobFailure;
  logs: string[];
  startedAt?: number;
  finishedAt?: number;
}

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

function makeOutputs(formatIds: readonly OutputFormatId[]): JobOutput[] {
  return formatIds.map((formatId) => ({
    formatId,
    label: getFormat(formatId).label,
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

  const jobsRef = useRef<Job[]>([]);
  const pumpingRef = useRef(false);
  const activeJobRef = useRef<string | null>(null);
  const cancelledRef = useRef<Set<string>>(new Set());
  const selectedFormatsRef = useRef<OutputFormatId[]>(selectedFormats);

  selectedFormatsRef.current = selectedFormats;

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
    (jobId: string, formatId: OutputFormatId, patch: Partial<JobOutput>) => {
      patchJob(jobId, (job) => ({
        outputs: job.outputs.map((output) =>
          output.formatId === formatId ? { ...output, ...patch } : output,
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

        const pending = (jobsRef.current.find((entry) => entry.id === jobId)?.outputs ?? []).filter(
          (output) => output.status === "pending",
        );

        for (const output of pending) {
          if (isCancelled()) throw new ExtractionError("Cancelled.");

          const format = getFormat(output.formatId);
          patchJob(jobId, { phase: `Extracting ${format.label}…` });
          patchOutput(jobId, output.formatId, { status: "running", ratio: 0, processedSeconds: 0 });

          try {
            let lastTick = 0;
            const result = await session.extract(output.formatId, (progress) => {
              const now = Date.now();
              if (now - lastTick < PROGRESS_THROTTLE_MS) return;
              lastTick = now;
              patchOutput(jobId, output.formatId, {
                ratio: progress.ratio,
                processedSeconds: progress.processedSeconds,
              });
            });
            patchOutput(jobId, output.formatId, {
              status: "done",
              ratio: 1,
              result,
              url: URL.createObjectURL(result.blob),
            });
          } catch (error) {
            if (isCancelled()) throw error;
            // One failed format should not abandon the others.
            patchOutput(jobId, output.formatId, {
              status: "error",
              ratio: null,
              error: toFailure(error),
            });
          }
        }

        if (isCancelled()) throw new ExtractionError("Cancelled.");

        const finished = jobsRef.current.find((entry) => entry.id === jobId);
        const anySucceeded = finished?.outputs.some((output) => output.status === "done") ?? false;
        const firstError = finished?.outputs.find((output) => output.error)?.error;

        patchJob(jobId, {
          status: anySucceeded ? "done" : "error",
          phase: anySucceeded ? "Done" : "Failed",
          error: anySucceeded ? undefined : firstError,
          finishedAt: Date.now(),
        });
      } catch (error) {
        if (isCancelled()) {
          patchJob(jobId, { status: "cancelled", phase: "Cancelled", finishedAt: Date.now() });
        } else {
          const failure = toFailure(error);
          patchJob(jobId, {
            status: "error",
            phase: "Failed",
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

        if (cancelledRef.current.has(jobId)) {
          // The worker was killed mid-command; the next job needs a fresh one.
          cancelledRef.current.delete(jobId);
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
      const newJobs: Job[] = files.map((file) => ({
        id: nextJobId(),
        file,
        status: "queued",
        phase: "Waiting…",
        outputs: makeOutputs(formatIds.length > 0 ? formatIds : DEFAULT_FORMAT_IDS),
        logs: [],
      }));
      commit([...jobsRef.current, ...newJobs]);
      void pump();
    },
    [commit, pump],
  );

  /** Adds another output format to a file that has already been converted. */
  const addFormatToJob = useCallback(
    (jobId: string, formatId: OutputFormatId) => {
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (!job || job.outputs.some((output) => output.formatId === formatId)) return;
      patchJob(jobId, {
        status: "queued",
        phase: "Waiting…",
        error: undefined,
        outputs: [...job.outputs, ...makeOutputs([formatId])],
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
    addFiles,
    addFormatToJob,
    cancelJob,
    removeJob,
    retryJob,
    clearFinished,
    activeCount,
  };
}
