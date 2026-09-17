/**
 * A subtitle file added to a video as a track of its own, without touching
 * the picture: the soft version of burning in.
 *
 * Every player that shows subtitles reads a track: the TV apps and VLC from
 * an MP4 or MKV, the browsers from a WebM. The track can be switched off,
 * which is the point, and writing it is a stream copy of everything else,
 * so it takes seconds however long the film.
 *
 * Each container has its own idea of a subtitle: MP4 and MOV hold MOV text,
 * Matroska holds SRT and ASS as they are, WebM holds WebVTT. The file the
 * visitor chose is read in the browser into cues and written for ffmpeg as
 * whichever of those the container wants.
 */
import { textFingerprint } from "./burn";
import { isBitmapSubtitle } from "./captions";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult, ScratchFile } from "./types";
import { containerArgs, containerFor, estimateCopyBytes, MKV, MOV, MP4, playbackWarning, sizeBlocker, WEBM } from "./video";
import { toSrt, type Cue } from "../subtitles";

/** A subtitle file as loaded: its cues, and its own text when it is ASS. */
export interface SubtitleTrackSource {
  name: string;
  cues: Cue[];
  /** The file's own text when it is ASS, so an MKV keeps its styling. Null otherwise. */
  ass: string | null;
}

export interface SubtitleTrackSettings {
  /** ISO 639-2 code, three letters, or "und" for none. */
  language: string;
  /** A name for the track, shown in a player's subtitle menu: "English (SDH)". */
  title: string;
  /** Mark the track as the one to show by default. */
  makeDefault: boolean;
}

export const DEFAULT_SUBTITLE_TRACK_SETTINGS: SubtitleTrackSettings = { language: "eng", title: "", makeDefault: true };

/** Languages worth a menu entry, by ISO 639-2 code. Anything else is typed. */
export const SUBTITLE_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fre", label: "French" },
  { code: "ger", label: "German" },
  { code: "ita", label: "Italian" },
  { code: "por", label: "Portuguese" },
  { code: "dut", label: "Dutch" },
  { code: "rus", label: "Russian" },
  { code: "pol", label: "Polish" },
  { code: "tur", label: "Turkish" },
  { code: "ara", label: "Arabic" },
  { code: "hin", label: "Hindi" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
  { code: "chi", label: "Chinese" },
  { code: "und", label: "Not tagged" },
];

/** True for a three-letter ISO 639-2 code, which is all a container will take. */
export function isLanguageCode(value: string): boolean {
  return /^[a-z]{3}$/.test(value);
}

/** Where the subtitle file is written for the run, by what the container wants. */
export const SUBTITLE_TRACK_DIR = "/track";

/** What the container wants the track written as. */
export function subtitleCodecFor(container: { extension: string }, source: SubtitleTrackSource): { encoder: string; scratch: ScratchFile } {
  if (container === WEBM) {
    return { encoder: "webvtt", scratch: { path: `${SUBTITLE_TRACK_DIR}/subtitles.srt`, contents: toSrt(source.cues) } };
  }
  if (container === MKV) {
    return source.ass !== null
      ? { encoder: "copy", scratch: { path: `${SUBTITLE_TRACK_DIR}/subtitles.ass`, contents: source.ass } }
      : { encoder: "copy", scratch: { path: `${SUBTITLE_TRACK_DIR}/subtitles.srt`, contents: toSrt(source.cues) } };
  }
  return { encoder: "mov_text", scratch: { path: `${SUBTITLE_TRACK_DIR}/subtitles.srt`, contents: toSrt(source.cues) } };
}

/** The container the video lands in: its own where it can carry a text track, else Matroska. */
export function subtitleTrackContainer(probe: ProbeResult, context: PlanContext | undefined) {
  const container = containerFor(probe.video?.codec ?? null, probe.audio?.codec ?? null, context?.sourceExtension);
  return container === MP4 || container === MOV || container === MKV || container === WEBM ? container : MKV;
}

/** The format for one subtitle file and one set of settings. */
export function subtitleTrackFormat(source: SubtitleTrackSource, settings: SubtitleTrackSettings): OutputFormat {
  const fingerprint = textFingerprint(source.ass ?? toSrt(source.cues));
  const language = isLanguageCode(settings.language) ? settings.language : "und";
  const title = settings.title.trim();
  return {
    id: `subtitle-track-${fingerprint}-${language}-${textFingerprint(title)}-${settings.makeDefault ? "default" : "optional"}`,
    label: `Add ${source.name}`,
    blurb: "The subtitles added as a track that can be switched on and off, with the picture and sound copied as they are",
    lossless: true,
    requiredEncoder: null,
    plan(probe, context) {
      const container = subtitleTrackContainer(probe, context);
      const { encoder, scratch } = subtitleCodecFor(container, source);
      // The file's own text tracks ride along; a bitmap track has no place in
      // a container that only takes text, and nothing here can read it.
      const keepOwn = probe.subtitleStreams.length > 0 && probe.subtitleStreams.every((stream) => !isBitmapSubtitle(stream.codec));
      const dropped = probe.subtitleStreams.length > 0 && !keepOwn;
      return {
        args: [
          "-i",
          scratch.path,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          // The new track first among the subtitles, so it is s:0 below.
          "-map",
          "1:0",
          ...(keepOwn ? ["-map", "0:s"] : []),
          "-dn",
          "-c:v",
          "copy",
          "-c:a",
          "copy",
          "-c:s",
          encoder,
          "-metadata:s:s:0",
          `language=${language}`,
          // MP4 and MOV name a track by its handler; Matroska and WebM by a title.
          ...(title ? ["-metadata:s:s:0", `${container === MP4 || container === MOV ? "handler_name" : "title"}=${title}`] : []),
          "-disposition:s:0",
          settings.makeDefault ? "default" : "0",
          ...containerArgs(container),
        ],
        scratchFiles: [scratch],
        ...container,
        mode: "copy",
        kind: "video",
        fileSuffix: `-subtitled-${language}`,
        warning:
          [
            dropped ? "The file's own subtitle tracks include an image-based one, which cannot travel with a text track, so they were left out." : null,
            playbackWarning(probe.video?.codec),
          ]
            .filter((line): line is string => line !== null)
            .join(" ") || undefined,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (!probe.video) {
        return { message: "This file has no picture to subtitle.", hint: "It is audio only.", retryable: false };
      }
      if (source.cues.length === 0) {
        return { message: `${source.name} has no cues in it.`, hint: "Nothing was read from the file, so there is nothing to add.", retryable: false };
      }
      return sizeBlocker(estimateCopyBytes(probe, context), "The file");
    },
  };
}
