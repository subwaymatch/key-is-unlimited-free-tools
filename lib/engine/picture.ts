/**
 * The tools that change the picture: resize and crop, rotate and flip, and
 * still frames - one frame, or a contact sheet of many.
 *
 * All argument strings against the machinery the other video tools use. The
 * resizer and the rotator are a filter and an H.264 encode, with the audio
 * copied when the container can hold it; the frame tools write one image
 * and stop.
 */
import { compactTimecode, trimDuration } from "./trim";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult, VideoStreamInfo } from "./types";
import {
  containerArgs,
  containerHolds,
  estimateEncodedBytes,
  fitFilter,
  fitsHeight,
  H264_ENCODE,
  MP4,
  preferredContainer,
  requireTrim,
  SELECT_VIDEO,
  sizeBlocker,
  type Container,
} from "./video";

/**
 * Audio for a re-encoded picture: copied when the container keeps it,
 * otherwise AAC. The picture is H.264 either way, so only the audio decides.
 */
export function pictureAudioArgs(probe: ProbeResult, container: Container): string[] {
  const codec = probe.audio?.codec.toLowerCase() ?? null;
  if (codec === null) return [];
  return containerHolds(container, "h264", codec)
    ? ["-c:a", "copy"]
    : ["-c:a", "aac", "-b:a", "160k", ...((probe.audio?.channels ?? 2) > 2 ? ["-ac", "2"] : [])];
}

/**
 * The container a re-encoded picture lands in: the source's when it holds
 * H.264 and the audio as they are, otherwise MP4 with the audio made AAC.
 * Matroska would keep the audio untouched, but a resized WebM that comes back
 * as an MKV is a surprise where an MP4 is not.
 */
export function pictureContainer(probe: ProbeResult, context: PlanContext | undefined): Container {
  const audio = probe.audio?.codec.toLowerCase() ?? null;
  const preferred = preferredContainer(context?.sourceExtension);
  return preferred && containerHolds(preferred, "h264", audio) ? preferred : MP4;
}

/* ---- Resize and crop ---------------------------------------------------- */

/** Heights on offer, largest first, plus two fractions of the source. */
export const RESIZE_HEIGHTS: readonly number[] = [2160, 1440, 1080, 720, 480, 360, 240];

export type ResizeTarget = number | "half" | "quarter";

/** Aspect ratios the picture can be cropped to, centred, before it is scaled. */
export type AspectCrop = "keep" | "16:9" | "9:16" | "1:1" | "4:5" | "4:3";

export const ASPECT_CROPS: readonly { id: AspectCrop; label: string; blurb: string }[] = [
  { id: "keep", label: "Keep the shape", blurb: "No cropping; only the size changes" },
  { id: "16:9", label: "16:9 landscape", blurb: "YouTube, TV, most screens" },
  { id: "9:16", label: "9:16 vertical", blurb: "Stories, Reels, Shorts, TikTok" },
  { id: "1:1", label: "1:1 square", blurb: "Feed posts" },
  { id: "4:5", label: "4:5 portrait", blurb: "Instagram's tallest feed post" },
  { id: "4:3", label: "4:3", blurb: "Older screens and projectors" },
];

export interface ResizeSettings {
  target: ResizeTarget;
  aspect: AspectCrop;
}

export const DEFAULT_RESIZE_SETTINGS: ResizeSettings = { target: 720, aspect: "keep" };

/**
 * A centred crop to the ratio, in ffmpeg's own arithmetic.
 *
 * `min(iw, ih*a/b)` is the widest the frame can be at that ratio without
 * leaving the picture, and likewise for the height, so whichever side is too
 * long is the one cut. Both stay even for the 4:2:0 encoder. The offsets are
 * left at their defaults, which centre the crop.
 */
export function cropFilter(aspect: AspectCrop): string | null {
  if (aspect === "keep") return null;
  const [a, b] = aspect.split(":").map(Number);
  return `crop=w=floor(min(iw\\,ih*${a}/${b})/2)*2:h=floor(min(ih\\,iw*${b}/${a})/2)*2`;
}

/** The scale step for a target: a bounded box for a height, a fraction otherwise. */
export function resizeScaleFilter(target: ResizeTarget): string {
  if (target === "half") return "scale=trunc(iw/4)*2:trunc(ih/4)*2";
  if (target === "quarter") return "scale=trunc(iw/8)*2:trunc(ih/8)*2";
  return fitFilter(target);
}

export function resizeLabel(target: ResizeTarget): string {
  if (target === "half") return "Half size";
  if (target === "quarter") return "Quarter size";
  return `${target}p`;
}

function aspectSlug(aspect: AspectCrop): string {
  return aspect.replace(":", "x");
}

/**
 * The resizer for one setting.
 *
 * Crop first, then scale, so "720p, 9:16" is a vertical crop of the source
 * scaled to fit 720 pixels on its short side. Nothing is ever enlarged: a
 * height the picture already fits inside leaves it at its own size, which
 * `offer` uses to keep those chips off the card.
 */
export function resizeFormat(settings: ResizeSettings): OutputFormat {
  const id = `resize-${settings.target}-${aspectSlug(settings.aspect)}`;
  const label =
    settings.aspect === "keep"
      ? resizeLabel(settings.target)
      : `${resizeLabel(settings.target)}, ${settings.aspect}`;

  const filters = [cropFilter(settings.aspect), resizeScaleFilter(settings.target)].filter(
    (filter): filter is string => filter !== null,
  );

  return {
    id,
    label,
    blurb:
      settings.aspect === "keep"
        ? `Scaled to fit ${resizeLabel(settings.target).toLowerCase()}, never enlarged`
        : `Cropped to ${settings.aspect} from the centre, then scaled to fit ${resizeLabel(settings.target).toLowerCase()}`,
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe, context) {
      const container = pictureContainer(probe, context);
      return {
        args: [
          ...SELECT_VIDEO,
          "-vf",
          filters.join(","),
          ...H264_ENCODE,
          "-crf",
          "20",
          ...pictureAudioArgs(probe, container),
          ...containerArgs(container),
        ],
        ...container,
        mode: "encode",
        kind: "video",
        fileSuffix: `-${
          typeof settings.target === "number" ? `${settings.target}p` : settings.target
        }${settings.aspect === "keep" ? "" : `-${aspectSlug(settings.aspect)}`}`,
      };
    },
    // A height the frame already fits under is nothing to offer, unless a
    // crop changes the shape anyway.
    offer(probe) {
      if (settings.aspect !== "keep" || typeof settings.target !== "number") return true;
      return !fitsHeight(probe.video, settings.target);
    },
    blocker(probe, context) {
      if (
        settings.aspect === "keep" &&
        typeof settings.target === "number" &&
        fitsHeight(probe.video, settings.target)
      ) {
        const video = probe.video!;
        return {
          message: `This video already fits within ${settings.target}p.`,
          hint: `It is ${video.width}x${video.height}, and nothing is ever enlarged. Pick a smaller size, or a crop.`,
          severity: "info",
          retryable: false,
        };
      }
      // The scaled frame is at most the source's, so this errs on the large side.
      return sizeBlocker(estimateEncodedBytes(probe, context, 160), "The resized video");
    },
  };
}

/* ---- Rotate and flip ---------------------------------------------------- */

export type Rotation = "cw" | "ccw" | "180" | "hflip" | "vflip";

/**
 * The five turns, as filters.
 *
 * ffmpeg turns a phone clip the right way up on decode from its rotation
 * tag, so these apply to the picture as a player shows it, and the output
 * carries no tag: what you see is what is in the frames.
 */
export const ROTATIONS: readonly { id: Rotation; label: string; blurb: string; filter: string }[] = [
  { id: "cw", label: "90 clockwise", blurb: "A quarter turn to the right", filter: "transpose=1" },
  { id: "ccw", label: "90 counter-clockwise", blurb: "A quarter turn to the left", filter: "transpose=2" },
  { id: "180", label: "180", blurb: "Upside down", filter: "hflip,vflip" },
  { id: "hflip", label: "Mirror", blurb: "Flipped left to right", filter: "hflip" },
  { id: "vflip", label: "Flip vertically", blurb: "Flipped top to bottom", filter: "vflip" },
];

export function rotation(id: Rotation) {
  const entry = ROTATIONS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown rotation "${id}".`);
  return entry;
}

/** The rotator for one turn: a filter and an H.264 encode, audio copied where it can be. */
export function rotateFormat(id: Rotation): OutputFormat {
  const turn = rotation(id);
  return {
    id: `rotate-${id}`,
    label: turn.label,
    blurb: turn.blurb,
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe, context) {
      const container = pictureContainer(probe, context);
      return {
        args: [
          ...SELECT_VIDEO,
          "-vf",
          turn.filter,
          ...H264_ENCODE,
          "-crf",
          "20",
          ...pictureAudioArgs(probe, container),
          ...containerArgs(container),
        ],
        ...container,
        mode: "encode",
        kind: "video",
        fileSuffix: id === "cw" ? "-rotated-90" : id === "ccw" ? "-rotated-270" : id === "180" ? "-rotated-180" : id === "hflip" ? "-mirrored" : "-flipped",
      };
    },
    blocker(probe, context) {
      return sizeBlocker(estimateEncodedBytes(probe, context, 160), "The rotated video");
    },
  };
}

export const ROTATE_FORMATS: readonly OutputFormat[] = ROTATIONS.map((turn) => rotateFormat(turn.id));

/* ---- Still frames ------------------------------------------------------- */

export type FrameImage = "jpg" | "png";

/**
 * One frame at the start marker, or the first frame when there is none.
 *
 * `-ss` before `-i` seeks straight to it, as the poster does, and `-frames:v
 * 1` stops after it. JPEG for a picture, PNG when the pixels matter.
 */
export function frameFormat(image: FrameImage): OutputFormat {
  const isPng = image === "png";
  return {
    id: `frame-${image}`,
    label: isPng ? "Frame as PNG" : "Frame as JPEG",
    blurb: isPng
      ? "The frame at the start marker, lossless"
      : "The frame at the start marker, as a small JPEG",
    lossless: isPng,
    requiredEncoder: isPng ? "png" : "mjpeg",
    plan(_probe, context) {
      const at = context?.trim?.startSeconds ?? 0;
      return {
        args: [
          "-map",
          "0:v:0",
          "-an",
          "-sn",
          "-dn",
          "-frames:v",
          "1",
          ...(isPng ? ["-c:v", "png"] : ["-c:v", "mjpeg", "-q:v", "2"]),
          "-f",
          "image2",
          "-update",
          "1",
        ],
        extension: image,
        mimeType: isPng ? "image/png" : "image/jpeg",
        mode: "encode",
        kind: "image",
        // Named by its moment, not by a range: "frame-at-1m30s".
        fileSuffix: `-frame-at-${compactTimecode(at)}`,
        omitRangeSuffix: true,
      };
    },
  };
}

export const FRAME_FORMATS: readonly OutputFormat[] = [frameFormat("jpg"), frameFormat("png")];

export interface SheetSettings {
  /** How many frames, spread evenly over the range. */
  frames: number;
  /** Width of each frame in the grid, in pixels. */
  width: number;
}

export const SHEET_FRAME_OPTIONS: readonly number[] = [4, 6, 9, 12, 16, 20, 25];
export const SHEET_WIDTH_OPTIONS: readonly number[] = [160, 240, 320, 480];
export const DEFAULT_SHEET_SETTINGS: SheetSettings = { frames: 9, width: 320 };

/** The grid a number of frames lays out as: as near square as it goes. */
export function sheetLayout(frames: number): { columns: number; rows: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(frames)));
  return { columns, rows: Math.max(1, Math.ceil(frames / columns)) };
}

/** Gap between tiles and around the sheet, in pixels. */
const SHEET_PADDING = 4;

/**
 * A contact sheet: frames spread evenly over the range, tiled into a grid.
 *
 * `fps` at frames-per-length picks one frame every so many seconds, `tile`
 * packs them, and `-frames:v 1` keeps the one sheet that comes out. The
 * length has to be known to space them, so a file without a duration is
 * refused rather than given a sheet of its first second.
 */
export function sheetFormat(settings: SheetSettings): OutputFormat {
  const { columns, rows } = sheetLayout(settings.frames);
  const id = `sheet-${settings.frames}-${settings.width}`;
  return {
    id,
    label: `Contact sheet, ${settings.frames} frames`,
    blurb: `${columns}x${rows} grid of ${settings.width} px frames, spread evenly over the range, as a JPEG`,
    lossless: false,
    requiredEncoder: "mjpeg",
    plan(probe, context) {
      const seconds = trimDuration(context?.trim ?? null, probe.durationSeconds) ?? settings.frames;
      const rate = (settings.frames / Math.max(seconds, 0.001)).toFixed(6);
      return {
        args: [
          "-map",
          "0:v:0",
          "-an",
          "-sn",
          "-dn",
          "-vf",
          `fps=${rate},scale=${settings.width}:-2:flags=lanczos,tile=${columns}x${rows}:padding=${SHEET_PADDING}:margin=${SHEET_PADDING}:color=black`,
          "-frames:v",
          "1",
          "-c:v",
          "mjpeg",
          "-q:v",
          "3",
          "-f",
          "image2",
          "-update",
          "1",
        ],
        extension: "jpg",
        mimeType: "image/jpeg",
        mode: "encode",
        kind: "image",
        fileSuffix: `-sheet-${settings.frames}`,
      };
    },
    blocker(probe, context): FormatBlocker | null {
      const seconds = trimDuration(context.trim, probe.durationSeconds);
      if (!seconds) {
        return {
          message: "This file's length is unknown, so the frames cannot be spread over it.",
          hint: "The container does not report a duration. Set both markers to give the sheet a range.",
          retryable: false,
        };
      }
      return null;
    },
  };
}

/** For the tools that only make sense over a range: re-exported for the apps. */
export { requireTrim };

/** Whether a frame is worth a sheet at all: nothing to tile from an unknown picture. */
export function hasPicture(video: VideoStreamInfo | null): boolean {
  return video !== null && !!video.width && !!video.height;
}
