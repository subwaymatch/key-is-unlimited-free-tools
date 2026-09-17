/**
 * The soundtrack of a video: another one put in its place or mixed under
 * it, and the one it has moved earlier or later to line up with the picture.
 *
 * Both copy the picture. Adding audio encodes the new track, because the
 * file it came from can be anything and the container has to be able to
 * hold what goes in; fixing sync is a pure stream copy, since nothing about
 * either stream changes but where it starts.
 */
import { formatSeconds, trimDuration } from "./trim";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult, ScratchFile } from "./types";
import {
  containerArgs,
  containerHolds,
  estimateCopyBytes,
  MKV,
  MP4,
  playbackWarning,
  preferredContainer,
  sizeBlocker,
  WEBM,
  type Container,
} from "./video";

/** Where the added audio file is written for the run. */
export const ADDED_AUDIO_DIR = "/added";

/**
 * The most an added audio file may weigh.
 *
 * Unlike the video, which is mounted and read in place, the audio file is
 * written into the core's filesystem, so it lives in the heap alongside the
 * output. An hour of MP3 is 60 MB; anything near this is a WAV that would be
 * better compressed first.
 */
export const MAX_ADDED_AUDIO_BYTES = 200_000_000;

/** Where an encoded soundtrack lands, and what it is encoded as. */
export interface SoundtrackTarget {
  container: Container;
  /** The audio encoder's arguments: AAC everywhere except a WebM, which takes Opus. */
  audioArgs: string[];
  audioKbps: number;
}

/**
 * The container a re-encoded soundtrack goes into, with the picture copied.
 *
 * The source's own when it holds the picture and AAC (a MOV stays a MOV, an
 * MKV an MKV); a WebM stays a WebM with Opus, since AAC cannot go in one;
 * otherwise an MP4 when the picture fits, and Matroska for everything else.
 */
export function soundtrackTarget(probe: ProbeResult, context: PlanContext | undefined): SoundtrackTarget {
  const video = probe.video?.codec.toLowerCase() ?? null;
  const aac = { audioArgs: ["-c:a", "aac", "-b:a", "192k"], audioKbps: 192 };
  // ffmpeg's own Opus encoder: libopus traps in the pinned core, see formats.ts.
  const opus = { audioArgs: ["-c:a", "opus", "-strict", "-2", "-b:a", "128k"], audioKbps: 128 };
  const preferred = preferredContainer(context?.sourceExtension);
  if (preferred === WEBM && containerHolds(WEBM, video, "opus")) return { container: WEBM, ...opus };
  if (preferred && containerHolds(preferred, video, "aac")) return { container: preferred, ...aac };
  if (containerHolds(MP4, video, "aac")) return { container: MP4, ...aac };
  if (containerHolds(WEBM, video, "opus")) return { container: WEBM, ...opus };
  return { container: MKV, ...aac };
}

/* ---- Add or replace the audio ------------------------------------------ */

/** An audio file the visitor chose: its bytes, and something to tell two apart. */
export interface AddedAudio {
  name: string;
  bytes: Uint8Array;
  /** Stable for one chosen file: its name, size and modification time. */
  key: string;
}

export type AddAudioMode = "replace" | "mix";
export type AddAudioLength = "fit" | "loop";

export interface AddAudioSettings {
  /** Put the new track in place of the original, or mix it under it. */
  mode: AddAudioMode;
  /**
   * "fit" pads a short track with silence and cuts a long one at the end of
   * the picture; "loop" repeats a short track until the picture ends.
   */
  length: AddAudioLength;
  /** How far under the original the new track sits when mixed, in dB; 0 is level. */
  mixLevelDb: number;
}

export const DEFAULT_ADD_AUDIO_SETTINGS: AddAudioSettings = { mode: "replace", length: "fit", mixLevelDb: -6 };

export const MIX_LEVELS: readonly { db: number; label: string; blurb: string }[] = [
  { db: 0, label: "Level", blurb: "As loud as the original" },
  { db: -6, label: "-6 dB", blurb: "Under the original, still clearly there" },
  { db: -12, label: "-12 dB", blurb: "Background music behind speech" },
  { db: -18, label: "-18 dB", blurb: "Barely there" },
];

/** A filename-safe extension for the scratch copy, so ffmpeg has a hint about the container. */
export function addedAudioPath(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  return `${ADDED_AUDIO_DIR}/audio${extension && extension !== name.toLowerCase() ? `.${extension}` : ""}`;
}

/**
 * The format for one audio file and one set of settings.
 *
 * The picture is copied. The new track is padded or looped to the picture's
 * length and encoded into whatever the container takes; when mixed, the
 * original is left at its level and the new track turned down under it.
 */
export function addAudioFormat(audio: AddedAudio, settings: AddAudioSettings): OutputFormat {
  const path = addedAudioPath(audio.name);
  const scratchFiles: ScratchFile[] = [{ path, contents: audio.bytes }];
  const mixing = settings.mode === "mix";
  const looping = settings.length === "loop";
  const level = mixing ? `-${Math.abs(settings.mixLevelDb)}db` : "";
  return {
    id: `add-audio-${audio.key}-${settings.mode}-${settings.length}${level}`,
    label: mixing ? `Mix in ${audio.name}` : `Replace with ${audio.name}`,
    blurb: mixing
      ? `The file's own sound kept, ${audio.name} mixed under it at ${settings.mixLevelDb} dB`
      : `The file's own sound dropped and ${audio.name} put in its place`,
    lossless: false,
    requiredEncoder: "aac",
    plan(probe, context) {
      const target = soundtrackTarget(probe, context);
      // Mixing needs something to mix with; a silent video gets the track outright.
      const mix = mixing && probe.audio !== null;
      const graph =
        `[1:a:0]volume=${settings.mixLevelDb}dB${looping ? "" : ",apad"}[added];` +
        "[0:a:0][added]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]";
      return {
        args: [
          ...(looping ? ["-stream_loop", "-1"] : []),
          "-i",
          path,
          ...(mix
            ? ["-filter_complex", graph, "-map", "0:v:0", "-map", "[a]"]
            : ["-map", "0:v:0", "-map", "1:a:0", ...(looping ? [] : ["-af", "apad"])]),
          "-sn",
          "-dn",
          "-c:v",
          "copy",
          ...target.audioArgs,
          // The picture decides the length: the added track is padded or
          // looped past it and cut here, and a longer one is cut here too.
          ...(mix ? [] : ["-shortest"]),
          ...containerArgs(target.container),
        ],
        scratchFiles,
        ...target.container,
        mode: "encode",
        kind: "video",
        fileSuffix: mix ? "-mixed" : "-new-audio",
        warning:
          [
            mixing && !mix ? "The video has no sound of its own to mix with, so the new track was used on its own." : null,
            playbackWarning(probe.video?.codec),
          ]
            .filter((line): line is string => line !== null)
            .join(" ") || undefined,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (!probe.video) {
        return { message: "This file has no picture.", hint: "Adding audio to an audio file would only replace it.", retryable: false };
      }
      if (audio.bytes.length > MAX_ADDED_AUDIO_BYTES) {
        return {
          message: `${audio.name} is too large to add.`,
          hint: `The audio file is held in memory while the video is written, so it is capped at ${Math.round(MAX_ADDED_AUDIO_BYTES / 1_000_000)} MB. Compress it first, or convert it to M4A or MP3.`,
          retryable: false,
        };
      }
      const seconds = trimDuration(context.trim, probe.durationSeconds) ?? 0;
      const target = soundtrackTarget(probe, context);
      const estimated = estimateCopyBytes(probe, context) + Math.round((target.audioKbps * 1000 * seconds) / 8);
      return sizeBlocker(estimated, "The video");
    },
  };
}

/* ---- Audio sync --------------------------------------------------------- */

/** Offsets worth a button, in milliseconds; positive moves the sound later. */
export const SYNC_PRESETS_MS: readonly number[] = [-500, -250, -100, 100, 250, 500];

/** The furthest either way the custom field takes, in milliseconds. */
export const MAX_SYNC_MS = 30_000;

/** Reads a typed offset in milliseconds. Null for zero, or anything out of range. */
export function parseSyncMs(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded === 0 || Math.abs(rounded) > MAX_SYNC_MS) return null;
  return rounded;
}

/** 250 -> "250 ms later", -1500 -> "1.5 s earlier". */
export function describeSync(offsetMs: number): string {
  const magnitude = Math.abs(offsetMs);
  const amount = magnitude >= 1000 ? `${Number((magnitude / 1000).toFixed(3))} s` : `${magnitude} ms`;
  return `${amount} ${offsetMs > 0 ? "later" : "earlier"}`;
}

/**
 * The sync fix for one offset: every stream copied, the sound moved.
 *
 * The file is read twice, once for the picture and once for the sound, and
 * `-itsoffset` delays whichever of the two has to start later. Sound that
 * has to come earlier is the picture starting later, which is the same
 * thing seen from the other side and keeps every timestamp positive.
 */
export function syncFormat(offsetMs: number): OutputFormat {
  const later = offsetMs > 0;
  const seconds = formatSeconds(Math.abs(offsetMs) / 1000);
  const description = describeSync(offsetMs);
  return {
    id: `sync-${later ? "later" : "earlier"}-${Math.abs(offsetMs)}ms`,
    label: description,
    blurb: later
      ? "The sound delayed, so it starts after the picture it used to run ahead of"
      : "The sound brought forward, so it stops lagging the picture",
    lossless: true,
    requiredEncoder: null,
    plan(probe, context) {
      const container = soundtrackTarget(probe, context).container;
      const input = context?.inputPath ?? "";
      const copied = containerHolds(container, probe.video?.codec.toLowerCase() ?? null, probe.audio?.codec.toLowerCase() ?? null);
      return {
        inputArgs: later ? [] : ["-itsoffset", seconds],
        args: [
          ...(later ? ["-itsoffset", seconds] : []),
          "-i",
          input,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-sn",
          "-dn",
          "-c:v",
          "copy",
          ...(copied ? ["-c:a", "copy"] : soundtrackTarget(probe, context).audioArgs),
          ...containerArgs(container),
        ],
        ...container,
        mode: copied ? "copy" : "encode",
        kind: "video",
        fileSuffix: `-audio-${later ? "later" : "earlier"}-${Math.abs(offsetMs)}ms`,
        warning: playbackWarning(probe.video?.codec),
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (!probe.video) {
        return { message: "This file has no picture to sync the sound to.", hint: "It is audio only.", retryable: false };
      }
      if (!probe.audio) {
        return { message: "This file has no sound to move.", hint: "There is no audio stream in it.", retryable: false };
      }
      return sizeBlocker(estimateCopyBytes(probe, context), "The file");
    },
  };
}
