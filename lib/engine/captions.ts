/**
 * Pulling subtitle tracks out of a video.
 *
 * An MKV from a disc rip or a download routinely carries several subtitle
 * tracks; an MP4 from a phone or an editor sometimes carries one. Text tracks
 * - SubRip, ASS, MOV text, WebVTT - come out as an SRT or a WebVTT file by a
 * stream copy through the subtitle encoder, in seconds. Image tracks - the
 * PGS of a Blu-ray, the bitmaps of a DVD - are pictures of words, and turning
 * those into text is OCR, which this does not do; they are refused with a
 * reason rather than written as an empty file.
 */
import type { FormatBlocker, OutputFormat, ProbeResult, SubtitleStreamInfo } from "./types";

/** Subtitle codecs that are bitmaps rather than text. */
export const BITMAP_SUBTITLE_CODECS: ReadonlySet<string> = new Set([
  "hdmv_pgs_subtitle",
  "pgssub",
  "dvd_subtitle",
  "dvdsub",
  "dvb_subtitle",
  "dvbsub",
  "xsub",
  "dvb_teletext",
]);

export function isBitmapSubtitle(codec: string): boolean {
  return BITMAP_SUBTITLE_CODECS.has(codec.toLowerCase());
}

/** The most tracks a card offers. Files with more are rare and keep their first eight. */
export const MAX_SUBTITLE_TRACKS = 8;

export type CaptionTarget = "srt" | "vtt";

const TARGETS: Record<CaptionTarget, { encoder: string; muxer: string; mimeType: string }> = {
  srt: { encoder: "srt", muxer: "srt", mimeType: "application/x-subrip" },
  vtt: { encoder: "webvtt", muxer: "webvtt", mimeType: "text/vtt" },
};

/** "eng", "English (SDH)" or "track 2": whatever names the track best. */
export function describeTrack(stream: SubtitleStreamInfo | undefined, index: number): string {
  if (!stream) return `track ${index + 1}`;
  if (stream.title && stream.language) return `${stream.title} (${stream.language})`;
  return stream.title ?? stream.language ?? `track ${index + 1}`;
}

/** Something filename-safe for the track: its language, else its number. */
function trackSuffix(stream: SubtitleStreamInfo | undefined, index: number): string {
  const language = stream?.language?.replace(/[^A-Za-z0-9]/g, "");
  return language ? `-${language.toLowerCase()}` : `-track${index + 1}`;
}

/** One track as one text format. */
export function captionFormat(track: number, target: CaptionTarget): OutputFormat {
  const spec = TARGETS[target];
  return {
    id: `subtitles-${track + 1}-${target}`,
    label: `Track ${track + 1} as ${target.toUpperCase()}`,
    blurb:
      target === "srt"
        ? "SubRip: the file every player and editor reads"
        : "WebVTT: for HTML video and the web",
    lossless: false,
    requiredEncoder: spec.encoder,
    plan(probe: ProbeResult) {
      const stream = probe.subtitleStreams[track];
      return {
        args: [
          "-map",
          `0:s:${track}`,
          "-vn",
          "-an",
          "-dn",
          "-c:s",
          spec.encoder,
          "-f",
          spec.muxer,
        ],
        extension: target,
        mimeType: spec.mimeType,
        mode: "encode",
        kind: "text",
        fileSuffix: trackSuffix(stream, track),
      };
    },
    offer(probe: ProbeResult) {
      return probe.subtitleStreams.length > track;
    },
    blocker(probe: ProbeResult): FormatBlocker | null {
      const stream = probe.subtitleStreams[track];
      if (!stream) {
        return {
          message: `This file has no subtitle track ${track + 1}.`,
          hint:
            probe.subtitleStreams.length === 0
              ? "It carries no subtitle tracks at all."
              : `It has ${probe.subtitleStreams.length}.`,
          retryable: false,
        };
      }
      if (isBitmapSubtitle(stream.codec)) {
        return {
          message: `Track ${track + 1} is image-based (${stream.codec}), so it cannot be turned into text.`,
          hint: "Blu-ray and DVD subtitles are pictures of the words rather than the words themselves. Reading them back needs OCR, which is a different tool.",
          retryable: false,
        };
      }
      return null;
    },
  };
}

/** Every track as SRT and as WebVTT; `offer` hides the tracks a file lacks. */
export const CAPTION_FORMATS: readonly OutputFormat[] = Array.from(
  { length: MAX_SUBTITLE_TRACKS },
  (_, track) => [captionFormat(track, "srt"), captionFormat(track, "vtt")],
).flat();

export const DEFAULT_CAPTION_FORMAT_IDS = ["subtitles-1-srt"];
