/**
 * The audio tools beyond extraction: loudness normalisation.
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
