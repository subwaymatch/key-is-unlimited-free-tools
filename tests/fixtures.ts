/**
 * Probe results for the unit tests of the newer engine modules, so each
 * file does not restate the same eleven fields.
 */
import type { AudioStreamInfo, PlanContext, ProbeResult, VideoStreamInfo } from "@/lib/engine/types";

export const H264: VideoStreamInfo = {
  codec: "h264",
  profile: "High",
  pixelFormat: "yuv420p",
  width: 1920,
  height: 1080,
  fps: 30,
  bitrateKbps: 4500,
  rotationDegrees: null,
};

export const AAC: AudioStreamInfo = {
  codec: "aac",
  profile: "LC",
  sampleRate: 48_000,
  channels: 2,
  channelLayout: "stereo",
  bitrateKbps: 160,
  language: null,
  title: null,
};

export const MP3: AudioStreamInfo = { ...AAC, codec: "mp3", profile: null, sampleRate: 44_100, bitrateKbps: 192 };

export interface ProbeOptions {
  video?: VideoStreamInfo | null;
  audio?: AudioStreamInfo | null;
  durationSeconds?: number | null;
  formatName?: string;
  subtitleStreams?: ProbeResult["subtitleStreams"];
  chapters?: ProbeResult["chapters"];
}

/** A video with AAC by default; pass `video: null` for an audio file. */
export function probe(options: ProbeOptions = {}): ProbeResult {
  const video = options.video === undefined ? H264 : options.video;
  const audio = options.audio === undefined ? AAC : options.audio;
  return {
    durationSeconds: options.durationSeconds === undefined ? 600 : options.durationSeconds,
    bitrateKbps: 4660,
    audioStreams: audio ? [audio] : [],
    audio,
    videoStreams: video ? [video] : [],
    video,
    hasVideo: video !== null,
    subtitleStreams: options.subtitleStreams ?? [],
    chapters: options.chapters ?? [],
    formatName: options.formatName ?? (video ? "mov,mp4,m4a,3gp,3g2,mj2" : "mp3"),
    log: [],
  };
}

export function context(overrides: Partial<PlanContext> = {}): PlanContext {
  return { trim: null, fileBytes: 300_000_000, sourceExtension: "mp4", inputPath: "/input/clip.mp4", ...overrides };
}

export const joined = (args: readonly string[]) => args.join(" ");
