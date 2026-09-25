import { describe, expect, it } from "vitest";

import { applyRedactions, blockSize, boxAt, rectBetween, type Redaction } from "@/lib/images/redact";

/** A picture where every pixel is different, so anything that survives is visible. */
function noise(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let index = 0; index < pixels.length; index += 4) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    pixels.set([seed & 0xff, (seed >> 8) & 0xff, (seed >> 16) & 0xff, 255], index);
  }
  return pixels;
}

const pixel = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe("drawing boxes", () => {
  it("takes the box between two corners in either order, kept inside the picture", () => {
    expect(rectBetween({ x: 30.4, y: 20.6 }, { x: 10.2, y: 5.9 }, 100, 50)).toEqual({ x: 10, y: 5, width: 21, height: 16 });
    expect(rectBetween({ x: -10, y: -10 }, { x: 150, y: 70 }, 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(rectBetween({ x: 10, y: 10 }, { x: 11, y: 40 }, 100, 50)).toBeNull();
  });

  it("finds the topmost box under a point", () => {
    const boxes = [
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 20, y: 20, width: 10, height: 10 },
    ];
    expect(boxAt(boxes, { x: 25, y: 25 })).toBe(1);
    expect(boxAt(boxes, { x: 5, y: 5 })).toBe(0);
    expect(boxAt(boxes, { x: 50, y: 5 })).toBe(-1);
  });
});

describe("burning boxes in", () => {
  const width = 80;
  const height = 60;
  const box = { x: 10, y: 12, width: 40, height: 30 };

  it("black: every pixel inside is black, every pixel outside untouched", () => {
    const source = noise(width, height);
    const pixels = source.slice();
    applyRedactions(pixels, width, height, [{ ...box, style: "black" }]);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
        expect(pixel(pixels, width, x, y)).toEqual(inside ? [0, 0, 0, 255] : pixel(source, width, x, y));
      }
    }
  });

  for (const style of ["pixelate", "blur"] as const) {
    it(`${style}: nothing finer than a block survives, and nothing outside changes`, () => {
      const source = noise(width, height);
      const pixels = source.slice();
      const redaction: Redaction = { ...box, style };
      applyRedactions(pixels, width, height, [redaction]);
      const block = blockSize(box);
      expect(block).toBe(12);
      // Two 4 x 4 squares swapped inside the first block leave its average, and so the redacted result, the same.
      const swapped = source.slice();
      for (let y = box.y; y < box.y + 4; y += 1) for (let x = box.x; x < box.x + 4; x += 1) swapped.set(pixel(source, width, x + 4, y + 4), (y * width + x) * 4);
      for (let y = box.y + 4; y < box.y + 8; y += 1) for (let x = box.x + 4; x < box.x + 8; x += 1) swapped.set(pixel(source, width, x - 4, y - 4), (y * width + x) * 4);
      applyRedactions(swapped, width, height, [redaction]);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
          if (inside) expect(pixel(swapped, width, x, y)).toEqual(pixel(pixels, width, x, y));
          else expect(pixel(pixels, width, x, y)).toEqual(pixel(source, width, x, y));
        }
      }
      if (style === "pixelate") {
        // Every pixel of a block is the block's average.
        expect(pixel(pixels, width, box.x, box.y)).toEqual(pixel(pixels, width, box.x + 11, box.y + 11));
      } else {
        // Blurred: neighbouring pixels differ by little.
        const a = pixel(pixels, width, box.x + 12, box.y + 12);
        const b = pixel(pixels, width, box.x + 13, box.y + 12);
        for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(a[channel] - b[channel])).toBeLessThan(20);
      }
    });
  }

  it("keeps a box that runs off the picture inside it", () => {
    const pixels = noise(width, height);
    applyRedactions(pixels, width, height, [{ x: 70, y: 50, width: 40, height: 40, style: "black" }]);
    expect(pixel(pixels, width, 79, 59)).toEqual([0, 0, 0, 255]);
    expect(pixel(pixels, width, 69, 59)).not.toEqual([0, 0, 0, 255]);
  });
});
