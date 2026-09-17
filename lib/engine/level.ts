/**
 * The level of the sound: turned up or down by a number of decibels, brought
 * to its loudest without clipping, or faded in and out.
 *
 * All of it is one audio filter and a re-encode of the sound. An audio file
 * comes back in its own format; a video keeps its picture copied and gets
 * its soundtrack re-encoded, the way the loudness normaliser does. Fading a
 * video's picture as well is the one job here that re-encodes the picture.
 */
import { audioTargetFor } from "./audio";
import { estimateOutputBytes, SELECT_AUDIO } from "./formats";
import { isPeakLine, parsePeak, peakGainDb, PEAK_TARGET_DB } from "./peak";
import { soundtrackTarget } from "./soundtrack";
import { formatSeconds, trimDuration } from "./trim";
import type { FormatBlocker, FormatPlan, OutputFormat, PlanContext, ProbeResult } from "./types";
import { containerArgs, estimateCopyBytes, estimateEncodedBytes, H264_ENCODE, playbackWarning, sizeBlocker } from "./video";

/* ---- Volume ------------------------------------------------------------- */

/** A change in level: a number of decibels, or up to the loudest the file can go. */
export type VolumeChoice = { kind: "db"; db: number } | { kind: "peak" };

/** Changes worth a button. 6 dB is double the amplitude; 10 dB sounds about twice as loud. */
export const VOLUME_PRESETS: readonly { db: number; blurb: string }[] = [
  { db: 3, blurb: "A little louder" },
  { db: 6, blurb: "Noticeably louder: double the amplitude" },
  { db: 12, blurb: "Much louder, for a recording that was far too quiet" },
  { db: -3, blurb: "A little quieter" },
  { db: -6, blurb: "Noticeably quieter: half the amplitude" },
  { db: -12, blurb: "Much quieter" },
];

export const MIN_VOLUME_DB = -40;
export const MAX_VOLUME_DB = 40;

/** Reads a typed change in decibels. Null for zero, or anything outside the range the tool takes. */
export function parseVolumeDb(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0 || rounded < MIN_VOLUME_DB || rounded > MAX_VOLUME_DB) return null;
  return rounded;
}

/** 6 -> "+6 dB", -3.5 -> "-3.5 dB". */
export function formatDb(db: number): string {
  return `${db > 0 ? "+" : ""}${Number(db.toFixed(1))} dB`;
}

/** Re-exported so the volume tool and its tests keep one import. */
export { isPeakLine, parsePeak, peakGainDb, PEAK_TARGET_DB };

/** The output options for a re-encoded soundtrack: the file's own format, or the picture copied and AAC. */
function levelArgs(probe: ProbeResult, context: PlanContext | undefined, filter: string): Omit<FormatPlan, "mode"> {
  if (probe.hasVideo && probe.video) {
    const target = soundtrackTarget(probe, context);
    return {
      args: ["-map", "0:v:0", "-map", "0:a:0", "-sn", "-dn", "-c:v", "copy", "-af", filter, ...target.audioArgs, ...containerArgs(target.container)],
      ...target.container,
      kind: "video",
      warning: playbackWarning(probe.video.codec),
    };
  }
  const target = audioTargetFor(probe.audio?.codec);
  return {
    args: [...SELECT_AUDIO, "-af", filter, ...target.args],
    extension: target.extension,
    mimeType: target.mimeType,
    kind: "audio",
  };
}

/** The guard every level change shares: sound to work on, and a size it can be written at. */
function levelBlocker(probe: ProbeResult, context: PlanContext, what: string): FormatBlocker | null {
  if (!probe.audio) {
    return { message: `This file has no sound to ${what}.`, hint: "There is no audio stream in it.", retryable: false };
  }
  if (probe.hasVideo) return sizeBlocker(estimateCopyBytes(probe, context), "The video");
  if (audioTargetFor(probe.audio.codec).extension === "wav") {
    return sizeBlocker(estimateOutputBytes("wav", probe, context.trim), "The WAV");
  }
  return null;
}

/**
 * The volume change for one choice.
 *
 * A number of decibels is one filter. "As loud as possible" measures the
 * loudest sample first, in a pass of its own, and the second pass lifts the
 * whole file so that sample lands just under full scale: the most gain the
 * file can take without clipping anywhere.
 */
export function volumeFormat(choice: VolumeChoice): OutputFormat {
  const peak = choice.kind === "peak";
  const label = peak ? "As loud as possible" : formatDb(choice.db);
  return {
    id: peak ? "volume-peak" : `volume-${choice.db > 0 ? "up" : "down"}-${Math.abs(choice.db)}db`,
    label,
    blurb: peak
      ? `Measured first, then lifted so the loudest moment sits at ${PEAK_TARGET_DB} dB: the most gain without clipping`
      : choice.db > 0
        ? `${label}. Sound already near full scale will clip; use "as loud as possible" for the safe maximum`
        : `${label} quieter throughout`,
    lossless: false,
    requiredEncoder: "aac",
    plan(probe, context) {
      const filterFor = (db: number) => `volume=${db}dB`;
      if (!peak) return { ...levelArgs(probe, context, filterFor(choice.db)), mode: "encode", fileSuffix: `-${choice.db > 0 ? "plus" : "minus"}${Math.abs(choice.db)}db` };
      return {
        analysisPasses: [[...SELECT_AUDIO, "-af", "volumedetect"]],
        ...levelArgs(probe, context, filterFor(0)),
        refine: {
          keep: isPeakLine,
          args: (lines) => levelArgs(probe, context, filterFor(peakGainDb(parsePeak(lines)))).args,
        },
        mode: "encode",
        fileSuffix: "-loud",
      };
    },
    blocker(probe, context) {
      return levelBlocker(probe, context, "change");
    },
  };
}

/* ---- Fade --------------------------------------------------------------- */

export interface FadeSettings {
  /** Seconds of fade at the start; 0 for none. */
  inSeconds: number;
  /** Seconds of fade at the end; 0 for none. */
  outSeconds: number;
  /** Fade a video's picture to and from black as well as its sound. */
  picture: boolean;
}

export const FADE_SECONDS_OPTIONS: readonly number[] = [0, 0.5, 1, 2, 3, 5, 10];

export const DEFAULT_FADE_SETTINGS: FadeSettings = { inSeconds: 1, outSeconds: 2, picture: true };

/** "1 s in, 2 s out", "3 s out", or "none". */
export function describeFade(settings: FadeSettings): string {
  const parts: string[] = [];
  if (settings.inSeconds > 0) parts.push(`${settings.inSeconds} s in`);
  if (settings.outSeconds > 0) parts.push(`${settings.outSeconds} s out`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

/**
 * The fade filters for a clip of a known length: one at the start, one that
 * ends where the clip ends. The output timeline starts at zero whatever the
 * range, since the seek is before the input.
 */
export function fadeFilters(settings: FadeSettings, seconds: number): { audio: string; video: string } {
  const outStart = formatSeconds(Math.max(0, seconds - settings.outSeconds));
  const audio = [
    settings.inSeconds > 0 ? `afade=t=in:st=0:d=${settings.inSeconds}` : null,
    settings.outSeconds > 0 ? `afade=t=out:st=${outStart}:d=${settings.outSeconds}` : null,
  ].filter((part): part is string => part !== null);
  const video = [
    settings.inSeconds > 0 ? `fade=t=in:st=0:d=${settings.inSeconds}` : null,
    settings.outSeconds > 0 ? `fade=t=out:st=${outStart}:d=${settings.outSeconds}` : null,
  ].filter((part): part is string => part !== null);
  return { audio: audio.join(","), video: video.join(",") };
}

/**
 * The fade for one setting.
 *
 * Sound alone is a filter and a re-encode of the sound, in the file's own
 * format. Fading the picture too is a full encode of the picture, which is
 * the only way to change what the frames show.
 */
export function fadeFormat(settings: FadeSettings): OutputFormat {
  const description = describeFade(settings);
  return {
    id: `fade-in${settings.inSeconds}-out${settings.outSeconds}${settings.picture ? "-picture" : ""}`,
    label: `Fade ${description}`,
    blurb: settings.picture
      ? "The sound faded, and a video's picture faded to and from black with it"
      : "The sound faded; a video's picture copied as it is",
    lossless: false,
    requiredEncoder: settings.picture ? "libx264" : "aac",
    plan(probe, context) {
      const seconds = trimDuration(context?.trim ?? null, probe.durationSeconds) ?? 0;
      const filters = fadeFilters(settings, seconds);
      const suffix = "-faded";
      if (probe.hasVideo && probe.video && settings.picture) {
        const target = soundtrackTarget(probe, context);
        return {
          args: [
            "-map",
            "0:v:0",
            ...(probe.audio ? ["-map", "0:a:0"] : []),
            "-sn",
            "-dn",
            "-vf",
            filters.video,
            ...H264_ENCODE,
            "-crf",
            "20",
            ...(probe.audio ? ["-af", filters.audio, ...target.audioArgs] : []),
            ...containerArgs(target.container),
          ],
          ...target.container,
          mode: "encode",
          kind: "video",
          fileSuffix: suffix,
        };
      }
      return { ...levelArgs(probe, context, filters.audio), mode: "encode", fileSuffix: suffix };
    },
    blocker(probe, context): FormatBlocker | null {
      if (settings.inSeconds === 0 && settings.outSeconds === 0) {
        return { message: "No fade is set.", hint: "Choose a fade in, a fade out or both in the panel above.", severity: "info", retryable: false };
      }
      const seconds = trimDuration(context.trim, probe.durationSeconds);
      if (settings.outSeconds > 0 && seconds === null) {
        return {
          message: "This file's length is unknown, so the fade out has nowhere to start.",
          hint: "The container does not report a duration. Set an end marker, or fade in only.",
          retryable: false,
        };
      }
      if (seconds !== null && seconds > 0 && settings.inSeconds + settings.outSeconds > seconds) {
        return {
          message: `The fades are longer than the ${context.trim ? "range" : "file"}.`,
          hint: `It is ${Number(seconds.toFixed(1))} seconds long and the fades add up to ${settings.inSeconds + settings.outSeconds}. Choose shorter ones.`,
          retryable: false,
        };
      }
      if (probe.hasVideo && probe.video && settings.picture) {
        return sizeBlocker(estimateEncodedBytes(probe, context, probe.audio ? 192 : 0), "The faded video");
      }
      return levelBlocker(probe, context, "fade");
    },
  };
}
