/**
 * Frames lifted out of a video every so many seconds, each as its own
 * picture.
 *
 * The thumbnail tool makes one frame or a sheet of many; this makes many
 * files, one format per moment the way the chapter splitter makes one per
 * chapter, each a seek straight to its moment and one frame out.
 */
import { compactTimecode, formatSeconds, formatTimecode } from "./trim";
import type { FormatBlocker, OutputFormat, ProbeResult } from "./types";

export type FrameImage = "jpg" | "png";

export interface FramesSettings {
  everySeconds: number;
  image: FrameImage;
}

export const FRAME_INTERVALS: readonly { seconds: number; label: string }[] = [
  { seconds: 1, label: "Every second" },
  { seconds: 2, label: "Every 2 seconds" },
  { seconds: 5, label: "Every 5 seconds" },
  { seconds: 10, label: "Every 10 seconds" },
  { seconds: 30, label: "Every 30 seconds" },
  { seconds: 60, label: "Every minute" },
];

/** The most frames a file yields; a card with more chips than this is a wall. */
export const MAX_FRAMES = 64;

export const DEFAULT_FRAMES_SETTINGS: FramesSettings = { everySeconds: 5, image: "jpg" };

/** Reads a typed interval in seconds. Null for anything under a tenth of a second. */
export function parseInterval(value: number): number | null {
  if (!Number.isFinite(value) || value < 0.1) return null;
  return Math.round(value * 10) / 10;
}

/** The moments a file yields frames at: the start, then every interval, up to the cap. */
export function frameTimes(durationSeconds: number | null, everySeconds: number): number[] {
  if (!durationSeconds || durationSeconds <= 0 || !(everySeconds > 0)) return [];
  const times: number[] = [];
  for (let at = 0; at < durationSeconds && times.length < MAX_FRAMES; at += everySeconds) times.push(Math.round(at * 1000) / 1000);
  return times;
}

/** "Frame 3 at 0:10". */
export function describeFrame(times: readonly number[], index: number): string {
  const at = times[index];
  return at === undefined ? `Frame ${index + 1}` : `Frame ${index + 1} at ${formatTimecode(at)}`;
}

/** One moment as one format. */
export function frameAtFormat(index: number, settings: FramesSettings): OutputFormat {
  const isPng = settings.image === "png";
  return {
    id: `frame-${index + 1}`,
    label: `Frame ${index + 1}`,
    blurb: isPng ? "This moment as a lossless PNG" : "This moment as a JPEG",
    lossless: isPng,
    requiredEncoder: isPng ? "png" : "mjpeg",
    describe(probe) {
      return describeFrame(frameTimes(probe.durationSeconds, settings.everySeconds), index);
    },
    offer(probe) {
      return frameTimes(probe.durationSeconds, settings.everySeconds).length > index;
    },
    plan(probe: ProbeResult) {
      const at = frameTimes(probe.durationSeconds, settings.everySeconds)[index] ?? 0;
      return {
        inputArgs: at > 0 ? ["-ss", formatSeconds(at)] : [],
        args: ["-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", ...(isPng ? ["-c:v", "png"] : ["-c:v", "mjpeg", "-q:v", "2"]), "-f", "image2", "-update", "1"],
        extension: settings.image,
        mimeType: isPng ? "image/png" : "image/jpeg",
        mode: "encode",
        kind: "image",
        fileSuffix: `-frame-${String(index + 1).padStart(2, "0")}-at-${compactTimecode(at)}`,
        omitRangeSuffix: true,
      };
    },
    blocker(probe): FormatBlocker | null {
      if (!probe.video) return { message: "This file has no picture.", hint: "It is audio only.", retryable: false };
      if (!probe.durationSeconds) {
        return { message: "This file's length is unknown, so the moments cannot be placed.", hint: "The container does not report a duration. Converting it to MP4 first gives it one.", retryable: false };
      }
      const times = frameTimes(probe.durationSeconds, settings.everySeconds);
      if (!times[index]) {
        if (index === 0) return null;
        return { message: `This file has no frame ${index + 1} at that interval.`, hint: `It yields ${times.length}.`, retryable: false };
      }
      return null;
    },
  };
}

export function frameFormats(settings: FramesSettings): OutputFormat[] {
  return Array.from({ length: MAX_FRAMES }, (_, index) => frameAtFormat(index, settings));
}

export function frameFormatIds(settings: FramesSettings): (probe: ProbeResult) => string[] {
  return (probe) => frameTimes(probe.durationSeconds, settings.everySeconds).map((_, index) => `frame-${index + 1}`);
}

/** A line for the panel: how many frames a length yields, and whether the cap binds. */
export function describeYield(durationSeconds: number | null, everySeconds: number): string | null {
  if (!durationSeconds) return null;
  const wanted = Math.ceil(durationSeconds / everySeconds);
  return wanted > MAX_FRAMES ? `${MAX_FRAMES} frames, the first ${formatTimecode(MAX_FRAMES * everySeconds)} of the file` : `${wanted} ${wanted === 1 ? "frame" : "frames"}`;
}
