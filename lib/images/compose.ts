/**
 * Several pictures as one: side by side, one above another, or in a grid.
 *
 * The arithmetic is pure and tested; the drawing needs a canvas.
 */
import { drawImage, type DecodedImage, type Size } from "./canvas";

export type ComposeLayout = "row" | "column" | "grid";

export const LAYOUT_OPTIONS: readonly { id: ComposeLayout; label: string; blurb: string }[] = [
  { id: "row", label: "Side by side", blurb: "In a row, each scaled to the same height" },
  { id: "column", label: "One above another", blurb: "In a column, each scaled to the same width" },
  { id: "grid", label: "A grid", blurb: "Rows and columns of equal cells, each picture fitted inside its cell" },
];

export interface ComposeOptions {
  layout: ComposeLayout;
  /** Cells across, for a grid; null picks a square-ish grid. */
  columns: number | null;
  /** Pixels between pictures, and around the edge. */
  gap: number;
  /** The most the longer side of the result may be; browsers refuse a canvas much past 16384. */
  maxSide: number;
}

export interface Placement extends Size {
  x: number;
  y: number;
}

export interface Composition extends Size {
  cells: Placement[];
  /** True when everything was scaled down to fit within `maxSide`. */
  shrunk: boolean;
}

/** The width and height of a picture drawn at a height or a width, never enlarged. */
function atHeight(size: Size, height: number): Size {
  return { width: Math.max(1, Math.round((size.width * height) / size.height)), height };
}

function atWidth(size: Size, width: number): Size {
  return { width, height: Math.max(1, Math.round((size.height * width) / size.width)) };
}

function fitIn(size: Size, box: Size): Size {
  const scale = Math.min(1, box.width / size.width, box.height / size.height);
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/** How many columns a grid of this many pictures gets when none was asked for. */
export function defaultColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/**
 * Where every picture goes, and how large the whole is.
 *
 * A row scales every picture to the shortest one's height, a column to the
 * narrowest one's width, so nothing is enlarged and nothing is cropped. A
 * grid's cell is the narrowest width by the shortest height, with each
 * picture fitted inside and centred.
 */
export function composeLayout(sizes: readonly Size[], options: ComposeOptions): Composition {
  const gap = Math.max(0, Math.round(options.gap));
  const cells: Placement[] = [];
  let width = 0;
  let height = 0;
  if (sizes.length === 0) return { width: 1, height: 1, cells, shrunk: false };

  if (options.layout === "row") {
    const rowHeight = Math.min(...sizes.map((size) => size.height));
    let x = gap;
    for (const size of sizes) {
      const scaled = atHeight(size, rowHeight);
      cells.push({ x, y: gap, ...scaled });
      x += scaled.width + gap;
    }
    width = x;
    height = rowHeight + gap * 2;
  } else if (options.layout === "column") {
    const columnWidth = Math.min(...sizes.map((size) => size.width));
    let y = gap;
    for (const size of sizes) {
      const scaled = atWidth(size, columnWidth);
      cells.push({ x: gap, y, ...scaled });
      y += scaled.height + gap;
    }
    width = columnWidth + gap * 2;
    height = y;
  } else {
    const columns = Math.max(1, Math.min(sizes.length, options.columns ?? defaultColumns(sizes.length)));
    const rows = Math.ceil(sizes.length / columns);
    const cell = { width: Math.min(...sizes.map((size) => size.width)), height: Math.min(...sizes.map((size) => size.height)) };
    for (const [index, size] of sizes.entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const fitted = fitIn(size, cell);
      cells.push({
        x: gap + column * (cell.width + gap) + Math.round((cell.width - fitted.width) / 2),
        y: gap + row * (cell.height + gap) + Math.round((cell.height - fitted.height) / 2),
        ...fitted,
      });
    }
    width = columns * cell.width + (columns + 1) * gap;
    height = rows * cell.height + (rows + 1) * gap;
  }

  const longest = Math.max(width, height);
  if (longest <= options.maxSide) return { width, height, cells, shrunk: false };
  const scale = options.maxSide / longest;
  const round = (value: number) => Math.max(1, Math.round(value * scale));
  return {
    width: round(width),
    height: round(height),
    cells: cells.map((cell) => ({ x: Math.round(cell.x * scale), y: Math.round(cell.y * scale), width: round(cell.width), height: round(cell.height) })),
    shrunk: true,
  };
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The pictures drawn where the composition puts them, on a background or on nothing. */
export function drawComposition(images: readonly DecodedImage[], composition: Composition, background: string | null): AnyCanvas {
  const canvas = makeCanvas(composition.width, composition.height);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, composition.width, composition.height);
  }
  context.imageSmoothingQuality = "high";
  images.forEach((image, index) => {
    const cell = composition.cells[index];
    if (!cell) return;
    // Drawn in halves down to the cell, so a large photo in a small cell is averaged rather than skipped.
    const scaled = drawImage(image, { width: cell.width, height: cell.height }, null);
    context.drawImage(scaled, cell.x, cell.y, cell.width, cell.height);
  });
  return canvas;
}
