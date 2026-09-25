import { describe, expect, it } from "vitest";

import { decodeGif, GifError, lzwEncode, optimizeGif, type Gif } from "@/lib/images/gif";

import { PILLOW_GIFS, PILLOW_NOISE } from "./gifFixtures";

const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

function sameFrames(a: Gif, b: Gif): void {
  expect(b.width).toBe(a.width);
  expect(b.height).toBe(a.height);
  expect(b.frames.length).toBe(a.frames.length);
  a.frames.forEach((frame, index) => {
    expect(Buffer.from(b.frames[index].pixels).equals(Buffer.from(frame.pixels))).toBe(true);
    expect(b.frames[index].delay).toBe(frame.delay);
  });
}

/** Frames with identical neighbours merged and their delays added, as the optimiser does. */
function mergedFrames(gif: Gif): Gif {
  const frames: Gif["frames"] = [];
  for (const frame of gif.frames) {
    const last = frames[frames.length - 1];
    if (last && Buffer.from(last.pixels).equals(Buffer.from(frame.pixels))) last.delay += frame.delay;
    else frames.push({ pixels: frame.pixels, delay: frame.delay });
  }
  return { ...gif, frames };
}

function noiseIndices(): number[] {
  let seed = 12345;
  const indices: number[] = [];
  for (let index = 0; index < 64 * 64; index += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    indices.push((seed >> 16) & 0xff);
  }
  return indices;
}

/** A tiny GIF written by hand, so a test can shape its blocks. */
function handmade(frames: { x: number; y: number; w: number; h: number; indices: number[]; disposal?: number; transparent?: number }[], width = 4, height = 4, palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]): Uint8Array {
  const bytes: number[] = [...Buffer.from("GIF89a"), width, 0, height, 0, 0x81, 0, 0, ...palette];
  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 4, ((frame.disposal ?? 1) << 2) | (frame.transparent !== undefined ? 1 : 0), 10, 0, frame.transparent ?? 0, 0);
    bytes.push(0x2c, frame.x, 0, frame.y, 0, frame.w, 0, frame.h, 0, 0);
    bytes.push(2, ...lzwEncode(Uint8Array.from(frame.indices), 2));
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

describe("decoding GIFs", () => {
  for (const [name, fixture] of Object.entries(PILLOW_GIFS)) {
    it(`${name}: every frame composes to what Pillow shows`, () => {
      const gif = decodeGif(fromBase64(fixture.gif));
      expect(gif.width).toBe(fixture.width);
      expect(gif.height).toBe(fixture.height);
      expect(gif.frames.map((frame) => frame.delay)).toEqual(fixture.delays);
      expect(gif.loops).toBe(fixture.loop);
      gif.frames.forEach((frame, index) => {
        const expected = fromBase64(fixture.frames[index]);
        expect(Buffer.from(frame.pixels).equals(Buffer.from(expected))).toBe(true);
      });
    });
  }

  it("reads LZW data that fills the code table and starts again", () => {
    const gif = decodeGif(fromBase64(PILLOW_NOISE));
    expect(gif.frames).toHaveLength(1);
    const pixels = gif.frames[0].pixels;
    noiseIndices().forEach((value, index) => {
      expect([pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2], pixels[index * 4 + 3]]).toEqual([value, 255 - value, (value * 7) & 255, 255]);
    });
  });

  it("clears a disposed frame's rectangle to transparent and restores the one before", () => {
    const gif = decodeGif(
      handmade([
        { x: 0, y: 0, w: 4, h: 4, indices: new Array(16).fill(1) },
        { x: 1, y: 1, w: 2, h: 2, indices: [2, 2, 2, 2], disposal: 3 },
        { x: 0, y: 0, w: 1, h: 1, indices: [3], disposal: 2 },
        { x: 3, y: 3, w: 1, h: 1, indices: [2] },
      ]),
    );
    const at = (frame: number, x: number, y: number) => Array.from(gif.frames[frame].pixels.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(at(1, 1, 1)).toEqual([0, 255, 0, 255]);
    // Frame 2 is drawn over frame 1 restored away: the green square is gone.
    expect(at(2, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(2, 0, 0)).toEqual([0, 0, 255, 255]);
    // Frame 2 was disposed to transparent before frame 3.
    expect(at(3, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(3, 3, 3)).toEqual([0, 255, 0, 255]);
  });

  it("explains what is wrong with a file that is not a GIF, or is cut short", () => {
    expect(() => decodeGif(new TextEncoder().encode("PNG not a gif"))).toThrow(GifError);
    const whole = fromBase64(PILLOW_GIFS.basic.gif);
    expect(() => decodeGif(whole.subarray(0, 60))).toThrow(/cut short/);
  });

  it("plays a file cut short up to its last whole frame, as a browser does", () => {
    const whole = fromBase64(PILLOW_GIFS.basic.gif);
    const gif = decodeGif(whole.subarray(0, whole.length - 20));
    expect(gif.truncated).toBe(true);
    expect(gif.frames).toHaveLength(PILLOW_GIFS.basic.frames.length - 1);
    expect(decodeGif(whole).truncated).toBe(false);
  });

  it("stops at a limit on the pixels it keeps", () => {
    expect(() => decodeGif(fromBase64(PILLOW_GIFS.basic.gif), 20 * 16 * 2)).toThrow(/too long/);
  });
});

describe("optimising GIFs", () => {
  for (const [name, fixture] of Object.entries(PILLOW_GIFS)) {
    it(`${name}: written again, it plays exactly the same`, () => {
      const source = decodeGif(fromBase64(fixture.gif));
      const result = optimizeGif(source, { colours: null });
      expect(result.reduced).toBe(false);
      const again = decodeGif(result.bytes);
      sameFrames(mergedFrames(source), again);
      expect(again.loops).toBe(source.frames.length > 1 ? (source.loops ?? 0) : source.loops);
    });
  }

  it("merges identical frames, adding their delays", () => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    const other = pixels.slice();
    other.set([255, 0, 0, 255], 0);
    const result = optimizeGif({ width: 8, height: 8, loops: 0, extraBytes: 0, truncated: false, frames: [{ pixels, delay: 100 }, { pixels: pixels.slice(), delay: 50 }, { pixels: other, delay: 30 }] }, { colours: null });
    expect(result.frames).toBe(2);
    expect(result.merged).toBe(1);
    expect(decodeGif(result.bytes).frames.map((frame) => frame.delay)).toEqual([150, 30]);
  });

  it("writes only the rectangle that changed", () => {
    const base = new Uint8ClampedArray(40 * 30 * 4);
    for (let index = 0; index < base.length; index += 4) base.set([(index / 4) % 40 * 6, 90, 200, 255], index);
    const changed = base.slice();
    changed.set([0, 0, 0, 255], (12 * 40 + 20) * 4);
    const result = optimizeGif({ width: 40, height: 30, loops: 0, extraBytes: 0, truncated: false, frames: [{ pixels: base, delay: 100 }, { pixels: changed, delay: 100 }] }, { colours: null });
    // The second image descriptor covers the one changed pixel.
    const descriptors = [...result.bytes.keys()].filter((at) => result.bytes[at] === 0x2c && result.bytes[at - 1] === 0 && result.bytes[at - 7] === 0xf9);
    const last = descriptors[descriptors.length - 1];
    expect([result.bytes[last + 1], result.bytes[last + 3], result.bytes[last + 5], result.bytes[last + 7]]).toEqual([20, 12, 1, 1]);
    sameFrames({ width: 40, height: 30, loops: 0, extraBytes: 0, truncated: false, frames: [{ pixels: base, delay: 100 }, { pixels: changed, delay: 100 }] }, decodeGif(result.bytes));
  });

  it("clears the ground when a later frame turns pixels transparent", () => {
    const opaque = new Uint8ClampedArray(6 * 6 * 4);
    for (let index = 0; index < opaque.length; index += 4) opaque.set([200, 50, 50, 255], index);
    const holed = opaque.slice();
    holed.fill(0, 0, 6 * 4 * 2);
    const moved = opaque.slice();
    moved.set([10, 10, 10, 255], 35 * 4);
    const source: Gif = { width: 6, height: 6, loops: 0, extraBytes: 0, truncated: false, frames: [{ pixels: moved, delay: 50 }, { pixels: opaque, delay: 50 }, { pixels: holed, delay: 50 }, { pixels: opaque.slice(), delay: 50 }] };
    sameFrames(source, decodeGif(optimizeGif(source, { colours: null }).bytes));
  });

  it("keeps every pixel of noise that fills LZW's table", () => {
    const gif = decodeGif(fromBase64(PILLOW_NOISE));
    const result = optimizeGif(gif, { colours: null });
    sameFrames(gif, decodeGif(result.bytes));
  });

  it("reduces colours to a shared palette, close to the original", () => {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) pixels.set([x * 8, y * 8, 128, 255], (y * 32 + x) * 4);
    const result = optimizeGif({ width: 32, height: 32, loops: 0, extraBytes: 0, truncated: false, frames: [{ pixels, delay: 100 }] }, { colours: 16 });
    const out = decodeGif(result.bytes).frames[0].pixels;
    const colours = new Set<number>();
    let error = 0;
    for (let index = 0; index < out.length; index += 4) {
      colours.add((out[index] << 16) | (out[index + 1] << 8) | out[index + 2]);
      error += Math.abs(out[index] - pixels[index]) + Math.abs(out[index + 1] - pixels[index + 1]);
    }
    expect(colours.size).toBeLessThanOrEqual(16);
    expect(error / (32 * 32)).toBeLessThan(40);
  });

  it("falls back to 255 colours when frames compose to more than one palette holds", () => {
    const pixels = new Uint8ClampedArray(20 * 20 * 4);
    for (let index = 0; index < 400; index += 1) pixels.set([index % 256, Math.floor(index / 2) % 256, 7, 255], index * 4);
    const result = optimizeGif({ width: 20, height: 20, loops: null, extraBytes: 0, truncated: false, frames: [{ pixels, delay: 0 }] }, { colours: null });
    expect(result.reduced).toBe(true);
    expect(decodeGif(result.bytes).frames).toHaveLength(1);
  });
});
