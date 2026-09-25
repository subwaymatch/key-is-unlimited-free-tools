import { describe, expect, it } from "vitest";

import { diffPages } from "@/lib/pdf/visualDiff";

function page(width: number, height: number, ink: (x: number, y: number) => boolean) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels.set(ink(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * width + x) * 4);
  return { pixels, width, height };
}

describe("comparing drawn pages", () => {
  it("paints ink only in the first red, ink only in the second green, and fades the rest", () => {
    const first = page(10, 10, (x, y) => y === 2 && x < 5);
    const second = page(10, 10, (x, y) => (y === 2 && x < 3) || (y === 7 && x >= 5));
    const diff = diffPages(first, second, 16);
    expect(diff).toMatchObject({ removed: 2, added: 5, changed: 7, total: 100, bounds: { x: 3, y: 2, width: 7, height: 6 } });
    expect(Array.from(diff.out.subarray((2 * 10 + 3) * 4, (2 * 10 + 3) * 4 + 3))).toEqual([215, 35, 35]);
    expect(Array.from(diff.out.subarray((7 * 10 + 6) * 4, (7 * 10 + 6) * 4 + 3))).toEqual([20, 150, 60]);
    expect(Array.from(diff.out.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(diff.out.subarray((2 * 10) * 4, (2 * 10) * 4 + 3))).toEqual([178, 178, 178]);
  });

  it("finds nothing between identical pages, and treats a larger page's extra paper as white", () => {
    expect(diffPages(page(4, 4, () => false), page(4, 4, () => false), 0).changed).toBe(0);
    const wider = diffPages(page(4, 4, () => false), page(6, 4, (x) => x === 5), 0);
    expect(wider).toMatchObject({ width: 6, height: 4, added: 4, removed: 0 });
  });
});
