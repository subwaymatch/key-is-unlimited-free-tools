/**
 * Pictures given a shape, cut up, compared, or keyed.
 *
 * Four more things the canvas does with nothing but arithmetic around it:
 * corners rounded or the whole cut to a circle with a border; a picture
 * cut into a grid of tiles; two pictures compared pixel by pixel; and one
 * colour made see-through. The arithmetic is pure and tested; the drawing
 * needs a canvas.
 */
import type { DecodedImage, Size } from "./canvas";

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextOf(canvas: AnyCanvas): AnyContext {
  return canvas.getContext("2d") as AnyContext;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ---- Rounded corners ---------------------------------------------------- */

export type RoundChoice = "small" | "medium" | "large" | "circle";

export const ROUND_OPTIONS: readonly { id: RoundChoice; label: string; blurb: string }[] = [
  { id: "small", label: "Slightly rounded", blurb: "A twentieth of the shorter side" },
  { id: "medium", label: "Rounded", blurb: "An eighth of the shorter side" },
  { id: "large", label: "Very rounded", blurb: "A quarter of the shorter side" },
  { id: "circle", label: "A circle", blurb: "Cut to a centred square, then rounded all the way" },
];

export type BorderChoice = "none" | "thin" | "thick";

export const BORDER_OPTIONS: readonly { id: BorderChoice; label: string; blurb?: string }[] = [
  { id: "none", label: "No border" },
  { id: "thin", label: "Thin", blurb: "One per cent of the shorter side" },
  { id: "thick", label: "Thick", blurb: "Three per cent of the shorter side" },
];

export interface RoundPlan extends Size {
  /** The part of the source that is drawn: everything, or a centred square for a circle. */
  crop: Rect;
  radius: number;
  /** The border's width in pixels, 0 for none. */
  border: number;
}

/** The size, crop, corner radius and border for a picture of this size. */
export function roundPlan(size: Size, round: RoundChoice, border: BorderChoice): RoundPlan {
  const shorter = Math.min(size.width, size.height);
  const crop: Rect =
    round === "circle"
      ? { x: Math.floor((size.width - shorter) / 2), y: Math.floor((size.height - shorter) / 2), width: shorter, height: shorter }
      : { x: 0, y: 0, width: size.width, height: size.height };
  const fraction = round === "small" ? 0.05 : round === "medium" ? 0.125 : round === "large" ? 0.25 : 0.5;
  const radius = round === "circle" ? shorter / 2 : Math.round(shorter * fraction);
  const borderWidth = border === "none" ? 0 : Math.max(border === "thin" ? 1 : 2, Math.round(shorter * (border === "thin" ? 0.01 : 0.03)));
  return { width: crop.width, height: crop.height, crop, radius, border: borderWidth };
}

/** A rectangle with rounded corners as a path, drawn with arcs so every browser takes it. */
export function roundedPath(context: AnyContext, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * The picture inside a rounded shape, with a border inside its edge, on a
 * background or on nothing.
 */
export function drawRounded(image: DecodedImage, plan: RoundPlan, borderColour: string, background: string | null): AnyCanvas {
  const canvas = makeCanvas(plan.width, plan.height);
  const context = contextOf(canvas);
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, plan.width, plan.height);
  }
  context.save();
  roundedPath(context, 0, 0, plan.width, plan.height, plan.radius);
  context.clip();
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height, 0, 0, plan.width, plan.height);
  context.restore();
  if (plan.border > 0) {
    const inset = plan.border / 2;
    roundedPath(context, inset, inset, plan.width - plan.border, plan.height - plan.border, plan.radius - inset);
    context.lineWidth = plan.border;
    context.strokeStyle = borderColour;
    context.stroke();
  }
  return canvas;
}

/* ---- Tiles -------------------------------------------------------------- */

export interface TilePreset {
  id: string;
  label: string;
  blurb: string;
  rows: number;
  columns: number;
}

export const TILE_PRESETS: readonly TilePreset[] = [
  { id: "3x3", label: "3 x 3", blurb: "Nine tiles, the way a profile grid shows them", rows: 3, columns: 3 },
  { id: "1x3", label: "3 across", blurb: "One row of three, for a carousel", rows: 1, columns: 3 },
  { id: "1x2", label: "2 across", blurb: "Left half and right half", rows: 1, columns: 2 },
  { id: "2x2", label: "2 x 2", blurb: "Four quarters", rows: 2, columns: 2 },
  { id: "2x1", label: "2 down", blurb: "Top half and bottom half", rows: 2, columns: 1 },
  { id: "custom", label: "Rows and columns", blurb: "Any grid up to 10 by 10, typed below", rows: 0, columns: 0 },
];

export const MAX_TILES_PER_SIDE = 10;

export interface Tile extends Rect {
  /** 0-based, top to bottom and left to right. */
  row: number;
  column: number;
}

export interface TilePlan {
  /** The part of the picture the tiles cover: everything, or a centred crop for square tiles. */
  crop: Rect;
  tiles: Tile[];
  rows: number;
  columns: number;
}

/**
 * A grid of tiles over a picture, every edge on a whole pixel and every
 * pixel in exactly one tile. With `square` the picture is first cropped,
 * about its centre, to the shape that makes each tile square.
 */
export function tilePlan(size: Size, rows: number, columns: number, square: boolean): TilePlan {
  const r = Math.max(1, Math.min(MAX_TILES_PER_SIDE, Math.round(rows)));
  const c = Math.max(1, Math.min(MAX_TILES_PER_SIDE, Math.round(columns)));
  let crop: Rect = { x: 0, y: 0, width: size.width, height: size.height };
  if (square) {
    const tile = Math.floor(Math.min(size.width / c, size.height / r));
    const width = tile * c;
    const height = tile * r;
    crop = { x: Math.floor((size.width - width) / 2), y: Math.floor((size.height - height) / 2), width, height };
  }
  const xs = Array.from({ length: c + 1 }, (_, index) => crop.x + Math.round((index * crop.width) / c));
  const ys = Array.from({ length: r + 1 }, (_, index) => crop.y + Math.round((index * crop.height) / r));
  const tiles: Tile[] = [];
  for (let row = 0; row < r; row += 1) {
    for (let column = 0; column < c; column += 1) {
      tiles.push({ row, column, x: xs[column], y: ys[row], width: xs[column + 1] - xs[column], height: ys[row + 1] - ys[row] });
    }
  }
  return { crop, tiles, rows: r, columns: c };
}

/** "photo-r1c2": which tile this is, for its file name. */
export function tileSuffix(tile: Tile, plan: TilePlan): string {
  if (plan.rows === 1) return `-${tile.column + 1}`;
  if (plan.columns === 1) return `-${tile.row + 1}`;
  return `-r${tile.row + 1}c${tile.column + 1}`;
}

/** One tile of the picture, at its own size. */
export function drawTile(image: DecodedImage, tile: Tile, background: string | null): AnyCanvas {
  const canvas = makeCanvas(Math.max(1, tile.width), Math.max(1, tile.height));
  const context = contextOf(canvas);
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image.source, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
  return canvas;
}

/* ---- Comparing two pictures --------------------------------------------- */

export type DiffTolerance = "exact" | "small" | "loose";

export const DIFF_TOLERANCES: readonly { id: DiffTolerance; label: string; blurb: string; value: number }[] = [
  { id: "exact", label: "Exact", blurb: "Any change in any channel counts", value: 0 },
  { id: "small", label: "Ignore noise", blurb: "JPEG grain and rounding are not a change", value: 16 },
  { id: "loose", label: "Only clear changes", blurb: "A shift of a shade or two is not a change", value: 48 },
];

export interface PixelDiff {
  /** Pixels that differ, and how many were compared. */
  changed: number;
  total: number;
  /** The smallest rectangle around every change, or null for none. */
  bounds: Rect | null;
  /** The first picture faded to grey with every changed pixel painted red. */
  out: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Two pictures of the same size compared pixel by pixel: a pixel differs
 * when any channel, alpha included, differs by more than the tolerance.
 */
export function diffPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number, tolerance: number): PixelDiff {
  const total = width * height;
  const out = new Uint8ClampedArray(new ArrayBuffer(total * 4));
  let changed = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < total; index += 1) {
    const at = index * 4;
    const differs =
      Math.abs(a[at] - b[at]) > tolerance ||
      Math.abs(a[at + 1] - b[at + 1]) > tolerance ||
      Math.abs(a[at + 2] - b[at + 2]) > tolerance ||
      Math.abs(a[at + 3] - b[at + 3]) > tolerance;
    if (differs) {
      changed += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      out[at] = 225;
      out[at + 1] = 30;
      out[at + 2] = 30;
      out[at + 3] = 255;
    } else {
      // The first picture, as a grey ghost: a third of its contrast, lifted towards white.
      const grey = Math.round(0.299 * a[at] + 0.587 * a[at + 1] + 0.114 * a[at + 2]);
      const faded = 255 - Math.round((255 - grey) * 0.35);
      out[at] = faded;
      out[at + 1] = faded;
      out[at + 2] = faded;
      out[at + 3] = 255;
    }
  }
  const bounds = changed > 0 ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null;
  return { changed, total, bounds, out };
}

/** "0.4% of the pixels", "1 pixel in 3", for the card. */
export function describeShare(changed: number, total: number): string {
  if (total === 0) return "no pixels";
  const percent = (changed / total) * 100;
  const shown = percent >= 10 ? percent.toFixed(0) : percent >= 1 ? percent.toFixed(1) : percent >= 0.01 ? percent.toFixed(2) : "under 0.01";
  return `${shown}% of the pixels`;
}

/* ---- Keying a colour out ------------------------------------------------- */

export interface Colour {
  r: number;
  g: number;
  b: number;
}

export type KeyTarget = "white" | "black" | "corner" | "custom";

export const KEY_TARGETS: readonly { id: KeyTarget; label: string; blurb: string }[] = [
  { id: "white", label: "White", blurb: "A logo or a scan on a white background" },
  { id: "corner", label: "The top-left pixel", blurb: "Whatever colour the background is" },
  { id: "black", label: "Black", blurb: "A picture on a black background" },
  { id: "custom", label: "A colour I type", blurb: "As a hex code, below" },
];

export type KeyTolerance = "tight" | "normal" | "loose";

export const KEY_TOLERANCES: readonly { id: KeyTolerance; label: string; blurb: string; value: number }[] = [
  { id: "tight", label: "Only that colour", blurb: "Within 12 of it on every channel", value: 12 },
  { id: "normal", label: "Close shades too", blurb: "Within 40: JPEG grain and slight shadows go", value: 40 },
  { id: "loose", label: "Anything like it", blurb: "Within 90: for an uneven background", value: 90 },
];

/** "#fff" or "#ffffff" as a colour, or null. */
export function parseHexColour(text: string): Colour | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split("").map((ch) => ch + ch).join("") : match[1];
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

export function hexOf(colour: Colour): string {
  return `#${[colour.r, colour.g, colour.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** The colour of one pixel. */
export function samplePixel(data: Uint8ClampedArray, width: number, x: number, y: number): Colour {
  const at = (y * width + x) * 4;
  return { r: data[at], g: data[at + 1], b: data[at + 2] };
}

/** How far a pixel is from a colour: the largest difference on any channel. */
function distance(data: Uint8ClampedArray, at: number, colour: Colour): number {
  return Math.max(Math.abs(data[at] - colour.r), Math.abs(data[at + 1] - colour.g), Math.abs(data[at + 2] - colour.b));
}

/**
 * Every pixel near the colour made transparent, and the ones a little
 * further off partly so, which softens the edge left behind.
 *
 * With `contiguous`, only the pixels reachable from the picture's edges
 * through other matching pixels go: a white background goes and a white
 * shirt in the middle stays. Returns how many pixels were made fully
 * transparent.
 */
export function keyOut(data: Uint8ClampedArray, width: number, height: number, colour: Colour, tolerance: number, contiguous: boolean): number {
  const total = width * height;
  const matched = new Uint8Array(total);
  const feather = tolerance * 1.5 + 1;
  if (contiguous) {
    const stack: number[] = [];
    const visit = (index: number) => {
      if (matched[index] || distance(data, index * 4, colour) > tolerance) return;
      matched[index] = 1;
      stack.push(index);
    };
    for (let x = 0; x < width; x += 1) {
      visit(x);
      visit((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += 1) {
      visit(y * width);
      visit(y * width + width - 1);
    }
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (index >= width) visit(index - width);
      if (index + width < total) visit(index + width);
    }
  } else {
    for (let index = 0; index < total; index += 1) {
      if (distance(data, index * 4, colour) <= tolerance) matched[index] = 1;
    }
  }
  let removed = 0;
  for (let index = 0; index < total; index += 1) {
    const at = index * 4;
    if (matched[index]) {
      data[at + 3] = 0;
      removed += 1;
      continue;
    }
    // A pixel a shade past the tolerance, next to one that went: part of the edge, faded in proportion.
    const x = index % width;
    const neighbour =
      (x > 0 && matched[index - 1]) || (x < width - 1 && matched[index + 1]) || (index >= width && matched[index - width]) || (index + width < total && matched[index + width]);
    if (!contiguous || neighbour) {
      const away = distance(data, at, colour);
      if (away < feather) data[at + 3] = Math.round((data[at + 3] * (away - tolerance)) / (feather - tolerance));
    }
  }
  return removed;
}
