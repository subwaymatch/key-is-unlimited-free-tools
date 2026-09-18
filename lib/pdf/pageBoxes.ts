/**
 * Pages made another size, and pages cropped: every page fitted onto a
 * named paper size, and margins taken off by a measurement or down to
 * where the content stops.
 *
 * Cropping sets the page's boxes rather than redrawing anything, which is
 * what a viewer's own crop does: the content is still in the file, and
 * the page shows the part inside the box. The arithmetic is pure and
 * tested; the writing goes through pdf-lib.
 */
import type { PDFDocument as PDFDocumentType, PDFEmbeddedPage } from "pdf-lib";

import { PlainError } from "../plainQueue";
import { drawInBox, normalRotation, shownSize, type Draw, type PageFace } from "./impose";

/* ---- Resizing ----------------------------------------------------------- */

export type PaperSize = "a4" | "letter" | "a5" | "a3" | "legal" | "tabloid";

export const PAPER_SIZES: readonly { id: PaperSize; label: string; blurb: string; size: [number, number] }[] = [
  { id: "a4", label: "A4", blurb: "210 x 297 mm: most of the world", size: [595.28, 841.89] },
  { id: "letter", label: "Letter", blurb: "8.5 x 11 in: North America", size: [612, 792] },
  { id: "a5", label: "A5", blurb: "Half of A4: a small booklet, an e-reader", size: [419.53, 595.28] },
  { id: "a3", label: "A3", blurb: "Twice A4: a poster, a plan", size: [841.89, 1190.55] },
  { id: "legal", label: "Legal", blurb: "8.5 x 14 in", size: [612, 1008] },
  { id: "tabloid", label: "Tabloid", blurb: "11 x 17 in: twice Letter", size: [792, 1224] },
];

export type Orientation = "auto" | "portrait" | "landscape";

export const ORIENTATION_OPTIONS: readonly { id: Orientation; label: string; blurb: string }[] = [
  { id: "auto", label: "As each page", blurb: "Landscape pages on landscape paper, portrait on portrait" },
  { id: "portrait", label: "Portrait", blurb: "Every page on upright paper" },
  { id: "landscape", label: "Landscape", blurb: "Every page on paper turned sideways" },
];

export interface ResizeSettings {
  paper: PaperSize;
  orientation: Orientation;
  /** Scale small pages up to fill the paper, as well as large ones down. */
  enlarge: boolean;
  /** Points of paper left clear around the page. */
  margin: number;
}

export interface ResizedPage {
  width: number;
  height: number;
  draw: Draw;
  /** The scale the page was drawn at, 1 for none. */
  scale: number;
}

export interface ResizePlan {
  pages: ResizedPage[];
  scaledUp: number;
  scaledDown: number;
}

/** Every page on its sheet, scaled to fit inside the margins and centred. */
export function resizePlan(faces: readonly PageFace[], settings: ResizeSettings): ResizePlan {
  const paper = PAPER_SIZES.find((entry) => entry.id === settings.paper) ?? PAPER_SIZES[0];
  const [short, long] = paper.size;
  let scaledUp = 0;
  let scaledDown = 0;
  const pages = faces.map((face, index) => {
    const shown = shownSize(face);
    const landscape = settings.orientation === "landscape" || (settings.orientation === "auto" && shown.width > shown.height);
    const [width, height] = landscape ? [long, short] : [short, long];
    const box = { width: Math.max(1, width - settings.margin * 2), height: Math.max(1, height - settings.margin * 2) };
    let scale = Math.min(box.width / shown.width, box.height / shown.height);
    if (!settings.enlarge) scale = Math.min(1, scale);
    if (scale > 1.0001) scaledUp += 1;
    else if (scale < 0.9999) scaledDown += 1;
    const drawWidth = shown.width * scale;
    const drawHeight = shown.height * scale;
    const left = (width - drawWidth) / 2;
    const bottom = (height - drawHeight) / 2;
    return { width, height, scale, draw: drawInBox(index, face, scale, left, bottom, drawWidth, drawHeight) };
  });
  return { pages, scaledUp, scaledDown };
}

/** The faces of a document's pages: size and rotation. */
export function pageFaces(source: PDFDocumentType): PageFace[] {
  return source.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height, rotation: normalRotation(page.getRotation().angle) };
  });
}

/** A new document with every page drawn onto paper of the size asked. */
export async function resizePdfPages(source: PDFDocumentType, settings: ResizeSettings, report?: (index: number, count: number) => void): Promise<{ bytes: Uint8Array; plan: ResizePlan }> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const pages = source.getPages();
  const plan = resizePlan(pageFaces(source), settings);
  const out = await PDFDocument.create();
  for (const [index, page] of pages.entries()) {
    report?.(index, pages.length);
    const target = plan.pages[index];
    const sheet = out.addPage([target.width, target.height]);
    // A page with no content stream is blank, and pdf-lib cannot embed one; its sheet stays blank.
    if (!page.node.Contents()) continue;
    let embedded: PDFEmbeddedPage;
    try {
      embedded = await out.embedPage(page);
    } catch (error) {
      throw new PlainError("These pages could not be copied onto new paper.", error instanceof Error ? error.message : undefined, { cause: error });
    }
    const { draw } = target;
    sheet.drawPage(embedded, { x: draw.x, y: draw.y, width: draw.width, height: draw.height, rotate: degrees(draw.rotate) });
  }
  return { bytes: await out.save(), plan };
}

/* ---- Cropping ----------------------------------------------------------- */

/** Points taken off each edge of the page as it is shown. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const POINTS_PER_MM = 72 / 25.4;

/**
 * The insets as the page stores them, given that its viewer turns it.
 *
 * A page stored with a clockwise quarter turn shows its left edge at the
 * top, so what is taken off the top of the shown page comes off the left
 * of the stored one, and so on round.
 */
export function unrotatedInsets(insets: Insets, rotation: number): Insets {
  switch (normalRotation(rotation)) {
    case 90:
      return { top: insets.right, right: insets.bottom, bottom: insets.left, left: insets.top };
    case 180:
      return { top: insets.bottom, right: insets.left, bottom: insets.top, left: insets.right };
    case 270:
      return { top: insets.left, right: insets.top, bottom: insets.right, left: insets.bottom };
    default:
      return { ...insets };
  }
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The least a page may be cropped to, so a mistyped margin cannot make it vanish. */
const MIN_BOX = 18;

/** The box inset from another, never smaller than a postage stamp. */
export function insetBox(box: Box, insets: Insets): Box {
  const width = Math.max(MIN_BOX, box.width - insets.left - insets.right);
  const height = Math.max(MIN_BOX, box.height - insets.top - insets.bottom);
  const x = Math.min(box.x + insets.left, box.x + box.width - width);
  const y = Math.min(box.y + insets.bottom, box.y + box.height - height);
  return { x, y, width, height };
}

/**
 * The insets that trim a shown page to the bounds of its content, from a
 * rendering of it: the bounds are in rendered pixels of the shown page,
 * so they divide by the scale into points, with a little kept around.
 */
export function insetsFromBounds(bounds: { left: number; top: number; right: number; bottom: number }, rendered: { width: number; height: number; scale: number }, keepPoints: number): Insets {
  const keep = keepPoints * rendered.scale;
  return {
    top: Math.max(0, bounds.top - keep) / rendered.scale,
    left: Math.max(0, bounds.left - keep) / rendered.scale,
    right: Math.max(0, rendered.width - bounds.right - keep) / rendered.scale,
    bottom: Math.max(0, rendered.height - bounds.bottom - keep) / rendered.scale,
  };
}

/** The document with each page's boxes set to the inset given for it, in shown terms. */
export async function cropPdfPages(source: PDFDocumentType, insetsFor: (index: number) => Insets | null): Promise<{ bytes: Uint8Array; cropped: number }> {
  let cropped = 0;
  for (const [index, page] of source.getPages().entries()) {
    const shown = insetsFor(index);
    if (!shown) continue;
    const stored = unrotatedInsets(shown, page.getRotation().angle);
    const box = insetBox(page.getCropBox(), stored);
    page.setCropBox(box.x, box.y, box.width, box.height);
    page.setMediaBox(box.x, box.y, box.width, box.height);
    page.setBleedBox(box.x, box.y, box.width, box.height);
    page.setTrimBox(box.x, box.y, box.width, box.height);
    cropped += 1;
  }
  return { bytes: await source.save(), cropped };
}
