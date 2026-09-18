/**
 * Pixels out of a PDF page: the images it paints, as PDF.js hands them
 * over, and the bounds of what is drawn on a rendered page.
 *
 * Pure, so the conversions are tested without PDF.js in sight.
 */

/** The three layouts PDF.js decodes an image into. */
export type PixelKind = "gray1" | "rgb" | "rgba";

/**
 * RGBA pixels from PDF.js's image data: one bit per pixel with rows padded
 * to a byte, three bytes per pixel, or four.
 */
export function rgbaFrom(kind: PixelKind, data: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  if (kind === "rgba") {
    out.set(data.subarray(0, out.length));
    return out;
  }
  if (kind === "rgb") {
    for (let pixel = 0, at = 0; pixel < width * height; pixel += 1, at += 3) {
      out[pixel * 4] = data[at];
      out[pixel * 4 + 1] = data[at + 1];
      out[pixel * 4 + 2] = data[at + 2];
      out[pixel * 4 + 3] = 255;
    }
    return out;
  }
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const byte = data[y * rowBytes + (x >> 3)] ?? 255;
      const bit = (byte >> (7 - (x & 7))) & 1;
      const value = bit ? 255 : 0;
      const at = (y * width + x) * 4;
      out[at] = value;
      out[at + 1] = value;
      out[at + 2] = value;
      out[at + 3] = 255;
    }
  }
  return out;
}

export interface Bounds {
  left: number;
  top: number;
  /** One past the last column and row with something on them. */
  right: number;
  bottom: number;
}

/**
 * The box around everything that is not white, or null for a blank page.
 *
 * A pixel counts when any channel is darker than the threshold and it is
 * not transparent; light grey from anti-aliasing or a scanner's paper is
 * left out by the threshold, so a scan's faint background does not stop
 * the trim.
 */
export function contentBounds(pixels: Uint8ClampedArray, width: number, height: number, threshold = 232): Bounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (pixels[at + 3] < 32) continue;
      if (pixels[at] < threshold || pixels[at + 1] < threshold || pixels[at + 2] < threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}
