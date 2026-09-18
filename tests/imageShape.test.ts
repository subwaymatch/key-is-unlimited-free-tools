import { describe, expect, it } from "vitest";

import { describeShare, diffPixels, hexOf, keyOut, parseHexColour, roundPlan, samplePixel, tilePlan, tileSuffix } from "@/lib/images/shape";

/** Pixels from a function of x and y. */
function pixels(width: number, height: number, at: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(at(x, y), (y * width + x) * 4);
    }
  }
  return data;
}

describe("rounding corners", () => {
  it("scales the radius and the border to the shorter side", () => {
    const plan = roundPlan({ width: 800, height: 400 }, "medium", "thin");
    expect(plan).toMatchObject({ width: 800, height: 400, radius: 50, border: 4 });
    expect(plan.crop).toEqual({ x: 0, y: 0, width: 800, height: 400 });
    expect(roundPlan({ width: 800, height: 400 }, "small", "none").radius).toBe(20);
    expect(roundPlan({ width: 800, height: 400 }, "large", "thick")).toMatchObject({ radius: 100, border: 12 });
  });

  it("cuts a circle from a centred square", () => {
    const plan = roundPlan({ width: 800, height: 400 }, "circle", "none");
    expect(plan).toMatchObject({ width: 400, height: 400, radius: 200, border: 0 });
    expect(plan.crop).toEqual({ x: 200, y: 0, width: 400, height: 400 });
  });

  it("never draws a border thinner than a pixel", () => {
    expect(roundPlan({ width: 20, height: 20 }, "small", "thin").border).toBe(1);
    expect(roundPlan({ width: 20, height: 20 }, "small", "thick").border).toBe(2);
  });
});

describe("tiling", () => {
  it("covers every pixel once with whole-pixel edges", () => {
    const plan = tilePlan({ width: 1001, height: 700 }, 3, 3, false);
    expect(plan.tiles).toHaveLength(9);
    const widths = plan.tiles.slice(0, 3).map((tile) => tile.width);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(plan.tiles[8]).toMatchObject({ row: 2, column: 2 });
    expect(plan.tiles[8].x + plan.tiles[8].width).toBe(1001);
    expect(plan.tiles[8].y + plan.tiles[8].height).toBe(700);
  });

  it("crops to square tiles about the centre when asked", () => {
    const plan = tilePlan({ width: 1000, height: 400 }, 1, 3, true);
    expect(plan.crop).toEqual({ x: 0, y: 33, width: 999, height: 333 });
    expect(plan.tiles.every((tile) => tile.width === 333 && tile.height === 333)).toBe(true);
    const tall = tilePlan({ width: 300, height: 1000 }, 2, 2, true);
    expect(tall.crop).toEqual({ x: 0, y: 350, width: 300, height: 300 });
  });

  it("clamps the grid and names tiles by row and column", () => {
    const plan = tilePlan({ width: 100, height: 100 }, 0, 40, false);
    expect(plan).toMatchObject({ rows: 1, columns: 10 });
    expect(tileSuffix(plan.tiles[3], plan)).toBe("-4");
    const grid = tilePlan({ width: 100, height: 100 }, 2, 2, false);
    expect(tileSuffix(grid.tiles[3], grid)).toBe("-r2c2");
    const column = tilePlan({ width: 100, height: 100 }, 3, 1, false);
    expect(tileSuffix(column.tiles[2], column)).toBe("-3");
  });
});

describe("comparing pixels", () => {
  it("counts the pixels that differ past the tolerance and boxes them", () => {
    const a = pixels(4, 4, () => [100, 100, 100, 255]);
    const b = pixels(4, 4, (x, y) => (x === 2 && y === 1 ? [200, 100, 100, 255] : x === 3 && y === 3 ? [100, 100, 110, 255] : [100, 100, 100, 255]));
    const exact = diffPixels(a, b, 4, 4, 0);
    expect(exact.changed).toBe(2);
    expect(exact.total).toBe(16);
    expect(exact.bounds).toEqual({ x: 2, y: 1, width: 2, height: 3 });
    expect(Array.from(exact.out.subarray((1 * 4 + 2) * 4, (1 * 4 + 2) * 4 + 4))).toEqual([225, 30, 30, 255]);
    // An unchanged pixel is the first picture, faded.
    expect(exact.out[0]).toBe(255 - Math.round((255 - 100) * 0.35));
    const loose = diffPixels(a, b, 4, 4, 16);
    expect(loose.changed).toBe(1);
    expect(loose.bounds).toEqual({ x: 2, y: 1, width: 1, height: 1 });
    expect(diffPixels(a, a, 4, 4, 0).bounds).toBeNull();
  });

  it("describes a share", () => {
    expect(describeShare(0, 0)).toBe("no pixels");
    expect(describeShare(50, 100)).toBe("50% of the pixels");
    expect(describeShare(3, 100)).toBe("3.0% of the pixels");
    expect(describeShare(1, 1000)).toBe("0.10% of the pixels");
    expect(describeShare(1, 100000)).toBe("under 0.01% of the pixels");
  });
});

describe("keying a colour out", () => {
  it("reads and writes hex colours", () => {
    expect(parseHexColour("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHexColour("FFF")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColour("#12345")).toBeNull();
    expect(hexOf({ r: 255, g: 128, b: 0 })).toBe("#ff8000");
    expect(samplePixel(pixels(2, 2, (x, y) => [x * 100, y * 100, 7, 255]), 2, 1, 1)).toEqual({ r: 100, g: 100, b: 7 });
  });

  it("makes every matching pixel transparent, feathering the ones just past the tolerance", () => {
    // A white frame, a red square in the middle, one near-white pixel at (1, 1).
    const data = pixels(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? (x === 1 && y === 1 ? [240, 240, 240, 255] : [200, 0, 0, 255]) : [255, 255, 255, 255]));
    const removed = keyOut(data, 5, 5, { r: 255, g: 255, b: 255 }, 10, false);
    expect(removed).toBe(16);
    expect(data[3]).toBe(0);
    expect(data[((2 * 5 + 2) * 4) + 3]).toBe(255);
    // 15 away with a tolerance of 10 and a feather to 16: mostly gone.
    const near = data[((1 * 5 + 1) * 4) + 3];
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(255);
  });

  it("with contiguous keying, keeps a matching island inside the picture", () => {
    // White everywhere, a black ring, white inside the ring.
    const data = pixels(7, 7, (x, y) => {
      const ring = (x === 1 || x === 5 || y === 1 || y === 5) && x >= 1 && x <= 5 && y >= 1 && y <= 5;
      return ring ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const removed = keyOut(data, 7, 7, { r: 255, g: 255, b: 255 }, 10, true);
    expect(removed).toBe(49 - 16 - 9);
    expect(data[((3 * 7 + 3) * 4) + 3]).toBe(255);
    expect(data[3]).toBe(0);
    const all = pixels(7, 7, (x, y) => {
      const ring = (x === 1 || x === 5 || y === 1 || y === 5) && x >= 1 && x <= 5 && y >= 1 && y <= 5;
      return ring ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    expect(keyOut(all, 7, 7, { r: 255, g: 255, b: 255 }, 10, false)).toBe(49 - 16);
  });
});
