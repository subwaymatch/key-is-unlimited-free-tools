"use client";

/**
 * PDF.js, for the two things pdf-lib cannot do: draw a page, and read the
 * text off one.
 *
 * PDF.js is Apache-2.0 and plain JavaScript, with a worker it spawns from
 * a URL and data files it reads from a directory, all copied into public/
 * by scripts/copy-pdfjs-assets.mjs. It is pulled in on first use, so only
 * the pages that draw or read pay its 450 KB.
 *
 * The legacy build, not the modern one. The modern build is written for the
 * current release of each browser and uses APIs from the last few months -
 * Map.prototype.getOrInsertComputed, at the time of writing - so a Chrome
 * one year old fails on the first document with "getOrInsertComputed is not
 * a function". The legacy build carries the polyfills and supports browsers
 * about two years back, which is the promise the rest of the site makes.
 */
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { encodeCanvas, type ImageMime } from "../images/canvas";
import { PlainError } from "../plainQueue";

/** Must match package.json; scripts/copy-pdfjs-assets.mjs checks. */
export const PDFJS_VERSION = "6.3.289";

const ASSETS = `/pdfjs/${PDFJS_VERSION}`;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let library: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  library ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
    module.GlobalWorkerOptions.workerSrc = `${ASSETS}/pdf.worker.min.mjs`;
    return module;
  });
  return library;
}

/**
 * Releases a document's worker memory once its pages are drawn or read.
 *
 * The document proxy has no destroy of its own in PDF.js 6; the loading task
 * that produced it is where teardown lives.
 */
export async function closePdf(document: PDFDocumentProxy): Promise<void> {
  await document.loadingTask.destroy();
}

/** A document opened for drawing or reading, or the reason it could not be. */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const { getDocument } = await pdfjs();
  try {
    return await getDocument({
      data: bytes,
      cMapUrl: `${ASSETS}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSETS}/standard_fonts/`,
      wasmUrl: `${ASSETS}/wasm/`,
      iccUrl: `${ASSETS}/iccs/`,
    }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    if (name === "PasswordException") {
      throw new PlainError("This PDF is password-protected.", "Its pages cannot be read without the password. Open it in a viewer, print it to a new PDF, and use that.", { cause: error });
    }
    throw new PlainError("This file could not be read as a PDF.", message, { cause: error });
  }
}

export const DPI_OPTIONS: readonly { dpi: number; label: string; blurb: string }[] = [
  { dpi: 72, label: "72 dpi", blurb: "Screen size: small files, fine for a preview" },
  { dpi: 150, label: "150 dpi", blurb: "Sharp on a screen; the usual choice" },
  { dpi: 300, label: "300 dpi", blurb: "Print quality: large files" },
];

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
  /** The page's own size in points, for a page that will be rebuilt at it. */
  pointWidth: number;
  pointHeight: number;
}

/**
 * A tick that a hidden tab still gets.
 *
 * PDF.js draws a page in slices and asks for the next one through
 * `requestAnimationFrame`, which Chrome does not run for a minimized window
 * or a background tab: the render stops after the first slice and never
 * resumes, so a card sits at "Drawing page 1 of 5" until the visitor comes
 * back. A message posted to a channel is an ordinary task, not a frame and
 * not a timer, so it is delivered whether or not the page is painting and
 * without the one-second floor Chrome puts on timers in the background.
 *
 * `RenderTask.onContinue` is PDF.js's own hook for this: given one, it hands
 * over the "draw the next slice" callback instead of scheduling a frame.
 */
function nextTick(run: () => void): void {
  if (typeof MessageChannel !== "function") {
    setTimeout(run, 0);
    return;
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    channel.port2.close();
    run();
  };
  channel.port2.postMessage(null);
}

/** One page drawn at a resolution and encoded. */
export async function renderPage(document: PDFDocumentProxy, index: number, dpi: number, mime: ImageMime, quality: number | null): Promise<RenderedPage> {
  const page = await document.getPage(index + 1);
  const points = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: dpi / 72 });
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document_(), { width, height });
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (mime === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  const task = page.render({ canvasContext: context, viewport, canvas: canvas as HTMLCanvasElement });
  task.onContinue = (continueRendering: () => void) => nextTick(continueRendering);
  await task.promise;
  page.cleanup();
  const blob = await encodeCanvas(canvas, mime, quality ?? undefined);
  return { blob, width, height, pointWidth: points.width, pointHeight: points.height };
}

function document_(): HTMLCanvasElement {
  return document.createElement("canvas");
}

/**
 * The text of one page, in reading order as PDF.js gives it, with a line
 * break where the text moves down and a space where it moves along.
 */
export async function pageText(document: PDFDocumentProxy, index: number): Promise<string> {
  const page = await document.getPage(index + 1);
  const content = await page.getTextContent();
  let text = "";
  let lastY: number | null = null;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
    else if (text && !text.endsWith("\n") && !text.endsWith(" ") && item.str && !item.str.startsWith(" ")) text += " ";
    text += item.str;
    if (item.hasEOL) text += "\n";
    lastY = y;
  }
  page.cleanup();
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
