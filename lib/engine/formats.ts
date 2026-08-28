/**
 * Output format catalogue.
 *
 * Each format turns a ProbeResult into a concrete ffmpeg invocation. The two
 * interesting decisions live here:
 *
 *  - "Original" and "M4A" stream-copy when the source codec already fits the
 *    target container. Copying skips decode+encode entirely, which is the
 *    difference between seconds and minutes on a multi-gigabyte file.
 *  - Every job selects exactly one audio stream (`-map 0:a:0`) and drops video,
 *    subtitles and data, so muxers never reject an unsupported companion stream.
 */
import type { ExtractMode, ProbeResult } from "./types";

export type OutputFormatId = "original" | "m4a" | "mp3" | "wav" | "opus" | "flac";

export interface FormatPlan {
  args: string[];
  extension: string;
  mimeType: string;
  mode: ExtractMode;
}

export interface OutputFormat {
  id: OutputFormatId;
  label: string;
  blurb: string;
  /** Whether the result preserves the source audio bit-for-bit or losslessly. */
  lossless: boolean;
  /**
   * Encoder that must exist in the loaded core for this format to work.
   * Null means the format is (or can be) a pure stream copy.
   */
  requiredEncoder: string | null;
  plan(probe: ProbeResult): FormatPlan;
}

/** Drop video, subtitles and data; take the first audio stream only. */
const SELECT_AUDIO = ["-map", "0:a:0", "-vn", "-sn", "-dn"];

const MP4_AUDIO = { extension: "m4a", mimeType: "audio/mp4" };

/**
 * Container to copy each codec into, so "Original" stays a true stream copy.
 * Anything unrecognised goes to Matroska audio, which accepts nearly any codec.
 */
const COPY_TARGETS: Array<{
  matches: (codec: string) => boolean;
  extension: string;
  mimeType: string;
}> = [
  { matches: (c) => c === "aac" || c === "alac", ...MP4_AUDIO },
  { matches: (c) => c === "mp3", extension: "mp3", mimeType: "audio/mpeg" },
  { matches: (c) => c === "mp2", extension: "mp2", mimeType: "audio/mpeg" },
  { matches: (c) => c === "opus", extension: "opus", mimeType: "audio/ogg" },
  { matches: (c) => c === "vorbis", extension: "ogg", mimeType: "audio/ogg" },
  { matches: (c) => c === "flac", extension: "flac", mimeType: "audio/flac" },
  { matches: (c) => c === "ac3", extension: "ac3", mimeType: "audio/ac3" },
  { matches: (c) => c === "eac3", extension: "eac3", mimeType: "audio/eac3" },
  { matches: (c) => c.startsWith("pcm_"), extension: "wav", mimeType: "audio/wav" },
];

const MATROSKA_AUDIO = { extension: "mka", mimeType: "audio/x-matroska" };

/** Picks the container that can hold `codec` without re-encoding. */
export function copyTargetForCodec(codec: string | null): {
  extension: string;
  mimeType: string;
} {
  if (!codec) return MATROSKA_AUDIO;
  const normalized = codec.toLowerCase();
  const target = COPY_TARGETS.find((entry) => entry.matches(normalized));
  return target
    ? { extension: target.extension, mimeType: target.mimeType }
    : MATROSKA_AUDIO;
}

/** Codecs that can be copied straight into an MP4/M4A container. */
const MP4_COPYABLE = new Set(["aac", "alac"]);

export const OUTPUT_FORMATS: readonly OutputFormat[] = [
  {
    id: "original",
    label: "Original",
    blurb: "Stream copy — no re-encoding, identical audio, fastest",
    lossless: true,
    requiredEncoder: null,
    plan(probe) {
      const target = copyTargetForCodec(probe.audio?.codec ?? null);
      return {
        args: [...SELECT_AUDIO, "-c:a", "copy"],
        ...target,
        mode: "copy",
      };
    },
  },
  {
    id: "m4a",
    label: "M4A (AAC)",
    blurb: "Plays everywhere; copied losslessly when the source is already AAC",
    lossless: false,
    requiredEncoder: "aac",
    plan(probe) {
      const codec = probe.audio?.codec?.toLowerCase() ?? "";
      const canCopy = MP4_COPYABLE.has(codec);
      return {
        args: [
          ...SELECT_AUDIO,
          ...(canCopy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]),
          // Moves the moov atom to the front so players can start immediately.
          "-movflags",
          "+faststart",
        ],
        ...MP4_AUDIO,
        mode: canCopy ? "copy" : "encode",
      };
    },
  },
  {
    id: "mp3",
    label: "MP3",
    blurb: "Universal compatibility, VBR ~190 kbps",
    lossless: false,
    requiredEncoder: "libmp3lame",
    plan() {
      return {
        args: [...SELECT_AUDIO, "-c:a", "libmp3lame", "-q:a", "2"],
        extension: "mp3",
        mimeType: "audio/mpeg",
        mode: "encode",
      };
    },
  },
  {
    id: "opus",
    label: "Opus",
    blurb: "Best quality per byte, 128 kbps",
    lossless: false,
    requiredEncoder: "libopus",
    plan() {
      return {
        args: [...SELECT_AUDIO, "-c:a", "libopus", "-b:a", "128k"],
        extension: "opus",
        mimeType: "audio/ogg",
        mode: "encode",
      };
    },
  },
  {
    id: "flac",
    label: "FLAC",
    blurb: "Lossless, roughly half the size of WAV",
    lossless: true,
    requiredEncoder: "flac",
    plan() {
      return {
        args: [...SELECT_AUDIO, "-c:a", "flac"],
        extension: "flac",
        mimeType: "audio/flac",
        mode: "encode",
      };
    },
  },
  {
    id: "wav",
    label: "WAV",
    blurb: "Uncompressed 16-bit PCM — large files",
    lossless: true,
    requiredEncoder: "pcm_s16le",
    plan() {
      return {
        args: [...SELECT_AUDIO, "-c:a", "pcm_s16le"],
        extension: "wav",
        mimeType: "audio/wav",
        mode: "encode",
      };
    },
  },
];

export const DEFAULT_FORMAT_IDS: OutputFormatId[] = ["original", "mp3"];

export function getFormat(id: string): OutputFormat {
  const format = OUTPUT_FORMATS.find((entry) => entry.id === id);
  if (!format) throw new Error(`Unknown output format: ${id}`);
  return format;
}

/**
 * Output ceiling imposed by ffmpeg.wasm.
 *
 * WORKERFS lets the *input* be read from disk without limit, but ffmpeg still
 * writes its output into the in-memory filesystem, which shares the core's
 * ~2 GB heap. The threshold sits below that to leave room for working memory.
 */
export const MAX_SAFE_OUTPUT_BYTES = 1_500_000_000;

/**
 * Estimated output size, for formats whose size is predictable before running.
 *
 * Only uncompressed PCM is worth guarding: at 16-bit/48 kHz stereo, WAV grows
 * about 11.5 MB per minute, so a ~2.2 hour video is already at the ceiling.
 * Compressed formats stay comfortably small at any realistic duration.
 */
export function estimateOutputBytes(
  formatId: OutputFormatId,
  probe: ProbeResult,
): number | null {
  if (formatId !== "wav") return null;
  const { durationSeconds, audio } = probe;
  if (!durationSeconds || !audio) return null;
  const sampleRate = audio.sampleRate ?? 48_000;
  const channels = audio.channels ?? 2;
  return Math.round(durationSeconds * sampleRate * channels * 2) + 44;
}

/**
 * Returns a reason the format cannot run for this file, or null when it can.
 */
export function findFormatBlocker(
  formatId: OutputFormatId,
  probe: ProbeResult,
): { message: string; hint: string } | null {
  const estimated = estimateOutputBytes(formatId, probe);
  if (estimated !== null && estimated > MAX_SAFE_OUTPUT_BYTES) {
    const gib = (estimated / 1024 ** 3).toFixed(1);
    return {
      message: `WAV would be about ${gib} GB`,
      hint: "ffmpeg.wasm builds its output in memory, which caps out near 1.5 GB. Choose FLAC for lossless audio at roughly half the size.",
    };
  }
  return null;
}
