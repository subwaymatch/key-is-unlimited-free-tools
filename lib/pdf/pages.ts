/**
 * PDF pages through pdf-lib: merged, split, rotated, removed, numbered, and
 * pictures made into pages.
 *
 * pdf-lib is plain JavaScript under the MIT licence, which is why it is the
 * PDF library here and Ghostscript and MuPDF are not (section 2.2 of the
 * catalogue). It is pulled in on first use, so the pages that do not need
 * it never load it.
 */
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

import { PlainError } from "../plainQueue";
import { describeRange, pageIndices, type PageRange } from "./ranges";

type PdfLib = typeof import("pdf-lib");

let library: Promise<PdfLib> | null = null;

function pdfLib(): Promise<PdfLib> {
  library ??= import("pdf-lib");
  return library;
}

/** A PDF opened for reading, with the reason it could not be if it could not. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentType> {
  const { PDFDocument } = await pdfLib();
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypted/i.test(message)) {
      throw new PlainError(
        "This PDF is password-protected.",
        "Its pages cannot be read without the password. Open it in a viewer, print it to a new PDF, and use that.",
        { cause: error },
      );
    }
    throw new PlainError("This file could not be read as a PDF.", message, { cause: error });
  }
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount();
}

/** Everything a document can say about itself in one line: "12 pages, A4". */
export function describePdf(document: PDFDocumentType): string {
  const count = document.getPageCount();
  const first = document.getPage(0);
  const { width, height } = first.getSize();
  return `${count} ${count === 1 ? "page" : "pages"}, ${describePageSize(width, height)}`;
}

/** "A4", "Letter", "210 x 297 mm": the size of a page in words. */
export function describePageSize(widthPoints: number, heightPoints: number): string {
  const mm = (points: number) => Math.round(points / 72 * 25.4);
  const [short, long] = [Math.min(widthPoints, heightPoints), Math.max(widthPoints, heightPoints)].map(mm);
  const orientation = widthPoints > heightPoints ? " landscape" : "";
  if (Math.abs(short - 210) <= 2 && Math.abs(long - 297) <= 2) return `A4${orientation}`;
  if (Math.abs(short - 216) <= 2 && Math.abs(long - 279) <= 2) return `Letter${orientation}`;
  if (Math.abs(short - 148) <= 2 && Math.abs(long - 210) <= 2) return `A5${orientation}`;
  if (Math.abs(short - 297) <= 2 && Math.abs(long - 420) <= 2) return `A3${orientation}`;
  return `${mm(widthPoints)} x ${mm(heightPoints)} mm`;
}

/** One document from several, in order. */
export async function mergePdfs(sources: readonly Uint8Array[], report?: (index: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const merged = await PDFDocument.create();
  for (const [index, bytes] of sources.entries()) {
    report?.(index);
    const source = await loadPdf(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}

/** A new document of the pages a range list names, in that order. */
export async function extractPages(source: PDFDocumentType, ranges: readonly PageRange[]): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, pageIndices(ranges));
  for (const page of pages) out.addPage(page);
  return out.save();
}

/** One document per range. */
export async function splitPdf(source: PDFDocumentType, ranges: readonly PageRange[], report?: (index: number) => void): Promise<{ range: PageRange; label: string; bytes: Uint8Array }[]> {
  const pieces: { range: PageRange; label: string; bytes: Uint8Array }[] = [];
  for (const [index, range] of ranges.entries()) {
    report?.(index);
    pieces.push({ range, label: describeRange(range), bytes: await extractPages(source, [range]) });
  }
  return pieces;
}

/** The document with some or all of its pages turned, by a quarter, a half or three quarters clockwise. */
export async function rotatePages(source: PDFDocumentType, clockwiseDegrees: 90 | 180 | 270, indices: readonly number[] | null): Promise<Uint8Array> {
  const { degrees } = await pdfLib();
  const wanted = indices ?? source.getPageIndices();
  for (const index of wanted) {
    const page = source.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + clockwiseDegrees) % 360));
  }
  return source.save();
}

/** The document without these pages. */
export async function removePages(source: PDFDocumentType, indices: readonly number[]): Promise<Uint8Array> {
  const drop = [...new Set(indices)].sort((a, b) => b - a);
  if (drop.length >= source.getPageCount()) {
    throw new PlainError("That would remove every page.", "Leave at least one page out of the list.");
  }
  for (const index of drop) source.removePage(index);
  return source.save();
}

export type NumberPosition = "bottom-center" | "bottom-right" | "bottom-left" | "top-center" | "top-right";

export interface PageNumberSettings {
  position: NumberPosition;
  /** "3" or "3 of 12". */
  ofTotal: boolean;
  fontSize: number;
  /** The number the first page gets. */
  startAt: number;
}

export const DEFAULT_PAGE_NUMBER_SETTINGS: PageNumberSettings = { position: "bottom-center", ofTotal: false, fontSize: 11, startAt: 1 };

/** The text for one page. */
export function pageNumberText(index: number, count: number, settings: PageNumberSettings): string {
  const number = settings.startAt + index;
  return settings.ofTotal ? `${number} of ${settings.startAt + count - 1}` : String(number);
}

/** Every page numbered in Helvetica, at the position asked for. */
export async function addPageNumbers(source: PDFDocumentType, settings: PageNumberSettings): Promise<Uint8Array> {
  const { StandardFonts, rgb } = await pdfLib();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const count = source.getPageCount();
  const margin = 28;
  for (const [index, page] of source.getPages().entries()) {
    const text = pageNumberText(index, count, settings);
    const width = font.widthOfTextAtSize(text, settings.fontSize);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const x = settings.position.endsWith("center") ? (pageWidth - width) / 2 : settings.position.endsWith("right") ? pageWidth - margin - width : margin;
    const y = settings.position.startsWith("top") ? pageHeight - margin : margin - settings.fontSize / 2;
    page.drawText(text, { x, y, size: settings.fontSize, font, color: rgb(0.15, 0.15, 0.15) });
  }
  return source.save();
}

export type PageSizeChoice = "fit" | "a4" | "letter";

export interface ImagePage {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

export interface ImagesToPdfSettings {
  page: PageSizeChoice;
  /** Points of white around the picture on a fixed page size. */
  margin: number;
}

export const DEFAULT_IMAGES_TO_PDF_SETTINGS: ImagesToPdfSettings = { page: "a4", margin: 36 };

const PAGE_SIZES: Record<Exclude<PageSizeChoice, "fit">, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };

/**
 * Where a picture goes on its page: a fixed page turned to suit the picture
 * with the picture fitted inside the margins, or a page the picture's own
 * size at 72 points an inch.
 */
export function placeImage(image: { width: number; height: number }, settings: ImagesToPdfSettings): { page: [number, number]; x: number; y: number; width: number; height: number } {
  if (settings.page === "fit") return { page: [image.width, image.height], x: 0, y: 0, width: image.width, height: image.height };
  const [short, long] = PAGE_SIZES[settings.page];
  const landscape = image.width > image.height;
  const page: [number, number] = landscape ? [long, short] : [short, long];
  const box = { width: page[0] - settings.margin * 2, height: page[1] - settings.margin * 2 };
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { page, x: (page[0] - width) / 2, y: (page[1] - height) / 2, width, height };
}

/** One PDF with a page per picture. */
export async function imagesToPdf(images: readonly ImagePage[], settings: ImagesToPdfSettings, report?: (index: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  for (const [index, image] of images.entries()) {
    report?.(index);
    const embedded = image.mime === "image/png" ? await out.embedPng(image.bytes) : await out.embedJpg(image.bytes);
    const placed = placeImage(image, settings);
    const page = out.addPage(placed.page);
    page.drawImage(embedded, { x: placed.x, y: placed.y, width: placed.width, height: placed.height });
  }
  return out.save();
}
