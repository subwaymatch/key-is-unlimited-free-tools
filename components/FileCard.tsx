"use client";

import { Download, Plus, RotateCcw, X } from "lucide-react";

import { Button } from "./ui/Button";
import { useMemo, useRef, useState } from "react";

import { isFormatAvailable } from "@/lib/engine/formats";
import { formatTimecode } from "@/lib/engine/trim";
import type {
  EngineCapabilities,
  FormatPlan,
  OutputFormat,
  OutputKind,
  PlanContext,
  TrimRange,
} from "@/lib/engine/types";
import { fileExtension } from "@/lib/mediaTypes";
import {
  describeAudio,
  describeChapters,
  describeSubtitles,
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

/**
 * What the badge says, given the job and the tool.
 *
 * Two of these are not fixed. "Converting" is the wrong verb on the tool that
 * compresses and the one that trims, so the tool supplies its own; and a
 * failure that is really a note ("already under 25 MB") must not wear the word
 * Failed or the red that goes with it.
 */
function statusLabel(job: Job, features: ToolFeatures): string {
  switch (job.status) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing";
    case "converting":
      return `${features.busyLabel ?? "Converting"}`;
    case "ready":
      return "Ready";
    case "done":
      return "Done";
    case "error":
      return job.error?.severity === "info" ? "Nothing to do" : "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function statusStyle(job: Job): string {
  if (job.status === "error" && job.error?.severity === "info") return styles.statusIdle;
  return STATUS_STYLE[job.status];
}

/**
 * Extension the output will carry.
 *
 * Read from the finished file when there is one and from the format plan
 * before then, which is the same function that names the download, so the
 * badge cannot promise one extension and deliver another. "Original" is the
 * reason this is not simply the format id: its container depends on the
 * source codec.
 */
function outputExtension(output: JobOutput, job: Job, context: PlanContext): string | null {
  const fromResult = output.result?.fileName.split(".").pop();
  if (fromResult) return fromResult;
  return outputPlan(output, job, context)?.extension ?? null;
}

/** What the format would write for this file, or null before it can be known. */
function outputPlan(output: JobOutput, job: Job, context: PlanContext): FormatPlan | null {
  if (!job.probe) return null;
  try {
    return output.format.plan(job.probe, { ...context, trim: output.trim });
  } catch {
    return null;
  }
}

/** Whether the browser can be expected to show this finished output inline. */
function isPreviewable(kind: OutputKind, extension: string): boolean {
  if (kind === "text") return false;
  if (kind === "image") return true;
  if (kind === "video") return isLikelyPlayableVideo(extension);
  return isLikelyPlayable(extension);
}

/** A range as "0:03-0:05", with the file's own end standing in for an open one. */
function describeRange(trim: TrimRange, durationSeconds: number | null): string {
  const end =
    trim.endSeconds !== null
      ? formatTimecode(trim.endSeconds)
      : durationSeconds !== null
        ? formatTimecode(durationSeconds)
        : "end";
  return `${formatTimecode(trim.startSeconds)}-${end}`;
}

/**
 * The preview an output row shows for itself, if any.
 *
 * Previews used to hang off the bottom of the card, which put the player for
 * one output directly under the error message of another and made it read as
 * that row's result.
 */
type RowPreview = "video" | "audio" | "image" | null;

function OutputRow({
  output,
  durationSeconds,
  extension,
  preview,
  onCancel,
  onRetry,
  mediaRef,
}: {
  output: JobOutput;
  durationSeconds: number | null;
  /** File extension this output will carry, e.g. "mp3". Null before probing. */
  extension: string | null;
  preview: RowPreview;
  onCancel: () => void;
  onRetry: () => void;
  mediaRef?: (element: HTMLMediaElement | null) => void;
}) {
  const { result, trim } = output;

  const range = trim ? describeRange(trim, durationSeconds) : null;
  /*
   * A stream copy can only begin on a keyframe, so a "fast cut" from 0:03 can
   * really start at 0:00. The engine measures the file that came out; this is
   * where the card stops claiming otherwise.
   */
  const actual = result?.actualTrim ?? null;
  const overshootSeconds =
    actual && trim ? Math.max(0, trim.startSeconds - actual.startSeconds) : 0;

  const isInfo = output.error?.severity === "info";
  const canRetry = output.status === "cancelled" || output.error?.retryable !== false;

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
            <span className={styles.rowMeta}>{formatBytes(result.bytes)}</span>
            <a href={output.url} download={result.fileName} className={styles.download}>
              <Download aria-hidden="true" size={14} strokeWidth={2} />
              Download
            </a>
          </div>
        )}

        {output.status === "running" && (
          <div className={styles.rowState}>
            <span className={styles.rowMeta}>
              {output.ratio === null ? "Working..." : formatPercent(output.ratio)}
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
            {/*
             * Retry is only offered where running the same job again could end
             * differently. "No audio track found" and "already under 25 MB"
             * will say exactly the same thing the second time.
             */}
            {canRetry && (
              <Button onClick={onRetry} aria-label={`Retry ${output.label}`}>
                <RotateCcw aria-hidden="true" size={13} strokeWidth={2} />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>

      {output.status === "running" && (
        <div className={styles.rowBar}>
          <ProgressBar ratio={output.ratio} label={`${output.label} conversion progress`} />
        </div>
      )}

      {output.status === "error" && output.error && (
        <div className={isInfo ? styles.rowNote : styles.rowError}>
          <p className={isInfo ? styles.rowNoteMessage : styles.rowErrorMessage}>
            {output.error.message}
          </p>
          {output.error.hint && <p className={styles.rowErrorHint}>{output.error.hint}</p>}
        </div>
      )}

      {output.status === "done" && actual && overshootSeconds > 0 && (
        <p className={styles.rowNoteMessage}>
          {`The cut starts at ${formatTimecode(actual.startSeconds)}, ${formatDuration(
            overshootSeconds,
          )} before the marker: a copied stream can only begin on a keyframe. Use the precise cut to land on the frame.`}
        </p>
      )}

      {output.status === "done" && result?.warning && (
        <p className={styles.rowNoteMessage}>{result.warning}</p>
      )}

      {preview === "video" && output.url && (
        <video
          ref={mediaRef}
          controls
          preload="metadata"
          src={output.url}
          className={styles.videoPreview}
        >
          Your browser cannot play this video format.
        </video>
      )}

      {preview === "audio" && output.url && (
        <audio
          ref={mediaRef}
          controls
          preload="metadata"
          src={output.url}
          className={styles.preview}
        >
          Your browser cannot play this audio format.
        </audio>
      )}

      {preview === "image" && output.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={output.url} alt="" className={styles.imagePreview} />
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
  const audioRef = useRef<HTMLMediaElement | null>(null);

  const isRunning = job.status === "preparing" || job.status === "converting";
  const runningOutput = job.outputs.find((output) => output.status === "running");

  /** The first finished audio or video output a browser is likely to play inline. */
  const playable = useMemo(
    () =>
      job.outputs.find(
        (output) =>
          output.status === "done" &&
          output.url &&
          output.result!.kind !== "image" &&
          isPreviewable(output.result!.kind, output.result!.extension),
      ),
    [job.outputs],
  );

  /**
   * The newest finished image, shown whatever else is on the card: a GIF is
   * the thing the visitor came for, and it never replaces the source preview
   * they pick the next range from.
   */
  const latestImage = useMemo(
    () =>
      [...job.outputs]
        .reverse()
        .find(
          (output) => output.status === "done" && output.url && output.result!.kind === "image",
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

  const planContext: PlanContext = {
    trim: null,
    fileBytes: job.file.size,
    sourceExtension: fileExtension(job.file.name),
  };

  /**
   * Formats with no full-file output yet; clips are offered by the trim panel.
   *
   * `offer` is what keeps the compressor's chip row useful: every preset is in
   * its catalogue so a file can be re-compressed from its own card, and only
   * the sizes actually smaller than this file appear.
   */
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
        if (covered || !isFormatAvailable(format, capabilities)) return false;
        if (!job.probe || !format.offer) return true;
        return format.offer(job.probe, planContext);
      });

  const totalDuration = job.probe?.durationSeconds ?? null;

  /**
   * Markers can only be read off the preview when the preview is the whole
   * file. A clip's timeline starts at its own zero, so its playback position
   * does not name a point in the source.
   */
  const previewIsWhole = showSource || (playable !== undefined && playable.trim === null);
  const getPreviewPosition = previewIsWhole
    ? () => {
        const element = videoRef.current ?? audioRef.current;
        return element && Number.isFinite(element.currentTime) ? element.currentTime : null;
      }
    : null;

  /** Which row, if any, carries the inline player for this card. */
  const previewFor = (output: JobOutput): RowPreview => {
    if (latestImage && output.id === latestImage.id) return "image";
    if (showSource || !playable || output.id !== playable.id) return null;
    return playable.result!.kind === "video" ? "video" : "audio";
  };

  const meta = [formatBytes(job.file.size)];
  if (job.probe) {
    meta.push(formatDuration(job.probe.durationSeconds));
    if (job.probe.video) meta.push(describeVideo(job.probe.video));
    if (job.probe.audio) meta.push(describeAudio(job.probe.audio));
    else if (!job.probe.video) meta.push("No audio");
    if (job.probe.subtitleStreams.length > 0) meta.push(describeSubtitles(job.probe.subtitleStreams));
    if (job.probe.chapters.length > 0) meta.push(describeChapters(job.probe.chapters));
  }

  const isInfo = job.status === "error" && job.error?.severity === "info";
  const canRetryJob = job.status === "cancelled" || job.error?.retryable !== false;

  /*
   * A middle ellipsis, so a long name keeps the one part that identifies what
   * kind of file it is. At 375 px the old single-line clamp left about nine
   * characters and no extension, which is a filename nobody can recognise.
   */
  const extension = fileExtension(job.file.name);
  const stem = extension
    ? job.file.name.slice(0, job.file.name.length - extension.length - 1)
    : job.file.name;

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
              <span className={styles.fileStem}>{stem}</span>
              {extension && <span className={styles.fileExt}>.{extension}</span>}
            </p>
            <p className={styles.meta}>
              {meta.join(", ")}
              {job.probe && job.probe.audioStreams.length > 1 && (
                <>{`, ${job.probe.audioStreams.length} audio tracks (using the first)`}</>
              )}
            </p>
          </div>
        </div>

        <div className={styles.actions}>
          <span className={`${styles.status} ${statusStyle(job)}`}>
            {statusLabel(job, features)}
          </span>

          {isRunning ? (
            <Button onClick={() => onCancel(job.id)}>Cancel</Button>
          ) : (
            <>
              {(job.status === "error" || job.status === "cancelled") && canRetryJob && (
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
                  (runningOutput.trim
                    ? (runningOutput.trim.endSeconds ?? totalDuration) -
                      runningOutput.trim.startSeconds
                    : totalDuration) *
                    // The counter runs on the output's clock, which a speed
                    // change makes shorter or longer than the range it reads.
                    (outputPlan(runningOutput, job, planContext)?.durationFactor ?? 1),
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
        <div role={isInfo ? undefined : "alert"} className={isInfo ? styles.note : styles.alert}>
          <p className={isInfo ? styles.noteMessage : styles.alertMessage}>{job.error.message}</p>
          {job.error.hint && <p className={styles.alertHint}>{job.error.hint}</p>}
        </div>
      )}

      {job.outputs.length > 0 && (
        <ul className={styles.outputs}>
          {job.outputs.map((output) => {
            const preview = previewFor(output);
            return (
              <li key={output.id}>
                <OutputRow
                  output={output}
                  durationSeconds={totalDuration}
                  extension={outputExtension(output, job, planContext)}
                  preview={preview}
                  mediaRef={(element) => {
                    // The clip panel reads markers off whichever element is
                    // showing the whole source, so it needs a handle on it.
                    if (preview === "video") {
                      videoRef.current = element as HTMLVideoElement | null;
                    } else if (preview === "audio") {
                      audioRef.current = element;
                    }
                  }}
                  onCancel={() => onCancelOutput(job.id, output.id)}
                  onRetry={() => onRetryOutput(job.id, output.id)}
                />
              </li>
            );
          })}
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
