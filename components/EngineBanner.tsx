"use client";

import { CORE_LABEL } from "@/lib/engine/coreLoader";
import { formatBytes } from "@/lib/format-utils";
import type { EngineState } from "@/lib/useConversionQueue";

import { ProgressBar } from "./ProgressBar";

interface EngineBannerProps {
  state: EngineState;
}

/**
 * Surfaces the one-time ffmpeg core download.
 *
 * It is ~31 MB, so the first conversion would otherwise begin with a long,
 * unexplained pause. Once the engine is ready this collapses to nothing.
 */
export function EngineBanner({ state }: EngineBannerProps) {
  if (state.stage === "idle" || state.stage === "ready") return null;

  if (state.stage === "error") {
    return (
      <div
        role="alert"
        className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm"
      >
        <p className="font-medium text-danger">
          {state.error?.message ?? "The ffmpeg engine failed to load."}
        </p>
        {state.error?.hint && <p className="mt-1 text-muted">{state.error.hint}</p>}
      </div>
    );
  }

  const isDownloading = state.stage === "downloading-core";

  return (
    <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {isDownloading ? "Downloading the ffmpeg engine…" : "Starting the ffmpeg engine…"}
        </p>
        {isDownloading && state.totalBytes > 0 && (
          <p className="text-xs tabular-nums text-muted">
            {formatBytes(state.receivedBytes)} / {formatBytes(state.totalBytes)}
          </p>
        )}
      </div>

      <div className="mt-2">
        <ProgressBar
          ratio={isDownloading ? state.ratio : null}
          label="ffmpeg engine loading progress"
        />
      </div>

      <p className="mt-2 text-xs text-subtle">
        {CORE_LABEL} is fetched once and then cached by your browser.
      </p>
    </div>
  );
}
