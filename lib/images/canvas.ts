/**
 * Pictures through the browser's own decoder and encoder.
 *
 * No library and no WebAssembly: every browser decodes JPEG, PNG, WebP, GIF
 * and BMP, most decode AVIF, and Safari decodes HEIC, so a canvas is the
 * converter, the resizer and the compressor. What comes out of a canvas
 * carries no metadata at all, which for a picture headed somewhere public
 * is the right default.
 *
 * The arithmetic - what size to draw at, which quality lands under a size -
 * is pure and tested; the drawing and encoding need a browser.
 */

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "heif", "tif", "tiff", "jfif", "ico"] as const;

export const IMAGE_ACCEPT = ["image/*", ...IMAGE_EXTENSIONS.map((extension) => `.${extension}`)].join(",");

const IMAGE_SET: ReadonlySet<string> = new Set<string>(IMAGE_EXTENSIONS);

/** Whether this is plausibly a picture, before anything tries to decode it. */
export function looksLikeImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_SET.has(extension);
}

export function rejectNonImage(file: File): { message: string; hint: string } | null {
  if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to read." };
  if (looksLikeImage(file)) return null;
  return { message: "This is not an image.", hint: "Drop a JPEG, PNG, WebP, GIF, BMP, AVIF or HEIC file." };
}

export const MIME_EXTENSIONS: Record<ImageMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const MIME_LABELS: Record<ImageMime, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

/** The format to write a picture back in when "the same" was asked: the three a canvas can write, and PNG for the rest. */
export function sameFormatMime(file: File): ImageMime {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type === "image/jpeg" || extension === "jpg" || extension === "jpeg" || extension === "jfif") return "image/jpeg";
  if (file.type === "image/webp" || extension === "webp") return "image/webp";
  return "image/png";
}

/** Whether the picture can have transparent pixels, which JPEG would paint white. */
export function mayHaveTransparency(file: File): boolean {
  return sameFormatMime(file) !== "image/jpeg";
}

/** Quality presets for the lossy formats. */
export const QUALITY_PRESETS: readonly { id: string; quality: number; label: string; blurb: string }[] = [
  { id: "high", quality: 0.92, label: "High", blurb: "Hard to tell from the original" },
  { id: "good", quality: 0.82, label: "Good", blurb: "The usual choice: a third of the size, and still clean" },
  { id: "small", quality: 0.7, label: "Small", blurb: "Noticeably compressed up close, fine in a feed" },
];

/* ---- Sizes -------------------------------------------------------------- */

export interface Size {
  width: number;
  height: number;
}

/** A size fitted so its longest side is at most `limit`, never enlarged, never under a pixel. */
export function fitLongestSide(size: Size, limit: number): Size {
  const longest = Math.max(size.width, size.height);
  if (longest <= limit) return { width: size.width, height: size.height };
  const scale = limit / longest;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/** A size scaled by a fraction, never under a pixel. */
export function scaleSize(size: Size, factor: number): Size {
  return { width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)) };
}

/** A size fitted inside a box, never enlarged. */
export function fitInside(size: Size, box: Size): Size {
  const scale = Math.min(1, box.width / size.width, box.height / size.height);
  return scaleSize(size, scale);
}

/* ---- Compressing to a size ---------------------------------------------- */

/** Below this quality the picture is blocks; a smaller frame is the better trade. */
export const MIN_QUALITY = 0.4;
export const MAX_QUALITY = 0.95;

export interface QualitySearch {
  quality: number;
  bytes: number;
}

/**
 * The highest quality at which the encoded picture lands under the target,
 * by bisection on the quality, or null when even the lowest is too large.
 *
 * `sizeAt` is the encoder: how many bytes the picture is at a quality. Each
 * call encodes the whole frame, so the search is a handful of steps, and it
 * checks the ends first so a picture already small at the top quality costs
 * one encode.
 */
export async function findQualityUnder(sizeAt: (quality: number) => Promise<number>, targetBytes: number, steps = 6): Promise<QualitySearch | null> {
  const top = await sizeAt(MAX_QUALITY);
  if (top <= targetBytes) return { quality: MAX_QUALITY, bytes: top };
  const bottom = await sizeAt(MIN_QUALITY);
  if (bottom > targetBytes) return null;
  let low = MIN_QUALITY;
  let lowBytes = bottom;
  let high = MAX_QUALITY;
  for (let i = 0; i < steps; i += 1) {
    const middle = Math.round(((low + high) / 2) * 100) / 100;
    if (middle <= low || middle >= high) break;
    const bytes = await sizeAt(middle);
    if (bytes <= targetBytes) {
      low = middle;
      lowBytes = bytes;
    } else {
      high = middle;
    }
  }
  return { quality: low, bytes: lowBytes };
}

/**
 * The fraction to shrink a frame by when the lowest quality is still too
 * large: bytes scale with the pixel count, so the side scales with the
 * square root, with a little in hand for the encoder's overheads.
 */
export function shrinkFactor(bytesAtMinQuality: number, targetBytes: number): number {
  return Math.min(0.9, Math.sqrt(targetBytes / bytesAtMinQuality) * 0.95);
}

/* ---- The browser half --------------------------------------------------- */

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/**
 * The picture decoded, with its Exif orientation applied, so what is drawn
 * is what a viewer shows.
 *
 * `createImageBitmap` takes any format the browser decodes and, asked to,
 * honours the orientation tag; a browser that lacks the option is given an
 * <img> instead, which browsers have oriented on their own since 2020.
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the element.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The browser could not decode this picture."));
      element.src = url;
    });
    if (!image.naturalWidth) throw new Error("The browser could not decode this picture.");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The picture drawn at a size, halving on the way down.
 *
 * One draw from 6000 to 600 pixels skips most of the source pixels and
 * looks like it; drawing in halves lets the scaler average every step.
 */
export function drawImage(image: DecodedImage, size: Size, background: string | null): AnyCanvas {
  let source: CanvasImageSource = image.source;
  let width = image.width;
  let height = image.height;
  while (width / 2 >= size.width && height / 2 >= size.height && width > 2 && height > 2) {
    width = Math.floor(width / 2);
    height = Math.floor(height / 2);
    const step = makeCanvas(width, height);
    const context = step.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    source = step;
  }
  const canvas = makeCanvas(size.width, size.height);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/** The canvas encoded, at a quality for the lossy formats. */
export async function encodeCanvas(canvas: AnyCanvas, type: ImageMime, quality?: number): Promise<Blob> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type, quality })
      : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error(`The browser could not write a ${MIME_LABELS[type]}.`);
  if (blob.type !== type) throw new Error(`This browser cannot write ${MIME_LABELS[type]} files.`);
  return blob;
}

const encodeSupport = new Map<ImageMime, boolean>();

/** Whether this browser writes the format: Safari, notably, writes no WebP. */
export function canEncode(type: ImageMime): boolean {
  if (typeof document === "undefined") return true;
  const known = encodeSupport.get(type);
  if (known !== undefined) return known;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const supported = canvas.toDataURL(type).startsWith(`data:${type}`);
  encodeSupport.set(type, supported);
  return supported;
}

/** "1600x1200", for a fact line. */
export function describeSize(size: Size): string {
  return `${size.width}x${size.height}`;
}
