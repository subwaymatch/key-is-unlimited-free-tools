/**
 * A watermark on a video: a picture in a corner, or a line of text.
 *
 * A picture is a second input scaled to a share of the frame's width,
 * given the opacity asked for and laid over every frame; text is the
 * `drawtext` filter with the font the site ships, since the pinned core has
 * freetype but no fontconfig and cannot find a font of its own. Either is
 * one H.264 encode with the sound copied where the container keeps it.
 */
import { BURN_FONT_PATH } from "./burn";
import { pictureAudioArgs, pictureContainer } from "./picture";
import type { OutputFormat, ScratchFile } from "./types";
import { containerArgs, estimateEncodedBytes, H264_ENCODE, sizeBlocker } from "./video";

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export const WATERMARK_POSITIONS: readonly { id: WatermarkPosition; label: string }[] = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
  { id: "center", label: "Centre" },
];

export interface WatermarkImage {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
  key: string;
}

export interface WatermarkSettings {
  position: WatermarkPosition;
  /** The picture's width, or the text's height, as a share of the frame's width or height. */
  size: number;
  /** 0.1 to 1. */
  opacity: number;
  /** Distance from the edges as a share of the frame's width. */
  margin: number;
}

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = { position: "bottom-right", size: 0.2, opacity: 0.7, margin: 0.03 };

export const WATERMARK_SIZES: readonly { size: number; label: string }[] = [
  { size: 0.1, label: "Small" },
  { size: 0.2, label: "Medium" },
  { size: 0.35, label: "Large" },
];

export const WATERMARK_OPACITIES: readonly { opacity: number; label: string }[] = [
  { opacity: 0.4, label: "Faint" },
  { opacity: 0.7, label: "Clear" },
  { opacity: 1, label: "Solid" },
];

/** Where the watermark image is written for the run. */
export const WATERMARK_IMAGE_DIR = "/watermark";
/** Where the text goes: a file, so nothing in it needs escaping for the filter. */
export const WATERMARK_TEXT_PATH = "/watermark/text.txt";

export function watermarkImagePath(image: WatermarkImage): string {
  return `${WATERMARK_IMAGE_DIR}/mark.${image.mimeType === "image/png" ? "png" : "jpg"}`;
}

/** The overlay's top-left corner, in the overlay filter's own variables. */
export function overlayPosition(position: WatermarkPosition, margin: number): { x: string; y: string } {
  const m = `main_w*${margin}`;
  switch (position) {
    case "top-left":
      return { x: m, y: m };
    case "top-right":
      return { x: `main_w-overlay_w-${m}`, y: m };
    case "bottom-left":
      return { x: m, y: `main_h-overlay_h-${m}` };
    case "bottom-right":
      return { x: `main_w-overlay_w-${m}`, y: `main_h-overlay_h-${m}` };
    case "center":
      return { x: "(main_w-overlay_w)/2", y: "(main_h-overlay_h)/2" };
  }
}

/** The text's top-left corner, in drawtext's own variables. */
export function textPosition(position: WatermarkPosition, margin: number): { x: string; y: string } {
  const m = `w*${margin}`;
  switch (position) {
    case "top-left":
      return { x: m, y: m };
    case "top-right":
      return { x: `w-tw-${m}`, y: m };
    case "bottom-left":
      return { x: m, y: `h-th-${m}` };
    case "bottom-right":
      return { x: `w-tw-${m}`, y: `h-th-${m}` };
    case "center":
      return { x: "(w-tw)/2", y: "(h-th)/2" };
  }
}

/**
 * The graph for a picture: made translucent, scaled against the frame to a
 * share of its width with its own shape kept, and laid on.
 *
 * scale2ref's variables are the trap here: iw and ih are the reference (the
 * video), while main_w, main_h and mdar are the picture being scaled. A
 * width written as main_w*0.2 is a fifth of the logo's own width - a
 * 16-pixel mark on a 4K frame - which is what the browser run measured.
 */
export function imageWatermarkGraph(settings: WatermarkSettings): string {
  const { x, y } = overlayPosition(settings.position, settings.margin);
  return (
    `[1:v]format=rgba,colorchannelmixer=aa=${settings.opacity}[mark];` +
    `[mark][0:v:0]scale2ref=w='iw*${settings.size}':h='ow/mdar'[scaled][base];` +
    `[base][scaled]overlay=x='${x}':y='${y}':format=auto[v]`
  );
}

/** The filter for a line of text, white with a dark edge so it reads on anything. */
export function textWatermarkFilter(settings: WatermarkSettings): string {
  const { x, y } = textPosition(settings.position, settings.margin);
  return (
    `drawtext=fontfile=${BURN_FONT_PATH}:textfile=${WATERMARK_TEXT_PATH}:fontsize=h*${settings.size / 4}` +
    `:fontcolor=white@${settings.opacity}:borderw=2:bordercolor=black@${settings.opacity}:x='${x}':y='${y}'`
  );
}

/** A picture laid over every frame. */
export function imageWatermarkFormat(image: WatermarkImage, settings: WatermarkSettings): OutputFormat {
  const path = watermarkImagePath(image);
  const scratchFiles: ScratchFile[] = [{ path, contents: image.bytes }];
  return {
    id: `watermark-image-${image.key}-${settings.position}-${settings.size}-${settings.opacity}`,
    label: `Watermark with ${image.name}`,
    blurb: "The picture laid over every frame, in one H.264 encode",
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe, context) {
      const container = pictureContainer(probe, context);
      return {
        args: ["-i", path, "-filter_complex", imageWatermarkGraph(settings), "-map", "[v]", "-map", "0:a:0?", "-sn", "-dn", ...H264_ENCODE, "-crf", "20", ...pictureAudioArgs(probe, container), ...containerArgs(container)],
        scratchFiles,
        ...container,
        mode: "encode",
        kind: "video",
        fileSuffix: "-watermarked",
      };
    },
    blocker(probe, context) {
      if (!probe.video) return { message: "This file has no picture to mark.", hint: "It is audio only.", retryable: false };
      return sizeBlocker(estimateEncodedBytes(probe, context, 160), "The watermarked video");
    },
  };
}

/** A line of text drawn on every frame. */
export function textWatermarkFormat(text: string, font: Uint8Array, settings: WatermarkSettings): OutputFormat {
  const line = text.replace(/\r?\n/g, " ").trim();
  return {
    id: `watermark-text-${textFingerprint(line)}-${settings.position}-${settings.size}-${settings.opacity}`,
    label: `Watermark "${line.length > 24 ? `${line.slice(0, 24)}...` : line}"`,
    blurb: "The text drawn on every frame, in one H.264 encode",
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe, context) {
      const container = pictureContainer(probe, context);
      return {
        args: ["-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-vf", textWatermarkFilter(settings), ...H264_ENCODE, "-crf", "20", ...pictureAudioArgs(probe, container), ...containerArgs(container)],
        scratchFiles: [
          { path: BURN_FONT_PATH, contents: font },
          { path: WATERMARK_TEXT_PATH, contents: line },
        ],
        ...container,
        mode: "encode",
        kind: "video",
        fileSuffix: "-watermarked",
      };
    },
    blocker(probe, context) {
      if (!probe.video) return { message: "This file has no picture to mark.", hint: "It is audio only.", retryable: false };
      if (!line) return { message: "There is no text to draw.", hint: "Type the watermark in the panel above.", retryable: false };
      return sizeBlocker(estimateEncodedBytes(probe, context, 160), "The watermarked video");
    },
  };
}

/** A short, stable id for a string, so two texts are two formats. */
function textFingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
