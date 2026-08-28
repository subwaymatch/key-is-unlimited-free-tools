"use client";

import { useEffect, useState } from "react";

import { OUTPUT_FORMATS, type OutputFormatId } from "@/lib/engine/formats";
import { formatTimecode, parseTrimInputs, resolveTrim, sameTrimRange } from "@/lib/engine/trim";
import type { EngineCapabilities, TrimRange } from "@/lib/engine/types";
import { formatDuration } from "@/lib/format-utils";
import type { Job } from "@/lib/useConversionQueue";

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
  // component, so its result — and only its result — is pulled into the fields.
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

  const formats = OUTPUT_FORMATS.filter(
    (format) =>
      !capabilities ||
      !format.requiredEncoder ||
      capabilities.encoders.has(format.requiredEncoder),
  );

  const setFromPreview = (setter: (value: string) => void) => {
    const position = getPreviewPosition?.();
    if (position !== null && position !== undefined) setter(formatTimecode(position));
  };

  return (
    <div
      role="group"
      aria-label="Clip markers"
      className="mt-3 rounded-lg border border-border-subtle bg-background px-3 py-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0">
          <span className="block text-xs font-medium text-muted">Start</span>
          <input
            type="text"
            inputMode="decimal"
            value={startText}
            placeholder="0:00"
            disabled={disabled}
            onChange={(event) => setStartText(event.target.value)}
            className="mt-1 w-28 rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm tabular-nums"
          />
        </label>

        <label className="min-w-0">
          <span className="block text-xs font-medium text-muted">End</span>
          <input
            type="text"
            inputMode="decimal"
            value={endText}
            placeholder={duration !== null ? formatTimecode(duration) : "end"}
            disabled={disabled}
            onChange={(event) => setEndText(event.target.value)}
            className="mt-1 w-28 rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm tabular-nums"
          />
        </label>

        {getPreviewPosition && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setFromPreview(setStartText)}
              title="Set the start marker to the preview's playback position"
              className="rounded-md border border-border-strong px-2 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-55"
            >
              ⇱ Start here
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setFromPreview(setEndText)}
              title="Set the end marker to the preview's playback position"
              className="rounded-md border border-border-strong px-2 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-55"
            >
              ⇲ End here
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={onDetectSilence}
          title="Decode the audio once to find leading and trailing silence"
          className="rounded-md border border-border-strong px-2 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-55"
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
            className="text-xs text-subtle underline-offset-2 hover:text-muted hover:underline disabled:opacity-55"
          >
            Clear
          </button>
        )}
      </div>

      {problem ? (
        <p className="mt-2 text-xs text-warning">{problem}</p>
      ) : (
        <p className="mt-2 text-xs text-subtle">
          {trim === null
            ? "The whole track. Set a marker to clip it."
            : `Clip is ${formatDuration(clipLength)} long.`}
        </p>
      )}

      {job.silence && (
        <p className="mt-1 text-xs text-subtle">
          {job.silence.entirelySilent
            ? "The audio is silent throughout — nothing to trim."
            : suggested
              ? `Found ${job.silence.intervals.length} silent ${
                  job.silence.intervals.length === 1 ? "stretch" : "stretches"
                }; markers set to skip the quiet head and tail.`
              : "No leading or trailing silence found."}
        </p>
      )}

      {!problem && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">
            {trim === null ? "Extract as:" : "Extract this clip as:"}
          </span>
          {formats.map((format) => {
            const exists = job.outputs.some(
              (output) => output.formatId === format.id && sameTrimRange(output.trim, trim),
            );
            return (
              <button
                key={format.id}
                type="button"
                disabled={disabled || exists}
                title={exists ? "Already extracted for this range" : undefined}
                onClick={() => onExtract(format.id, trim)}
                className="rounded-md border border-border-strong px-2 py-0.5 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border-strong disabled:hover:text-inherit"
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
