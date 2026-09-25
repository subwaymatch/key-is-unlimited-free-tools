/**
 * Animated GIFs read, played through to whole frames, and written again
 * smaller.
 *
 * A GIF is a palette and a run of frames, each a rectangle of palette
 * indices compressed with LZW, drawn over what came before according to
 * its disposal method. The decoder composes every frame into a full RGBA
 * picture, exactly as a browser shows it. The optimiser then writes each
 * frame as only the rectangle that changed since the one before, with the
 * pixels inside it that did not change made transparent, which LZW
 * compresses to almost nothing; identical frames are merged into one with
 * their delays added; comments and application data other than the loop
 * count are dropped. Colours can also be reduced to one shared palette
 * built by median cut, which is lossy and much smaller.
 */
import { medianCut } from "./palette";

export class GifError extends Error {}

/** The file stops before its trailer. */
class Truncated extends Error {}

export interface GifFrame {
  /** Full-size RGBA, composed as a viewer shows it. */
  pixels: Uint8ClampedArray;
  /** Milliseconds. */
  delay: number;
}

export interface Gif {
  width: number;
  height: number;
  frames: GifFrame[];
  /** 0 loops forever; null means no loop block, played once. */
  loops: number | null;
  /** Bytes of comments and other application blocks, dropped when written again. */
  extraBytes: number;
  /** The file was cut short; the frames are the whole ones before the cut, as a browser plays them. */
  truncated: boolean;
}

/* ---- LZW ------------------------------------------------------------------ */

function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  for (let code = 0; code < clear; code += 1) {
    suffix[code] = code;
    prefix[code] = -1;
  }
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let previous = -1;
  let written = 0;
  let bits = 0;
  let buffer = 0;
  const stack = new Uint8Array(4096);
  for (let at = 0; at < data.length && written < pixelCount; ) {
    while (bits < codeSize && at < data.length) {
      buffer |= data[at++] << bits;
      bits += 8;
    }
    if (bits < codeSize) break;
    const code = buffer & ((1 << codeSize) - 1);
    buffer >>>= codeSize;
    bits -= codeSize;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    let entry = code;
    if (code >= next) {
      // The code being defined right now: the previous string plus its own first byte.
      if (previous < 0 || code > next) break;
      entry = previous;
    }
    let depth = 0;
    for (let walk = entry; walk >= 0 && depth < 4096; walk = prefix[walk]) stack[depth++] = suffix[walk];
    const first = stack[depth - 1];
    for (let index = depth - 1; index >= 0 && written < pixelCount; index -= 1) out[written++] = stack[index];
    if (code >= next && written < pixelCount) out[written++] = first;
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next += 1;
      if (next === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = code;
  }
  return out;
}

/** Palette indices compressed as GIF's LZW, in sub-blocks of at most 255 bytes. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  let codeSize = minCodeSize + 1;
  const emit = (code: number) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(buffer & 0xff);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  let table = new Map<number, number>();
  let next = end + 1;
  emit(clear);
  if (indices.length === 0) {
    emit(end);
    if (bits > 0) out.push(buffer & 0xff);
    return subBlocks(out);
  }
  let current = indices[0];
  for (let index = 1; index < indices.length; index += 1) {
    const value = indices[index];
    const key = current * 256 + value;
    const found = table.get(key);
    if (found !== undefined) {
      current = found;
      continue;
    }
    emit(current);
    if (next < 4096) {
      table.set(key, next);
      // A code is emitted at the width the decoder will use when it reads it.
      if (next === 1 << codeSize && codeSize < 12) codeSize += 1;
      next += 1;
    } else {
      emit(clear);
      table = new Map();
      next = end + 1;
      codeSize = minCodeSize + 1;
    }
    current = value;
  }
  emit(current);
  emit(end);
  if (bits > 0) out.push(buffer & 0xff);
  return subBlocks(out);
}

function subBlocks(data: number[]): Uint8Array {
  const out = new Uint8Array(data.length + Math.ceil(data.length / 255) + 1);
  let at = 0;
  for (let start = 0; start < data.length; start += 255) {
    const chunk = data.slice(start, start + 255);
    out[at++] = chunk.length;
    out.set(chunk, at);
    at += chunk.length;
  }
  out[at++] = 0;
  return out.subarray(0, at);
}

/* ---- Decoding -------------------------------------------------------------- */

/** Every frame composed; maxPixels bounds the frames' pixels added up, since each frame is kept whole. */
export function decodeGif(bytes: Uint8Array, maxPixels = Infinity): Gif {
  const signature = new TextDecoder("latin1").decode(bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") throw new GifError("This is not a GIF: it does not start with GIF87a or GIF89a.");
  if (bytes.length < 13) throw new GifError("The GIF is cut short: it ends inside its header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  if (width === 0 || height === 0) throw new GifError("This GIF says it is 0 pixels in size.");
  const packed = bytes[10];
  let at = 13;
  let globalTable: Uint8Array | null = null;
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 7) + 1));
    globalTable = bytes.subarray(at, at + size);
    at += size;
  }
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames: GifFrame[] = [];
  let loops: number | null = null;
  let extraBytes = 0;
  let transparent = -1;
  let delay = 0;
  let disposal = 0;
  const readBlocks = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      if (at >= bytes.length) throw new Truncated();
      const size = bytes[at++];
      if (size === 0) break;
      parts.push(bytes.subarray(at, at + size));
      total += size;
      at += size;
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    return joined;
  };
  let truncated = false;
  try {
    while (at < bytes.length) {
      const block = bytes[at++];
      if (block === 0x3b) break;
      if (block === 0x21) {
        const label = bytes[at++];
        const start = at;
        const data = readBlocks();
        if (label === 0xf9 && data.length >= 4) {
          disposal = (data[0] >> 2) & 7;
          delay = (data[1] | (data[2] << 8)) * 10;
          transparent = data[0] & 1 ? data[3] : -1;
        } else if (label === 0xff && data.length >= 11 && new TextDecoder("latin1").decode(data.subarray(0, 11)) === "NETSCAPE2.0") {
          const sub = data.subarray(11);
          if (sub[0] === 1) loops = sub[1] | (sub[2] << 8);
        } else extraBytes += at - start + 2;
      } else if (block === 0x2c) {
        if (at + 10 > bytes.length) throw new Truncated();
        const x = view.getUint16(at, true);
        const y = view.getUint16(at + 2, true);
        const w = view.getUint16(at + 4, true);
        const h = view.getUint16(at + 6, true);
        const flags = bytes[at + 8];
        at += 9;
        let table = globalTable;
        if (flags & 0x80) {
          const size = 3 * (1 << ((flags & 7) + 1));
          table = bytes.subarray(at, at + size);
          at += size;
          if (at >= bytes.length) throw new Truncated();
        }
        if (!table) throw new GifError("A frame has no colour table to draw with.");
        const minCodeSize = bytes[at++];
        if (minCodeSize < 2 || minCodeSize > 11) throw new GifError("A frame's compressed data is damaged.");
        const indices = lzwDecode(readBlocks(), minCodeSize, w * h);
        const before = disposal === 3 ? canvas.slice() : null;
        // Interlaced rows come in four passes: every eighth from 0, every eighth from 4, every fourth from 2, every second from 1.
        const rows: number[] = [];
        if (flags & 0x40) for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let row = start; row < h; row += step) rows.push(row);
        else for (let row = 0; row < h; row += 1) rows.push(row);
        rows.forEach((row, order) => {
          const py = y + row;
          if (py >= height) return;
          for (let column = 0; column < w; column += 1) {
            const px = x + column;
            if (px >= width) continue;
            const index = indices[order * w + column];
            if (index === transparent) continue;
            const target = (py * width + px) * 4;
            canvas[target] = table[index * 3] ?? 0;
            canvas[target + 1] = table[index * 3 + 1] ?? 0;
            canvas[target + 2] = table[index * 3 + 2] ?? 0;
            canvas[target + 3] = 255;
          }
        });
        if ((frames.length + 1) * width * height > maxPixels) throw new GifError(`This GIF is too long to optimise here: ${frames.length} frames of ${width} x ${height} fill all the memory a browser tab allows.`);
        frames.push({ pixels: canvas.slice(), delay });
        if (disposal === 2) {
          for (let row = y; row < Math.min(height, y + h); row += 1) canvas.fill(0, (row * width + x) * 4, (row * width + Math.min(width, x + w)) * 4);
        } else if (disposal === 3 && before) canvas.set(before);
        transparent = -1;
        delay = 0;
        disposal = 0;
      } else if (block === 0x00) {
        continue;
      } else throw new GifError(`The GIF has a block of a kind that does not exist (0x${block.toString(16)}).`);
    }
  } catch (error) {
    if (!(error instanceof Truncated)) throw error;
    truncated = true;
  }
  if (frames.length === 0) throw new GifError(truncated ? "The GIF is cut short before its first frame ends." : "This GIF has no frames in it.");
  return { width, height, frames, loops, extraBytes, truncated };
}

/* ---- Encoding -------------------------------------------------------------- */

export interface OptimizeOptions {
  /** Reduce to one shared palette of this many colours; null keeps every colour exactly. */
  colours: number | null;
}

export interface OptimizeResult {
  bytes: Uint8Array;
  frames: number;
  merged: number;
  /** Frames in the source, before identical ones were merged. */
  sourceFrames: number;
  /** True when colours had to be reduced because a frame held more than a GIF palette can. */
  reduced: boolean;
}

const colourKey = (pixels: Uint8ClampedArray, at: number) => (pixels[at + 3] < 128 ? -1 : (pixels[at] << 16) | (pixels[at + 1] << 8) | pixels[at + 2]);

function quantizer(frames: GifFrame[], count: number): (key: number) => number {
  // A sample of pixels from every frame is enough to find the palette.
  const total = frames.length * (frames[0].pixels.length / 4);
  const step = Math.max(1, Math.floor(total / 250_000));
  const sample: number[] = [];
  let seen = 0;
  for (const frame of frames) {
    for (let at = 0; at < frame.pixels.length; at += 4, seen += 1) {
      if (seen % step !== 0 || frame.pixels[at + 3] < 128) continue;
      sample.push(frame.pixels[at], frame.pixels[at + 1], frame.pixels[at + 2], 255);
    }
  }
  // One palette slot stays free for transparency.
  const palette = medianCut(Uint8ClampedArray.from(sample), Math.min(count, 255)).map((swatch) => (swatch.r << 16) | (swatch.g << 8) | swatch.b);
  const cache = new Map<number, number>();
  return (key: number) => {
    if (key < 0) return key;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const [r, g, b] = [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff];
    let best = palette[0] ?? 0;
    let bestDistance = Infinity;
    for (const colour of palette) {
      const dr = ((colour >> 16) & 0xff) - r;
      const dg = ((colour >> 8) & 0xff) - g;
      const db = (colour & 0xff) - b;
      const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = colour;
      }
    }
    cache.set(key, best);
    return best;
  };
}

class Writer {
  private chunks: number[] = [];
  private parts: Uint8Array[] = [];

  byte(value: number): void {
    this.chunks.push(value & 0xff);
  }

  word(value: number): void {
    this.byte(value);
    this.byte(value >> 8);
  }

  bytes(data: ArrayLike<number>): void {
    this.flush();
    this.parts.push(Uint8Array.from(data as ArrayLike<number>));
  }

  flush(): void {
    if (this.chunks.length > 0) {
      this.parts.push(Uint8Array.from(this.chunks));
      this.chunks = [];
    }
  }

  result(): Uint8Array {
    this.flush();
    const total = this.parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

class PaletteOverflow extends Error {}

/** The animation written again as small as it will go without changing how it looks (or, with colours, close to it). */
export function optimizeGif(gif: Gif, options: OptimizeOptions): OptimizeResult {
  try {
    return writeOptimized(gif, options.colours);
  } catch (error) {
    // Frames of a GIF with a palette each can compose to more colours than one frame may hold.
    if (!(error instanceof PaletteOverflow) || options.colours !== null) throw error;
    return { ...writeOptimized(gif, 255), reduced: true };
  }
}

function writeOptimized(gif: Gif, colourCount: number | null): OptimizeResult {
  const { width, height } = gif;
  const map = colourCount ? quantizer(gif.frames, colourCount) : (key: number) => key;
  const keyed = gif.frames.map((frame) => {
    const keys = new Int32Array(width * height);
    for (let index = 0; index < keys.length; index += 1) keys[index] = map(colourKey(frame.pixels, index * 4));
    return { keys, delay: frame.delay };
  });
  // Identical frames in a row become one, their delays added together.
  const frames: { keys: Int32Array; delay: number }[] = [];
  for (const frame of keyed) {
    const last = frames[frames.length - 1];
    if (last && last.keys.every((key, index) => key === frame.keys[index])) last.delay += frame.delay;
    else frames.push({ keys: frame.keys, delay: frame.delay });
  }
  const writer = new Writer();
  writer.bytes(new TextEncoder().encode("GIF89a"));
  writer.word(width);
  writer.word(height);
  writer.byte(0x70);
  writer.byte(0);
  writer.byte(0);
  if (frames.length > 1 || gif.loops !== null) {
    writer.bytes([0x21, 0xff, 0x0b, ...new TextEncoder().encode("NETSCAPE2.0"), 0x03, 0x01]);
    writer.word(gif.loops ?? 0);
    writer.byte(0);
  }
  let previous: Int32Array | null = null;
  frames.forEach((frame, index) => {
    // The rectangle that changed since the last frame, and whether anything in it turned transparent.
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    let reveals = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        if (previous && previous[at] === frame.keys[at]) continue;
        if (previous && frame.keys[at] < 0) reveals = true;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    // Graphic control: disposal 1 keeps this frame for the next to draw over; 2 clears it when the next reveals transparency.
    const nextReveals = index + 1 < frames.length && frames[index + 1].keys.some((key, at) => key < 0 && frame.keys[at] >= 0);
    // GIF cannot draw transparency over a pixel, so a frame that turns pixels transparent is drawn whole on
    // ground its predecessor cleared, and that predecessor is written whole so disposing it clears everything.
    const whole = previous === null || reveals || nextReveals;
    if (whole) {
      left = 0;
      top = 0;
      right = width - 1;
      bottom = height - 1;
    }
    const w = right - left + 1;
    const h = bottom - top + 1;
    const colours = new Map<number, number>();
    const indices = new Uint8Array(w * h);
    let transparentIndex = -1;
    const needsTransparency = (() => {
      for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
        const at = y * width + x;
        if (frame.keys[at] < 0 || (!whole && previous && previous[at] === frame.keys[at])) return true;
      }
      return false;
    })();
    if (needsTransparency) {
      transparentIndex = 0;
      colours.set(-1, 0);
    }
    let overflow = false;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const at = y * width + x;
        const key = frame.keys[at] < 0 || (!whole && previous && previous[at] === frame.keys[at]) ? -1 : frame.keys[at];
        let slot = colours.get(key);
        if (slot === undefined) {
          if (colours.size >= 256) {
            overflow = true;
            slot = 0;
          } else {
            slot = colours.size;
            colours.set(key, slot);
          }
        }
        indices[(y - top) * w + (x - left)] = slot;
      }
    }
    if (overflow) throw new PaletteOverflow();
    const bitsNeeded = Math.max(1, Math.ceil(Math.log2(Math.max(2, colours.size))));
    const tableSize = 1 << bitsNeeded;
    const table = new Uint8Array(tableSize * 3);
    for (const [key, slot] of colours) if (key >= 0) table.set([(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff], slot * 3);
    writer.bytes([0x21, 0xf9, 0x04, ((nextReveals ? 2 : 1) << 2) | (transparentIndex >= 0 ? 1 : 0)]);
    writer.word(Math.round(frame.delay / 10));
    writer.byte(Math.max(0, transparentIndex));
    writer.byte(0);
    writer.byte(0x2c);
    writer.word(left);
    writer.word(top);
    writer.word(w);
    writer.word(h);
    writer.byte(0x80 | (bitsNeeded - 1));
    writer.bytes(table);
    const minCodeSize = Math.max(2, bitsNeeded);
    writer.byte(minCodeSize);
    writer.bytes(lzwEncode(indices, minCodeSize));
    // After a frame whose successor reveals transparency, the next starts from cleared ground.
    previous = nextReveals ? null : frame.keys;
  });
  writer.byte(0x3b);
  return { bytes: writer.result(), frames: frames.length, merged: gif.frames.length - frames.length, sourceFrames: gif.frames.length, reduced: false };
}
