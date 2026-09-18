import { describe, expect, it } from "vitest";

import { composeLayout, defaultColumns } from "@/lib/images/compose";
import { contrastingText, medianCut, paletteText, toHex } from "@/lib/images/palette";

const sizes = [
  { width: 400, height: 200 },
  { width: 300, height: 300 },
  { width: 100, height: 400 },
];

describe("composing pictures", () => {
  it("puts a row at the shortest height and a column at the narrowest width", () => {
    const row = composeLayout(sizes, { layout: "row", columns: null, gap: 10, maxSide: 16384 });
    expect(row.cells).toEqual([
      { x: 10, y: 10, width: 400, height: 200 },
      { x: 420, y: 10, width: 200, height: 200 },
      { x: 630, y: 10, width: 50, height: 200 },
    ]);
    expect(row).toMatchObject({ width: 690, height: 220, shrunk: false });

    const column = composeLayout(sizes, { layout: "column", columns: null, gap: 0, maxSide: 16384 });
    expect(column.cells.map((cell) => cell.width)).toEqual([100, 100, 100]);
    expect(column.cells.map((cell) => cell.y)).toEqual([0, 50, 150]);
    expect(column).toMatchObject({ width: 100, height: 550 });
  });

  it("fits a grid's pictures inside equal cells, centred", () => {
    const grid = composeLayout(sizes, { layout: "grid", columns: 2, gap: 4, maxSide: 16384 });
    // The cell is the narrowest width by the shortest height: 100 x 200.
    expect(grid).toMatchObject({ width: 2 * 100 + 3 * 4, height: 2 * 200 + 3 * 4 });
    expect(grid.cells[0]).toEqual({ x: 4, y: 4 + 75, width: 100, height: 50 });
    expect(grid.cells[1]).toEqual({ x: 108, y: 4 + 50, width: 100, height: 100 });
    expect(grid.cells[2]).toEqual({ x: 4 + 25, y: 208, width: 50, height: 200 });
    expect(defaultColumns(5)).toBe(3);
    expect(defaultColumns(1)).toBe(1);
  });

  it("shrinks the whole to the longest side a canvas allows", () => {
    const wide = composeLayout([{ width: 20000, height: 100 }, { width: 20000, height: 100 }], { layout: "row", columns: null, gap: 0, maxSide: 16000 });
    expect(wide).toMatchObject({ width: 16000, height: 40, shrunk: true });
    expect(wide.cells[1].x).toBe(8000);
    expect(composeLayout([], { layout: "row", columns: null, gap: 0, maxSide: 100 })).toMatchObject({ width: 1, height: 1 });
  });
});

describe("a picture's palette", () => {
  it("finds the colours by share, ignoring transparent pixels", () => {
    const pixels = new Uint8ClampedArray(100 * 4);
    for (let index = 0; index < 100; index += 1) {
      const at = index * 4;
      if (index < 60) pixels.set([255, 0, 0, 255], at);
      else if (index < 90) pixels.set([0, 0, 255, 255], at);
      else pixels.set([0, 255, 0, 0], at);
    }
    const swatches = medianCut(pixels, 8);
    expect(swatches.map((swatch) => swatch.hex)).toEqual(["#ff0000", "#0000ff"]);
    expect(swatches[0].share).toBeCloseTo(60 / 90, 5);
    expect(swatches[1].share).toBeCloseTo(30 / 90, 5);
    expect(medianCut(new Uint8ClampedArray(8), 4)).toEqual([]);
  });

  it("splits a gradient into as many boxes as asked", () => {
    const pixels = new Uint8ClampedArray(256 * 4);
    for (let value = 0; value < 256; value += 1) pixels.set([value, 128, 255 - value, 255], value * 4);
    const swatches = medianCut(pixels, 4);
    expect(swatches).toHaveLength(4);
    expect(swatches.reduce((sum, swatch) => sum + swatch.share, 0)).toBeCloseTo(1, 5);
    expect(swatches.map((swatch) => swatch.r).sort((a, b) => a - b)).toEqual([32, 96, 160, 224]);
  });

  it("writes hex and text", () => {
    expect(toHex(255, 0, 128)).toBe("#ff0080");
    expect(contrastingText(255, 255, 255)).toBe("#000000");
    expect(contrastingText(0, 0, 40)).toBe("#ffffff");
    const text = paletteText([{ r: 255, g: 0, b: 0, hex: "#ff0000", share: 0.5 }], "a.png");
    expect(text).toContain("#ff0000  rgb(255, 0, 0)  50%");
    expect(text).toContain("  --colour-1: #ff0000;");
  });
});
