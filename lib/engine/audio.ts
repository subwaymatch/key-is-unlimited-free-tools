/**
 * The audio tools beyond extraction: loudness normalisation, compression to
 * a rate or a size, the sides of a recording, and pictures of it.
 *
 * "Normalize volume" is the vague version of this; the sharp one is a target
 * in LUFS that a platform publishes and enforces. Spotify and YouTube turn
 * everything down to -14; Apple wants -16; European broadcast is -23. A file
 * mastered to the number is played back as delivered, and one that is not is
 * turned down or, worse, left quiet.
 *
 * `loudnorm` in two passes, because its single pass is a dynamic normaliser
 * that rides the gain through the file and pumps on music. The first pass
 * measures and prints what it found; the second is given those numbers and
 * applies one linear gain, which is what "normalise" means. The engine runs
 * the passes and hands the first one's printout to `refine`.
 */
import { copyTargetForCodec, estimateOutputBytes, SELECT_AUDIO } from "./formats";
import { trimDuration } from "./trim";
import type { FormatBlocker, FormatPlan, OutputFormat, PlanContext, ProbeResult } from "./types";
import { containerArgs, containerFor, estimateCopyBytes, playbackWarning, sizeBlocker } from "./video";

export interface LoudnessPreset {
  id: string;
  /** Integrated loudness, in LUFS. */
  lufs: number;
  /** True-peak ceiling, in dBTP. */
  truePeak: number;
  label: string;
  blurb: string;
}

/**
 * Targets people are actually asked for, with who asks for them.
 *
 * True peak is -1 dBTP everywhere except US broadcast, whose spec says -2.
 * Spotify suggests -2 for loud masters headed for lossy encoding, but its
 * stated ceiling is -1 and that is what the preset says.
 */
export const LOUDNESS_PRESETS: readonly LoudnessPreset[] = [
  { id: "streaming", lufs: -14, truePeak: -1, label: "-14 LUFS", blurb: "Spotify, YouTube, Amazon Music, Tidal" },
  { id: "apple", lufs: -16, truePeak: -1, label: "-16 LUFS", blurb: "Apple Music, Apple Podcasts, most podcast hosts" },
  { id: "loud-podcast", lufs: -18, truePeak: -1, label: "-18 LUFS", blurb: "Audiobooks and spoken word, a touch quieter" },
  { id: "ebu", lufs: -23, truePeak: -1, label: "-23 LUFS", blurb: "EBU R128: European broadcast" },
  { id: "atsc", lufs: -24, truePeak: -2, label: "-24 LUFS", blurb: "ATSC A/85: US broadcast" },
];

export interface NormalizeSettings {
  lufs: number;
  truePeak: number;
}

export const DEFAULT_NORMALIZE_SETTINGS: NormalizeSettings = { lufs: -14, truePeak: -1 };

/** The quietest and loudest targets the custom field takes. */
export const MIN_LUFS = -40;
export const MAX_LUFS = -5;

/**
 * Loudness range the normaliser is allowed to squeeze the file into, in LU.
 *
 * loudnorm's default of 7 is tight enough to flatten music; 11 leaves a
 * film's dynamics alone while still meeting every target above, and is what
 * the platforms themselves measure against.
 */
const LOUDNESS_RANGE = 11;

/** Reads a typed LUFS target. Null for anything outside the range the tool takes. */
export function parseLufs(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded < MIN_LUFS || rounded > MAX_LUFS) return null;
  return rounded;
}

/** -14 -> "-14 LUFS", -16.5 -> "-16.5 LUFS". */
export function formatLufs(lufs: number): string {
  return `${Number(lufs.toFixed(1))} LUFS`;
}

/** What the first pass prints, as far as the second needs it. */
export interface LoudnessMeasurement {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

/** True for the lines of loudnorm's JSON printout the second pass reads. */
export function isLoudnormLine(line: string): boolean {
  return /"(input_i|input_tp|input_lra|input_thresh|target_offset)"\s*:/.test(line);
}

/**
 * Reads the measurement back out of the first pass's printout:
 *
 *   "input_i" : "-27.10",
 *   "input_tp" : "-4.70",
 *   ...
 *   "target_offset" : "0.20"
 *
 * Null when a value is missing or not a number, which loudnorm prints as
 * "-inf" for a silent file: the second pass then runs in its dynamic mode,
 * which still produces a sensible file.
 */
export function parseLoudnormOutput(lines: readonly string[]): LoudnessMeasurement | null {
  const read = (key: string): number | null => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const match = lines[i].match(new RegExp(`"${key}"\\s*:\\s*"?(-?\\d+(?:\\.\\d+)?)"?`));
      if (match) return Number(match[1]);
    }
    return null;
  };
  const inputI = read("input_i");
  const inputTp = read("input_tp");
  const inputLra = read("input_lra");
  const inputThresh = read("input_thresh");
  const targetOffset = read("target_offset");
  if (
    inputI === null ||
    inputTp === null ||
    inputLra === null ||
    inputThresh === null ||
    targetOffset === null
  ) {
    return null;
  }
  return { inputI, inputTp, inputLra, inputThresh, targetOffset };
}

/** The measuring pass's filter: the target, and a request for the printout. */
export function loudnormMeasureFilter(settings: NormalizeSettings): string {
  return `loudnorm=I=${settings.lufs}:TP=${settings.truePeak}:LRA=${LOUDNESS_RANGE}:print_format=json`;
}

/**
 * The correcting pass's filter. Given the measurement it applies one linear
 * gain; without one it falls back to loudnorm's dynamic mode.
 */
export function loudnormApplyFilter(
  settings: NormalizeSettings,
  measured: LoudnessMeasurement | null,
): string {
  const base = `loudnorm=I=${settings.lufs}:TP=${settings.truePeak}:LRA=${LOUDNESS_RANGE}`;
  if (!measured) return base;
  return (
    `${base}:measured_I=${measured.inputI}:measured_TP=${measured.inputTp}` +
    `:measured_LRA=${measured.inputLra}:measured_thresh=${measured.inputThresh}` +
    `:offset=${measured.targetOffset}:linear=true`
  );
}

/** The sample rate the output is written at: the source's own, or 48 kHz. */
function outputSampleRate(probe: ProbeResult): number {
  const rate = probe.audio?.sampleRate;
  return rate && rate > 0 ? rate : 48_000;
}

interface AudioTarget {
  args: string[];
  extension: string;
  mimeType: string;
}

/**
 * The codec a normalised audio file is written in: its own, where the core
 * has an encoder for it, so an MP3 stays an MP3 and a FLAC stays lossless.
 * Anything else becomes AAC in an M4A, which plays everywhere.
 */
export function audioTargetFor(codec: string | null | undefined): AudioTarget {
  const name = codec?.toLowerCase() ?? "";
  if (name === "mp3") {
    return { args: ["-c:a", "libmp3lame", "-q:a", "2"], extension: "mp3", mimeType: "audio/mpeg" };
  }
  if (name === "flac") return { args: ["-c:a", "flac"], extension: "flac", mimeType: "audio/flac" };
  if (name.startsWith("pcm_")) {
    return { args: ["-c:a", "pcm_s16le"], extension: "wav", mimeType: "audio/wav" };
  }
  if (name === "opus") {
    return {
      args: ["-c:a", "opus", "-strict", "-2", "-b:a", "128k"],
      extension: "opus",
      mimeType: "audio/ogg",
    };
  }
  if (name === "vorbis") {
    return { args: ["-c:a", "libvorbis", "-q:a", "5"], extension: "ogg", mimeType: "audio/ogg" };
  }
  const m4a = copyTargetForCodec("aac");
  return {
    args: ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
    extension: m4a.extension,
    mimeType: m4a.mimeType,
  };
}

/**
 * The normaliser for one target.
 *
 * An audio file comes back in its own format at the target loudness; a video
 * keeps its picture untouched, copied, and gets its soundtrack normalised as
 * AAC, in a container that can hold both.
 */
export function normalizeFormat(settings: NormalizeSettings): OutputFormat {
  const label = formatLufs(settings.lufs);
  const id = `normalize-${Math.abs(settings.lufs)}lufs-${Math.abs(settings.truePeak)}tp`;

  return {
    id,
    label,
    blurb: `Integrated loudness ${label}, peaks under ${settings.truePeak} dBTP, in two passes`,
    lossless: false,
    requiredEncoder: "aac",
    plan(probe): FormatPlan {
      const rate = String(outputSampleRate(probe));
      const measure = [...SELECT_AUDIO, "-af", loudnormMeasureFilter(settings), "-ar", rate];

      // The final pass's shape, minus the filter, which is written from the
      // measurement once there is one.
      const finalArgsWith = (filter: string): string[] => {
        if (probe.hasVideo && probe.video) {
          return [
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-sn",
            "-dn",
            "-c:v",
            "copy",
            "-af",
            filter,
            "-ar",
            rate,
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            ...containerArgs(container),
          ];
        }
        return [...SELECT_AUDIO, "-af", filter, "-ar", rate, ...target.args];
      };

      const target = audioTargetFor(probe.audio?.codec);
      const container = containerFor(probe.video?.codec ?? null, "aac", null);
      const output = probe.hasVideo && probe.video ? container : target;

      return {
        analysisPasses: [measure],
        args: finalArgsWith(loudnormApplyFilter(settings, null)),
        refine: {
          keep: isLoudnormLine,
          args: (lines) => finalArgsWith(loudnormApplyFilter(settings, parseLoudnormOutput(lines))),
        },
        extension: output.extension,
        mimeType: output.mimeType,
        mode: "encode",
        kind: probe.hasVideo && probe.video ? "video" : "audio",
        fileSuffix: `-${Math.abs(settings.lufs)}lufs`,
        warning: probe.hasVideo ? playbackWarning(probe.video?.codec) : undefined,
      };
    },
    blocker(probe: ProbeResult, context: PlanContext): FormatBlocker | null {
      if (!probe.audio) {
        return {
          message: "This file has no audio to normalise.",
          hint: "There is no audio stream in it.",
          retryable: false,
        };
      }
      if (probe.hasVideo) return sizeBlocker(estimateCopyBytes(probe, context), "The video");
      if (audioTargetFor(probe.audio.codec).extension === "wav") {
        const estimated = estimateOutputBytes("wav", probe, context.trim);
        return sizeBlocker(estimated, "The WAV");
      }
      // A compressed file cannot get near the ceiling at any length worth having.
      return null;
    },
  };
}

/* ---- Compress ----------------------------------------------------------- */

export type AudioCodec = "opus" | "aac" | "mp3";

export interface AudioCompressPreset {
  id: string;
  label: string;
  blurb: string;
  codec: AudioCodec;
  kbps: number;
  /** Fold to one channel: speech loses nothing and the file halves. */
  mono: boolean;
}

/**
 * What people actually want when they say "make this audio smaller", in
 * order of size. Opus for speech, where it is unmatched at low rates and
 * plays in every browser and messaging app; AAC and MP3 for music, where
 * the format has to open in a car stereo as well as a phone.
 */
export const AUDIO_COMPRESS_PRESETS: readonly AudioCompressPreset[] = [
  { id: "voice-tiny", label: "Voice, smallest", blurb: "Opus at 24 kbps, mono: an hour of speech in about 11 MB", codec: "opus", kbps: 24, mono: true },
  { id: "voice", label: "Voice, clear", blurb: "Opus at 48 kbps: podcasts, lectures, interviews", codec: "opus", kbps: 48, mono: false },
  { id: "music-small", label: "Music, small", blurb: "AAC at 96 kbps in an M4A: fine on a phone", codec: "aac", kbps: 96, mono: false },
  { id: "music", label: "Music, good", blurb: "MP3 at 128 kbps: plays absolutely everywhere", codec: "mp3", kbps: 128, mono: false },
  { id: "music-high", label: "Music, transparent", blurb: "AAC at 192 kbps: hard to tell from the original", codec: "aac", kbps: 192, mono: false },
];

export interface CompressAudioSettings {
  /** A preset's id, or null when a target size is set instead. */
  presetId: string | null;
  /** The size to land under, in bytes, when no preset is chosen. */
  targetBytes: number | null;
}

export const DEFAULT_COMPRESS_AUDIO_SETTINGS: CompressAudioSettings = {
  presetId: "voice",
  targetBytes: null,
};

/** Below this even speech falls apart. */
export const MIN_AUDIO_KBPS = 12;

/** Margin under a target size for container overhead and encoder drift. */
const AUDIO_SIZE_MARGIN = 0.95;

interface AudioCodecTarget {
  args: string[];
  extension: string;
  mimeType: string;
  requiredEncoder: string;
}

/** Encoder arguments and container for a codec at a rate. */
export function audioCodecTarget(codec: AudioCodec, kbps: number, mono: boolean, channels: number | null): AudioCodecTarget {
  const layout = mono ? ["-ac", "1"] : (channels ?? 2) > 2 ? ["-ac", "2"] : [];
  if (codec === "opus") {
    return {
      args: ["-c:a", "opus", "-strict", "-2", "-b:a", `${kbps}k`, ...layout],
      extension: "opus",
      mimeType: "audio/ogg",
      requiredEncoder: "opus",
    };
  }
  if (codec === "mp3") {
    return {
      args: ["-c:a", "libmp3lame", "-b:a", `${kbps}k`, ...layout],
      extension: "mp3",
      mimeType: "audio/mpeg",
      requiredEncoder: "libmp3lame",
    };
  }
  return {
    args: ["-c:a", "aac", "-b:a", `${kbps}k`, ...layout, "-movflags", "+faststart"],
    extension: "m4a",
    mimeType: "audio/mp4",
    requiredEncoder: "aac",
  };
}

/**
 * The bitrate a byte budget affords over a length, and the codec to spend
 * it on: Opus below 64 kbps, where nothing else is listenable, AAC above.
 */
export function audioBudget(
  targetBytes: number,
  seconds: number,
): { kbps: number; codec: AudioCodec; mono: boolean } | null {
  if (!(seconds > 0) || !(targetBytes > 0)) return null;
  const kbps = Math.floor((targetBytes * 8 * AUDIO_SIZE_MARGIN) / seconds / 1000);
  if (kbps < MIN_AUDIO_KBPS) return null;
  return { kbps, codec: kbps < 64 ? "opus" : "aac", mono: kbps < 32 };
}

/** A preset by id, for the app and the format. */
export function audioPreset(id: string): AudioCompressPreset | undefined {
  return AUDIO_COMPRESS_PRESETS.find((preset) => preset.id === id);
}

function megabytesLabel(bytes: number): string {
  return String(Math.round(bytes / 100_000) / 10);
}

/**
 * The audio compressor for one setting: a preset's codec and rate, or a
 * rate worked out from a target size and the file's length.
 */
export function compressAudioFormat(settings: CompressAudioSettings): OutputFormat {
  const preset = settings.presetId ? audioPreset(settings.presetId) : undefined;
  const targetBytes = preset ? null : settings.targetBytes;
  const megabytes = targetBytes === null ? null : megabytesLabel(targetBytes);

  const id = preset ? `compress-audio-${preset.id}` : `compress-audio-${megabytes}mb`;
  const label = preset ? preset.label : `${megabytes} MB`;

  return {
    id,
    label,
    blurb: preset ? preset.blurb : `Under ${megabytes} MB: the bitrate is worked out from the length`,
    lossless: false,
    requiredEncoder: preset ? audioCodecTarget(preset.codec, preset.kbps, preset.mono, null).requiredEncoder : "aac",
    plan(probe, context) {
      const channels = probe.audio?.channels ?? null;
      const choice = preset
        ? { codec: preset.codec, kbps: preset.kbps, mono: preset.mono }
        : (audioBudget(targetBytes ?? 0, trimDuration(context?.trim ?? null, probe.durationSeconds) ?? 0) ?? {
            codec: "opus" as const,
            kbps: MIN_AUDIO_KBPS,
            mono: true,
          });
      const target = audioCodecTarget(choice.codec, choice.kbps, choice.mono, channels);
      return {
        args: [...SELECT_AUDIO, ...target.args],
        extension: target.extension,
        mimeType: target.mimeType,
        mode: "encode",
        kind: "audio",
        fileSuffix: preset ? `-${preset.id}` : `-${megabytes}mb`,
      };
    },
    offer(probe, context) {
      if (preset) return true;
      return estimateCopyBytes(probe, context) > (targetBytes ?? 0);
    },
    blocker(probe, context): FormatBlocker | null {
      if (!probe.audio) {
        return { message: "This file has no audio to compress.", hint: "There is no audio stream in it.", retryable: false };
      }
      if (preset) return null;
      const seconds = trimDuration(context.trim, probe.durationSeconds);
      if (!seconds) {
        return {
          message: "This file's length is unknown, so it cannot be sized.",
          hint: "The container does not report a duration. Choose a preset instead.",
          retryable: false,
        };
      }
      const already = estimateCopyBytes(probe, context);
      if (already <= (targetBytes ?? 0)) {
        return {
          message: `This ${context.trim ? "range" : "file"} is already under ${megabytes} MB.`,
          hint: `It is about ${megabytesLabel(already)} MB, so there is nothing to do. Pick a smaller size, or a preset, to shrink it anyway.`,
          severity: "info",
          retryable: false,
        };
      }
      if (audioBudget(targetBytes ?? 0, seconds) === null) {
        return {
          message: `${megabytes} MB is too small for audio this long.`,
          hint: `At that size the audio would get under ${MIN_AUDIO_KBPS} kbps. Choose a larger target, or trim it to a shorter range.`,
          retryable: false,
        };
      }
      return null;
    },
  };
}

/* ---- Channels ----------------------------------------------------------- */

export type ChannelOperation = "mono" | "stereo" | "left" | "right" | "swap" | "karaoke";

interface ChannelSpec {
  id: ChannelOperation;
  label: string;
  blurb: string;
  args: string[];
  /** Whether the operation means anything for a file with this many channels. */
  applies(channels: number | null): boolean;
}

/**
 * The things people do with the sides of a recording.
 *
 * `pan` names its outputs in terms of its inputs, so "left only" is a mono
 * stream fed from c0 and "swap" is a stereo stream with the sides crossed.
 * Vocal removal is the old centre-cut trick: whatever is identical in both
 * channels - usually the voice - cancels when one is subtracted from the
 * other, and whatever is panned survives. It works on some mixes and not on
 * others, and the label says so.
 */
const CHANNEL_SPECS: readonly ChannelSpec[] = [
  {
    id: "mono",
    label: "Mono",
    blurb: "Both sides mixed down to one channel",
    args: ["-ac", "1"],
    applies: (channels) => channels !== 1,
  },
  {
    id: "stereo",
    label: "Stereo from mono",
    blurb: "The one channel on both sides, for players that expect two",
    args: ["-ac", "2"],
    applies: (channels) => channels === 1,
  },
  {
    id: "left",
    label: "Left channel only",
    blurb: "The left side as a mono file",
    args: ["-af", "pan=mono|c0=c0"],
    applies: (channels) => channels !== null && channels >= 2,
  },
  {
    id: "right",
    label: "Right channel only",
    blurb: "The right side as a mono file",
    args: ["-af", "pan=mono|c0=c1"],
    applies: (channels) => channels !== null && channels >= 2,
  },
  {
    id: "swap",
    label: "Swap left and right",
    blurb: "The sides crossed over",
    args: ["-af", "pan=stereo|c0=c1|c1=c0"],
    applies: (channels) => channels === 2,
  },
  {
    id: "karaoke",
    label: "Remove vocals",
    blurb: "The centre of a stereo mix cancelled, which takes out the voice on some songs and not others",
    args: ["-af", "pan=stereo|c0=0.5*c0-0.5*c1|c1=0.5*c0-0.5*c1"],
    applies: (channels) => channels === 2,
  },
];

/** One channel operation, written back in the source's own format. */
export function channelFormat(operation: ChannelOperation): OutputFormat {
  const spec = CHANNEL_SPECS.find((entry) => entry.id === operation);
  if (!spec) throw new Error(`Unknown channel operation "${operation}".`);
  return {
    id: `channels-${spec.id}`,
    label: spec.label,
    blurb: spec.blurb,
    lossless: false,
    requiredEncoder: "aac",
    plan(probe) {
      const target = audioTargetFor(probe.audio?.codec);
      return {
        args: [...SELECT_AUDIO, ...spec.args, ...target.args],
        extension: target.extension,
        mimeType: target.mimeType,
        mode: "encode",
        kind: "audio",
        fileSuffix: `-${spec.id}`,
      };
    },
    offer(probe) {
      return spec.applies(probe.audio?.channels ?? null);
    },
    blocker(probe, context): FormatBlocker | null {
      if (!probe.audio) {
        return { message: "This file has no audio.", hint: "There is no audio stream in it.", retryable: false };
      }
      if (!spec.applies(probe.audio.channels ?? null)) {
        return {
          message: `${spec.label} does not apply to a ${probe.audio.channelLayout ?? "this"} file.`,
          hint:
            spec.id === "stereo"
              ? "The file already has more than one channel."
              : "It needs a stereo recording to work on.",
          retryable: false,
        };
      }
      if (audioTargetFor(probe.audio.codec).extension === "wav") {
        return sizeBlocker(estimateOutputBytes("wav", probe, context.trim), "The WAV");
      }
      return null;
    },
  };
}

export const CHANNEL_FORMATS: readonly OutputFormat[] = CHANNEL_SPECS.map((spec) => channelFormat(spec.id));

/* ---- Pictures of audio -------------------------------------------------- */

export interface AudioPictureSettings {
  width: number;
  height: number;
  /** Ink colour of a waveform; the background is transparent. */
  tone: "dark" | "light";
}

export const AUDIO_PICTURE_SIZES: readonly { width: number; height: number; blurb: string }[] = [
  { width: 800, height: 200, blurb: "Small, for a thumbnail or a message" },
  { width: 1200, height: 300, blurb: "The usual choice for a page" },
  { width: 1920, height: 480, blurb: "Full width on a large screen" },
  { width: 2400, height: 600, blurb: "For print or a banner" },
];

export const DEFAULT_AUDIO_PICTURE_SETTINGS: AudioPictureSettings = { width: 1200, height: 300, tone: "dark" };

const INK: Record<AudioPictureSettings["tone"], string> = { dark: "0x171717", light: "0xfafafa" };

const IMAGE_ARGS = ["-frames:v", "1", "-c:v", "png", "-f", "image2", "-update", "1"];

/**
 * A waveform: the whole file's shape as one transparent PNG.
 *
 * Mixed to mono first so the picture is one shape rather than two stacked;
 * `showwavespic` scales it to the size asked for.
 */
export function waveformFormat(settings: AudioPictureSettings): OutputFormat {
  const size = `${settings.width}x${settings.height}`;
  return {
    id: `waveform-${size}-${settings.tone}`,
    label: "Waveform",
    blurb: `${size}, ${settings.tone} on a transparent background, as a PNG`,
    lossless: false,
    requiredEncoder: "png",
    plan() {
      return {
        args: [
          "-filter_complex",
          `[0:a:0]aformat=channel_layouts=mono,showwavespic=s=${size}:colors=${INK[settings.tone]}[v]`,
          "-map",
          "[v]",
          ...IMAGE_ARGS,
        ],
        extension: "png",
        mimeType: "image/png",
        mode: "encode",
        kind: "image",
        fileSuffix: "-waveform",
      };
    },
    blocker: noAudioBlocker,
  };
}

/** A spectrogram: frequency over time, with its scale drawn along the edges. */
export function spectrogramFormat(settings: AudioPictureSettings): OutputFormat {
  const size = `${settings.width}x${settings.height}`;
  return {
    id: `spectrogram-${size}`,
    label: "Spectrogram",
    blurb: `${size} plus a legend, frequency against time, as a PNG`,
    lossless: false,
    requiredEncoder: "png",
    plan() {
      return {
        args: ["-filter_complex", `[0:a:0]showspectrumpic=s=${size}:legend=1[v]`, "-map", "[v]", ...IMAGE_ARGS],
        extension: "png",
        mimeType: "image/png",
        mode: "encode",
        kind: "image",
        fileSuffix: "-spectrogram",
      };
    },
    blocker: noAudioBlocker,
  };
}

function noAudioBlocker(probe: ProbeResult): FormatBlocker | null {
  if (probe.audio) return null;
  return { message: "This file has no audio to draw.", hint: "There is no audio stream in it.", retryable: false };
}
