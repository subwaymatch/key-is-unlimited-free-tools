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
import { trimDuration } from "./trim";
import type {
  EngineCapabilities,
  FormatBlocker,
  OutputFormat,
  ProbeResult,
  TrimRange,
} from "./types";

export type { FormatPlan, OutputFormat } from "./types";

export type OutputFormatId = "original" | "m4a" | "mp3" | "wav" | "opus" | "flac";

/** An audio format: the shared shape, with the id narrowed to this catalogue. */
export interface AudioFormat extends OutputFormat {
  id: OutputFormatId;
}

/** Drop video, subtitles and data; take the first audio stream only. */
export const SELECT_AUDIO = ["-map", "0:a:0", "-vn", "-sn", "-dn"];

const MP4_AUDIO = { extension: "m4a", mimeType: "audio/mp4" };

/** Moves the moov atom to the front so players can start immediately. */
const MP4_FASTSTART = ["-movflags", "+faststart"];

/**
 * PCM flavours the WAV muxer can hold.
 *
 * WAV's tag table covers little-endian PCM, unsigned 8-bit and the two
 * telephony codecs. The big-endian variants older QuickTime files carry are not
 * in it, and a stream copy into WAV fails at mux time rather than at probe
 * time, so those are sent to Matroska with the other unusual codecs.
 */
const WAV_COPYABLE_PCM = /^pcm_(?:s(?:16|24|32|64)le|f(?:32|64)le|u8|alaw|mulaw)$/;

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
  { matches: (c) => WAV_COPYABLE_PCM.test(c), extension: "wav", mimeType: "audio/wav" },
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

/**
 * Codecs the "M4A (AAC)" format copies rather than re-encodes.
 *
 * ALAC would sit in an M4A just as happily, but this format promises AAC in
 * its name; a lossless copy of an ALAC track is what "Original" produces.
 */
const MP4_COPYABLE = new Set(["aac"]);

export const OUTPUT_FORMATS: readonly AudioFormat[] = [
  {
    id: "original",
    label: "Original",
    blurb: "Stream copy - no re-encoding, identical audio, fastest",
    lossless: true,
    requiredEncoder: null,
    plan(probe) {
      const target = copyTargetForCodec(probe.audio?.codec ?? null);
      return {
        args: [
          ...SELECT_AUDIO,
          "-c:a",
          "copy",
          ...(target.extension === MP4_AUDIO.extension ? MP4_FASTSTART : []),
        ],
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
          ...MP4_FASTSTART,
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
    /*
     * ffmpeg's own Opus encoder, not libopus.
     *
     * libopus is compiled into @ffmpeg/core 0.12.10 and advertised by
     * `-encoders`, but every invocation of it traps with "RuntimeError: memory
     * access out of bounds" - at any bitrate, any channel count, into any
     * container, and with or without an explicit mapping family. libvorbis,
     * libmp3lame and flac in the same build are fine, so this is libopus
     * specifically rather than the core or the Ogg muxer. 0.12.10 is the newest
     * core published, so there is no upgrade to move to.
     *
     * The native encoder is marked experimental, hence `-strict -2`, and it
     * only codes mono or stereo: a surround source is downmixed, which is what
     * libmp3lame already does for MP3. It is lower quality than libopus at the
     * same bitrate, which is the price of the format working at all.
     *
     * If a later core fixes libopus, this goes back to
     * ["-c:a", "libopus", "-b:a", "128k"] and requiredEncoder to "libopus".
     */
    label: "Opus",
    blurb: "Small files at 128 kbps, good for speech and music",
    lossless: false,
    requiredEncoder: "opus",
    plan() {
      return {
        args: [...SELECT_AUDIO, "-c:a", "opus", "-strict", "-2", "-b:a", "128k"],
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
    blurb: "Uncompressed 16-bit PCM - large files",
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
    blocker(probe, { trim }) {
      const estimated = estimateOutputBytes("wav", probe, trim);
      if (estimated === null || estimated <= MAX_SAFE_OUTPUT_BYTES) return null;
      const gib = (estimated / 1024 ** 3).toFixed(1);
      return {
        message: `WAV would be about ${gib} GB`,
        hint: "ffmpeg.wasm builds its output in memory, which caps out near 1.5 GB. Choose FLAC for lossless audio at roughly half the size, or trim the range down.",
      };
    },
  },
];

export const DEFAULT_FORMAT_IDS: OutputFormatId[] = ["original", "mp3"];

export function getFormat(id: string): AudioFormat {
  const format = OUTPUT_FORMATS.find((entry) => entry.id === id);
  if (!format) throw new Error(`Unknown output format: ${id}`);
  return format;
}

/** Looks a format up in any catalogue, or returns undefined for an unknown id. */
export function findFormat(
  formats: readonly OutputFormat[],
  id: string,
): OutputFormat | undefined {
  return formats.find((entry) => entry.id === id);
}

/**
 * Whether the loaded core can produce this format.
 *
 * Everything is on offer until the core has reported what it ships: the list
 * is not knowable before then, and greying out formats on a guess would be
 * worse than letting the engine say no.
 */
export function isFormatAvailable(
  format: OutputFormat,
  capabilities: EngineCapabilities | null,
): boolean {
  if (!capabilities || !format.requiredEncoder) return true;
  return capabilities.encoders.has(format.requiredEncoder);
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
 *
 * A trim shrinks the output proportionally, which is one way a WAV that would
 * otherwise be refused becomes perfectly reasonable.
 */
export function estimateOutputBytes(
  formatId: OutputFormatId,
  probe: ProbeResult,
  trim: TrimRange | null = null,
): number | null {
  if (formatId !== "wav") return null;
  const { audio } = probe;
  const seconds = trimDuration(trim, probe.durationSeconds);
  if (!seconds || !audio) return null;
  const sampleRate = audio.sampleRate ?? 48_000;
  const channels = audio.channels ?? 2;
  return Math.round(seconds * sampleRate * channels * 2) + 44;
}

/**
 * Returns a reason the format cannot run for this file, or null when it can.
 *
 * Each format carries its own guard; this is the audio catalogue's view of
 * them, by id, for the few callers that think in ids.
 */
export function findFormatBlocker(
  formatId: OutputFormatId,
  probe: ProbeResult,
  trim: TrimRange | null = null,
  fileBytes = 0,
): FormatBlocker | null {
  return getFormat(formatId).blocker?.(probe, { trim, fileBytes }) ?? null;
}
