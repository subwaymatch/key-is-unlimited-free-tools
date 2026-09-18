"use client";

/**
 * PDF.js again, for what lies under a page: the images it paints, and the
 * pixels of a page drawn small enough to measure.
 *
 * An image comes out of PDF.js one of two ways: already decoded into an
 * `ImageBitmap` where the browser could do it, or as raw bytes in one of
 * three layouts with a kind to say which. Both end on a canvas here.
 */
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { encodeCanvas, type ImageMime } from "../images/canvas";
import { rgbaFrom, type PixelKind } from "./pixels";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let library: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  library ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return library;
}

interface RawImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

export interface PageImage {
  blob: Blob;
  width: number;
  height: number;
  /** 1-based page and the image's number on it. */
  page: number;
  index: number;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The kind PDF.js names, as this module names it. */
function kindOf(lib: PdfJs, kind: number | undefined): PixelKind | null {
  if (kind === lib.ImageKind.GRAYSCALE_1BPP) return "gray1";
  if (kind === lib.ImageKind.RGB_24BPP) return "rgb";
  if (kind === lib.ImageKind.RGBA_32BPP) return "rgba";
  return null;
}

/** One of PDF.js's images as a canvas, or null for a layout it does not describe. */
function canvasOf(lib: PdfJs, image: RawImage): HTMLCanvasElement | OffscreenCanvas | null {
  const canvas = makeCanvas(image.width, image.height);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0);
    return canvas;
  }
  const kind = kindOf(lib, image.kind);
  if (!kind || !image.data) return null;
  const pixels = new ImageData(rgbaFrom(kind, image.data, image.width, image.height), image.width, image.height);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/** The longest to wait for PDF.js to finish decoding one image. */
const OBJECT_WAIT_MS = 30_000;

interface ObjectStore {
  get(id: string, callback?: (data: unknown) => void): unknown;
}

/**
 * A page's object by id, once PDF.js has it.
 *
 * The operator list can arrive before the worker has finished decoding an
 * image the list paints: the renderer waits on a dependency operator for
 * exactly this reason, and so must this. `get` with a callback is the
 * store's own way to wait. Ids that start with "g_" live with the document
 * rather than the page.
 */
function objectOf(page: { objs: ObjectStore; commonObjs: ObjectStore }, id: string): Promise<RawImage | null> {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), OBJECT_WAIT_MS);
    try {
      store.get(id, (data) => {
        clearTimeout(timer);
        resolve((data as RawImage | null) ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Every image painted on a page, in painting order, each once, at least
 * `minSide` pixels on its shorter side so bullets and rules are skipped.
 */
export async function pageImages(document: PDFDocumentProxy, index: number, mime: ImageMime, quality: number | null, minSide: number): Promise<PageImage[]> {
  const lib = await pdfjs();
  const page = await document.getPage(index + 1);
  const ops = await page.getOperatorList();
  const seen = new Set<string>();
  const images: PageImage[] = [];
  for (let at = 0; at < ops.fnArray.length; at += 1) {
    const fn = ops.fnArray[at];
    let image: RawImage | null = null;
    if (fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintImageXObjectRepeat) {
      const id = String(ops.argsArray[at][0]);
      if (seen.has(id)) continue;
      seen.add(id);
      image = await objectOf(page, id);
    } else if (fn === lib.OPS.paintInlineImageXObject) {
      image = ops.argsArray[at][0] as RawImage;
    }
    if (!image || !image.width || !image.height || Math.min(image.width, image.height) < minSide) continue;
    const canvas = canvasOf(lib, image);
    if (!canvas) continue;
    if (mime === "image/jpeg") {
      // A JPEG has no transparency: what was see-through is painted white first.
      const flat = makeCanvas(canvas.width, canvas.height);
      const context = flat.getContext("2d") as CanvasRenderingContext2D;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, flat.width, flat.height);
      context.drawImage(canvas, 0, 0);
      images.push({ blob: await encodeCanvas(flat, mime, quality ?? undefined), width: canvas.width, height: canvas.height, page: index + 1, index: images.length + 1 });
    } else {
      images.push({ blob: await encodeCanvas(canvas, mime, quality ?? undefined), width: canvas.width, height: canvas.height, page: index + 1, index: images.length + 1 });
    }
  }
  page.cleanup();
  return images;
}

export interface PagePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Rendered pixels per point. */
  scale: number;
}

/** A page drawn at a resolution, as pixels, for measuring rather than saving. */
export async function pagePixels(document: PDFDocumentProxy, index: number, dpi: number): Promise<PagePixels> {
  const page = await document.getPage(index + 1);
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport, canvas: canvas as HTMLCanvasElement }).promise;
  const pixels = context.getImageData(0, 0, width, height);
  page.cleanup();
  return { data: pixels.data, width, height, scale };
}
