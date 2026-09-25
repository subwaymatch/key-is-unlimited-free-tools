/**
 * Parts of a picture covered for good: boxes drawn over a screenshot and
 * burned into its pixels.
 *
 * Everything here works on RGBA pixels, so what is saved is exactly what
 * was shown. A black box replaces every pixel under it. Pixelating and
 * blurring both keep only the average colour of coarse blocks - blurring
 * then shades smoothly between those averages - so no detail finer than a
 * block survives either; a light Gaussian blur, by contrast, can be undone.
 */

export type RedactStyle = "black" | "pixelate" | "blur";

export interface RedactRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Redaction extends RedactRect {
  style: RedactStyle;
}

/** The smallest box worth keeping, in pixels; anything smaller was a click, not a drag. */
export const MIN_SIDE = 3;

/** The box between two corners, whole pixels, kept inside the picture; null when too small to mean anything. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }, width: number, height: number): RedactRect | null {
  const left = Math.max(0, Math.floor(Math.min(a.x, b.x)));
  const top = Math.max(0, Math.floor(Math.min(a.y, b.y)));
  const right = Math.min(width, Math.ceil(Math.max(a.x, b.x)));
  const bottom = Math.min(height, Math.ceil(Math.max(a.y, b.y)));
  if (right - left < MIN_SIDE || bottom - top < MIN_SIDE) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The last-drawn box under a point, since later boxes are drawn on top; -1 for none. */
export function boxAt(boxes: readonly RedactRect[], point: { x: number; y: number }): number {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    if (point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height) return index;
  }
  return -1;
}

/**
 * Pixels per block for a box: coarse enough that a line of text inside it
 * becomes one or two rows of blocks, and never finer than 12 pixels.
 */
export function blockSize(box: RedactRect): number {
  return Math.max(12, Math.round(Math.min(box.width, box.height) / 3));
}

/** Each block's average colour, a grid of cols x rows RGBA values. */
function blockAverages(pixels: Uint8ClampedArray, width: number, box: RedactRect, block: number): { cols: number; rows: number; colours: Float64Array } {
  const cols = Math.ceil(box.width / block);
  const rows = Math.ceil(box.height / block);
  const colours = new Float64Array(cols * rows * 4);
  const counts = new Float64Array(cols * rows);
  for (let y = 0; y < box.height; y += 1) {
    const row = Math.floor(y / block);
    for (let x = 0; x < box.width; x += 1) {
      const cell = row * cols + Math.floor(x / block);
      const at = ((box.y + y) * width + box.x + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) colours[cell * 4 + channel] += pixels[at + channel];
      counts[cell] += 1;
    }
  }
  for (let cell = 0; cell < counts.length; cell += 1) for (let channel = 0; channel < 4; channel += 1) colours[cell * 4 + channel] /= counts[cell] || 1;
  return { cols, rows, colours };
}

function redactOne(pixels: Uint8ClampedArray, width: number, height: number, redaction: Redaction): void {
  const box = { x: Math.max(0, redaction.x), y: Math.max(0, redaction.y), width: 0, height: 0 };
  box.width = Math.min(width, redaction.x + redaction.width) - box.x;
  box.height = Math.min(height, redaction.y + redaction.height) - box.y;
  if (box.width <= 0 || box.height <= 0) return;
  if (redaction.style === "black") {
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) pixels.set([0, 0, 0, 255], (y * width + x) * 4);
    }
    return;
  }
  const block = blockSize(box);
  const { cols, rows, colours } = blockAverages(pixels, width, box, block);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const at = ((box.y + y) * width + box.x + x) * 4;
      if (redaction.style === "pixelate") {
        const cell = (Math.floor(y / block) * cols + Math.floor(x / block)) * 4;
        for (let channel = 0; channel < 4; channel += 1) pixels[at + channel] = colours[cell + channel];
        continue;
      }
      // Blur: shade between the block centres, which carry nothing finer than a block.
      const gx = Math.min(cols - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const gy = Math.min(rows - 1, Math.max(0, (y + 0.5) / block - 0.5));
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const x1 = Math.min(cols - 1, x0 + 1);
      const y1 = Math.min(rows - 1, y0 + 1);
      const fx = gx - x0;
      const fy = gy - y0;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = colours[(y0 * cols + x0) * 4 + channel] * (1 - fx) + colours[(y0 * cols + x1) * 4 + channel] * fx;
        const bottom = colours[(y1 * cols + x0) * 4 + channel] * (1 - fx) + colours[(y1 * cols + x1) * 4 + channel] * fx;
        pixels[at + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
}

/** Every box burned into the pixels in the order drawn, in place. */
export function applyRedactions(pixels: Uint8ClampedArray, width: number, height: number, redactions: readonly Redaction[]): void {
  for (const redaction of redactions) redactOne(pixels, width, height, redaction);
}
