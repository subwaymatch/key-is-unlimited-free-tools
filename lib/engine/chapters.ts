/**
 * Chapter markers, from a list someone typed.
 *
 * The list is the one every podcast host and video description already
 * uses: a time and a title per line, "1:23 Part one". It becomes an
 * ffmetadata file written into the core for the run, and ffmpeg copies every
 * stream untouched while taking its chapters from that second input. MP4,
 * MOV, M4A, MKV, WebM, MP3 and Ogg all carry chapters; WAV and FLAC do not,
 * and are refused with the way out.
 */
import { textFingerprint } from "./burn";
import { parseTimecode } from "./trim";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult } from "./types";
import { containerArgs, containerFor, estimateCopyBytes, playbackWarning, sizeBlocker } from "./video";

export interface ChapterEntry {
  startSeconds: number;
  title: string;
}

export interface ParsedChapterList {
  chapters: ChapterEntry[];
  /** Lines skipped, and why, worth a line in the panel. */
  warnings: string[];
}

/** Where the chapter file is written for the run. */
export const CHAPTERS_PATH = "/chapters.ffmeta";

/** Containers whose muxers write chapters. */
const CHAPTER_CONTAINERS: ReadonlySet<string> = new Set([
  "mp4",
  "m4v",
  "m4a",
  "mov",
  "mkv",
  "mka",
  "webm",
  "mp3",
  "ogg",
  "opus",
]);

/**
 * Reads a chapter list: one chapter per line, a time and then a title.
 *
 * Takes what people paste: "0:00 Intro", "00:01:30 - Part one",
 * "[1:02:03] Finale", "90 Something" (seconds). A line that does not start
 * with a time is skipped and said so; a chapter without a title is given
 * its number; chapters come out sorted, with a repeated time dropped.
 */
export function parseChapterList(text: string): ParsedChapterList {
  const chapters: ChapterEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const match = line.match(/^\[?\s*([0-9:.]+)\s*\]?\s*(?:[-:|.)]\s*)?(.*)$/);
    const seconds = match ? parseTimecode(match[1]) : null;
    if (!match || seconds === null) {
      warnings.push(`Line ${index + 1} does not start with a time and was skipped: "${line.slice(0, 40)}"`);
      return;
    }
    const start = Math.round(seconds * 1000) / 1000;
    if (seen.has(start)) {
      warnings.push(`Line ${index + 1} repeats the time ${match[1]} and was skipped.`);
      return;
    }
    seen.add(start);
    chapters.push({ startSeconds: start, title: match[2].trim() });
  });

  chapters.sort((a, b) => a.startSeconds - b.startSeconds);
  return {
    chapters: chapters.map((chapter, index) => ({
      ...chapter,
      title: chapter.title || `Chapter ${index + 1}`,
    })),
    warnings,
  };
}

/** ffmetadata escapes the four characters that mean something to it. */
function escapeMetadata(value: string): string {
  return value.replace(/([=;#\\])/g, "\\$1").replace(/\n/g, "\\\n");
}

/**
 * The ffmetadata file for a list: each chapter runs to the next one's start,
 * the last to the end of the file. Chapters at or past the end are left out,
 * since a chapter with no length is not one.
 */
export function chaptersMetadata(chapters: readonly ChapterEntry[], durationSeconds: number): string {
  const within = chapters.filter((chapter) => chapter.startSeconds < durationSeconds);
  const blocks = within.map((chapter, index) => {
    const end = index + 1 < within.length ? within[index + 1].startSeconds : durationSeconds;
    return [
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${Math.round(chapter.startSeconds * 1000)}`,
      `END=${Math.round(end * 1000)}`,
      `title=${escapeMetadata(chapter.title)}`,
    ].join("\n");
  });
  return `;FFMETADATA1\n${blocks.join("\n\n")}\n`;
}

/** The container the output lands in: the source's, or the codec's own for audio. */
function chapterContainer(probe: ProbeResult, context: PlanContext | undefined) {
  return containerFor(probe.video?.codec ?? null, probe.audio?.codec ?? null, context?.sourceExtension);
}

/** The streams copied through: the picture, the sound and the subtitles, never the data tracks. */
function copyMaps(probe: ProbeResult): string[] {
  return probe.hasVideo && probe.video
    ? ["-map", "0:v:0", "-map", "0:a?", "-map", "0:s?", "-dn"]
    : ["-map", "0:a:0", "-vn", "-sn", "-dn"];
}

/**
 * The format for one chapter list. Everything is copied; only the chapters
 * change, and the source's own tags are kept or dropped by the switch, which
 * this plan reads itself since the engine's stripping would undo its chapters.
 */
export function chaptersFormat(text: string): OutputFormat {
  const parsed = parseChapterList(text);
  return {
    id: `chapters-${textFingerprint(text)}`,
    label: `${parsed.chapters.length} ${parsed.chapters.length === 1 ? "chapter" : "chapters"}`,
    blurb: "Every stream copied as it is, with the chapter markers written into the container",
    lossless: true,
    requiredEncoder: null,
    plan(probe, context) {
      const container = chapterContainer(probe, context);
      const duration = probe.durationSeconds ?? Number.MAX_SAFE_INTEGER;
      const strip = context?.stripMetadata ?? false;
      const dropped = parsed.chapters.filter((chapter) => chapter.startSeconds >= duration).length;
      return {
        args: [
          "-i",
          CHAPTERS_PATH,
          ...copyMaps(probe),
          // Global only: without the ":g", -1 takes the chapter titles with it.
          "-map_metadata:g",
          strip ? "-1" : "0",
          "-map_chapters",
          "1",
          "-c",
          "copy",
          ...(strip ? ["-fflags", "+bitexact"] : []),
          ...containerArgs(container),
        ],
        scratchFiles: [{ path: CHAPTERS_PATH, contents: chaptersMetadata(parsed.chapters, duration) }],
        ...container,
        mode: "copy",
        kind: probe.hasVideo && probe.video ? "video" : "audio",
        fileSuffix: "-chapters",
        stripsMetadata: true,
        warning:
          [
            dropped > 0
              ? `${dropped} ${dropped === 1 ? "chapter starts" : "chapters start"} at or after the end of the file and ${dropped === 1 ? "was" : "were"} left out.`
              : null,
            probe.hasVideo ? playbackWarning(probe.video?.codec) : null,
          ]
            .filter((line): line is string => line !== null)
            .join(" ") || undefined,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (parsed.chapters.length === 0) {
        return {
          message: "There are no chapters to add.",
          hint: "Type one per line in the panel above, a time and then a title: 1:23 Part one.",
          retryable: false,
        };
      }
      if (probe.durationSeconds === null) {
        return {
          message: "This file's length is unknown, so the last chapter has no end.",
          hint: "The container does not report a duration. Converting it to MP4 or M4A first gives it one.",
          retryable: false,
        };
      }
      const container = chapterContainer(probe, context);
      if (!CHAPTER_CONTAINERS.has(container.extension)) {
        return {
          message: `A ${container.extension.toUpperCase()} file cannot carry chapters.`,
          hint: "WAV and FLAC have nowhere to put them. Convert the audio to M4A or MP3 first, then add the chapters to that.",
          retryable: false,
        };
      }
      if (parsed.chapters.every((chapter) => chapter.startSeconds >= probe.durationSeconds!)) {
        return {
          message: "Every chapter starts after the end of the file.",
          hint: `The file is ${Math.round(probe.durationSeconds)} seconds long.`,
          retryable: false,
        };
      }
      return sizeBlocker(estimateCopyBytes(probe, context), "The file");
    },
  };
}
