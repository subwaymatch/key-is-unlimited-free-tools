/**
 * Changing the speed of a recording: a lecture at 1.5x, an interview slowed
 * down to transcribe.
 *
 * The speed changer for video re-times the picture too; this is the same
 * `atempo` chain on the sound alone, written back in the file's own format,
 * for the far more common case where there is no picture, or none wanted.
 */
import { audioTargetFor } from "./audio";
import { estimateOutputBytes, SELECT_AUDIO } from "./formats";
import type { FormatBlocker, OutputFormat } from "./types";
import { atempoChain, formatSpeed } from "./video";

/** Speeds worth a button for listening. Anything else goes in the custom field. */
export const AUDIO_SPEED_PRESETS: readonly { factor: number; blurb: string }[] = [
  { factor: 0.5, blurb: "Half speed, for transcribing" },
  { factor: 0.75, blurb: "A little slower, still natural" },
  { factor: 1.25, blurb: "A little faster, still natural" },
  { factor: 1.5, blurb: "Faster: the usual choice for a lecture" },
  { factor: 2, blurb: "Twice as fast, and still followable" },
  { factor: 3, blurb: "Three times as fast: skimming" },
];

/** The speed changer for one factor, on the sound alone. */
export function audioSpeedFormat(factor: number): OutputFormat {
  const speed = formatSpeed(factor);
  const filter = atempoChain(factor)
    .map((step) => `atempo=${step}`)
    .join(",");
  return {
    id: `audio-speed-${speed}`,
    label: speed,
    blurb: factor === 1 ? "The same speed, re-encoded" : factor > 1 ? `${speed} faster, pitch kept` : `${speed} slower, pitch kept`,
    lossless: false,
    requiredEncoder: "aac",
    plan(probe) {
      const target = audioTargetFor(probe.audio?.codec);
      return {
        args: [...SELECT_AUDIO, "-af", filter, ...target.args],
        extension: target.extension,
        mimeType: target.mimeType,
        mode: "encode",
        kind: "audio",
        fileSuffix: `-${speed}`,
        durationFactor: 1 / factor,
        limitInput: true,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (!probe.audio) {
        return { message: "This file has no sound to re-time.", hint: "There is no audio stream in it.", retryable: false };
      }
      if (audioTargetFor(probe.audio.codec).extension !== "wav") return null;
      const atSource = estimateOutputBytes("wav", probe, context.trim);
      const estimated = atSource === null ? null : Math.round(atSource / factor);
      if (estimated === null || estimated <= 1_500_000_000) return null;
      return {
        message: `The WAV would be about ${(estimated / 1024 ** 3).toFixed(1)} GB.`,
        hint: "ffmpeg.wasm builds its output in memory, which caps out near 1.5 GB. Trim the range down, or convert to FLAC first.",
        retryable: false,
      };
    },
  };
}
