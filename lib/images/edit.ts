/**
 * Pictures changed rather than converted: cropped to a shape, marked with
 * text or a logo, cut into a set of icons, or spelt out as text.
 *
 * The arithmetic is pure and tested; the drawing needs a canvas.
 */
import { drawImage, type DecodedImage, type Size } from "./canvas";

/* ---- Crop --------------------------------------------------------------- */

export interface Aspect {
  id: string;
  label: string;
  blurb: string;
  width: number;
  height: number;
}

export const ASPECTS: readonly Aspect[] = [
  { id: "1:1", label: "Square", blurb: "Profile pictures, Instagram", width: 1, height: 1 },
  { id: "4:5", label: "4:5 portrait", blurb: "Instagram's tallest feed post", width: 4, height: 5 },
  { id: "16:9", label: "16:9 landscape", blurb: "YouTube thumbnails, slides, screens", width: 16, height: 9 },
  { id: "9:16", label: "9:16 portrait", blurb: "Stories, Reels, TikTok", width: 9, height: 16 },
  { id: "3:2", label: "3:2 landscape", blurb: "A camera's own frame; 6x4 prints", width: 3, height: 2 },
  { id: "2:3", label: "2:3 portrait", blurb: "4x6 prints, Pinterest", width: 2, height: 3 },
  { id: "4:3", label: "4:3 landscape", blurb: "Older screens, iPad photos", width: 4, height: 3 },
  { id: "3:4", label: "3:4 portrait", blurb: "A phone's own photo, upright", width: 3, height: 4 },
];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The largest centred rectangle of this shape that fits the picture, in whole pixels. */
export function centredCrop(size: Size, aspect: { width: number; height: number }): CropRect {
  const target = aspect.width / aspect.height;
  const current = size.width / size.height;
  let width = size.width;
  let height = size.height;
  if (current > target) width = Math.round(size.height * target);
  else height = Math.round(size.width / target);
  width = Math.max(1, Math.min(size.width, width));
  height = Math.max(1, Math.min(size.height, height));
  return { x: Math.floor((size.width - width) / 2), y: Math.floor((size.height - height) / 2), width, height };
}

/** Whether a picture is already that shape, within a pixel. */
export function isAlreadyShape(size: Size, aspect: { width: number; height: number }): boolean {
  const rect = centredCrop(size, aspect);
  return rect.width === size.width && rect.height === size.height;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The rectangle of the picture, drawn at a size. */
export function drawCrop(image: DecodedImage, rect: CropRect, size: Size, background: string | null): AnyCanvas {
  // The crop is a picture of its own; the size-stepping draw works on it.
  const cropped = makeCanvas(rect.width, rect.height);
  const context = cropped.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  context.drawImage(image.source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const asImage: DecodedImage = { source: cropped, width: rect.width, height: rect.height, close: () => {} };
  return drawImage(asImage, size, background);
}

/* ---- Watermark ---------------------------------------------------------- */

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export const CORNERS: readonly { id: Corner; label: string }[] = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
  { id: "center", label: "Centre" },
];

/** Where a mark of this size sits on a picture of that size, inset by a share of the width. */
export function markPlacement(base: Size, mark: Size, corner: Corner, marginFraction: number): { x: number; y: number } {
  const margin = Math.round(base.width * marginFraction);
  switch (corner) {
    case "top-left":
      return { x: margin, y: margin };
    case "top-right":
      return { x: base.width - mark.width - margin, y: margin };
    case "bottom-left":
      return { x: margin, y: base.height - mark.height - margin };
    case "bottom-right":
      return { x: base.width - mark.width - margin, y: base.height - mark.height - margin };
    case "center":
      return { x: Math.round((base.width - mark.width) / 2), y: Math.round((base.height - mark.height) / 2) };
  }
}

export interface MarkStyle {
  corner: Corner;
  /** A picture's width, or the text's height, as a share of the base's width or height. */
  size: number;
  opacity: number;
  margin: number;
}

/** A logo laid over the picture, scaled to a share of its width. */
export function drawImageMark(canvas: AnyCanvas, mark: DecodedImage, style: MarkStyle): void {
  const base = { width: canvas.width, height: canvas.height };
  const width = Math.max(1, Math.round(base.width * style.size));
  const height = Math.max(1, Math.round((mark.height / mark.width) * width));
  const { x, y } = markPlacement(base, { width, height }, style.corner, style.margin);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  context.save();
  context.globalAlpha = style.opacity;
  context.imageSmoothingQuality = "high";
  context.drawImage(mark.source, x, y, width, height);
  context.restore();
}

/** A line of text drawn on the picture, white with a dark edge so it reads on anything. */
export function drawTextMark(canvas: AnyCanvas, text: string, style: MarkStyle): void {
  const base = { width: canvas.width, height: canvas.height };
  const fontSize = Math.max(8, Math.round(base.height * style.size * 0.25));
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  context.save();
  context.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  context.textBaseline = "top";
  const width = Math.ceil(context.measureText(text).width);
  const height = Math.ceil(fontSize * 1.2);
  const { x, y } = markPlacement(base, { width, height }, style.corner, style.margin);
  context.globalAlpha = style.opacity;
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, fontSize / 12);
  context.strokeStyle = "rgba(0,0,0,0.8)";
  context.strokeText(text, x, y);
  context.fillStyle = "#ffffff";
  context.fillText(text, x, y);
  context.restore();
}

/* ---- Favicons ----------------------------------------------------------- */

/** The sizes that go into the .ico, and the PNGs alongside it. */
export const ICO_SIZES: readonly number[] = [16, 32, 48];
export const FAVICON_PNGS: readonly { size: number; fileName: string; purpose: string }[] = [
  { size: 180, fileName: "apple-touch-icon.png", purpose: "the icon iOS shows on the home screen" },
  { size: 192, fileName: "icon-192.png", purpose: "Android and the web app manifest" },
  { size: 512, fileName: "icon-512.png", purpose: "the manifest's large icon and splash" },
];

/**
 * An .ico holding PNG entries: the header, a directory entry per picture,
 * and the pictures. Every browser and Windows since 7 read PNG in an ICO.
 */
export function icoFromPngs(entries: readonly { size: number; bytes: Uint8Array }[]): Uint8Array {
  const headerLength = 6 + entries.length * 16;
  const total = headerLength + entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);
  let offset = headerLength;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    out[at] = entry.size >= 256 ? 0 : entry.size;
    out[at + 1] = entry.size >= 256 ? 0 : entry.size;
    out[at + 2] = 0;
    out[at + 3] = 0;
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, entry.bytes.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(entry.bytes, offset);
    offset += entry.bytes.length;
  });
  return out;
}

/** The lines to put in a page's head, for the files this makes. */
export function faviconSnippet(): string {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    "",
    "<!-- manifest.webmanifest -->",
    "{",
    '  "icons": [',
    '    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },',
    '    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }',
    "  ]",
    "}",
  ].join("\n");
}

/* ---- Base64 ------------------------------------------------------------- */

/** The most a picture may weigh before its data URI stops being useful to anyone. */
export const MAX_BASE64_BYTES = 10_000_000;

/** A data URI's text and the snippets people paste it into. */
export function base64Snippets(dataUri: string, alt: string): { html: string; css: string } {
  return {
    html: `<img src="${dataUri}" alt="${alt.replace(/"/g, "&quot;")}">`,
    css: `background-image: url("${dataUri}");`,
  };
}

/** How much larger the text is than the bytes: four characters for three bytes. */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}
