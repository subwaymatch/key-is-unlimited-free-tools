/**
 * Several pages on each sheet: two or four side by side, or the pairs a
 * booklet needs so the sheets fold into a book.
 *
 * A booklet is printed on both sides and folded down the middle, so the
 * pages on a sheet are not neighbours: the first sheet's front carries the
 * last page and the first, its back the second and the second-to-last, and
 * so on inward. The page count is rounded up to a multiple of four with
 * blank cells, since a sheet has four page faces.
 *
 * The arithmetic is pure and tested; the drawing goes through pdf-lib.
 */
import type { PDFDocument as PDFDocumentType, PDFEmbeddedPage } from "pdf-lib";

import { PlainError } from "../plainQueue";

export type ImposeLayout = "2up" | "4up" | "booklet";
export type SheetChoice = "double" | "a4" | "letter";

export interface ImposeSettings {
  layout: ImposeLayout;
  sheet: SheetChoice;
}

export const LAYOUT_OPTIONS: readonly { id: ImposeLayout; label: string; blurb: string }[] = [
  { id: "2up", label: "Two per sheet", blurb: "Pages 1 and 2 side by side, then 3 and 4: half the paper" },
  { id: "4up", label: "Four per sheet", blurb: "A 2 x 2 grid of pages: handouts, slides, thumbnails" },
  { id: "booklet", label: "Booklet", blurb: "Paired so that double-sided sheets fold in half into a book" },
];

export const SHEET_OPTIONS: readonly { id: SheetChoice; label: string; blurb: string }[] = [
  { id: "double", label: "The pages' own size", blurb: "Nothing is scaled: two A4 pages make an A3 sheet. Let the printer fit it" },
  { id: "a4", label: "A4", blurb: "Pages scaled down to fit an A4 sheet" },
  { id: "letter", label: "Letter", blurb: "Pages scaled down to fit a Letter sheet" },
];

const SHEET_SIZES: Record<Exclude<SheetChoice, "double">, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };

/** The page indices on each side of a booklet's sheets, outermost pair first; null is a blank. */
export function bookletSides(count: number): (number | null)[][] {
  const padded = Math.max(4, Math.ceil(count / 4) * 4);
  const page = (index: number) => (index < count ? index : null);
  const sides: (number | null)[][] = [];
  for (let k = 0; k < padded / 2; k += 1) {
    const outer = padded - 1 - k;
    sides.push(k % 2 === 0 ? [page(outer), page(k)] : [page(k), page(outer)]);
  }
  return sides;
}

/** The page indices on each sheet in reading order, the last sheet padded with blanks. */
export function sequentialSides(count: number, perSheet: number): (number | null)[][] {
  const sides: (number | null)[][] = [];
  for (let start = 0; start < Math.max(count, 1); start += perSheet) {
    const side: (number | null)[] = [];
    for (let cell = 0; cell < perSheet; cell += 1) side.push(start + cell < count ? start + cell : null);
    sides.push(side);
  }
  return sides;
}

export interface PageFace {
  width: number;
  height: number;
  /** The page's own rotation, 0, 90, 180 or 270, which its viewer applies. */
  rotation: number;
}

export interface Draw {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees counter-clockwise for the draw, undoing the page's own rotation. */
  rotate: number;
}

export interface Sheet {
  width: number;
  height: number;
  draws: Draw[];
}

export interface ImposePlan {
  sheets: Sheet[];
  columns: number;
  rows: number;
  /** True when some page was scaled down to fit its cell. */
  scaled: boolean;
}

function grid(layout: ImposeLayout): { columns: number; rows: number } {
  return layout === "4up" ? { columns: 2, rows: 2 } : { columns: 2, rows: 1 };
}

/** The size a page shows at: its width and height swapped when it is turned a quarter. */
export function shownSize(face: PageFace): { width: number; height: number } {
  const quarter = face.rotation === 90 || face.rotation === 270;
  return quarter ? { width: face.height, height: face.width } : { width: face.width, height: face.height };
}

/** Every sheet, with where each page lands on it. */
export function imposePlan(faces: readonly PageFace[], settings: ImposeSettings): ImposePlan {
  const { columns, rows } = grid(settings.layout);
  const shown = faces.map(shownSize);
  const widest = Math.max(1, ...shown.map((size) => size.width));
  const tallest = Math.max(1, ...shown.map((size) => size.height));
  let sheetWidth: number;
  let sheetHeight: number;
  if (settings.sheet === "double") {
    sheetWidth = columns * widest;
    sheetHeight = rows * tallest;
  } else {
    const [short, long] = SHEET_SIZES[settings.sheet];
    // Two cells side by side want a landscape sheet; a 2 x 2 grid wants whichever way the pages go.
    const landscape = columns > rows || (columns === rows && widest > tallest);
    [sheetWidth, sheetHeight] = landscape ? [long, short] : [short, long];
  }
  const cellWidth = sheetWidth / columns;
  const cellHeight = sheetHeight / rows;
  const sides = settings.layout === "booklet" ? bookletSides(faces.length) : sequentialSides(faces.length, columns * rows);
  let scaled = false;
  const sheets = sides.map((side) => {
    const draws: Draw[] = [];
    side.forEach((page, cell) => {
      if (page === null) return;
      const face = faces[page];
      const size = shown[page];
      const column = cell % columns;
      const row = Math.floor(cell / columns);
      const scale = Math.min(1, cellWidth / size.width, cellHeight / size.height);
      if (scale < 1) scaled = true;
      const width = size.width * scale;
      const height = size.height * scale;
      const left = column * cellWidth + (cellWidth - width) / 2;
      const bottom = sheetHeight - (row + 1) * cellHeight + (cellHeight - height) / 2;
      draws.push(drawInBox(page, face, scale, left, bottom, width, height));
    });
    return { width: sheetWidth, height: sheetHeight, draws };
  });
  return { sheets, columns, rows, scaled };
}

/**
 * The draw call that puts a page's content, turned the way its viewer
 * shows it, into the box from (left, bottom) of the shown width and
 * height. pdf-lib draws an embedded page by translating to (x, y), then
 * rotating counter-clockwise, then scaling, so a page stored with a
 * clockwise quarter turn is drawn rotated by -90 from the box's top-left
 * corner, and so on round. The page-resize tool draws with it too.
 */
export function drawInBox(page: number, face: PageFace, scale: number, left: number, bottom: number, width: number, height: number): Draw {
  const drawWidth = face.width * scale;
  const drawHeight = face.height * scale;
  switch (face.rotation) {
    case 90:
      return { page, x: left, y: bottom + height, width: drawWidth, height: drawHeight, rotate: -90 };
    case 180:
      return { page, x: left + width, y: bottom + height, width: drawWidth, height: drawHeight, rotate: 180 };
    case 270:
      return { page, x: left + width, y: bottom, width: drawWidth, height: drawHeight, rotate: 90 };
    default:
      return { page, x: left, y: bottom, width: drawWidth, height: drawHeight, rotate: 0 };
  }
}

/** A page's rotation as 0, 90, 180 or 270 clockwise. */
export function normalRotation(degrees: number): number {
  return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}

/** The document with its pages laid onto sheets as the plan says. */
export async function imposePdf(source: PDFDocumentType, settings: ImposeSettings, report?: (index: number, count: number) => void): Promise<{ bytes: Uint8Array; plan: ImposePlan }> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const pages = source.getPages();
  const faces: PageFace[] = pages.map((page) => {
    const { width, height } = page.getSize();
    return { width, height, rotation: normalRotation(page.getRotation().angle) };
  });
  const plan = imposePlan(faces, settings);
  const out = await PDFDocument.create();
  // A page with no content stream is blank, and pdf-lib cannot embed one; its cell is left blank.
  const embedded = new Map<number, PDFEmbeddedPage>();
  try {
    for (const [index, page] of pages.entries()) {
      if (page.node.Contents()) embedded.set(index, await out.embedPage(page));
    }
  } catch (error) {
    throw new PlainError("These pages could not be copied onto sheets.", error instanceof Error ? error.message : undefined, { cause: error });
  }
  for (const [index, sheet] of plan.sheets.entries()) {
    report?.(index, plan.sheets.length);
    const page = out.addPage([sheet.width, sheet.height]);
    for (const draw of sheet.draws) {
      const source_ = embedded.get(draw.page);
      if (source_) page.drawPage(source_, { x: draw.x, y: draw.y, width: draw.width, height: draw.height, rotate: degrees(draw.rotate) });
    }
  }
  return { bytes: await out.save(), plan };
}
