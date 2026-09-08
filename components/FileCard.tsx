"use client";

import { Download, Plus, RotateCcw, X } from "lucide-react";

import { Button } from "./ui/Button";
import { useMemo, useRef, useState } from "react";

import { isFormatAvailable } from "@/lib/engine/formats";
import { formatTimecode } from "@/lib/engine/trim";
import type {
  EngineCapabilities,
  OutputFormat,
  OutputKind,
  TrimRange,
} from "@/lib/engine/types";
import {
  describeAudio,
  describeVideo,
  formatBytes,
  formatDuration,
  formatPercent,
  isLikelyPlayable,
  isLikelyPlayableVideo,
} from "@/lib/format-utils";
import type { ToolFeatures } from "@/lib/toolFeatures";
import type { Job, JobOutput } from "@/lib/useConversionQueue";

import { ProgressBar } from "./ProgressBar";
import { TrimPanel } from "./TrimPanel";
import styles from "./FileCard.module.css";

interface FileCardProps {
  job: Job;
  /** The tool's catalogue, for the "also" chips and the clip panel. */
  formats: readonly OutputFormat[];
  features: ToolFeatures;
  capabilities: EngineCapabilities | null;
  onCancel: (jobId: string) => void;
  onRemove: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onAddFormat: (jobId: string, formatId: string, trim?: TrimRange | null) => void;
  onDetectSilence: (jobId: string) => void;
  onCancelOutput: (jobId: string, outputId: string) => void;
  onRetryOutput: (jobId: string, outputId: string) => void;
}

const STATUS_STYLE: Record<Job["status"], string> = {
  queued: styles.statusIdle,
  preparing: styles.statusBusy,
  converting: styles.statusBusy,
  ready: styles.statusIdle,
  done: styles.statusDone,
  error: styles.statusError,
  cancelled: styles.statusIdle,
};

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  preparing: "Preparing",
  converting: "Converting",
  ready: "Ready",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

/**
 * Extension the output will carry.
 *
 * Read from the finished file when there is one and from the format plan
 * before then, which is the same function that names the download, so the
 * badge cannot promise one extension and deliver another. "Original" is the
 * reason this is not simply the format id: its container depends on the
 * source codec.
 */
function outputExtension(output: JobOutput, job: Job): string | null {
  const fromResult = output.result?.fileName.split(".").pop();
  if (fromResult) return fromResult;
  if (!job.probe) return null;
  try {
    return output.format.plan(job.probe, { trim: output.trim, fileBytes: job.file.size })
      .extension;
  } catch {
    return null;
  }
}

/** Whether the browser can be expected to show this finished output inline. */
function isPreviewable(kind: OutputKind, extension: string): boolean {
  if (kind === "image") return true;
  if (kind === "video") return isLikelyPlayableVideo(extension);
  return isLikelyPlayable(extension);
}

function OutputRow({
  output,
  durationSeconds,
  extension,
  onCancel,
  onRetry,
}: {
  output: JobOutput;
  durationSeconds: number | null;
  /** File extension this output will carry, e.g. "mp3". Null before probing. */
  extension: string | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { result, trim } = output;

  const range = trim
    ? `${formatTimecode(trim.startSeconds)}-${
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
          {extension && <span className={`${styles.tag} ${styles.tagExt}`}>.{extension}</span>}
          {result?.mode === "copy" && (
            <span
              title="Copied without re-encoding - bit-for-bit identical streams"
              className={`${styles.tag} ${styles.tagCopy}`}
            >
              Stream copy
            </span>
          )}
        </div>

        {output.status === "done" && result && (
          <div className={styles.rowState}>
            <span className={styles.rowMeta}>
              {formatBytes(result.bytes)}
            </span>
            <a
              href={output.url}
              download={result.fileName}
              className={styles.download}
            >
              <Download aria-hidden="true" size={14} strokeWidth={2} />
              Download
            </a>
          </div>
        )}

        {output.status === "running" && (
          <div className={styles.rowState}>
            <span className={styles.rowMeta}>
              {output.ratio === null
                ? "Working..."
                : formatPercent(output.ratio)}
            </span>
            <Button onClick={onCancel} aria-label={`Cancel ${output.label}`}>
              Cancel
            </Button>
          </div>
        )}

        {output.status === "pending" && (
          <div className={styles.rowState}>
            <span className={styles.rowWaiting}>Waiting</span>
            <Button onClick={onCancel} aria-label={`Cancel ${output.label}`}>
              Cancel
            </Button>
          </div>
        )}

        {(output.status === "cancelled" || output.status === "error") && (
          <div className={styles.rowState}>
            {output.status === "cancelled" && (
              <span className={styles.rowWaiting}>Cancelled</span>
            )}
            <Button onClick={onRetry} aria-label={`Retry ${output.label}`}>
              <RotateCcw aria-hidden="true" size={13} strokeWidth={2} />
              Retry
            </Button>
          </div>
        )}
      </div>

      {output.status === "running" && (
        <div className={styles.rowBar}>
          <ProgressBar
            ratio={output.ratio}
            label={`${output.label} conversion progress`}
          />
        </div>
      )}

      {output.status === "error" && output.error && (
        <div className={styles.rowError}>
          <p className={styles.rowErrorMessage}>{output.error.message}</p>
          {output.error.hint && (
            <p className={styles.rowErrorHint}>{output.error.hint}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function FileCard({
  job,
  formats,
  features,
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
  // One of these holds the preview, depending on what the tool shows.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isRunning = job.status === "preparing" || job.status === "converting";
  const runningOutput = job.outputs.find(
    (output) => output.status === "running",
  );

  /** The first finished output a browser is likely to show inline. */
  const playable = useMemo(
    () =>
      job.outputs.find(
        (output) =>
          output.status === "done" &&
          output.url &&
          isPreviewable(output.result!.kind, output.result!.extension),
      ),
    [job.outputs],
  );

  /**
   * The source itself, for tools that cut before they have produced anything.
   * Once a whole-file output exists it takes over, since it is the thing the
   * visitor is about to download.
   */
  const showSource =
    job.sourceUrl !== undefined &&
    job.probe !== undefined &&
    (playable === undefined || playable.trim !== null);

  /** Formats with no full-file output yet; clips are offered by the trim panel. */
  const remainingFormats = features.requireTrim
    ? []
    : formats.filter((format) => {
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
   * file. A clip's timeline starts at its own zero, so its playback position
   * does not name a point in the source.
   */
  const previewIsWhole =
    showSource || (playable !== undefined && playable.trim === null && playable.result!.kind !== "image");
  const getPreviewPosition = previewIsWhole
    ? () => {
        const element = videoRef.current ?? audioRef.current;
        return element && Number.isFinite(element.currentTime)
          ? element.currentTime
          : null;
      }
    : null;

  const meta = [formatBytes(job.file.size)];
  if (job.probe) {
    meta.push(formatDuration(job.probe.durationSeconds));
    if (job.probe.video) meta.push(describeVideo(job.probe.video));
    if (job.probe.audio) meta.push(describeAudio(job.probe.audio));
    else if (!job.probe.video) meta.push("No audio");
  }

  return (
    <li className={styles.card}>
      <div className={styles.header}>
        <div className={styles.identity}>
          {job.posterUrl && (
            /*
             * Decorative: the filename right beside it already identifies the
             * file, so alt text here would only repeat it. eslint-disable is
             * not needed - an empty alt is the correct markup for that.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.posterUrl} alt="" className={styles.poster} />
          )}
          <div className={styles.identityText}>
            <p className={styles.fileName} title={job.file.name}>
              {job.file.name}
            </p>
            <p className={styles.meta}>
              {meta.join(", ")}
              {job.probe && job.probe.audioStreams.length > 1 && (
                <>
                  {" "}
                  {`, ${job.probe.audioStreams.length} audio tracks (using the first)`}
                </>
              )}
            </p>
          </div>
        </div>

        <div className={styles.actions}>
          <span className={`${styles.status} ${STATUS_STYLE[job.status]}`}>
            {STATUS_LABEL[job.status]}
          </span>

          {isRunning ? (
            <Button onClick={() => onCancel(job.id)}>Cancel</Button>
          ) : (
            <>
              {(job.status === "error" || job.status === "cancelled") && (
                <Button onClick={() => onRetry(job.id)}>
                  <RotateCcw aria-hidden="true" size={13} strokeWidth={2} />
                  Retry
                </Button>
              )}
              <Button
                onClick={() => onRemove(job.id)}
                aria-label={`Remove ${job.file.name}`}
                variant="ghost"
              >
                <X aria-hidden="true" size={13} strokeWidth={2} />
                Remove
              </Button>
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
          {job.error.hint && (
            <p className={styles.alertHint}>{job.error.hint}</p>
          )}
        </div>
      )}

      {job.outputs.length > 0 && (
        <ul className={styles.outputs}>
          {job.outputs.map((output) => (
            <li key={output.id}>
              <OutputRow
                output={output}
                durationSeconds={totalDuration}
                extension={outputExtension(output, job)}
                onCancel={() => onCancelOutput(job.id, output.id)}
                onRetry={() => onRetryOutput(job.id, output.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {showSource && (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          src={job.sourceUrl}
          className={styles.videoPreview}
        >
          Your browser cannot play this video.
        </video>
      )}

      {!showSource && playable?.url && playable.result!.kind === "video" && (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          src={playable.url}
          className={styles.videoPreview}
        >
          Your browser cannot play this video format.
        </video>
      )}

      {!showSource && playable?.url && playable.result!.kind === "audio" && (
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={playable.url}
          className={styles.preview}
        >
          Your browser cannot play this audio format.
        </audio>
      )}

      {!showSource && playable?.url && playable.result!.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={playable.url} alt="" className={styles.imagePreview} />
      )}

      {!isRunning && job.probe && (
        <>
          {remainingFormats.length > 0 && (
            <div className={styles.chips}>
              <span className={styles.chipsLabel}>{features.alsoLabel}</span>
              {remainingFormats.map((format) => (
                <Button
                  key={format.id}
                  onClick={() => onAddFormat(job.id, format.id, null)}
                  title={format.blurb}
                  className={styles.chip}
                >
                  <Plus aria-hidden="true" size={13} strokeWidth={2} />
                  {format.label}
                </Button>
              ))}
            </div>
          )}

          {features.trim && (
            <TrimPanel
              job={job}
              formats={formats}
              features={features}
              capabilities={capabilities}
              onExtract={(formatId, trim) => onAddFormat(job.id, formatId, trim)}
              onDetectSilence={() => onDetectSilence(job.id)}
              getPreviewPosition={getPreviewPosition}
              disabled={isRunning}
            />
          )}
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
