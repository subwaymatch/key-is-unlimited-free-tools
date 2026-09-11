/**
 * What counts as a media file before ffmpeg has seen it.
 *
 * The engine is the authority on whether a file can be decoded, and it stays
 * that way: a renamed or truncated video is only discoverable by trying. But
 * dropping a PDF on a video converter should not download a 31 MB core and
 * mount the file to reach the same conclusion a fraction of a second of string
 * comparison can. This is that first pass, and it is deliberately generous -
 * anything plausible is let through and the probe decides.
 */

/**
 * Container extensions worth accepting, including the many a browser reports
 * with an empty or wrong MIME type (MKV and MTS are the usual offenders).
 */
export const VIDEO_EXTENSIONS = [
  "mp4",
  "m4v",
  "mov",
  "qt",
  "mkv",
  "webm",
  "avi",
  "wmv",
  "flv",
  "f4v",
  "mpg",
  "mpeg",
  "m2v",
  "mts",
  "m2ts",
  "ts",
  "vob",
  "ogv",
  "3gp",
  "3g2",
  "asf",
  "rm",
  "rmvb",
  "divx",
  "mxf",
  "dv",
  "y4m",
] as const;

export const AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "m4b",
  "aac",
  "wav",
  "flac",
  "opus",
  "ogg",
  "oga",
  "mka",
  "wma",
  "aiff",
  "aif",
  "alac",
  "ac3",
  "eac3",
  "mp2",
  "amr",
  "caf",
  "au",
  "dts",
  "ape",
  "wv",
] as const;

const VIDEO_SET: ReadonlySet<string> = new Set<string>(VIDEO_EXTENSIONS);
const AUDIO_SET: ReadonlySet<string> = new Set<string>(AUDIO_EXTENSIONS);

/** Lower-case extension of a filename, without the dot, or null when it has none. */
export function fileExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) return null;
  return fileName.slice(lastDot + 1).toLowerCase();
}

/** The filename without its extension, so outputs can be named after the source. */
export function fileStem(fileName: string, fallback = "file"): string {
  const extension = fileExtension(fileName);
  const stem = extension ? fileName.slice(0, fileName.length - extension.length - 1) : fileName;
  return stem.trim() || fallback;
}

/**
 * The `accept` list for a file input, as extensions plus the MIME wildcards.
 *
 * Both halves are needed: the wildcards cover formats not listed here, and the
 * extensions cover the containers browsers have no MIME type for.
 */
function acceptList(wildcards: string[], extensions: readonly string[]): string {
  return [...wildcards, ...extensions.map((extension) => `.${extension}`)].join(",");
}

export const VIDEO_ACCEPT = acceptList(["video/*"], VIDEO_EXTENSIONS);
export const MEDIA_ACCEPT = acceptList(
  ["video/*", "audio/*"],
  [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS],
);

/** What the tool is prepared to open, matching MediaExpectation. */
export type MediaKind = "audio" | "video" | "media";

/**
 * Whether this file is plausibly the kind of media the tool works on.
 *
 * A file whose MIME type says audio or video is taken at its word, whichever
 * the tool wanted: an MP3 dropped on the video converter is a real media file
 * with no video in it, and "no video track found" after a probe is a far
 * better message than "not a media file" before one. What this rejects is the
 * text file, the PDF, the ZIP - things with no reading at all.
 */
export function looksLikeMedia(file: File): boolean {
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) return true;
  const extension = fileExtension(file.name);
  return extension !== null && (VIDEO_SET.has(extension) || AUDIO_SET.has(extension));
}

export interface RejectionReason {
  message: string;
  hint: string;
}

/** Why this file will not be opened, or null when it is worth trying. */
export function rejectFile(file: File): RejectionReason | null {
  if (file.size === 0) {
    return {
      message: "This file is empty.",
      hint: "It is 0 bytes, so there is nothing in it to read. It may not have finished copying.",
    };
  }
  if (!looksLikeMedia(file)) {
    const extension = fileExtension(file.name);
    return {
      message: "This is not a video or audio file.",
      hint: extension
        ? `Nothing here reads .${extension} files. Drop a video or an audio file instead.`
        : "The file has no extension and no media type, so there is nothing to read it as.",
    };
  }
  return null;
}
