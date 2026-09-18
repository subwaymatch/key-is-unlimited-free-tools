/**
 * PDF pages through pdf-lib: merged, split, rotated, removed, numbered, and
 * pictures made into pages.
 *
 * pdf-lib is plain JavaScript under the MIT licence, which is why it is the
 * PDF library here and Ghostscript and MuPDF are not (section 2.2 of the
 * catalogue). It is pulled in on first use, so the pages that do not need
 * it never load it.
 */
import type { PDFDocument as PDFDocumentType, PDFObject as PDFObjectType, PDFPage as PDFPageType } from "pdf-lib";

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

/**
 * Everything a document can say about itself in one line: "12 pages, A4".
 *
 * A document whose pages are not all the same size says so and names them,
 * rather than describing the whole file by whatever its first page happens
 * to be: a file of A4 landscape, A4 and tabloid is not "3 pages, A4
 * landscape".
 */
export function describePdf(document: PDFDocumentType): string {
  const count = document.getPageCount();
  const pages = `${count} ${count === 1 ? "page" : "pages"}`;
  const sizes: string[] = [];
  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    const size = describePageSize(width, height);
    if (!sizes.includes(size)) sizes.push(size);
  }
  if (sizes.length === 1) return `${pages}, ${sizes[0]}`;
  const named = sizes.slice(0, 3).join(", ");
  return `${pages}, mixed sizes: ${sizes.length > 3 ? `${named} and ${sizes.length - 3} more` : named}`;
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
  if (Math.abs(short - 216) <= 2 && Math.abs(long - 356) <= 2) return `Legal${orientation}`;
  if (Math.abs(short - 279) <= 2 && Math.abs(long - 432) <= 2) return `Tabloid${orientation}`;
  return `${mm(widthPoints)} x ${mm(heightPoints)} mm`;
}

/**
 * One document from several, in order, keeping the first one's metadata.
 *
 * Every other PDF tool here hands back a file that still says who wrote it
 * and what it is called; a merge that quietly replaced the title and author
 * with pdf-lib's own producer line was the odd one out. The first file is
 * the one the merged document is named after everywhere else on the card,
 * so it is the one whose metadata carries over.
 */
export async function mergePdfs(sources: readonly Uint8Array[], report?: (index: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const merged = await PDFDocument.create();
  for (const [index, bytes] of sources.entries()) {
    report?.(index);
    const source = await loadPdf(bytes);
    if (index === 0) copyMetadata(source, merged);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}

/** The Info fields one document states, written onto another. */
function copyMetadata(from: PDFDocumentType, to: PDFDocumentType): void {
  const title = from.getTitle();
  const author = from.getAuthor();
  const subject = from.getSubject();
  const keywords = from.getKeywords();
  const creator = from.getCreator();
  const producer = from.getProducer();
  const created = from.getCreationDate();
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
  if (subject) to.setSubject(subject);
  // getKeywords gives back the one string the file stores; setKeywords wants the words.
  if (keywords) to.setKeywords(keywords.split(/[,;]+/).map((word) => word.trim()).filter(Boolean));
  if (creator) to.setCreator(creator);
  if (producer) to.setProducer(producer);
  if (created && !Number.isNaN(created.getTime())) to.setCreationDate(created);
}

/** A new document of these pages, 0-based, in this order; a page named twice comes out twice. */
export async function pagesInOrder(source: PDFDocumentType, indices: readonly number[]): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  copyMetadata(source, out);
  const pages = await out.copyPages(source, [...indices]);
  for (const page of pages) out.addPage(page);
  return out.save();
}

/** A new document of the pages a range list names, in that order. */
export async function extractPages(source: PDFDocumentType, ranges: readonly PageRange[]): Promise<Uint8Array> {
  return pagesInOrder(source, pageIndices(ranges));
}

/** The 0-based indices of every page, last first. */
export function reversedOrder(count: number): number[] {
  return Array.from({ length: count }, (_, index) => count - 1 - index);
}

/**
 * The order typed, then every page not named, in its own order.
 *
 * "3, 1" on a five-page document is pages 3, 1, 2, 4, 5: the typed pages
 * move to the front and nothing is lost, which is what moving a page means.
 */
export function typedOrder(count: number, typed: readonly number[]): { order: number[]; appended: number } {
  const order: number[] = [];
  const seen = new Set<number>();
  for (const index of typed) {
    if (index < 0 || index >= count || seen.has(index)) continue;
    seen.add(index);
    order.push(index);
  }
  let appended = 0;
  for (let index = 0; index < count; index += 1) {
    if (seen.has(index)) continue;
    order.push(index);
    appended += 1;
  }
  return { order, appended };
}

/** Whether an order is the one the document already has. */
export function isIdentityOrder(order: readonly number[]): boolean {
  return order.every((index, position) => index === position);
}

/* ---- Forms and annotations ---------------------------------------------- */

export interface FormSummary {
  fields: number;
  /** "text field", "check box" and so on, with how many of each. */
  kinds: { kind: string; count: number }[];
  /** Every annotation on every page: widgets, links, comments, stamps. */
  annotations: number;
}

/** What a document carries that flattening would bake in or take out. */
export async function describeForm(source: PDFDocumentType): Promise<FormSummary> {
  const lib = await pdfLib();
  const counts = new Map<string, number>();
  let fields = 0;
  try {
    for (const field of source.getForm().getFields()) {
      fields += 1;
      const kind =
        field instanceof lib.PDFTextField ? "text field"
        : field instanceof lib.PDFCheckBox ? "check box"
        : field instanceof lib.PDFRadioGroup ? "radio group"
        : field instanceof lib.PDFDropdown ? "dropdown"
        : field instanceof lib.PDFOptionList ? "option list"
        : field instanceof lib.PDFButton ? "button"
        : field instanceof lib.PDFSignature ? "signature"
        : "field";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  } catch {
    // A form dictionary pdf-lib cannot read: there are no fields it can flatten.
  }
  let annotations = 0;
  for (const page of source.getPages()) annotations += liveAnnotations(source, page).length;
  return { fields, kinds: [...counts.entries()].map(([kind, count]) => ({ kind, count })), annotations };
}

/**
 * The entries of a page's annotation array that still point at something.
 *
 * pdf-lib's flatten deletes a widget's object but can leave its reference in
 * the page's array, which viewers skip over and a count would not.
 */
function liveAnnotations(source: PDFDocumentType, page: PDFPageType): PDFObjectType[] {
  const annots = page.node.Annots();
  if (!annots) return [];
  const live: PDFObjectType[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const entry = annots.get(index);
    if (source.context.lookup(entry) !== undefined) live.push(entry);
  }
  return live;
}

export interface FlattenSettings {
  /** Draw every form field's value into its page and remove the field. */
  fields: boolean;
  /** Remove every annotation left: links, comments, stamps, and any field not flattened. */
  annotations: boolean;
}

/** The document with its fields baked in and its annotations gone, as asked. */
export async function flattenPdf(source: PDFDocumentType, settings: FlattenSettings): Promise<Uint8Array> {
  const { PDFName } = await pdfLib();
  if (settings.fields) {
    try {
      source.getForm().flatten();
    } catch (error) {
      throw new PlainError(
        "This form could not be flattened.",
        `pdf-lib gave up on one of its fields: ${error instanceof Error ? error.message : String(error)}. Removing the annotations instead takes the fields out without drawing their values.`,
        { cause: error },
      );
    }
  }
  if (settings.annotations) {
    for (const page of source.getPages()) page.node.delete(PDFName.of("Annots"));
    source.catalog.delete(PDFName.of("AcroForm"));
  } else if (settings.fields) {
    // What flattening deleted is still named in the page arrays; write them without it.
    const { PDFArray } = await pdfLib();
    for (const page of source.getPages()) {
      const live = liveAnnotations(source, page);
      if (live.length === 0) page.node.delete(PDFName.of("Annots"));
      else if (live.length !== page.node.Annots()?.size()) {
        const array = PDFArray.withContext(source.context);
        for (const entry of live) array.push(entry);
        page.node.set(PDFName.of("Annots"), array);
      }
    }
  }
  return source.save();
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

/* ---- A text stamp ------------------------------------------------------- */

export type StampLayout = "diagonal" | "center" | "bottom";

export interface StampSettings {
  text: string;
  layout: StampLayout;
  /** 0.05 to 1. */
  opacity: number;
  fontSize: number;
}

export const DEFAULT_STAMP_SETTINGS: StampSettings = { text: "CONFIDENTIAL", layout: "diagonal", opacity: 0.25, fontSize: 60 };

/** Where the stamp goes on a page, and how it is turned. */
export function stampPlacement(page: { width: number; height: number }, textWidth: number, fontSize: number, layout: StampLayout): { x: number; y: number; degrees: number } {
  if (layout === "bottom") return { x: (page.width - textWidth) / 2, y: 36, degrees: 0 };
  if (layout === "center") return { x: (page.width - textWidth) / 2, y: (page.height - fontSize) / 2, degrees: 0 };
  // Diagonal, corner to corner: turned so it climbs, and shifted so its middle sits on the page's.
  const angle = Math.atan2(page.height, page.width);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: page.width / 2 - (textWidth / 2) * cos + (fontSize / 2) * sin,
    y: page.height / 2 - (textWidth / 2) * sin - (fontSize / 2) * cos,
    degrees: (angle * 180) / Math.PI,
  };
}

/** The text drawn over every page, grey and translucent. */
export async function stampPages(source: PDFDocumentType, settings: StampSettings): Promise<Uint8Array> {
  const { StandardFonts, rgb, degrees } = await pdfLib();
  const font = await source.embedFont(StandardFonts.HelveticaBold);
  const text = settings.text.trim();
  for (const page of source.getPages()) {
    const { width, height } = page.getSize();
    // Fit the text on the page's diagonal, or its width, whatever the size asked for.
    const room = settings.layout === "diagonal" ? Math.hypot(width, height) * 0.8 : width * 0.9;
    let size = settings.fontSize;
    let textWidth = font.widthOfTextAtSize(text, size);
    if (textWidth > room) {
      size = Math.max(8, (size * room) / textWidth);
      textWidth = font.widthOfTextAtSize(text, size);
    }
    const placed = stampPlacement({ width, height }, textWidth, size, settings.layout);
    page.drawText(text, { x: placed.x, y: placed.y, size, font, color: rgb(0.45, 0.45, 0.45), opacity: settings.opacity, rotate: degrees(placed.degrees) });
  }
  return source.save();
}

/* ---- Metadata ----------------------------------------------------------- */

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  created: string;
  modified: string;
  /** True when the file also carries an XMP metadata stream. */
  hasXmp: boolean;
}

/** What the document says about itself. */
export function readMetadata(document: PDFDocumentType): PdfMetadata {
  const { PDFName } = { PDFName: pdfNameSync() };
  const date = (value: Date | undefined) => (value && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 16).replace("T", " ") : "");
  return {
    title: document.getTitle() ?? "",
    author: document.getAuthor() ?? "",
    subject: document.getSubject() ?? "",
    keywords: document.getKeywords() ?? "",
    creator: document.getCreator() ?? "",
    producer: document.getProducer() ?? "",
    created: date(document.getCreationDate()),
    modified: date(document.getModificationDate()),
    hasXmp: PDFName !== null && document.catalog.has(PDFName.of("Metadata")),
  };
}

let pdfNameClass: PdfLib["PDFName"] | null = null;

/** pdf-lib's PDFName, once the library is loaded; the loaders below load it first. */
function pdfNameSync(): PdfLib["PDFName"] | null {
  return pdfNameClass;
}

/** Loads the library, so readMetadata can name the XMP entry without an await of its own. */
export async function loadPdfForMetadata(bytes: Uint8Array): Promise<PDFDocumentType> {
  const lib = await pdfLib();
  pdfNameClass = lib.PDFName;
  return loadPdf(bytes);
}

export interface MetadataEdits {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

/** The fields of the panel that were filled in. */
export function countEdits(edits: MetadataEdits): number {
  return (Object.keys(edits) as (keyof MetadataEdits)[]).filter((field) => edits[field].trim() !== "").length;
}

/**
 * The document with its metadata cleared, and then any of these written:
 * the Info dictionary emptied of every key and the XMP stream dropped, so
 * nothing about who made it or when survives; then the title, author,
 * subject and keywords typed, if any.
 */
export async function rewriteMetadata(source: PDFDocumentType, edits: MetadataEdits | null, clear: boolean): Promise<Uint8Array> {
  const { PDFName, PDFDict } = await pdfLib();
  if (clear) {
    const info = source.context.lookup(source.context.trailerInfo.Info);
    if (info instanceof PDFDict) {
      for (const key of [...info.keys()]) info.delete(key);
    }
    source.catalog.delete(PDFName.of("Metadata"));
  }
  if (edits) {
    if (edits.title.trim()) source.setTitle(edits.title.trim());
    if (edits.author.trim()) source.setAuthor(edits.author.trim());
    if (edits.subject.trim()) source.setSubject(edits.subject.trim());
    if (edits.keywords.trim()) source.setKeywords(edits.keywords.split(/[,;]+/).map((word) => word.trim()).filter(Boolean));
  }
  return source.save({ updateFieldAppearances: false });
}

/* ---- Pages from pictures of pages --------------------------------------- */

export interface RenderedPageImage {
  bytes: Uint8Array;
  /** The page's own size in points, kept so the document stays the size it was. */
  pointWidth: number;
  pointHeight: number;
}

/** A document whose every page is a JPEG of the page it replaces, at its own size. */
export async function rebuildFromImages(pages: readonly RenderedPageImage[], report?: (index: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  for (const [index, image] of pages.entries()) {
    report?.(index);
    const embedded = await out.embedJpg(image.bytes);
    const page = out.addPage([image.pointWidth, image.pointHeight]);
    page.drawImage(embedded, { x: 0, y: 0, width: image.pointWidth, height: image.pointHeight });
  }
  return out.save();
}
