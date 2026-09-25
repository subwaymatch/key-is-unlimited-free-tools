/**
 * Passport and visa photos laid out for printing: one photo cut to a
 * country's size and repeated across a 4x6 in print, an A4 sheet or a
 * Letter sheet at 300 dpi, with lines to cut along.
 *
 * A 4x6 print costs a few pennies at a pharmacy kiosk and holds six or
 * eight passport photos, against several pounds or dollars for a photo
 * booth. The arithmetic - how many fit, where each goes - is pure and
 * tested; the drawing needs a canvas.
 */
import { drawCrop, type CropRect } from "./edit";
import type { DecodedImage, Size } from "./canvas";

export interface PhotoSpec {
  id: string;
  label: string;
  blurb: string;
  /** In millimetres. */
  width: number;
  height: number;
}

export const PHOTO_SPECS: readonly PhotoSpec[] = [
  { id: "35x45", label: "35 x 45 mm", blurb: "UK, EU, Schengen visas, Australia, New Zealand, Japan and most of the world", width: 35, height: 45 },
  { id: "2x2in", label: "2 x 2 in", blurb: "US passports and visas, India OCI", width: 50.8, height: 50.8 },
  { id: "50x70", label: "50 x 70 mm", blurb: "Canadian passports", width: 50, height: 70 },
  { id: "33x48", label: "33 x 48 mm", blurb: "Chinese visas", width: 33, height: 48 },
];

export interface SheetSpec {
  id: string;
  label: string;
  blurb: string;
  /** In millimetres, portrait. */
  width: number;
  height: number;
  /** The least margin photos butted together may leave: none on a photo print, a printer's reach on paper. */
  tightMargin: number;
}

export const SHEET_SPECS: readonly SheetSpec[] = [
  { id: "4x6", label: "4 x 6 in print", blurb: "10 x 15 cm: a photo print from a kiosk or an online print shop", width: 101.6, height: 152.4, tightMargin: 0 },
  { id: "a4", label: "A4 paper", blurb: "Printed at home, at 100% scale", width: 210, height: 297, tightMargin: 4 },
  { id: "letter", label: "US Letter paper", blurb: "Printed at home, at 100% scale", width: 215.9, height: 279.4, tightMargin: 4 },
];

export const DPI = 300;

export function mmToPixels(mm: number, dpi = DPI): number {
  return Math.round((mm / 25.4) * dpi);
}

export interface SheetLayout {
  /** The sheet as it is drawn: turned to landscape when more photos fit that way. */
  sheet: Size;
  photo: Size;
  /** Top-left corners of each photo, in pixels. */
  cells: { x: number; y: number }[];
  columns: number;
  rows: number;
  landscape: boolean;
}

/**
 * As many photos as fit on the sheet with a gap between them and a margin
 * at the edges, whichever way round holds more, centred. When butting the
 * photos together edge to edge fits more - six 2 x 2 in photos on a 4 x 6
 * print rather than two - they are butted together, with the cut lines
 * between them.
 */
export function sheetLayout(sheet: SheetSpec, photo: PhotoSpec, gapMm = 2, marginMm = 3, dpi = DPI): SheetLayout {
  const fit = (width: number, height: number, gap: number, margin: number) => {
    const columns = Math.max(0, Math.floor((width - 2 * margin + gap + 0.001) / (photo.width + gap)));
    const rows = Math.max(0, Math.floor((height - 2 * margin + gap + 0.001) / (photo.height + gap)));
    return { columns, rows, count: columns * rows, gap };
  };
  const candidates = [
    { ...fit(sheet.width, sheet.height, gapMm, marginMm), landscape: false },
    { ...fit(sheet.height, sheet.width, gapMm, marginMm), landscape: true },
    { ...fit(sheet.width, sheet.height, 0, sheet.tightMargin), landscape: false },
    { ...fit(sheet.height, sheet.width, 0, sheet.tightMargin), landscape: true },
  ];
  const best = candidates.reduce((winner, candidate) => (candidate.count > winner.count ? candidate : winner));
  const { columns, rows, landscape } = best;
  gapMm = best.gap;
  const sheetWidth = landscape ? sheet.height : sheet.width;
  const sheetHeight = landscape ? sheet.width : sheet.height;
  const photoPixels = { width: mmToPixels(photo.width, dpi), height: mmToPixels(photo.height, dpi) };
  const gap = mmToPixels(gapMm, dpi);
  const size = { width: mmToPixels(sheetWidth, dpi), height: mmToPixels(sheetHeight, dpi) };
  const blockWidth = columns * photoPixels.width + Math.max(0, columns - 1) * gap;
  const blockHeight = rows * photoPixels.height + Math.max(0, rows - 1) * gap;
  const left = Math.round((size.width - blockWidth) / 2);
  const top = Math.round((size.height - blockHeight) / 2);
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) cells.push({ x: left + column * (photoPixels.width + gap), y: top + row * (photoPixels.height + gap) });
  }
  return { sheet: size, photo: photoPixels, cells, columns, rows, landscape };
}

/**
 * The part of the picture a photo is cut from: the largest rectangle of
 * the photo's shape, centred across and placed towards the top down, since
 * a portrait taken for a passport usually has more space below the chin
 * than above the head. `raise` is how far towards the top, 0 to 1.
 */
export function photoCrop(size: Size, photo: PhotoSpec, raise = 0.35): CropRect {
  const target = photo.width / photo.height;
  let width = size.width;
  let height = size.height;
  if (width / height > target) width = Math.round(height * target);
  else height = Math.round(width / target);
  width = Math.max(1, Math.min(size.width, width));
  height = Math.max(1, Math.min(size.height, height));
  const spare = size.height - height;
  return { x: Math.floor((size.width - width) / 2), y: Math.floor(spare * raise), width, height };
}

/**
 * A JPEG told its resolution: the JFIF header's density set to dots per
 * inch, so a computer prints it at its true size rather than at whatever
 * a 72-dpi default makes of it. Bytes without a JFIF header are returned
 * as they came.
 */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const out = bytes.slice();
  if (out[0] !== 0xff || out[1] !== 0xd8 || out[2] !== 0xff || out[3] !== 0xe0) return out;
  if (String.fromCharCode(out[6], out[7], out[8], out[9]) !== "JFIF" || out[10] !== 0) return out;
  out[13] = 1;
  out[14] = dpi >> 8;
  out[15] = dpi & 0xff;
  out[16] = dpi >> 8;
  out[17] = dpi & 0xff;
  return out;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The one photo, cut and scaled to its size at 300 dpi. */
export function drawPhoto(image: DecodedImage, photo: PhotoSpec, raise = 0.35): AnyCanvas {
  const rect = photoCrop({ width: image.width, height: image.height }, photo, raise);
  return drawCrop(image, rect, { width: mmToPixels(photo.width), height: mmToPixels(photo.height) }, "#ffffff");
}

/** The sheet: white, the photo in every cell, and a thin grey line around each to cut along. */
export function drawSheet(photoCanvas: AnyCanvas, layout: SheetLayout): AnyCanvas {
  const canvas = makeCanvas(layout.sheet.width, layout.sheet.height);
  const context = canvas.getContext("2d") as AnyContext;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, layout.sheet.width, layout.sheet.height);
  for (const cell of layout.cells) context.drawImage(photoCanvas, cell.x, cell.y, layout.photo.width, layout.photo.height);
  context.strokeStyle = "#b0b0b0";
  context.lineWidth = 1;
  for (const cell of layout.cells) context.strokeRect(cell.x - 0.5, cell.y - 0.5, layout.photo.width + 1, layout.photo.height + 1);
  return canvas;
}
