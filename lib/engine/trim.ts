/**
 * Trimming: choosing which part of the audio comes out.
 *
 * There are two ways in, and they converge on the same `TrimRange`:
 *
 *  - explicit markers the user sets, typed as timecodes or taken from the
 *    playback position of a preview, and
 *  - leading/trailing silence found by ffmpeg's `silencedetect` filter.
 *
 * The arguments this builds are deliberately `-ss` *before* `-i` and `-t`
 * *after* it:
 *
 *  - `-ss` as an input option makes ffmpeg seek to the start point instead of
 *    decoding and discarding everything before it. On a multi-gigabyte file
 *    that is the difference between instant and minutes, and WORKERFS mounts
 *    are seekable, so the seek is real.
 *  - `-to` is measured against the input timeline in some ffmpeg versions and
 *    the output timeline in others, which makes it a coin flip once `-ss` has
 *    already shifted timestamps. `-t` is a *length*, so it means one thing
 *    everywhere.
 *
 * Everything here is pure, so it is unit-tested without a browser.
 */
import type {
  SilenceInterval,
  SilenceScanOptions,
  TrimRange,
} from "./types";

/**
 * Defaults for silence detection.
 *
 * -50 dBFS sits below room tone and encoder noise floors but well above
 * anything audible, and half a second is long enough that a pause between
 * words is not mistaken for the end of the recording.
 */
export const DEFAULT_SILENCE_OPTIONS: SilenceScanOptions = {
  thresholdDb: -50,
  minDurationSeconds: 0.5,
};

/**
 * Silence deliberately kept on either side of an automatic cut.
 *
 * silencedetect reports where the audio crossed the threshold, which is a
 * little after speech actually began; starting exactly there clips the attack
 * of the first word.
 */
export const SILENCE_PADDING_SECONDS = 0.1;

/** How near an edge a silence must reach to count as leading or trailing. */
const EDGE_TOLERANCE_SECONDS = 0.05;

/** Shorter than this and there is no clip worth producing. */
export const MIN_CLIP_SECONDS = 0.05;

/**
 * Shortest clip automatic trimming will propose.
 *
 * Deliberately far above MIN_CLIP_SECONDS: someone asking for a quarter-second
 * range has said what they want, but a file that is silent apart from a cough
 * should be reported as having nothing to trim rather than reduced to the
 * cough.
 */
export const MIN_SUGGESTED_CLIP_SECONDS = 0.5;

export interface TrimProblem {
  message: string;
  hint: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Seconds as a plain decimal - ffmpeg accepts this anywhere a time is taken. */
function formatSeconds(seconds: number): string {
  return (Math.round(seconds * 1000) / 1000).toFixed(3);
}

/**
 * Clamps a requested range to what the file can actually deliver.
 *
 * Returns a null trim for a range that turns out to cover everything, so the
 * common case adds no arguments at all, and a `problem` for a range that would
 * produce no audio - which is worth saying before a long conversion, not after.
 */
export function resolveTrim(
  trim: TrimRange | null | undefined,
  durationSeconds: number | null,
): { trim: TrimRange | null; problem: TrimProblem | null } {
  if (!trim) return { trim: null, problem: null };

  const knownDuration =
    durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : null;

  const start = Math.max(0, trim.startSeconds);
  if (knownDuration !== null && start >= knownDuration) {
    return {
      trim: null,
      problem: {
        message: "The clip starts after the end of this file.",
        hint: `The audio is ${formatSeconds(knownDuration)} seconds long.`,
      },
    };
  }

  let end = trim.endSeconds;
  if (end !== null && knownDuration !== null) end = Math.min(end, knownDuration);

  if (end !== null && end - start < MIN_CLIP_SECONDS) {
    return {
      trim: null,
      problem: {
        message: "The clip end must come after its start.",
        hint: "Set an end time later than the start time, or clear it to run to the end of the file.",
      },
    };
  }

  // A range that covers the whole file is not a trim; drop it so the command
  // stays a plain extraction (and, for stream copies, stays byte-exact).
  const reachesEnd = end === null || (knownDuration !== null && end >= knownDuration);
  if (start <= 0 && reachesEnd) return { trim: null, problem: null };

  return {
    trim: { startSeconds: start, endSeconds: reachesEnd ? null : end },
    problem: null,
  };
}

/** Whether two ranges select the same audio, treating null as "everything". */
export function sameTrimRange(a: TrimRange | null, b: TrimRange | null): boolean {
  if (a === null || b === null) return a === b;
  return a.startSeconds === b.startSeconds && a.endSeconds === b.endSeconds;
}

/** Length of the audio a trim will produce, or null when it is unknowable. */
export function trimDuration(
  trim: TrimRange | null,
  durationSeconds: number | null,
): number | null {
  if (!trim) return durationSeconds;
  const end = trim.endSeconds ?? durationSeconds;
  if (end === null) return null;
  return Math.max(0, end - trim.startSeconds);
}

/** ffmpeg arguments for a trim, split by where they have to go on the line. */
export function trimArgs(trim: TrimRange | null): { input: string[]; output: string[] } {
  if (!trim) return { input: [], output: [] };
  const length = trim.endSeconds === null ? null : trim.endSeconds - trim.startSeconds;
  return {
    input: trim.startSeconds > 0 ? ["-ss", formatSeconds(trim.startSeconds)] : [],
    output: length !== null ? ["-t", formatSeconds(length)] : [],
  };
}

/** The `silencedetect` filter, configured. */
export function silenceDetectArgs(options: SilenceScanOptions): string[] {
  const threshold = clamp(options.thresholdDb, -90, 0);
  const minDuration = clamp(options.minDurationSeconds, 0.05, 60);
  return ["-af", `silencedetect=noise=${threshold}dB:d=${minDuration}`];
}

/** True for the log lines a silence scan actually needs to keep. */
export function isSilenceEventLine(message: string): boolean {
  return /silence_(start|end)\s*:/.test(message);
}

/**
 * Reads silencedetect's log lines into intervals.
 *
 * The filter prints an unpaired line per event:
 *   [silencedetect @ 0x...] silence_start: 12.3456
 *   [silencedetect @ 0x...] silence_end: 15.9 | silence_duration: 3.5544
 *
 * A `silence_start` with no matching end means the file finished while still
 * silent - which is precisely the trailing silence worth cutting, so it is kept
 * as an open interval rather than discarded.
 */
export function parseSilenceLog(log: readonly string[]): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];

  for (const line of log) {
    const start = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (start) {
      // silencedetect can report a fractionally negative start on the first
      // sample; the timeline begins at zero.
      intervals.push({ start: Math.max(0, Number(start[1])), end: null });
      continue;
    }

    const end = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (!end) continue;
    const open = intervals[intervals.length - 1];
    // An end with nothing open cannot be placed on the timeline.
    if (open && open.end === null) open.end = Math.max(open.start, Number(end[1]));
  }

  return intervals;
}

/** True when the detected silence spans the entire file. */
export function isEntirelySilent(
  intervals: readonly SilenceInterval[],
  durationSeconds: number | null,
): boolean {
  if (intervals.length !== 1 || !durationSeconds) return false;
  const [only] = intervals;
  return (
    only.start <= EDGE_TOLERANCE_SECONDS &&
    (only.end === null || durationSeconds - only.end <= EDGE_TOLERANCE_SECONDS)
  );
}

/**
 * Turns detected silence into a trim that drops the quiet head and tail.
 *
 * Only silence touching an edge is removed. Pauses in the middle are left
 * alone: cutting them would need a filter graph and would change the timing of
 * whatever is left, which is a different feature from trimming.
 */
export function suggestTrimFromSilence(
  intervals: readonly SilenceInterval[],
  durationSeconds: number | null,
  padding = SILENCE_PADDING_SECONDS,
): TrimRange | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  if (intervals.length === 0) return null;
  // Nothing to keep, so there is nothing to suggest.
  if (isEntirelySilent(intervals, durationSeconds)) return null;

  const first = intervals[0];
  const last = intervals[intervals.length - 1];

  const startSeconds =
    first.start <= EDGE_TOLERANCE_SECONDS && first.end !== null
      ? clamp(first.end - padding, 0, durationSeconds)
      : 0;

  const reachesEnd =
    last.end === null || durationSeconds - last.end <= EDGE_TOLERANCE_SECONDS;
  const endSeconds = reachesEnd
    ? clamp(last.start + padding, 0, durationSeconds)
    : durationSeconds;

  if (endSeconds - startSeconds < MIN_SUGGESTED_CLIP_SECONDS) return null;
  if (startSeconds <= 0 && endSeconds >= durationSeconds) return null;

  return {
    startSeconds,
    endSeconds: endSeconds >= durationSeconds ? null : endSeconds,
  };
}

/**
 * Parses a timecode into seconds; null when the text is not one.
 *
 * Accepts what people actually type: `90`, `1:30`, `1:02:03.5`.
 */
export function parseTimecode(value: string): number | null {
  const text = value.trim();
  if (!text) return null;

  const parts = text.split(":");
  if (parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+(?:\.\d+)?$|^\.\d+$/.test(part)) return null;
    seconds = seconds * 60 + Number(part);
  }

  return Number.isFinite(seconds) ? seconds : null;
}

/** 3723.5 -> "1:02:03.5"; 90 -> "1:30". Seeds and echoes the marker inputs. */
export function formatTimecode(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) * 100) / 100;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const whole = Math.floor(rest + 1e-9);
  const hundredths = Math.min(99, Math.round((rest - whole) * 100));

  const fraction =
    hundredths > 0 ? `.${String(hundredths).padStart(2, "0").replace(/0$/, "")}` : "";
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(whole)}${fraction}`
    : `${minutes}:${pad(whole)}${fraction}`;
}

/** 3723 -> "1h02m03s". Filename-safe, unlike a colon on Windows. */
export function compactTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (hours > 0) return `${hours}h${pad(minutes)}m${pad(rest)}s`;
  if (minutes > 0) return `${minutes}m${pad(rest)}s`;
  return `${rest}s`;
}

/**
 * Filename marker for a trimmed output, so clips from one video do not all
 * download under the same name.
 */
export function trimFileSuffix(
  trim: TrimRange | null,
  durationSeconds: number | null,
): string {
  if (!trim) return "";
  const end = trim.endSeconds ?? durationSeconds;
  return end === null
    ? `-from-${compactTimecode(trim.startSeconds)}`
    : `-${compactTimecode(trim.startSeconds)}-${compactTimecode(end)}`;
}

/**
 * Reads the two marker fields as a range.
 *
 * An empty start means the beginning of the file and an empty end means its
 * end, so the fields can be filled in one at a time.
 */
export function parseTrimInputs(
  startText: string,
  endText: string,
): { trim: TrimRange | null; error: string | null } {
  const startRaw = startText.trim();
  const endRaw = endText.trim();

  const start = startRaw ? parseTimecode(startRaw) : 0;
  if (start === null) {
    return { trim: null, error: `"${startRaw}" is not a time - try 1:30, 0:04.5 or 90.` };
  }

  const end = endRaw ? parseTimecode(endRaw) : null;
  if (endRaw && end === null) {
    return { trim: null, error: `"${endRaw}" is not a time - try 1:30, 0:04.5 or 90.` };
  }

  if (end !== null && end - start < MIN_CLIP_SECONDS) {
    return { trim: null, error: "The end time must come after the start time." };
  }

  if (start <= 0 && end === null) return { trim: null, error: null };
  return { trim: { startSeconds: start, endSeconds: end }, error: null };
}
