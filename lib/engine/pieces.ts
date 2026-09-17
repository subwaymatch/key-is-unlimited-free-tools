/**
 * Cutting a file into equal parts: every ten minutes, or into four.
 *
 * The chapter splitter's shape with the cuts worked out from the length
 * instead of read from the file: one stream-copy format per piece, offered
 * for as many pieces as the length makes, each seeking before the input and
 * running for its share. A video piece starts on the keyframe before its
 * cut, as a fast cut does; sound is cut to the frame.
 */
import { chapterContainer, copyMaps } from "./chapters";
import { formatSeconds, formatTimecode } from "./trim";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult, TrimRange } from "./types";
import { containerArgs, estimateCopyBytes, playbackWarning, sizeBlocker } from "./video";

/** Cut every so many seconds, or into so many pieces of equal length. */
export type PieceRule = { kind: "length"; seconds: number } | { kind: "count"; count: number };

export const PIECE_LENGTHS: readonly { seconds: number; label: string }[] = [
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 1800, label: "30 minutes" },
  { seconds: 3600, label: "1 hour" },
];

export const PIECE_COUNTS: readonly number[] = [2, 3, 4, 5, 10];

/** The most pieces a file is cut into; a chip per piece has to stay readable. */
export const MAX_PIECES = 64;

/** Shorter than this and a last piece is folded into the one before it. */
const MIN_TAIL_SECONDS = 1;

export const DEFAULT_PIECE_RULE: PieceRule = { kind: "length", seconds: 600 };

/** Reads a typed length in minutes. Null for anything under a tenth of a minute. */
export function parsePieceMinutes(value: number): number | null {
  if (!Number.isFinite(value) || value < 0.1) return null;
  return Math.round(value * 60);
}

/** "every 10 minutes" or "into 4 parts". */
export function describeRule(rule: PieceRule): string {
  if (rule.kind === "count") return `into ${rule.count} parts`;
  const preset = PIECE_LENGTHS.find((entry) => entry.seconds === rule.seconds);
  if (preset) return `every ${preset.label.replace("1 minute", "minute").replace("1 hour", "hour")}`;
  const minutes = Number((rule.seconds / 60).toFixed(2));
  return `every ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * Where the cuts fall for a file of this length: the ranges of every piece.
 *
 * A tail shorter than a second is not a piece and joins the one before it,
 * so a file of 600.4 seconds cut every minute is ten pieces, not eleven.
 */
export function pieceRanges(durationSeconds: number | null, rule: PieceRule): TrimRange[] {
  if (!durationSeconds || durationSeconds <= 0) return [];
  const length = rule.kind === "count" ? durationSeconds / Math.max(1, rule.count) : rule.seconds;
  if (!(length > 0)) return [];
  const ranges: TrimRange[] = [];
  for (let start = 0; start < durationSeconds && ranges.length < MAX_PIECES; start += length) {
    const end = Math.min(durationSeconds, start + length);
    ranges.push({ startSeconds: start, endSeconds: end });
  }
  const last = ranges[ranges.length - 1];
  const previous = ranges[ranges.length - 2];
  if (last && previous && last.endSeconds !== null && last.endSeconds - last.startSeconds < MIN_TAIL_SECONDS) {
    previous.endSeconds = last.endSeconds;
    ranges.pop();
  }
  return ranges;
}

/** "Part 3 of 7: 20:00 to 30:00", to the second: a third of 6.03 s is not worth "0:02.01". */
export function describePiece(ranges: readonly TrimRange[], index: number): string {
  const range = ranges[index];
  if (!range || range.endSeconds === null) return `Part ${index + 1}`;
  return `Part ${index + 1} of ${ranges.length}: ${formatTimecode(Math.round(range.startSeconds))} to ${formatTimecode(Math.round(range.endSeconds))}`;
}

/** One piece as one format, for a rule. */
export function pieceFormat(index: number, rule: PieceRule): OutputFormat {
  return {
    id: `part-${index + 1}`,
    label: `Part ${index + 1}`,
    blurb: "This part as its own file, every stream copied",
    lossless: true,
    requiredEncoder: null,
    describe(probe) {
      return describePiece(pieceRanges(probe.durationSeconds, rule), index);
    },
    offer(probe) {
      return pieceRanges(probe.durationSeconds, rule).length > index;
    },
    plan(probe: ProbeResult, context?: PlanContext) {
      const ranges = pieceRanges(probe.durationSeconds, rule);
      const range = ranges[index] ?? { startSeconds: 0, endSeconds: probe.durationSeconds };
      const end = range.endSeconds ?? probe.durationSeconds ?? 0;
      const length = Math.max(0, end - range.startSeconds);
      const container = chapterContainer(probe, context);
      const total = probe.durationSeconds;
      return {
        inputArgs: range.startSeconds > 0 ? ["-ss", formatSeconds(range.startSeconds)] : [],
        args: [
          ...copyMaps(probe),
          "-t",
          formatSeconds(length),
          "-c",
          "copy",
          // A copied stream starts on the keyframe before the seek, which lands
          // it at a negative timestamp; shift everything so the piece starts at zero.
          "-avoid_negative_ts",
          "make_zero",
          // The whole file's chapter list would be wrong in a piece of it.
          "-map_chapters",
          "-1",
          ...containerArgs(container),
        ],
        ...container,
        mode: "copy",
        kind: probe.hasVideo && probe.video ? "video" : "audio",
        fileSuffix: `-part${String(index + 1).padStart(2, "0")}`,
        // Progress is measured against the whole file, and this is a piece of it.
        durationFactor: total ? length / total : 1,
        warning: probe.hasVideo ? playbackWarning(probe.video?.codec) : undefined,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (!probe.durationSeconds) {
        return {
          message: "This file's length is unknown, so it cannot be cut into parts.",
          hint: "The container does not report a duration. Converting it to MP4 or M4A first gives it one.",
          retryable: false,
        };
      }
      const ranges = pieceRanges(probe.durationSeconds, rule);
      if (ranges.length < 2) {
        return {
          message: `This file is too short to cut ${describeRule(rule)}.`,
          hint: `It is ${formatTimecode(probe.durationSeconds)} long, which makes one part. Choose a shorter length.`,
          severity: "info",
          retryable: false,
        };
      }
      const range = ranges[index];
      if (!range) {
        return { message: `This file has no part ${index + 1}.`, hint: `Cut ${describeRule(rule)} it has ${ranges.length}.`, retryable: false };
      }
      return sizeBlocker(estimateCopyBytes(probe, { ...context, trim: range }), "This part");
    },
  };
}

/** Every piece as a format; `offer` hides the ones a file does not make. */
export function pieceFormats(rule: PieceRule): OutputFormat[] {
  return Array.from({ length: MAX_PIECES }, (_, index) => pieceFormat(index, rule));
}

/** The formats a file gets on arrival: one per piece its length makes. */
export function pieceFormatIds(rule: PieceRule): (probe: ProbeResult) => string[] {
  return (probe) => pieceRanges(probe.durationSeconds, rule).map((_, index) => `part-${index + 1}`);
}
