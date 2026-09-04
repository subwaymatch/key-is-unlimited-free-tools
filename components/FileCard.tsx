"use client";

import { useMemo, useRef, useState } from "react";

import { isFormatAvailable, OUTPUT_FORMATS, type OutputFormatId } from "@/lib/engine/formats";
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
import styles from "./FileCard.module.css";

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
  queued: styles.statusIdle,
  preparing: styles.statusBusy,
  converting: styles.statusBusy,
  done: styles.statusDone,
  error: styles.statusError,
  cancelled: styles.statusIdle,
};

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  preparing: "Preparing",
  converting: "Converting",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

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
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <div className={styles.rowLabel}>
          <span className={styles.formatName}>{output.label}</span>
          {range && (
            <span
              title="Clipped to this range of the source"
              className={`${styles.tag} ${styles.tagRange}`}
            >
              {range}
            </span>
          )}
          {result?.mode === "copy" && (
            <span
              title="Copied without re-encoding — bit-for-bit identical audio"
              className={`${styles.tag} ${styles.tagCopy}`}
            >
              Stream copy
            </span>
          )}
        </div>

        {output.status === "done" && result && (
          <div className={styles.rowState}>
            <span className={styles.rowMeta}>
              {formatBytes(result.bytes)} · {formatElapsed(result.elapsedMs)}
            </span>
            <a href={output.url} download={result.fileName} className={styles.download}>
              Download
            </a>
          </div>
        )}

        {output.status === "running" && (
          <div className={styles.rowState}>
            <span className={styles.rowMeta}>
              {output.ratio === null ? "Working…" : formatPercent(output.ratio)}
            </span>
            <button
              type="button"
              onClick={onCancel}
              aria-label={`Cancel ${output.label}`}
              className={styles.rowButton}
            >
              Cancel
            </button>
          </div>
        )}

        {output.status === "pending" && (
          <div className={styles.rowState}>
            <span className={styles.rowWaiting}>Waiting</span>
            <button
              type="button"
              onClick={onCancel}
              aria-label={`Cancel ${output.label}`}
              className={styles.rowButton}
            >
              Cancel
            </button>
          </div>
        )}

        {(output.status === "cancelled" || output.status === "error") && (
          <div className={styles.rowState}>
            {output.status === "cancelled" && (
              <span className={styles.rowWaiting}>Cancelled</span>
            )}
            <button
              type="button"
              onClick={onRetry}
              aria-label={`Retry ${output.label}`}
              className={styles.rowButton}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {output.status === "running" && (
        <div className={styles.rowBar}>
          <ProgressBar ratio={output.ratio} label={`${output.label} conversion progress`} />
        </div>
      )}

      {output.status === "error" && output.error && (
        <div className={styles.rowError}>
          <p className={styles.rowErrorMessage}>{output.error.message}</p>
          {output.error.hint && <p className={styles.rowErrorHint}>{output.error.hint}</p>}
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
    return !covered && isFormatAvailable(format, capabilities);
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
    <li className={styles.card}>
      <div className={styles.header}>
        <div className={styles.identity}>
          <p className={styles.fileName} title={job.file.name}>
            {job.file.name}
          </p>
          <p className={styles.meta}>
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

        <div className={styles.actions}>
          <span className={`${styles.status} ${STATUS_STYLE[job.status]}`}>
            {STATUS_LABEL[job.status]}
          </span>

          {isRunning ? (
            <button type="button" onClick={() => onCancel(job.id)} className={styles.action}>
              Cancel
            </button>
          ) : (
            <>
              {(job.status === "error" || job.status === "cancelled") && (
                <button type="button" onClick={() => onRetry(job.id)} className={styles.action}>
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemove(job.id)}
                aria-label={`Remove ${job.file.name}`}
                className={styles.action}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {isRunning && (
        <div className={styles.progress}>
          <div className={styles.phaseRow}>
            {/* Only the phase is announced: it changes a handful of times per
                file, whereas the counter beside it updates several times a
                second, and the progress bar already carries its value. */}
            <p className={styles.phase} aria-live="polite">
              {job.phase}
            </p>
            {runningOutput && totalDuration !== null && (
              <p className={styles.elapsed}>
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
          <div className={styles.progressBar}>
            <ProgressBar
              ratio={runningOutput?.ratio ?? job.phaseRatio}
              label={`${job.file.name} progress`}
            />
          </div>
        </div>
      )}

      {job.status === "error" && job.error && (
        <div role="alert" className={styles.alert}>
          <p className={styles.alertMessage}>{job.error.message}</p>
          {job.error.hint && <p className={styles.alertHint}>{job.error.hint}</p>}
        </div>
      )}

      {job.outputs.length > 0 && (
        <ul className={styles.outputs}>
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
        <audio
          ref={previewRef}
          controls
          preload="metadata"
          src={playable.url}
          className={styles.preview}
        >
          Your browser cannot play this audio format.
        </audio>
      )}

      {!isRunning && job.probe && (
        <>
          {remainingFormats.length > 0 && (
            <div className={styles.chips}>
              <span className={styles.chipsLabel}>Also convert to:</span>
              {remainingFormats.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  onClick={() => onAddFormat(job.id, format.id, null)}
                  className={styles.chip}
                >
                  {format.label}
                </button>
              ))}
            </div>
          )}

          <div className={styles.disclosure}>
            <button
              type="button"
              onClick={() => setShowTrim((previous) => !previous)}
              aria-expanded={showTrim}
              className={styles.disclosureButton}
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
        <div className={styles.disclosure}>
          <button
            type="button"
            onClick={() => setShowLogs((previous) => !previous)}
            aria-expanded={showLogs}
            className={styles.disclosureButton}
          >
            {showLogs ? "Hide" : "Show"} ffmpeg log ({job.logs.length} lines)
          </button>
          {showLogs && <pre className={styles.log}>{job.logs.join("\n")}</pre>}
        </div>
      )}
    </li>
  );
}
