/**
 * QR codes found in a picture: a screenshot, a scan or a photo taken at an
 * angle, with one code in it or several.
 *
 * The picture is made black and white by a threshold that follows the
 * local brightness, so a shadow across a code does not swallow half of it.
 * Rows are scanned for the 1:1:3:1:1 runs of dark and light a finder
 * pattern makes, and each hit is checked down the column and along the
 * diagonal. Every three finders that could be the corners of one code are
 * tried: the module size and grid are estimated from them, the alignment
 * pattern is looked for near the fourth corner to correct for
 * perspective, and the grid is sampled and handed to the decoder, whose
 * error correction says whether the guess was right. This is the approach
 * ZXing takes, written afresh.
 */
import { decodeModules, QrReadError, QrSizeMismatch, type QrContent } from "./decode";
import { alignmentPositions, sizeOf, versionOfSize } from "./tables";

export interface BitImage {
  width: number;
  height: number;
  /** 1 for dark. */
  bits: Uint8Array;
}

export interface Point {
  x: number;
  y: number;
}

export interface FoundCode extends QrContent {
  /** Top-left, top-right, bottom-right and bottom-left corners of the symbol in the picture. */
  corners: [Point, Point, Point, Point];
}


/* ---- Brightness to black and white --------------------------------------- */

/** Luminance from RGBA pixels, as ITU-R BT.601 weighs the channels, over white where transparent. */
export function luminance(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let index = 0, at = 0; index < out.length; index += 1, at += 4) {
    const alpha = rgba[at + 3] / 255;
    const gray = (rgba[at] * 299 + rgba[at + 1] * 587 + rgba[at + 2] * 114) / 1000;
    out[index] = Math.round(gray * alpha + 255 * (1 - alpha));
  }
  return out;
}

/**
 * Black and white by a threshold that follows the neighbourhood: each 8 x 8
 * block is compared with the average of the 5 x 5 blocks around it, and a
 * flat block borrows its neighbours' level rather than inventing one.
 */
export function binarize(gray: Uint8Array, width: number, height: number): BitImage {
  const bits = new Uint8Array(width * height);
  if (width < 40 || height < 40) {
    // Too small for blocks: one threshold for the whole picture, at the valley between its two peaks.
    const histogram = new Array<number>(256).fill(0);
    for (const value of gray) histogram[value] += 1;
    const threshold = otsu(histogram, gray.length);
    for (let index = 0; index < gray.length; index += 1) bits[index] = gray[index] <= threshold ? 1 : 0;
    return { width, height, bits };
  }
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  const black = new Float64Array(blocksX * blocksY);
  for (let by = 0; by < blocksY; by += 1) {
    const top = Math.min(by * 8, height - 8);
    for (let bx = 0; bx < blocksX; bx += 1) {
      const left = Math.min(bx * 8, width - 8);
      let sum = 0;
      let min = 255;
      let max = 0;
      for (let y = 0; y < 8; y += 1) {
        const row = (top + y) * width + left;
        for (let x = 0; x < 8; x += 1) {
          const value = gray[row + x];
          sum += value;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      let average = sum / 64;
      if (max - min <= 24) {
        // A flat block: call it light, unless its neighbours say this is the dark side of an edge.
        average = min / 2;
        if (by > 0 && bx > 0) {
          const neighbours = (black[(by - 1) * blocksX + bx] + 2 * black[by * blocksX + bx - 1] + black[(by - 1) * blocksX + bx - 1]) / 4;
          if (min < neighbours) average = neighbours;
        }
      }
      black[by * blocksX + bx] = average;
    }
  }
  const clamp = (value: number, most: number) => (value < 2 ? 2 : Math.min(value, most));
  for (let by = 0; by < blocksY; by += 1) {
    const top = Math.min(by * 8, height - 8);
    const cy = clamp(by, blocksY - 3);
    for (let bx = 0; bx < blocksX; bx += 1) {
      const left = Math.min(bx * 8, width - 8);
      const cx = clamp(bx, blocksX - 3);
      let sum = 0;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) sum += black[(cy + dy) * blocksX + cx + dx];
      const threshold = sum / 25;
      for (let y = 0; y < 8; y += 1) {
        const row = (top + y) * width + left;
        for (let x = 0; x < 8; x += 1) bits[row + x] = gray[row + x] <= threshold ? 1 : 0;
      }
    }
  }
  return { width, height, bits };
}

function otsu(histogram: number[], total: number): number {
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  let backgroundSum = 0;
  let background = 0;
  let best = 0;
  let threshold = 127;
  for (let value = 0; value < 256; value += 1) {
    background += histogram[value];
    if (background === 0) continue;
    const foreground = total - background;
    if (foreground === 0) break;
    backgroundSum += value * histogram[value];
    const meanBackground = backgroundSum / background;
    const meanForeground = (sum - backgroundSum) / foreground;
    const between = background * foreground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = value;
    }
  }
  return threshold;
}

export function invert(image: BitImage): BitImage {
  const bits = new Uint8Array(image.bits.length);
  for (let index = 0; index < bits.length; index += 1) bits[index] = image.bits[index] ^ 1;
  return { ...image, bits };
}

/* ---- Finder patterns ----------------------------------------------------- */

interface Finder extends Point {
  size: number;
  count: number;
}

function crossRatio(counts: number[], tolerance = 0.5): boolean {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < 7) return false;
  const unit = total / 7;
  const variance = unit * tolerance;
  return Math.abs(unit - counts[0]) < variance && Math.abs(unit - counts[1]) < variance && Math.abs(3 * unit - counts[2]) < 3 * variance && Math.abs(unit - counts[3]) < variance && Math.abs(unit - counts[4]) < variance;
}

/** Blur and perspective stretch a ring more than a clean scan does, so the checks after the first scan allow more. */
const CROSS_CHECK = 0.7;

function centerFromEnd(counts: number[], end: number): number {
  return end - counts[4] - counts[3] - counts[2] / 2;
}

class FinderSearch {
  readonly found: Finder[] = [];
  private readonly get: (x: number, y: number) => number;

  constructor(private readonly image: BitImage) {
    this.get = (x, y) => image.bits[y * image.width + x];
  }

  /** Checks a candidate along a column; the centre's y, or NaN. */
  private vertical(startY: number, x: number, maxCount: number, total: number): number {
    const { height } = this.image;
    const counts = [0, 0, 0, 0, 0];
    let y = startY;
    while (y >= 0 && this.get(x, y)) {
      counts[2] += 1;
      y -= 1;
    }
    if (y < 0) return NaN;
    while (y >= 0 && !this.get(x, y) && counts[1] <= maxCount) {
      counts[1] += 1;
      y -= 1;
    }
    if (y < 0 || counts[1] > maxCount) return NaN;
    while (y >= 0 && this.get(x, y) && counts[0] <= maxCount) {
      counts[0] += 1;
      y -= 1;
    }
    if (counts[0] > maxCount) return NaN;
    y = startY + 1;
    while (y < height && this.get(x, y)) {
      counts[2] += 1;
      y += 1;
    }
    if (y === height) return NaN;
    while (y < height && !this.get(x, y) && counts[3] < maxCount) {
      counts[3] += 1;
      y += 1;
    }
    if (y === height || counts[3] >= maxCount) return NaN;
    while (y < height && this.get(x, y) && counts[4] < maxCount) {
      counts[4] += 1;
      y += 1;
    }
    if (counts[4] >= maxCount) return NaN;
    const sum = counts.reduce((a, b) => a + b, 0);
    if (5 * Math.abs(sum - total) >= 2 * total) return NaN;
    return crossRatio(counts, CROSS_CHECK) ? centerFromEnd(counts, y) : NaN;
  }

  /** The same along a row; the centre's x, or NaN. */
  private horizontal(startX: number, y: number, maxCount: number, total: number): number {
    const { width } = this.image;
    const counts = [0, 0, 0, 0, 0];
    let x = startX;
    while (x >= 0 && this.get(x, y)) {
      counts[2] += 1;
      x -= 1;
    }
    if (x < 0) return NaN;
    while (x >= 0 && !this.get(x, y) && counts[1] <= maxCount) {
      counts[1] += 1;
      x -= 1;
    }
    if (x < 0 || counts[1] > maxCount) return NaN;
    while (x >= 0 && this.get(x, y) && counts[0] <= maxCount) {
      counts[0] += 1;
      x -= 1;
    }
    if (counts[0] > maxCount) return NaN;
    x = startX + 1;
    while (x < width && this.get(x, y)) {
      counts[2] += 1;
      x += 1;
    }
    if (x === width) return NaN;
    while (x < width && !this.get(x, y) && counts[3] < maxCount) {
      counts[3] += 1;
      x += 1;
    }
    if (x === width || counts[3] >= maxCount) return NaN;
    while (x < width && this.get(x, y) && counts[4] < maxCount) {
      counts[4] += 1;
      x += 1;
    }
    if (counts[4] >= maxCount) return NaN;
    const sum = counts.reduce((a, b) => a + b, 0);
    if (5 * Math.abs(sum - total) >= total) return NaN;
    return crossRatio(counts, CROSS_CHECK) ? centerFromEnd(counts, x) : NaN;
  }

  /** The pattern also holds along the diagonal, which rules out most text and texture. */
  private diagonal(cy: number, cx: number): boolean {
    const { width, height } = this.image;
    const counts = [0, 0, 0, 0, 0];
    let step = 0;
    while (cy >= step && cx >= step && this.get(cx - step, cy - step)) {
      counts[2] += 1;
      step += 1;
    }
    if (counts[2] === 0) return false;
    while (cy >= step && cx >= step && !this.get(cx - step, cy - step)) {
      counts[1] += 1;
      step += 1;
    }
    if (counts[1] === 0) return false;
    while (cy >= step && cx >= step && this.get(cx - step, cy - step)) {
      counts[0] += 1;
      step += 1;
    }
    if (counts[0] === 0) return false;
    step = 1;
    while (cy + step < height && cx + step < width && this.get(cx + step, cy + step)) {
      counts[2] += 1;
      step += 1;
    }
    while (cy + step < height && cx + step < width && !this.get(cx + step, cy + step)) {
      counts[3] += 1;
      step += 1;
    }
    if (counts[3] === 0) return false;
    while (cy + step < height && cx + step < width && this.get(cx + step, cy + step)) {
      counts[4] += 1;
      step += 1;
    }
    if (counts[4] === 0) return false;
    return crossRatio(counts, 0.75);
  }

  private candidate(counts: number[], y: number, x: number): boolean {
    const total = counts.reduce((a, b) => a + b, 0);
    let cx = centerFromEnd(counts, x);
    const cy = this.vertical(y, Math.floor(cx), counts[2], total);
    if (Number.isNaN(cy)) return false;
    cx = this.horizontal(Math.floor(cx), Math.floor(cy), counts[2], total);
    if (Number.isNaN(cx) || !this.diagonal(Math.floor(cy), Math.floor(cx))) return false;
    const size = total / 7;
    for (const finder of this.found) {
      if (Math.abs(cy - finder.y) <= size && Math.abs(cx - finder.x) <= size) {
        const difference = Math.abs(size - finder.size);
        if (difference <= 1 || difference <= finder.size) {
          const count = finder.count + 1;
          finder.x = (finder.count * finder.x + cx) / count;
          finder.y = (finder.count * finder.y + cy) / count;
          finder.size = (finder.count * finder.size + size) / count;
          finder.count = count;
          return true;
        }
      }
    }
    this.found.push({ x: cx, y: cy, size, count: 1 });
    return true;
  }

  run(step: number): Finder[] {
    const { width, height } = this.image;
    for (let y = step - 1; y < height; y += step) {
      const counts = [0, 0, 0, 0, 0];
      let state = 0;
      for (let x = 0; x < width; x += 1) {
        if (this.get(x, y)) {
          if (state & 1) state += 1;
          counts[state] += 1;
        } else if (state & 1) {
          counts[state] += 1;
        } else if (state === 4) {
          if (crossRatio(counts) && this.candidate(counts, y, x)) {
            counts.fill(0);
            state = 0;
          } else {
            counts.splice(0, 5, counts[2], counts[3], counts[4], 1, 0);
            state = 3;
          }
        } else {
          state += 1;
          counts[state] += 1;
        }
      }
      if (crossRatio(counts)) this.candidate(counts, y, width);
    }
    return this.found;
  }
}

/* ---- Geometry ------------------------------------------------------------ */

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Three finders as bottom-left, top-left and top-right. */
function order(a: Finder, b: Finder, c: Finder): [Finder, Finder, Finder] {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);
  const [first, topLeft, second] = bc >= ab && bc >= ac ? [b, a, c] : ac >= bc && ac >= ab ? [a, b, c] : [a, c, b];
  // The cross product says which way round the other two are.
  const clockwise = (second.x - topLeft.x) * (first.y - topLeft.y) - (second.y - topLeft.y) * (first.x - topLeft.x) >= 0;
  return clockwise ? [first, topLeft, second] : [second, topLeft, first];
}

/** The line through points, by their principal axis. */
function fitLine(points: Point[]): { point: Point; direction: Point } | null {
  if (points.length < 2) return null;
  const mx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const my = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    sxx += (point.x - mx) ** 2;
    sxy += (point.x - mx) * (point.y - my);
    syy += (point.y - my) ** 2;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { point: { x: mx, y: my }, direction: { x: Math.cos(theta), y: Math.sin(theta) } };
}

function intersect(a: { point: Point; direction: Point }, b: { point: Point; direction: Point }): Point | null {
  const denominator = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
  if (Math.abs(denominator) < 1e-6) return null;
  const t = ((b.point.x - a.point.x) * b.direction.y - (b.point.y - a.point.y) * b.direction.x) / denominator;
  return { x: a.point.x + a.direction.x * t, y: a.point.y + a.direction.y * t };
}

class Transform {
  constructor(private readonly m: number[]) {}

  static squareToQuad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): Transform {
    const dx3 = x0 - x1 + x2 - x3;
    const dy3 = y0 - y1 + y2 - y3;
    if (dx3 === 0 && dy3 === 0) return new Transform([x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1]);
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const denominator = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / denominator;
    const a23 = (dx1 * dy3 - dx3 * dy1) / denominator;
    return new Transform([x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1]);
  }

  adjoint(): Transform {
    const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = this.m;
    return new Transform([a22 * a33 - a23 * a32, a23 * a31 - a21 * a33, a21 * a32 - a22 * a31, a13 * a32 - a12 * a33, a11 * a33 - a13 * a31, a12 * a31 - a11 * a32, a12 * a23 - a13 * a22, a13 * a21 - a11 * a23, a11 * a22 - a12 * a21]);
  }

  times(other: Transform): Transform {
    const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = this.m;
    const [b11, b21, b31, b12, b22, b32, b13, b23, b33] = other.m;
    return new Transform([
      a11 * b11 + a21 * b12 + a31 * b13,
      a11 * b21 + a21 * b22 + a31 * b23,
      a11 * b31 + a21 * b32 + a31 * b33,
      a12 * b11 + a22 * b12 + a32 * b13,
      a12 * b21 + a22 * b22 + a32 * b23,
      a12 * b31 + a22 * b32 + a32 * b33,
      a13 * b11 + a23 * b12 + a33 * b13,
      a13 * b21 + a23 * b22 + a33 * b23,
      a13 * b31 + a23 * b32 + a33 * b33,
    ]);
  }

  apply(x: number, y: number): Point {
    const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = this.m;
    const denominator = a13 * x + a23 * y + a33;
    return { x: (a11 * x + a21 * y + a31) / denominator, y: (a12 * x + a22 * y + a32) / denominator };
  }

  /** The transform taking one quadrilateral's corners to another's. */
  static quadToQuad(from: Point[], to: Point[]): Transform {
    const toSquare = Transform.squareToQuad(from[0].x, from[0].y, from[1].x, from[1].y, from[2].x, from[2].y, from[3].x, from[3].y).adjoint();
    const fromSquare = Transform.squareToQuad(to[0].x, to[0].y, to[1].x, to[1].y, to[2].x, to[2].y, to[3].x, to[3].y);
    return fromSquare.times(toSquare);
  }
}

class Sampler {
  constructor(private readonly image: BitImage) {}

  private get(x: number, y: number): number {
    return this.image.bits[y * this.image.width + x];
  }

  /** The length of a dark-light-dark run from one point towards another, by Bresenham's line. */
  private run(fromX: number, fromY: number, toX: number, toY: number): number {
    const steep = Math.abs(toY - fromY) > Math.abs(toX - fromX);
    if (steep) [fromX, fromY, toX, toY] = [fromY, fromX, toY, toX];
    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    let error = -dx / 2;
    const xStep = fromX < toX ? 1 : -1;
    const yStep = fromY < toY ? 1 : -1;
    let state = 0;
    const xLimit = toX + xStep;
    for (let x = fromX, y = fromY; x !== xLimit; x += xStep) {
      const realX = steep ? y : x;
      const realY = steep ? x : y;
      if ((state === 1) === (this.get(realX, realY) === 1)) {
        if (state === 2) return Math.hypot(x - fromX, y - fromY);
        state += 1;
      }
      error += dy;
      if (error > 0) {
        if (y === toY) break;
        y += yStep;
        error -= dx;
      }
    }
    return state === 2 ? Math.hypot(toX + xStep - fromX, toY - fromY) : NaN;
  }

  private runBothWays(fromX: number, fromY: number, toX: number, toY: number): number {
    const { width, height } = this.image;
    let result = this.run(fromX, fromY, toX, toY);
    let scale = 1;
    let otherX = fromX - (toX - fromX);
    if (otherX < 0) {
      scale = fromX / (fromX - otherX);
      otherX = 0;
    } else if (otherX >= width) {
      scale = (width - 1 - fromX) / (otherX - fromX);
      otherX = width - 1;
    }
    let otherY = Math.floor(fromY - (toY - fromY) * scale);
    scale = 1;
    if (otherY < 0) {
      scale = fromY / (fromY - otherY);
      otherY = 0;
    } else if (otherY >= height) {
      scale = (height - 1 - fromY) / (otherY - fromY);
      otherY = height - 1;
    }
    otherX = Math.floor(fromX + (otherX - fromX) * scale);
    result += this.run(fromX, fromY, otherX, otherY);
    return result - 1;
  }

  private moduleSizeOneWay(a: Point, b: Point): number {
    const one = this.runBothWays(Math.floor(a.x), Math.floor(a.y), Math.floor(b.x), Math.floor(b.y));
    const two = this.runBothWays(Math.floor(b.x), Math.floor(b.y), Math.floor(a.x), Math.floor(a.y));
    if (Number.isNaN(one)) return two / 7;
    if (Number.isNaN(two)) return one / 7;
    return (one + two) / 14;
  }

  moduleSize(topLeft: Point, topRight: Point, bottomLeft: Point): number {
    return (this.moduleSizeOneWay(topLeft, topRight) + this.moduleSizeOneWay(topLeft, bottomLeft)) / 2;
  }

  /** An alignment pattern - one dark module ringed by light - near where it should be. */
  alignment(moduleSize: number, estimateX: number, estimateY: number, allowance: number): Point | null {
    const { width, height } = this.image;
    const reach = Math.floor(allowance * moduleSize);
    const left = Math.max(0, estimateX - reach);
    const right = Math.min(width - 1, estimateX + reach);
    const top = Math.max(0, estimateY - reach);
    const bottom = Math.min(height - 1, estimateY + reach);
    if (right - left < moduleSize * 3 || bottom - top < moduleSize * 3) return null;
    const ratio = (counts: number[]) => counts.every((count) => Math.abs(moduleSize - count) < moduleSize / 2);
    const candidates: { x: number; y: number; size: number }[] = [];
    const vertical = (startY: number, x: number, maxCount: number, total: number): number => {
      const counts = [0, 0, 0];
      let y = startY;
      while (y >= 0 && this.get(x, y) && counts[1] <= maxCount) {
        counts[1] += 1;
        y -= 1;
      }
      if (y < 0 || counts[1] > maxCount) return NaN;
      while (y >= 0 && !this.get(x, y) && counts[0] <= maxCount) {
        counts[0] += 1;
        y -= 1;
      }
      if (counts[0] > maxCount) return NaN;
      y = startY + 1;
      while (y < height && this.get(x, y) && counts[1] <= maxCount) {
        counts[1] += 1;
        y += 1;
      }
      if (y === height || counts[1] > maxCount) return NaN;
      while (y < height && !this.get(x, y) && counts[2] <= maxCount) {
        counts[2] += 1;
        y += 1;
      }
      if (counts[2] > maxCount) return NaN;
      if (5 * Math.abs(counts[0] + counts[1] + counts[2] - total) >= 2 * total) return NaN;
      return ratio(counts) ? y - counts[2] - counts[1] / 2 : NaN;
    };
    const consider = (counts: number[], y: number, x: number): Point | null => {
      const total = counts[0] + counts[1] + counts[2];
      const cx = x - counts[2] - counts[1] / 2;
      const cy = vertical(y, Math.floor(cx), 2 * counts[1], total);
      if (Number.isNaN(cy)) return null;
      const size = total / 3;
      for (const candidate of candidates) {
        if (Math.abs(cy - candidate.y) <= size && Math.abs(cx - candidate.x) <= size && (Math.abs(size - candidate.size) <= 1 || Math.abs(size - candidate.size) <= candidate.size)) {
          return { x: (candidate.x + cx) / 2, y: (candidate.y + cy) / 2 };
        }
      }
      candidates.push({ x: cx, y: cy, size });
      return null;
    };
    const middle = top + Math.floor((bottom - top) / 2);
    for (let offset = 0; offset < bottom - top; offset += 1) {
      const y = middle + (offset & 1 ? -((offset + 1) >> 1) : (offset + 1) >> 1);
      if (y < top || y > bottom) continue;
      const counts = [0, 0, 0];
      let x = left;
      while (x < right && !this.get(x, y)) x += 1;
      let state = 0;
      for (; x < right; x += 1) {
        if (this.get(x, y)) {
          if (state === 1) counts[1] += 1;
          else if (state === 2) {
            if (ratio(counts)) {
              const confirmed = consider(counts, y, x);
              if (confirmed) return confirmed;
            }
            counts[0] = counts[2];
            counts[1] = 1;
            counts[2] = 0;
            state = 1;
          } else {
            state += 1;
            counts[state] += 1;
          }
        } else {
          if (state === 1) state += 1;
          counts[state] += 1;
        }
      }
      if (ratio(counts)) {
        const confirmed = consider(counts, y, right);
        if (confirmed) return confirmed;
      }
    }
    return candidates[0] ?? null;
  }

  /**
   * The outer square of a finder pattern, as the picture shows it: rays cast from the centre
   * find the outside edge of the dark ring, the edges are fitted as lines, and the corners are
   * where they meet. Under perspective the square is a quadrilateral whose sides run the same
   * way as the code's own edges, which is what places the code's fourth corner.
   */
  finderQuad(finder: Finder): Point[] | null {
    const { width, height } = this.image;
    const rays = 48;
    const points: { x: number; y: number; angle: number }[] = [];
    for (let ray = 0; ray < rays; ray += 1) {
      const angle = (2 * Math.PI * ray) / rays;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let state = 0;
      for (let t = 0; t < finder.size * 10; t += 0.5) {
        const x = Math.round(finder.x + dx * t);
        const y = Math.round(finder.y + dy * t);
        if (x < 0 || y < 0 || x >= width || y >= height) break;
        const dark = this.get(x, y) === 1;
        if (state === 0 && !dark) state = 1;
        else if (state === 1 && dark) state = 2;
        else if (state === 2 && !dark) {
          if (t >= finder.size * 1.5) points.push({ x: finder.x + dx * (t - 0.25), y: finder.y + dy * (t - 0.25), angle });
          break;
        }
      }
    }
    // The row scan's module size is only a guess under perspective; the ring's own radius is better.
    const radii = points.map((point) => Math.hypot(point.x - finder.x, point.y - finder.y)).sort((p, q) => p - q);
    const radius = radii[Math.floor(radii.length / 2)] ?? 0;
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const r = Math.hypot(points[index].x - finder.x, points[index].y - finder.y);
      if (r < radius * 0.65 || r > radius * 1.75) points.splice(index, 1);
    }
    if (points.length < rays * 0.6) return null;
    // The farthest point is a corner, the point farthest from it the opposite corner, and the
    // points farthest from the line between them on either side the other two.
    const far = (from: Point) => points.reduce((best, point) => (Math.hypot(point.x - from.x, point.y - from.y) > Math.hypot(best.x - from.x, best.y - from.y) ? point : best), points[0]);
    const a = far(finder);
    const c = far(a);
    const side = (point: Point) => (c.x - a.x) * (point.y - a.y) - (c.y - a.y) * (point.x - a.x);
    let b = a;
    let d = a;
    for (const point of points) {
      if (side(point) > side(b)) b = point;
      if (side(point) < side(d)) d = point;
    }
    const corners = [a, b, c, d].sort((p, q) => p.angle - q.angle);
    if (new Set(corners).size < 4) return null;
    // Fit each side through the points between two corners, away from the corners themselves.
    const lines: { point: Point; direction: Point }[] = [];
    for (let index = 0; index < 4; index += 1) {
      const from = corners[index].angle;
      const to = index === 3 ? corners[0].angle + 2 * Math.PI : corners[index + 1].angle;
      const span = to - from;
      const members = points.filter((point) => {
        const angle = point.angle < from ? point.angle + 2 * Math.PI : point.angle;
        return angle > from + span * 0.2 && angle < to - span * 0.2;
      });
      const line = fitLine(members);
      if (!line) return null;
      // Refit without the points far off the first line: a ray that slipped past a blurred corner.
      const residual = (point: Point) => Math.abs((point.x - line.point.x) * line.direction.y - (point.y - line.point.y) * line.direction.x);
      const sorted = members.map(residual).sort((p, q) => p - q);
      const limit = Math.max(1, 2 * sorted[Math.floor(sorted.length / 2)]);
      const refit = fitLine(members.filter((point) => residual(point) <= limit)) ?? line;
      lines.push(refit);
    }
    const quad: Point[] = [];
    for (let index = 0; index < 4; index += 1) {
      const meet = intersect(lines[(index + 3) % 4], lines[index]);
      if (!meet || Math.hypot(meet.x - finder.x, meet.y - finder.y) > radius * 2.2) return null;
      quad.push(meet);
    }
    // The four sides are one square's; one far longer or shorter than the rest means a corner went astray.
    const sides = quad.map((point, index) => distance(point, quad[(index + 1) % 4]));
    const mean = sides.reduce((sum, side) => sum + side, 0) / 4;
    if (sides.some((side) => side < mean * 0.35 || side > mean * 2)) return null;
    return quad;
  }

  /** The grid read through a transform from module space to the picture. */
  grid(transform: Transform, size: number): Uint8Array | null {
    const { width, height } = this.image;
    const modules = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const point = transform.apply(x + 0.5, y + 0.5);
        let px = Math.floor(point.x);
        let py = Math.floor(point.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
        if (px < -1 || py < -1 || px > width || py > height) return null;
        px = Math.min(Math.max(px, 0), width - 1);
        py = Math.min(Math.max(py, 0), height - 1);
        modules[y * size + x] = this.get(px, py);
      }
    }
    return modules;
  }
}

/** Samples and decodes one guess at the grid: its size, and where module (from, from) sits in the picture. */
function attempt(sampler: Sampler, size: number, topLeft: Point, topRight: Point, bottomLeft: Point, corner: Point, from: number, hints?: number[]): FoundCode | null {
  const transform = Transform.quadToQuad(
    [
      { x: 3.5, y: 3.5 },
      { x: size - 3.5, y: 3.5 },
      { x: from, y: from },
      { x: 3.5, y: size - 3.5 },
    ],
    [topLeft, topRight, corner, bottomLeft],
  );
  return decodeGrid(sampler, transform, size, hints);
}

function decodeGrid(sampler: Sampler, transform: Transform, size: number, hints?: number[]): FoundCode | null {
  const modules = sampler.grid(transform, size);
  if (!modules) return null;
  try {
    const content = decodeModules(modules, size);
    const corners = [transform.apply(0, 0), transform.apply(size, 0), transform.apply(size, size), transform.apply(0, size)] as [Point, Point, Point, Point];
    return { ...content, corners };
  } catch (error) {
    if (error instanceof QrSizeMismatch && hints && !hints.includes(sizeOf(error.version))) hints.push(sizeOf(error.version));
    if (error instanceof QrReadError) return null;
    throw error;
  }
}

/** Tries one set of three finders at the grid sizes near the estimate. */
function readTriple(sampler: Sampler, finders: [Finder, Finder, Finder]): FoundCode | null {
  const [bottomLeft, topLeft, topRight] = order(...finders);
  const moduleSize = sampler.moduleSize(topLeft, topRight, bottomLeft);
  if (!(moduleSize >= 1)) return null;
  const across = Math.round(distance(topLeft, topRight) / moduleSize);
  const down = Math.round(distance(topLeft, bottomLeft) / moduleSize);
  const estimate = Math.floor((across + down) / 2) + 7;
  const sizes: number[] = [];
  for (let delta = 0; delta <= 8 && sizes.length < 4; delta += 1) {
    for (const size of delta === 0 ? [estimate] : [estimate + delta, estimate - delta]) {
      if (versionOfSize(size) !== null && !sizes.includes(size)) sizes.push(size);
    }
  }
  const parallelogram = { x: topRight.x - topLeft.x + bottomLeft.x, y: topRight.y - topLeft.y + bottomLeft.y };
  for (const size of sizes) {
    const version = versionOfSize(size)!;
    if (alignmentPositions(version).length > 0) {
      const correction = 1 - 3 / (sizeOf(version) - 7);
      const estimateX = Math.floor(topLeft.x + correction * (parallelogram.x - topLeft.x));
      const estimateY = Math.floor(topLeft.y + correction * (parallelogram.y - topLeft.y));
      for (let allowance = 4; allowance <= 16; allowance <<= 1) {
        const found = sampler.alignment(moduleSize, estimateX, estimateY, allowance);
        if (found) {
          const code = attempt(sampler, size, topLeft, topRight, bottomLeft, found, size - 6.5, sizes);
          if (code) return code;
          break;
        }
      }
    }
    const code = attempt(sampler, size, topLeft, topRight, bottomLeft, parallelogram, size - 3.5, sizes);
    if (code) return code;
    if (sizes.length > 8) break;
  }
  // A version block read at a wrong size names the right one, and those sizes were added to the list.
  // Seen at an angle, the fourth corner is not where a parallelogram puts it, and a small code
  // has no alignment pattern to say where it is. The finders' own squares show which way the
  // code's edges run: the top-right finder's right side and the bottom-left finder's bottom side
  // meet at the code's bottom-right corner.
  const quads = [sampler.finderQuad(topLeft), sampler.finderQuad(topRight), sampler.finderQuad(bottomLeft)];
  if (quads[1] && quads[2]) {
    const axisX = { x: topRight.x - topLeft.x, y: topRight.y - topLeft.y };
    const axisY = { x: bottomLeft.x - topLeft.x, y: bottomLeft.y - topLeft.y };
    const determinant = axisX.x * axisY.y - axisX.y * axisY.x;
    /** A finder's corner on the given side of its centre, in the code's own axes. */
    const cornerOf = (quad: Point[], centre: Point, sx: number, sy: number) =>
      quad.find((point) => {
        const px = point.x - centre.x;
        const py = point.y - centre.y;
        const u = (px * axisY.y - py * axisY.x) / determinant;
        const v = (axisX.x * py - axisX.y * px) / determinant;
        return Math.sign(u) === sx && Math.sign(v) === sy;
      });
    const [tlQuad, trQuad, blQuad] = quads as [Point[] | null, Point[], Point[]];
    const outerTopLeft = tlQuad ? cornerOf(tlQuad, topLeft, -1, -1) : undefined;
    const outerTopRight = cornerOf(trQuad, topRight, 1, -1);
    const innerRight = cornerOf(trQuad, topRight, 1, 1);
    const outerBottomLeft = cornerOf(blQuad, bottomLeft, -1, 1);
    const innerBottom = cornerOf(blQuad, bottomLeft, 1, 1);
    if (outerTopRight && innerRight && outerBottomLeft && innerBottom) {
      const bottomRight = intersect(
        { point: outerTopRight, direction: { x: innerRight.x - outerTopRight.x, y: innerRight.y - outerTopRight.y } },
        { point: outerBottomLeft, direction: { x: innerBottom.x - outerBottomLeft.x, y: innerBottom.y - outerBottomLeft.y } },
      );
      if (bottomRight) {
        for (const size of sizes) {
          // Without the top-left finder's corner, its centre stands in, three and a half modules in.
          const transform = Transform.quadToQuad(
            [
              outerTopLeft ? { x: 0, y: 0 } : { x: 3.5, y: 3.5 },
              { x: size, y: 0 },
              { x: size, y: size },
              { x: 0, y: size },
            ],
            [outerTopLeft ?? topLeft, outerTopRight, bottomRight, outerBottomLeft],
          );
          const code = decodeGrid(sampler, transform, size, sizes);
          if (code) return code;
          // The corners place the alignment pattern far better than a parallelogram does; the
          // finder centres and that pattern then give a transform that fits the middle of the code.
          const version = versionOfSize(size)!;
          if (alignmentPositions(version).length > 0) {
            const predicted = transform.apply(size - 6.5, size - 6.5);
            const next = transform.apply(size - 5.5, size - 6.5);
            const local = Math.hypot(next.x - predicted.x, next.y - predicted.y);
            const found = sampler.alignment(local, Math.round(predicted.x), Math.round(predicted.y), 3) ?? sampler.alignment(local, Math.round(predicted.x), Math.round(predicted.y), 6);
            if (found) {
              const refined = attempt(sampler, size, topLeft, topRight, bottomLeft, found, size - 6.5, sizes);
              if (refined) return refined;
            }
          }
          if (sizes.length > 10) break;
        }
      }
    }
  }
  return null;
}

/** How likely three finders are one code's corners: near-equal legs at a right angle, near-equal sizes. */
function tripleScore(a: Finder, b: Finder, c: Finder): number {
  const [bottomLeft, topLeft, topRight] = order(a, b, c);
  const sizes = [a.size, b.size, c.size];
  const sizeRatio = Math.max(...sizes) / Math.min(...sizes);
  if (sizeRatio > 2.5) return Infinity;
  const across = distance(topLeft, topRight);
  const down = distance(topLeft, bottomLeft);
  const legRatio = Math.max(across, down) / Math.min(across, down);
  if (legRatio > 2.2) return Infinity;
  const unit = (a.size + b.size + c.size) / 3;
  const modulesAcross = across / unit;
  if (modulesAcross < 10 || modulesAcross > 190) return Infinity;
  const cosine = ((topRight.x - topLeft.x) * (bottomLeft.x - topLeft.x) + (topRight.y - topLeft.y) * (bottomLeft.y - topLeft.y)) / (across * down);
  if (Math.abs(cosine) > 0.6) return Infinity;
  return (legRatio - 1) + (sizeRatio - 1) + Math.abs(cosine);
}

/** Every code in a black-and-white picture. */
function readAll(image: BitImage, limit: number): FoundCode[] {
  const step = Math.max(1, Math.min(3, Math.floor(image.height / 400)));
  const finders = new FinderSearch(image).run(step);
  const confirmed = finders.filter((finder) => finder.count >= 2);
  const pool = (confirmed.length >= 3 ? confirmed : finders).sort((a, b) => b.count - a.count).slice(0, 40);
  const triples: { members: [Finder, Finder, Finder]; score: number }[] = [];
  for (let a = 0; a < pool.length; a += 1) {
    for (let b = a + 1; b < pool.length; b += 1) {
      for (let c = b + 1; c < pool.length; c += 1) {
        const score = tripleScore(pool[a], pool[b], pool[c]);
        if (Number.isFinite(score)) triples.push({ members: [pool[a], pool[b], pool[c]], score });
      }
    }
  }
  triples.sort((a, b) => a.score - b.score);
  const sampler = new Sampler(image);
  const used = new Set<Finder>();
  const found: FoundCode[] = [];
  let tried = 0;
  for (const triple of triples) {
    if (found.length >= limit || tried >= 400) break;
    if (triple.members.some((member) => used.has(member))) continue;
    tried += 1;
    const code = readTriple(sampler, triple.members);
    if (code) {
      found.push(code);
      for (const member of triple.members) used.add(member);
    }
  }
  return found;
}

export interface ReadOptions {
  /** Stop after this many codes. */
  limit?: number;
}

/**
 * Every QR code in a picture, given as luminance. Light-on-dark codes are
 * read too, by trying the picture inverted when nothing is found as it is.
 */
export function readQrCodes(gray: Uint8Array, width: number, height: number, options: ReadOptions = {}): FoundCode[] {
  const limit = options.limit ?? 50;
  const image = binarize(gray, width, height);
  const results = readAll(image, limit);
  if (results.length === 0) results.push(...readAll(invert(image), limit));
  // The same code seen twice - a finder triple mistaken for another - is kept once.
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.text}|${Math.round(result.corners[0].x / 20)}|${Math.round(result.corners[0].y / 20)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A picture's luminance scaled down to at most `longest` pixels on its long side, by averaging. */
export function downscale(gray: Uint8Array, width: number, height: number, longest: number): { gray: Uint8Array; width: number; height: number; scale: number } {
  const scale = Math.max(width, height) / longest;
  if (scale <= 1) return { gray, width, height, scale: 1 };
  const outWidth = Math.max(1, Math.round(width / scale));
  const outHeight = Math.max(1, Math.round(height / scale));
  const out = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < outWidth; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) sum += gray[yy * width + xx];
      out[y * outWidth + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { gray: out, width: outWidth, height: outHeight, scale };
}

/**
 * Every QR code in a picture of any size. A large photo is read scaled down
 * first, which is quicker and smooths away sensor noise; when that finds
 * nothing it is read at full size, for a small code in a big picture, and
 * then smaller still, for a code blurred past reading at full size.
 */
export function readQrCodesAtScales(gray: Uint8Array, width: number, height: number, options: ReadOptions = {}): FoundCode[] {
  const longest = Math.max(width, height);
  const tried = new Set<number>();
  for (const target of [1600, longest, 800]) {
    const scaled = downscale(gray, width, height, Math.min(target, longest));
    if (tried.has(scaled.width)) continue;
    tried.add(scaled.width);
    const found = readQrCodes(scaled.gray, scaled.width, scaled.height, options);
    if (found.length > 0) {
      if (scaled.scale === 1) return found;
      return found.map((code) => ({ ...code, corners: code.corners.map((point) => ({ x: point.x * scaled.scale, y: point.y * scaled.scale })) as FoundCode["corners"] }));
    }
  }
  return [];
}
