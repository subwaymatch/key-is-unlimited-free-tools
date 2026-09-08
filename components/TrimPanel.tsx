"use client";

import {
  ArrowRightFromLine,
  ArrowRightToLine,
  Plus,
  ScanSearch,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { isFormatAvailable } from "@/lib/engine/formats";
import { formatTimecode, parseTrimInputs, resolveTrim, sameTrimRange } from "@/lib/engine/trim";
import type { EngineCapabilities, OutputFormat, TrimRange } from "@/lib/engine/types";
import { formatDuration } from "@/lib/format-utils";
import type { ToolFeatures } from "@/lib/toolFeatures";
import type { Job } from "@/lib/useConversionQueue";

import { Button } from "./ui/Button";
import { Waveform } from "./Waveform";
import styles from "./TrimPanel.module.css";

interface TrimPanelProps {
  job: Job;
  /** The tool's catalogue: what a range can be turned into. */
  formats: readonly OutputFormat[];
  features: ToolFeatures;
  capabilities: EngineCapabilities | null;
  onExtract: (formatId: string, trim: TrimRange | null) => void;
  onDetectSilence: () => void;
  /**
   * Playback position of the preview player, when one is showing the whole
   * source. Null when there is no preview whose timeline matches the source.
   */
  getPreviewPosition: (() => number | null) | null;
  disabled: boolean;
}

/**
 * Per-file markers.
 *
 * This panel only appears once a file has been probed, which is what makes it
 * more useful than the global setting: the duration is known, the media can be
 * played, and "set the end marker to where I am watching" becomes possible.
 */
export function TrimPanel({
  job,
  formats: catalogue,
  features,
  capabilities,
  onExtract,
  onDetectSilence,
  getPreviewPosition,
  disabled,
}: TrimPanelProps) {
  const duration = job.probe?.durationSeconds ?? null;

  const [startText, setStartText] = useState(() =>
    job.trim ? formatTimecode(job.trim.startSeconds) : "",
  );
  const [endText, setEndText] = useState(() =>
    job.trim?.endSeconds != null ? formatTimecode(job.trim.endSeconds) : "",
  );

  // A silence scan is the one thing that changes the markers from outside this
  // component, so its result - and only its result - is pulled into the fields.
  const suggested = job.silence?.suggested ?? null;
  useEffect(() => {
    if (!job.silence) return;
    setStartText(suggested ? formatTimecode(suggested.startSeconds) : "");
    setEndText(suggested?.endSeconds != null ? formatTimecode(suggested.endSeconds) : "");
  }, [job.silence, suggested]);

  const parsed = parseTrimInputs(startText, endText);
  const resolved = resolveTrim(parsed.trim, duration);
  const problem = parsed.error ?? resolved.problem?.message ?? null;
  const trim = resolved.trim;

  const clipLength =
    trim === null
      ? duration
      : (trim.endSeconds ?? duration ?? 0) - trim.startSeconds;

  const formats = catalogue.filter((format) => isFormatAvailable(format, capabilities));

  const setFromPreview = (setter: (value: string) => void) => {
    const position = getPreviewPosition?.();
    if (position !== null && position !== undefined) setter(formatTimecode(position));
  };

  const waveform = job.waveform;
  const canDraw = duration !== null && duration > 0;

  /*
   * Dragging writes straight into the same text fields the inputs use, so the
   * two ways of setting a range cannot disagree: there is one source of truth
   * and the waveform is just another way to type into it.
   */
  const selectRange = (from: number, to: number | null) => {
    setStartText(from <= 0 ? "" : formatTimecode(from));
    setEndText(to === null || (duration !== null && to >= duration) ? "" : formatTimecode(to));
  };

  // A tool that only cuts has nothing to offer for the whole file.
  const offerFormats = !problem && (trim !== null || !features.requireTrim);

  return (
    <div role="group" aria-label="Clip markers" className={styles.panel}>
      {canDraw && (
        <div className={styles.waveform}>
          {waveform && waveform.peaks.length > 0 ? (
            <>
              <Waveform
                peaks={waveform.peaks}
                durationSeconds={duration}
                startSeconds={trim?.startSeconds ?? 0}
                endSeconds={trim?.endSeconds ?? null}
                onSelect={selectRange}
                disabled={disabled}
              />
              <p className={styles.waveformHint}>
                Drag across the waveform to select a range.
              </p>
            </>
          ) : job.wantsWaveform ? (
            <p className={styles.waveformHint}>Reading the audio to draw it...</p>
          ) : null}
        </div>
      )}

      <div className={styles.row}>
        <label>
          <span className={styles.fieldLabel}>Start</span>
          <input
            type="text"
            inputMode="decimal"
            value={startText}
            placeholder="0:00"
            disabled={disabled}
            onChange={(event) => setStartText(event.target.value)}
            className={styles.input}
          />
        </label>

        <label>
          <span className={styles.fieldLabel}>End</span>
          <input
            type="text"
            inputMode="decimal"
            value={endText}
            placeholder={duration !== null ? formatTimecode(duration) : "end"}
            disabled={disabled}
            onChange={(event) => setEndText(event.target.value)}
            className={styles.input}
          />
        </label>

        {getPreviewPosition && (
          <div className={styles.markerButtons}>
            <Button
              disabled={disabled}
              onClick={() => setFromPreview(setStartText)}
              title="Set the start marker to the preview's playback position"
            >
              <ArrowRightFromLine aria-hidden="true" size={13} strokeWidth={2} />
              Start here
            </Button>
            <Button
              disabled={disabled}
              onClick={() => setFromPreview(setEndText)}
              title="Set the end marker to the preview's playback position"
            >
              <ArrowRightToLine aria-hidden="true" size={13} strokeWidth={2} />
              End here
            </Button>
          </div>
        )}

        {features.silence && (
          <Button
            disabled={disabled}
            onClick={onDetectSilence}
            title="Decode the audio once to find leading and trailing silence"
          >
            <ScanSearch aria-hidden="true" size={13} strokeWidth={2} />
            Detect silence
          </Button>
        )}

        {(startText || endText) && (
          <Button
            disabled={disabled}
            onClick={() => {
              setStartText("");
              setEndText("");
            }}
            variant="ghost"
          >
            <X aria-hidden="true" size={13} strokeWidth={2} />
            Clear
          </Button>
        )}
      </div>

      {problem ? (
        <p className={styles.problem}>{problem}</p>
      ) : (
        <p className={styles.note}>
          {trim === null
            ? features.requireTrim
              ? "Set a start or end marker to choose the range to keep."
              : "The whole file. Set a marker to clip it."
            : `Clip is ${formatDuration(clipLength)} long.`}
        </p>
      )}

      {job.silence && (
        <p className={styles.detail}>
          {job.silence.entirelySilent
            ? "The audio is silent throughout - nothing to trim."
            : suggested
              ? `Found ${job.silence.intervals.length} silent ${
                  job.silence.intervals.length === 1 ? "stretch" : "stretches"
                }; markers set to skip the quiet head and tail.`
              : "No leading or trailing silence found."}
        </p>
      )}

      {offerFormats && (
        <div className={styles.extract}>
          <span className={styles.extractLabel}>
            {trim === null ? features.wholeLabel : features.clipLabel}
          </span>
          {formats.map((format) => {
            const exists = job.outputs.some(
              (output) =>
                output.formatId === format.id &&
                output.status !== "cancelled" &&
                sameTrimRange(output.trim, trim),
            );
            return (
              <Button
                key={format.id}
                disabled={disabled || exists}
                title={exists ? "Already produced for this range" : format.blurb}
                onClick={() => onExtract(format.id, trim)}
                className={styles.chip}
              >
                <Plus aria-hidden="true" size={13} strokeWidth={2} />
                {format.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
