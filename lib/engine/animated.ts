/**
 * An animated GIF as a video.
 *
 * A GIF is a video stream to ffmpeg, so this is an encode like any other,
 * with three things a GIF needs that a camera clip does not: even
 * dimensions, since 4:2:0 cannot code an odd edge; a steady frame rate,
 * since a GIF's frames each carry their own delay and some players stall on
 * a stream at 8 fps; and, when asked, the animation played more than once,
 * since the file says "loop" and the video has to say it in frames.
 */
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult } from "./types";
import { estimateEncodedBytes, H264_ENCODE, MP4, MP4_FASTSTART, sizeBlocker, vp8Encode, vp8TargetKbps, WEBM } from "./video";
import { trimDuration } from "./trim";

export type GifVideoTarget = "mp4" | "webm";

export interface GifVideoSettings {
  target: GifVideoTarget;
  /** How many times the animation plays through, from 1. */
  plays: number;
}

export const GIF_PLAYS_OPTIONS: readonly number[] = [1, 2, 3, 5, 10];

export const DEFAULT_GIF_VIDEO_SETTINGS: GifVideoSettings = { target: "mp4", plays: 1 };

/** Below this the source's own rate is kept; a slower GIF is brought up to a steady 30. */
const MIN_STEADY_FPS = 24;
const STEADY_FPS = 30;

/** Shorter than this and the GIF is a still picture, not an animation. */
const MIN_ANIMATION_SECONDS = 0.1;

/** The frame rate the video is written at: the GIF's own when it is a real one, else 30. */
export function gifOutputFps(fps: number | null): number {
  return fps && fps >= MIN_STEADY_FPS ? Number(fps.toFixed(3)) : STEADY_FPS;
}

/** Even dimensions, a steady rate, and 4:2:0. */
export function gifVideoFilter(fps: number | null): string {
  return `fps=${gifOutputFps(fps)},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p`;
}

function playsSuffix(plays: number): string {
  return plays > 1 ? `-x${plays}` : "";
}

/** The GIF as a video, for one target and play count. */
export function gifVideoFormat(settings: GifVideoSettings): OutputFormat {
  const webm = settings.target === "webm";
  const container = webm ? WEBM : MP4;
  return {
    id: `gif-${settings.target}-x${settings.plays}`,
    label: webm ? "WebM (VP8)" : "MP4 (H.264)",
    blurb: `${webm ? "The open web format" : "Plays anywhere: chat apps, social feeds, every browser"}${
      settings.plays > 1 ? `, the animation played ${settings.plays} times` : ""
    }`,
    lossless: false,
    requiredEncoder: webm ? "libvpx" : "libx264",
    plan(probe: ProbeResult) {
      return {
        inputArgs: settings.plays > 1 ? ["-stream_loop", String(settings.plays - 1)] : [],
        args: [
          "-map",
          "0:v:0",
          "-an",
          "-sn",
          "-dn",
          "-vf",
          gifVideoFilter(probe.video?.fps ?? null),
          ...(webm ? vp8Encode(probe.video) : [...H264_ENCODE, "-crf", "20", ...MP4_FASTSTART]),
        ],
        ...container,
        mode: "encode",
        kind: "video",
        fileSuffix: playsSuffix(settings.plays),
        durationFactor: settings.plays,
      };
    },
    blocker(probe, context: PlanContext): FormatBlocker | null {
      if (!probe.video) {
        return { message: "This file has no picture.", hint: "There is no video stream in it.", retryable: false };
      }
      if (probe.durationSeconds !== null && probe.durationSeconds < MIN_ANIMATION_SECONDS) {
        return {
          message: "This GIF is a single frame.",
          hint: "It has nothing to animate, so a video of it would be a still. Save it as a PNG instead.",
          retryable: false,
        };
      }
      const seconds = trimDuration(context.trim, probe.durationSeconds);
      const once = webm
        ? seconds === null
          ? null
          : Math.round((vp8TargetKbps(probe.video) * 1000 * seconds) / 8)
        : estimateEncodedBytes(probe, context, 0);
      return sizeBlocker(once === null ? null : once * settings.plays, "The video");
    },
  };
}
