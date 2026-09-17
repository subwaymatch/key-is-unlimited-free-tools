/**
 * Repeating a file: a clip three times over, or a ten-second loop run out to
 * an hour.
 *
 * `-stream_loop` reads the input again from the start as many times as asked
 * and carries the timestamps on, so every stream is copied and a loop of a
 * two-hour file takes as long as reading it that many times. A file looped
 * to a length is looped without end and cut where the length says.
 */
import { chapterContainer, copyMaps } from "./chapters";
import { formatSeconds } from "./trim";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult } from "./types";
import { containerArgs, estimateCopyBytes, playbackWarning, sizeBlocker } from "./video";

/** Repeat the file a number of times over, or until it is at least this long. */
export type LoopTarget = { kind: "times"; times: number } | { kind: "seconds"; seconds: number };

export const LOOP_TIMES: readonly number[] = [2, 3, 4, 5, 10];

export const LOOP_LENGTHS: readonly { seconds: number; label: string }[] = [
  { seconds: 60, label: "1 minute" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 3600, label: "1 hour" },
];

/** The most times a file is repeated: past this the output ceiling decides anyway. */
export const MAX_LOOP_TIMES = 100;

export const DEFAULT_LOOP_TARGET: LoopTarget = { kind: "times", times: 2 };

/** Reads a typed repeat count. Null for anything that is not a whole number from 2 up. */
export function parseLoopTimes(value: number): number | null {
  if (!Number.isInteger(value) || value < 2 || value > MAX_LOOP_TIMES) return null;
  return value;
}

/** "3 times over" or "to 1 hour". */
export function describeLoop(target: LoopTarget): string {
  if (target.kind === "times") return `${target.times} times over`;
  const preset = LOOP_LENGTHS.find((entry) => entry.seconds === target.seconds);
  return `to ${preset ? preset.label : `${target.seconds} seconds`}`;
}

/** How many times the file plays in the output, or null when that cannot be known. */
export function loopCount(target: LoopTarget, durationSeconds: number | null): number | null {
  if (target.kind === "times") return target.times;
  if (!durationSeconds || durationSeconds <= 0) return null;
  return target.seconds / durationSeconds;
}

function loopId(target: LoopTarget): string {
  return target.kind === "times" ? `loop-${target.times}x` : `loop-${target.seconds}s`;
}

/** The loop for one target: every stream copied, the file read over and over. */
export function loopFormat(target: LoopTarget): OutputFormat {
  const description = describeLoop(target);
  return {
    id: loopId(target),
    label: description.charAt(0).toUpperCase() + description.slice(1),
    blurb:
      target.kind === "times"
        ? `The whole file played ${target.times} times in a row, every stream copied`
        : `The file repeated until it is ${description.slice(3)} long, every stream copied`,
    lossless: true,
    requiredEncoder: null,
    plan(probe: ProbeResult, context?: PlanContext) {
      const container = chapterContainer(probe, context);
      const count = loopCount(target, probe.durationSeconds);
      return {
        inputArgs: ["-stream_loop", target.kind === "times" ? String(target.times - 1) : "-1"],
        args: [
          ...copyMaps(probe),
          ...(target.kind === "seconds" ? ["-t", formatSeconds(target.seconds)] : []),
          "-c",
          "copy",
          // The one chapter list would be wrong the second time round.
          "-map_chapters",
          "-1",
          ...containerArgs(container),
        ],
        ...container,
        mode: "copy",
        kind: probe.hasVideo && probe.video ? "video" : "audio",
        fileSuffix: target.kind === "times" ? `-x${target.times}` : `-${target.seconds}s-loop`,
        durationFactor: count ?? 1,
        warning: playbackWarning(probe.video?.codec),
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (target.kind === "seconds") {
        if (!probe.durationSeconds) {
          return {
            message: "This file's length is unknown, so it cannot be looped to a length.",
            hint: "The container does not report a duration. Loop it a number of times instead.",
            retryable: false,
          };
        }
        if (probe.durationSeconds >= target.seconds) {
          return {
            message: `This file is already ${description.slice(3)} or longer.`,
            hint: `It is ${Math.round(probe.durationSeconds)} seconds long, so there is nothing to repeat. Choose a longer length, or a number of times.`,
            severity: "info",
            retryable: false,
          };
        }
      }
      const count = loopCount(target, probe.durationSeconds) ?? 1;
      return sizeBlocker(Math.round(estimateCopyBytes(probe, context) * count), "The looped file");
    },
  };
}

/** Every preset as a format, for the card to offer another after the first. */
export const LOOP_FORMATS: readonly OutputFormat[] = [
  ...LOOP_TIMES.map((times) => loopFormat({ kind: "times", times })),
  ...LOOP_LENGTHS.map((entry) => loopFormat({ kind: "seconds", seconds: entry.seconds })),
];
