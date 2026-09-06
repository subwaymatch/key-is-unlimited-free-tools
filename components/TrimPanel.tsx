"use client";

import { useEffect, useState } from "react";

import { isFormatAvailable, OUTPUT_FORMATS, type OutputFormatId } from "@/lib/engine/formats";
import { formatTimecode, parseTrimInputs, resolveTrim, sameTrimRange } from "@/lib/engine/trim";
import type { EngineCapabilities, TrimRange } from "@/lib/engine/types";
import { formatDuration } from "@/lib/format-utils";
import type { Job } from "@/lib/useConversionQueue";

import styles from "./TrimPanel.module.css";

interface TrimPanelProps {
  job: Job;
  capabilities: EngineCapabilities | null;
  onExtract: (formatId: OutputFormatId, trim: TrimRange | null) => void;
  onDetectSilence: () => void;
  /**
   * Playback position of the preview player, when one is showing untrimmed
   * audio. Null when there is no preview whose timeline matches the source.
   */
  getPreviewPosition: (() => number | null) | null;
  disabled: boolean;
}

/**
 * Per-file markers.
 *
 * This panel only appears once a file has been probed, which is what makes it
 * more useful than the global setting: the duration is known, the audio can be
 * played, and "set the end marker to where I am listening" becomes possible.
 */
export function TrimPanel({
  job,
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

  const formats = OUTPUT_FORMATS.filter((format) => isFormatAvailable(format, capabilities));

  const setFromPreview = (setter: (value: string) => void) => {
    const position = getPreviewPosition?.();
    if (position !== null && position !== undefined) setter(formatTimecode(position));
  };

  return (
    <div role="group" aria-label="Clip markers" className={styles.panel}>
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
            <button
              type="button"
              disabled={disabled}
              onClick={() => setFromPreview(setStartText)}
              title="Set the start marker to the preview's playback position"
              className={styles.button}
            >
              Start here
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setFromPreview(setEndText)}
              title="Set the end marker to the preview's playback position"
              className={styles.button}
            >
              End here
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={onDetectSilence}
          title="Decode the audio once to find leading and trailing silence"
          className={styles.button}
        >
          Detect silence
        </button>

        {(startText || endText) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setStartText("");
              setEndText("");
            }}
            className={styles.clear}
          >
            Clear
          </button>
        )}
      </div>

      {problem ? (
        <p className={styles.problem}>{problem}</p>
      ) : (
        <p className={styles.note}>
          {trim === null
            ? "The whole track. Set a marker to clip it."
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

      {!problem && (
        <div className={styles.extract}>
          <span className={styles.extractLabel}>
            {trim === null ? "Extract as:" : "Extract this clip as:"}
          </span>
          {formats.map((format) => {
            const exists = job.outputs.some(
              (output) =>
                output.formatId === format.id &&
                output.status !== "cancelled" &&
                sameTrimRange(output.trim, trim),
            );
            return (
              <button
                key={format.id}
                type="button"
                disabled={disabled || exists}
                title={exists ? "Already extracted for this range" : undefined}
                onClick={() => onExtract(format.id, trim)}
                className={styles.chip}
              >
                {format.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
