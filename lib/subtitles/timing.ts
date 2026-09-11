/**
 * Fixing subtitle timing: a constant shift, and a stretch.
 *
 * Two knobs cover nearly every out-of-sync file. Subtitles that are late or
 * early by the same amount throughout need an offset. Subtitles that start in
 * sync and drift were made for a video at a different frame rate - a 25 fps
 * PAL release timed against a 23.976 fps film transfer, say - and need every
 * time multiplied by the ratio of the two rates.
 */
import { parseTimecode } from "../engine/trim";
import type { Cue } from "./types";

export interface Retiming {
  /** Seconds added to every time. Negative makes the subtitles earlier. */
  offsetSeconds: number;
  /** Every time is multiplied by this before the offset is added. 1 leaves it alone. */
  factor: number;
}

export const NO_RETIMING: Retiming = { offsetSeconds: 0, factor: 1 };

export function isRetimed(retiming: Retiming): boolean {
  return retiming.offsetSeconds !== 0 || retiming.factor !== 1;
}

/**
 * Frame-rate pairs worth a preset, with the factor each implies.
 *
 * Subtitles made for a 25 fps video run too fast against the same film at
 * 23.976 fps, so every time is multiplied by 25 / 23.976; the other way round
 * divides. The factor is `from / to`.
 */
export const FRAME_RATE_PRESETS: readonly { from: number; to: number; label: string }[] = [
  { from: 25, to: 23.976, label: "25 to 23.976 fps (PAL video to film)" },
  { from: 23.976, to: 25, label: "23.976 to 25 fps (film to PAL video)" },
  { from: 25, to: 29.97, label: "25 to 29.97 fps (PAL to NTSC)" },
  { from: 29.97, to: 25, label: "29.97 to 25 fps (NTSC to PAL)" },
  { from: 24, to: 25, label: "24 to 25 fps" },
  { from: 25, to: 24, label: "25 to 24 fps" },
  { from: 24, to: 23.976, label: "24 to 23.976 fps" },
  { from: 23.976, to: 24, label: "23.976 to 24 fps" },
];

export function stretchFactor(from: number, to: number): number {
  return from / to;
}

/**
 * Reads a typed offset: "1.5", "-2", "+0:03.25", "-1:02".
 *
 * A bare number is seconds; anything with a colon is a clock, read the same
 * way the trim markers are. Null for anything that is not a time.
 */
export function parseOffset(value: string): number | null {
  const text = value.trim();
  if (text === "") return 0;
  const sign = text.startsWith("-") ? -1 : 1;
  const unsigned = text.replace(/^[+-]/, "");
  const seconds = parseTimecode(unsigned);
  return seconds === null ? null : sign * seconds;
}

export interface RetimeResult {
  cues: Cue[];
  /** Cues that ended before the start of the media once moved, and were dropped. */
  dropped: number;
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Applies a retiming to every cue.
 *
 * A cue pushed entirely before zero is dropped: nothing can show it. One that
 * merely starts before zero is clamped to start at zero, since a caption that
 * was already showing when the video began is worth keeping.
 */
export function retimeCues(cues: readonly Cue[], retiming: Retiming): RetimeResult {
  if (!isRetimed(retiming)) return { cues: [...cues], dropped: 0 };
  const moved: Cue[] = [];
  let dropped = 0;
  for (const cue of cues) {
    const start = round(cue.start * retiming.factor + retiming.offsetSeconds);
    const end = round(cue.end * retiming.factor + retiming.offsetSeconds);
    if (end <= 0) {
      dropped += 1;
      continue;
    }
    moved.push({ ...cue, start: Math.max(0, start), end });
  }
  return { cues: moved, dropped };
}
