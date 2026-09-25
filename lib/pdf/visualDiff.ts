/**
 * Two drawn pages compared pixel by pixel, the way a reviewer reads a
 * change: ink only in the first version painted red, ink only in the
 * second painted green, and what both share faded to a grey ghost.
 */

export interface PageDiff {
  changed: number;
  total: number;
  /** Pixels darker in the first: removed. */
  removed: number;
  /** Pixels darker in the second: added. */
  added: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  out: Uint8ClampedArray<ArrayBuffer>;
}

const luma = (pixels: Uint8ClampedArray, at: number) => (pixels[at + 3] === 0 ? 255 : 0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2]);

/**
 * Two pages as RGBA, possibly of different sizes, compared over the larger
 * of the two; outside a page counts as white paper.
 */
export function diffPages(a: { pixels: Uint8ClampedArray; width: number; height: number }, b: { pixels: Uint8ClampedArray; width: number; height: number }, tolerance: number): PageDiff & { width: number; height: number } {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  let removed = 0;
  let added = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  const sample = (page: typeof a, x: number, y: number, channel: number) => (x < page.width && y < page.height ? page.pixels[(y * page.width + x) * 4 + channel] : 255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const inA = x < a.width && y < a.height;
      const inB = x < b.width && y < b.height;
      const ra = sample(a, x, y, 0);
      const ga = sample(a, x, y, 1);
      const ba = sample(a, x, y, 2);
      const rb = sample(b, x, y, 0);
      const gb = sample(b, x, y, 1);
      const bb = sample(b, x, y, 2);
      const differs = Math.abs(ra - rb) > tolerance || Math.abs(ga - gb) > tolerance || Math.abs(ba - bb) > tolerance;
      const la = inA ? luma(a.pixels, (y * a.width + x) * 4) : 255;
      const lb = inB ? luma(b.pixels, (y * b.width + x) * 4) : 255;
      if (differs) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (lb < la) {
          added += 1;
          out.set([20, 150, 60, 255], at);
        } else {
          removed += 1;
          out.set([215, 35, 35, 255], at);
        }
      } else {
        const faded = 255 - Math.round((255 - Math.min(la, lb)) * 0.3);
        out.set([faded, faded, faded, 255], at);
      }
    }
  }
  const changed = removed + added;
  return { changed, total: width * height, removed, added, bounds: changed > 0 ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null, out, width, height };
}
