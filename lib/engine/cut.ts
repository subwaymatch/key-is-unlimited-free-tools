/**
 * Cutting a range out of an audio file.
 *
 * The extractor's catalogue, insisting on a range: the file's own format
 * copied, which cuts on a frame of the codec (a few hundredths of a second)
 * without touching the sound, or any of the others re-encoded to the marker.
 */
import { OUTPUT_FORMATS } from "./formats";
import type { OutputFormat } from "./types";
import { requireTrim } from "./video";

export const TRIM_AUDIO_FORMATS: readonly OutputFormat[] = OUTPUT_FORMATS.map((format) => ({
  ...format,
  label: format.id === "original" ? "Same format" : format.label,
  blurb:
    format.id === "original"
      ? "Cut without re-encoding, in the file's own format: instant, and nothing lost"
      : format.blurb,
  blocker(probe, context) {
    return requireTrim(context) ?? format.blocker?.(probe, context) ?? null;
  },
}));
