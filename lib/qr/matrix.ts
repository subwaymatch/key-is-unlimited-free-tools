/**
 * The grid of a QR code: where the fixed patterns sit, the order data
 * modules are filled in, and the eight masks. Shared by the writer, which
 * fills the grid, and the reader, which empties it in the same order.
 *
 * Modules are a Uint8Array of size * size, row by row, 1 for dark.
 */
import { alignmentPositions, sizeOf } from "./tables";

/** Which modules belong to finder, timing, alignment, format and version patterns. */
export function functionModules(version: number): Uint8Array {
  const size = sizeOf(version);
  const reserved = new Uint8Array(size * size);
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) reserved[y * size + x] = 1;
  };
  // Finders with their separators, and the format areas beside them.
  for (let y = 0; y < 9; y += 1) for (let x = 0; x < 9; x += 1) mark(x, y);
  for (let y = 0; y < 9; y += 1) for (let x = size - 8; x < size; x += 1) mark(x, y);
  for (let y = size - 8; y < size; y += 1) for (let x = 0; x < 9; x += 1) mark(x, y);
  // Timing patterns.
  for (let index = 0; index < size; index += 1) {
    mark(6, index);
    mark(index, 6);
  }
  const positions = alignmentPositions(version);
  for (const [a, ay] of positions.entries()) {
    for (const [b, bx] of positions.entries()) {
      const corner = (a === 0 && b === 0) || (a === 0 && b === positions.length - 1) || (a === positions.length - 1 && b === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(bx + dx, ay + dy);
    }
  }
  if (version >= 7) {
    for (let a = 0; a < 6; a += 1) {
      for (let b = size - 11; b < size - 8; b += 1) {
        mark(b, a);
        mark(a, b);
      }
    }
  }
  return reserved;
}

const ORDER = new Map<number, Int32Array>();

/** Every data module's index, in the order codeword bits fill them. */
export function dataOrder(version: number): Int32Array {
  const cached = ORDER.get(version);
  if (cached) return cached;
  const size = sizeOf(version);
  const reserved = functionModules(version);
  const order: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (!reserved[y * size + x]) order.push(y * size + x);
      }
    }
  }
  const result = Int32Array.from(order);
  ORDER.set(version, result);
  return result;
}

/** Whether mask `mask` flips the module at column x, row y. */
export function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}
