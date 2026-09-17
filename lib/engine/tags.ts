/**
 * The tags of an audio file: title, artist, album and the rest, and the
 * cover picture.
 *
 * Every stream is copied; only the container's metadata changes, so a
 * whole album's worth of files is re-tagged in the time it takes to read
 * them. ffmpeg maps the generic tag names onto whatever the container
 * uses - ID3 frames in an MP3, iTunes atoms in an M4A, Vorbis comments in
 * a FLAC or an Ogg - so the plan speaks in generic names and the muxer
 * translates.
 *
 * This is the other plan that reads the "Output options" switch itself:
 * off, the file's other tags are kept and these written over them; on, the
 * file is cleared first and only these remain.
 */
import { textFingerprint } from "./burn";
import { chapterContainer, copyMaps } from "./chapters";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult, ScratchFile } from "./types";
import { containerArgs, estimateCopyBytes, playbackWarning, sizeBlocker } from "./video";

/** The tags on offer, in the order the panel shows them. All optional; empty means untouched. */
export interface TagValues {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  date: string;
  genre: string;
  track: string;
  comment: string;
}

export const EMPTY_TAGS: TagValues = {
  title: "",
  artist: "",
  album: "",
  albumArtist: "",
  date: "",
  genre: "",
  track: "",
  comment: "",
};

/** The generic ffmpeg key for each field. */
export const TAG_KEYS: Record<keyof TagValues, string> = {
  title: "title",
  artist: "artist",
  album: "album",
  albumArtist: "album_artist",
  date: "date",
  genre: "genre",
  track: "track",
  comment: "comment",
};

/** A cover picture the visitor chose. */
export interface CoverSource {
  name: string;
  bytes: Uint8Array;
  /** "image/jpeg" or "image/png": the two every tagging format takes. */
  mimeType: string;
  /** Stable for one chosen file: its name, size and modification time. */
  key: string;
}

/** The most a cover may weigh; a 3000 px JPEG is under a megabyte. */
export const MAX_COVER_BYTES = 10_000_000;

/** Containers whose muxers write a cover picture from an attached-pic stream. */
const COVER_CONTAINERS: ReadonlySet<string> = new Set(["mp3", "m4a", "mp4", "m4v", "mov", "flac"]);

/** Where the cover is written for the run. */
export function coverPath(cover: CoverSource): string {
  return `/cover.${cover.mimeType === "image/png" ? "png" : "jpg"}`;
}

/** The fields that were filled in, as ffmpeg `-metadata` pairs. */
export function tagArgs(tags: TagValues): string[] {
  return (Object.keys(TAG_KEYS) as (keyof TagValues)[]).flatMap((field) => {
    const value = tags[field].trim();
    return value ? ["-metadata", `${TAG_KEYS[field]}=${value}`] : [];
  });
}

/** How many fields were filled in. */
export function countTags(tags: TagValues): number {
  return (Object.keys(TAG_KEYS) as (keyof TagValues)[]).filter((field) => tags[field].trim() !== "").length;
}

/** The format for one set of tags and, optionally, a cover. */
export function tagsFormat(tags: TagValues, cover: CoverSource | null): OutputFormat {
  const count = countTags(tags);
  const fingerprint = textFingerprint(JSON.stringify(tags));
  return {
    id: `tags-${fingerprint}${cover ? `-cover-${cover.key}` : ""}`,
    label: `${count} ${count === 1 ? "tag" : "tags"}${cover ? " and a cover" : ""}`,
    blurb: "Every stream copied as it is, with these tags written into the container",
    lossless: true,
    requiredEncoder: null,
    plan(probe: ProbeResult, context?: PlanContext) {
      const container = chapterContainer(probe, context);
      const strip = context?.stripMetadata ?? false;
      const scratchFiles: ScratchFile[] = cover ? [{ path: coverPath(cover), contents: cover.bytes }] : [];
      const mp3 = container.extension === "mp3";
      const maps =
        probe.hasVideo && probe.video
          ? copyMaps(probe)
          : cover
            ? ["-map", "0:a:0", "-map", "1:v:0", "-sn", "-dn"]
            : // The file's own cover, if it has one, is a video stream and rides along.
              ["-map", "0:a:0", "-map", "0:v?", "-sn", "-dn"];
      return {
        args: [
          ...(cover ? ["-i", coverPath(cover)] : []),
          ...maps,
          "-c",
          "copy",
          // Off: the file's tags stay and these go over them. On: cleared first.
          ...(strip ? ["-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1", "-fflags", "+bitexact"] : []),
          ...tagArgs(tags),
          ...(cover
            ? [
                "-disposition:v:0",
                "attached_pic",
                // ID3 wants to know what the picture is of; the muxer reads it from here.
                ...(mp3 ? ["-metadata:s:v:0", "title=Album cover", "-metadata:s:v:0", "comment=Cover (front)"] : []),
              ]
            : []),
          // Windows and older players read ID3v2.3 and not 2.4.
          ...(mp3 ? ["-id3v2_version", "3"] : []),
          ...containerArgs(container),
        ],
        scratchFiles,
        ...container,
        mode: "copy",
        kind: probe.hasVideo && probe.video ? "video" : "audio",
        fileSuffix: "-tagged",
        stripsMetadata: true,
        warning: probe.hasVideo ? playbackWarning(probe.video?.codec) : undefined,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      if (count === 0 && !cover) {
        return { message: "There is nothing to write.", hint: "Fill in at least one tag, or choose a cover, in the panel above.", severity: "info", retryable: false };
      }
      const container = chapterContainer(probe, context);
      if (cover && (probe.hasVideo || !COVER_CONTAINERS.has(container.extension))) {
        return {
          message: probe.hasVideo
            ? "A cover picture goes on an audio file, not a video."
            : `A ${container.extension.toUpperCase()} file cannot carry a cover picture.`,
          hint: probe.hasVideo
            ? "Leave the cover out to write the tags alone."
            : "MP3, M4A and FLAC can. Convert the audio to one of those first, or leave the cover out to write the tags alone.",
          retryable: false,
        };
      }
      if (cover && cover.bytes.length > MAX_COVER_BYTES) {
        return {
          message: `${cover.name} is too large for a cover.`,
          hint: `Covers are capped at ${Math.round(MAX_COVER_BYTES / 1_000_000)} MB; a 1500 px JPEG is plenty.`,
          retryable: false,
        };
      }
      return sizeBlocker(estimateCopyBytes(probe, context) + (cover?.bytes.length ?? 0), "The file");
    },
  };
}
