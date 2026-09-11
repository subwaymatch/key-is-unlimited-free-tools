"use client";

/**
 * The state of the one ffmpeg engine, shared by every tool on the page.
 *
 * There is one worker and one core, so there is one banner's worth of state:
 * the core downloaded on the converter is loaded when the merger opens, and its
 * banner should say so rather than starting again at "idle". The queue and
 * the merger both drive it, and both read it through the same hook.
 */
import { useSyncExternalStore } from "react";

import { ExtractionError } from "./engine/types";
import type { AudioExtractor, EngineCapabilities, EngineLoadStage, FailureSeverity } from "./engine/types";

export interface JobFailure {
  message: string;
  hint?: string;
  /** "info" is a job with nothing to do rather than one that went wrong. */
  severity?: FailureSeverity;
  /** False when running the same job again can only produce the same result. */
  retryable?: boolean;
}

export function toFailure(error: unknown): JobFailure {
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
export function isFatal(error: unknown): boolean {
  return error instanceof ExtractionError && error.fatal;
}

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

/** Minimum gap between progress-driven re-renders. */
export const PROGRESS_THROTTLE_MS = 100;

const INITIAL_ENGINE_STATE: EngineState = {
  stage: "idle",
  ratio: null,
  receivedBytes: 0,
  totalBytes: 0,
  capabilities: null,
  restarts: 0,
};

let engineState: EngineState = INITIAL_ENGINE_STATE;
const listeners = new Set<() => void>();

export function setEngineState(patch: (previous: EngineState) => EngineState): void {
  engineState = patch(engineState);
  for (const listener of listeners) listener();
}

export function getEngineState(): EngineState {
  return engineState;
}

export function subscribeEngineState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEngineState(): EngineState {
  return useSyncExternalStore(subscribeEngineState, getEngineState, getEngineState);
}

/** @internal - lets tests start from a clean page. */
export function resetEngineState(): void {
  engineState = INITIAL_ENGINE_STATE;
}

/**
 * Loads the engine and mirrors its progress into the shared state.
 *
 * The core download reports several times a second; milestones always go
 * through and the rest are throttled, so the banner moves without the whole
 * page re-rendering on every chunk.
 */
export async function loadEngine(
  engine: Pick<AudioExtractor, "load">,
): Promise<EngineCapabilities> {
  let lastTick = 0;
  const capabilities = await engine.load((progress) => {
    const now = Date.now();
    const isMilestone = progress.stage !== "downloading-core" || progress.ratio === 1;
    if (!isMilestone && now - lastTick < PROGRESS_THROTTLE_MS) return;
    lastTick = now;
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
  return capabilities;
}

/** A failure to load the engine is global, not specific to one file. */
export function markEngineFailed(failure: JobFailure): void {
  setEngineState((previous) => ({ ...previous, stage: "error", error: failure }));
}

/**
 * The worker was killed, or died; the next job builds a fresh one.
 *
 * A cancel is something the visitor did; a crash is something that happened
 * to them, and only the second is counted, because only the second is worth
 * a banner.
 */
export function markEngineRestarted(crashed: boolean): void {
  setEngineState((previous) => ({
    ...previous,
    stage: "idle",
    capabilities: null,
    restarts: previous.restarts + (crashed ? 1 : 0),
  }));
}
