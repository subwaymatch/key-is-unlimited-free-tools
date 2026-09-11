/**
 * Splitting a file at its chapters.
 *
 * One format per chapter, offered for as many chapters as the file has, and
 * every one a stream copy of that chapter's range: nothing is decoded, so a
 * three-hour audiobook comes apart in the time it takes to read it. A video
 * piece starts on the keyframe before its chapter, as a fast cut does; sound
 * is cut to the frame.
 */
import { chapterContainer, copyMaps } from "./chapters";
import { formatSeconds } from "./trim";
import type { ChapterInfo, FormatBlocker, OutputFormat, PlanContext, ProbeResult } from "./types";
import { containerArgs, estimateCopyBytes, playbackWarning, sizeBlocker } from "./video";

/** How many chapters a file can be split into; a chip per chapter has to stay readable. */
export const MAX_CHAPTERS = 64;

/** The chapter's title, or its number when it has none. */
export function chapterTitle(chapter: ChapterInfo | undefined, index: number): string {
  const title = chapter?.title?.trim();
  return title ? title : `Chapter ${index + 1}`;
}

/** The label a chapter's row and chip carry: its number, and its title when it has one. */
export function describeChapter(chapter: ChapterInfo | undefined, index: number): string {
  const title = chapter?.title?.trim();
  return title ? `Chapter ${index + 1}: ${title}` : `Chapter ${index + 1}`;
}

/**
 * Something filename-safe from a title: lower case, a dash for everything
 * else, cut at a word to fit. Empty for a title with no ASCII letters or
 * digits in it, which is then just its number.
 */
export function slugify(text: string, maxLength = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  const atWord = cut.lastIndexOf("-");
  return atWord > 0 ? cut.slice(0, atWord) : cut;
}

/** "-03-the-first-part": the pieces sort in order and say what they are. */
function chapterSuffix(chapter: ChapterInfo | undefined, index: number): string {
  const number = String(index + 1).padStart(2, "0");
  const slug = chapter?.title ? slugify(chapter.title) : "";
  return slug ? `-${number}-${slug}` : `-${number}`;
}

/**
 * Where the chapter ends: its own end, or the file's when the chapter has
 * none. Null for a chapter with no length, or one past the end of the file.
 */
function chapterEnd(chapter: ChapterInfo, probe: ProbeResult): number | null {
  const total = probe.durationSeconds;
  if (total !== null && chapter.startSeconds >= total) return null;
  if (chapter.endSeconds > chapter.startSeconds) return chapter.endSeconds;
  if (chapter.endSeconds <= 0 && total !== null) return total;
  return null;
}

/** One chapter as one format. */
export function chapterFormat(index: number): OutputFormat {
  return {
    id: `chapter-${index + 1}`,
    label: `Chapter ${index + 1}`,
    blurb: "This chapter as its own file, every stream copied",
    lossless: true,
    requiredEncoder: null,
    describe(probe) {
      return describeChapter(probe.chapters[index], index);
    },
    offer(probe) {
      return probe.chapters.length > index;
    },
    plan(probe, context) {
      const chapter = probe.chapters[index];
      const end = chapterEnd(chapter, probe) ?? chapter.startSeconds;
      const length = end - chapter.startSeconds;
      const container = chapterContainer(probe, context);
      const strip = context?.stripMetadata ?? false;
      const total = probe.durationSeconds;
      return {
        inputArgs: chapter.startSeconds > 0 ? ["-ss", formatSeconds(chapter.startSeconds)] : [],
        args: [
          ...copyMaps(probe),
          "-t",
          formatSeconds(length),
          "-c",
          "copy",
          // A copied stream starts on the keyframe before the seek, which lands
          // it at a negative timestamp; shift everything so the piece starts at zero.
          "-avoid_negative_ts",
          "make_zero",
          // The whole file's chapter list would be wrong in a piece of it.
          "-map_chapters",
          "-1",
          // The piece is titled after its chapter, unless tags are being stripped.
          ...(strip
            ? []
            : [
                "-metadata",
                `title=${chapterTitle(chapter, index)}`,
                "-metadata",
                `track=${index + 1}/${probe.chapters.length}`,
              ]),
          ...containerArgs(container),
        ],
        ...container,
        mode: "copy",
        kind: probe.hasVideo && probe.video ? "video" : "audio",
        fileSuffix: chapterSuffix(chapter, index),
        // Progress is measured against the whole file, and this is a piece of it.
        durationFactor: total ? length / total : 1,
        // The keyframe snap is said once, in the page's note, rather than under
        // every one of an audiobook's forty pieces.
        warning: probe.hasVideo ? playbackWarning(probe.video?.codec) : undefined,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      const chapter = probe.chapters[index];
      if (!chapter) {
        return {
          message: `This file has no chapter ${index + 1}.`,
          hint: `It has ${probe.chapters.length}.`,
          retryable: false,
        };
      }
      const total = probe.durationSeconds;
      if (total !== null && chapter.startSeconds >= total) {
        return {
          message: `Chapter ${index + 1} starts past the end of the file.`,
          hint: "Its marker is at or after the last second, so there is nothing under it to cut out.",
          retryable: false,
        };
      }
      const end = chapterEnd(chapter, probe);
      if (end === null) {
        return {
          message: `Chapter ${index + 1} has no length.`,
          hint: "It ends where it starts, so there is nothing to cut out.",
          retryable: false,
        };
      }
      const piece: PlanContext = {
        ...context,
        trim: { startSeconds: chapter.startSeconds, endSeconds: end },
      };
      return sizeBlocker(estimateCopyBytes(probe, piece), "This chapter");
    },
  };
}

/** Every chapter as a format; `offer` hides the ones a file lacks. */
export const CHAPTER_FORMATS: readonly OutputFormat[] = Array.from(
  { length: MAX_CHAPTERS },
  (_, index) => chapterFormat(index),
);

/** The formats a file gets on arrival: one per chapter it has. */
export function chapterFormatIds(probe: ProbeResult): string[] {
  return probe.chapters.slice(0, MAX_CHAPTERS).map((_, index) => `chapter-${index + 1}`);
}
