"use client";

import { useMemo, useRef, useState } from "react";

import { OUTPUT_FORMATS, type OutputFormatId } from "@/lib/engine/formats";
import { formatTimecode } from "@/lib/engine/trim";
import type { EngineCapabilities, TrimRange } from "@/lib/engine/types";
import {
  describeAudio,
  formatBytes,
  formatDuration,
  formatElapsed,
  formatPercent,
  isLikelyPlayable,
} from "@/lib/format-utils";
import type { Job, JobOutput } from "@/lib/useConversionQueue";

import { ProgressBar } from "./ProgressBar";
import { TrimPanel } from "./TrimPanel";

interface FileCardProps {
  job: Job;
  capabilities: EngineCapabilities | null;
  onCancel: (jobId: string) => void;
  onRemove: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onAddFormat: (jobId: string, formatId: OutputFormatId, trim?: TrimRange | null) => void;
  onDetectSilence: (jobId: string) => void;
  onCancelOutput: (jobId: string, outputId: string) => void;
  onRetryOutput: (jobId: string, outputId: string) => void;
}

const STATUS_STYLE: Record<Job["status"], string> = {
  queued: "bg-border-subtle text-muted",
  preparing: "bg-accent-soft text-accent",
  converting: "bg-accent-soft text-accent",
  done: "bg-success-soft text-success",
  error: "bg-danger-soft text-danger",
  cancelled: "bg-border-subtle text-muted",
};

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  preparing: "Preparing",
  converting: "Converting",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

const ROW_BUTTON =
  "rounded-md border border-border-strong px-2 py-1 text-xs font-medium transition-colors hover:bg-surface";

function OutputRow({
  output,
  durationSeconds,
  onCancel,
  onRetry,
}: {
  output: JobOutput;
  durationSeconds: number | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { result, trim } = output;

  const range = trim
    ? `${formatTimecode(trim.startSeconds)}–${
        trim.endSeconds !== null
          ? formatTimecode(trim.endSeconds)
          : durationSeconds !== null
            ? formatTimecode(durationSeconds)
            : "end"
      }`
    : null;

  return (
    <div className="rounded-lg border border-border-subtle bg-background px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium">{output.label}</span>
          {range && (
            <span
              title="Clipped to this range of the source"
              className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums text-accent"
            >
              {range}
            </span>
          )}
          {result?.mode === "copy" && (
            <span
              title="Copied without re-encoding — bit-for-bit identical audio"
              className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success"
            >
              Stream copy
            </span>
          )}
        </div>

        {output.status === "done" && result && (
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-muted">
              {formatBytes(result.bytes)} · {formatElapsed(result.elapsedMs)}
            </span>
            <a
              href={output.url}
              download={result.fileName}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
            >
              Download
            </a>
          </div>
        )}

        {output.status === "running" && (
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-muted">
              {output.ratio === null ? "Working…" : formatPercent(output.ratio)}
            </span>
            <button
              type="button"
              onClick={onCancel}
              aria-label={`Cancel ${output.label}`}
              className={ROW_BUTTON}
            >
              Cancel
            </button>
          </div>
        )}

        {output.status === "pending" && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-subtle">Waiting</span>
            <button
              type="button"
              onClick={onCancel}
              aria-label={`Cancel ${output.label}`}
              className={ROW_BUTTON}
            >
              Cancel
            </button>
          </div>
        )}

        {(output.status === "cancelled" || output.status === "error") && (
          <div className="flex items-center gap-3">
            {output.status === "cancelled" && (
              <span className="text-xs text-subtle">Cancelled</span>
            )}
            <button
              type="button"
              onClick={onRetry}
              aria-label={`Retry ${output.label}`}
              className={ROW_BUTTON}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {output.status === "running" && (
        <div className="mt-2">
          <ProgressBar ratio={output.ratio} label={`${output.label} conversion progress`} />
        </div>
      )}

      {output.status === "error" && output.error && (
        <div className="mt-1.5 text-xs">
          <p className="text-danger">{output.error.message}</p>
          {output.error.hint && <p className="mt-0.5 text-muted">{output.error.hint}</p>}
        </div>
      )}
    </div>
  );
}

export function FileCard({
  job,
  capabilities,
  onCancel,
  onRemove,
  onRetry,
  onAddFormat,
  onDetectSilence,
  onCancelOutput,
  onRetryOutput,
}: FileCardProps) {
  const [showLogs, setShowLogs] = useState(false);
  const [showTrim, setShowTrim] = useState(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const isRunning = job.status === "preparing" || job.status === "converting";
  const runningOutput = job.outputs.find((output) => output.status === "running");

  /** The first finished output a browser is likely to play inline. */
  const playable = useMemo(
    () =>
      job.outputs.find(
        (output) =>
          output.status === "done" && output.url && isLikelyPlayable(output.result!.extension),
      ),
    [job.outputs],
  );

  /** Formats with no full-file output yet; clips are offered by the trim panel. */
  const remainingFormats = OUTPUT_FORMATS.filter((format) => {
    const covered = job.outputs.some(
      (output) =>
        output.formatId === format.id &&
        output.trim === null &&
        // A cancelled output produced nothing, so the format is still on offer.
        output.status !== "cancelled",
    );
    if (covered) return false;
    if (!capabilities || !format.requiredEncoder) return true;
    return capabilities.encoders.has(format.requiredEncoder);
  });

  const totalDuration = job.probe?.durationSeconds ?? null;

  /**
   * Markers can only be read off the preview when the preview is the whole
   * track. A clip's timeline starts at its own zero, so its playback position
   * does not name a point in the source.
   */
  const getPreviewPosition =
    playable && playable.trim === null
      ? () => {
          const element = previewRef.current;
          return element && Number.isFinite(element.currentTime) ? element.currentTime : null;
        }
      : null;

  return (
    <li className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={job.file.name}>
            {job.file.name}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatBytes(job.file.size)}
            {job.probe && (
              <>
                {" · "}
                {formatDuration(job.probe.durationSeconds)}
                {" · "}
                {describeAudio(job.probe.audio)}
              </>
            )}
            {job.probe && job.probe.audioStreams.length > 1 && (
              <> {` · ${job.probe.audioStreams.length} audio tracks (using the first)`}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`}
          >
            {STATUS_LABEL[job.status]}
          </span>

          {isRunning ? (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-background"
            >
              Cancel
            </button>
          ) : (
            <>
              {(job.status === "error" || job.status === "cancelled") && (
                <button
                  type="button"
                  onClick={() => onRetry(job.id)}
                  className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-background"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemove(job.id)}
                aria-label={`Remove ${job.file.name}`}
                className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-background"
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {isRunning && (
        <div className="mt-3" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-muted">{job.phase}</p>
            {runningOutput && totalDuration !== null && (
              <p className="text-xs tabular-nums text-muted">
                {formatDuration(runningOutput.processedSeconds)} /{" "}
                {formatDuration(
                  runningOutput.trim
                    ? (runningOutput.trim.endSeconds ?? totalDuration) -
                        runningOutput.trim.startSeconds
                    : totalDuration,
                )}
              </p>
            )}
          </div>
          <div className="mt-1.5">
            <ProgressBar
              ratio={runningOutput?.ratio ?? job.phaseRatio}
              label={`${job.file.name} progress`}
            />
          </div>
        </div>
      )}

      {job.status === "error" && job.error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm"
        >
          <p className="font-medium text-danger">{job.error.message}</p>
          {job.error.hint && <p className="mt-0.5 text-xs text-muted">{job.error.hint}</p>}
        </div>
      )}

      {job.outputs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {job.outputs.map((output) => (
            <li key={output.id}>
              <OutputRow
                output={output}
                durationSeconds={totalDuration}
                onCancel={() => onCancelOutput(job.id, output.id)}
                onRetry={() => onRetryOutput(job.id, output.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {playable?.url && (
        <div className="mt-3">
          <audio ref={previewRef} controls preload="metadata" src={playable.url} className="w-full">
            Your browser cannot play this audio format.
          </audio>
        </div>
      )}

      {!isRunning && job.probe && (
        <>
          {remainingFormats.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Also convert to:</span>
              {remainingFormats.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  onClick={() => onAddFormat(job.id, format.id, null)}
                  className="rounded-md border border-border-strong px-2 py-0.5 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
                >
                  {format.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowTrim((previous) => !previous)}
              aria-expanded={showTrim}
              className="text-xs text-subtle underline-offset-2 hover:text-muted hover:underline"
            >
              {showTrim ? "Hide" : "Trim or clip a range"}
            </button>
            {showTrim && (
              <TrimPanel
                job={job}
                capabilities={capabilities}
                onExtract={(formatId, trim) => onAddFormat(job.id, formatId, trim)}
                onDetectSilence={() => onDetectSilence(job.id)}
                getPreviewPosition={getPreviewPosition}
                disabled={isRunning}
              />
            )}
          </div>
        </>
      )}

      {job.logs.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowLogs((previous) => !previous)}
            aria-expanded={showLogs}
            className="text-xs text-subtle underline-offset-2 hover:text-muted hover:underline"
          >
            {showLogs ? "Hide" : "Show"} ffmpeg log ({job.logs.length} lines)
          </button>
          {showLogs && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-relaxed text-muted">
              {job.logs.join("\n")}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
