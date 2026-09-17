import { describe, expect, it } from "vitest";

import { frameCount, gifFrameCount, isAnimatedPng, isAnimatedWebp } from "@/lib/images/animation";

/** A GIF with a given number of image descriptors, built by hand. */
function gif(frames: number, { globalTable = true } = {}): Uint8Array {
  const bytes: number[] = [];
  for (const character of "GIF89a") bytes.push(character.charCodeAt(0));
  // Logical screen descriptor: 1x1, packed, background, aspect.
  bytes.push(1, 0, 1, 0, globalTable ? 0x80 : 0x00, 0, 0);
  if (globalTable) bytes.push(0, 0, 0, 0xff, 0xff, 0xff); // Two colours.
  for (let index = 0; index < frames; index += 1) {
    // Graphic control extension, which every animated frame carries.
    bytes.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00);
    // Image descriptor: separator, left, top, width, height, packed.
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00);
    // LZW minimum code size, one data sub-block, terminator.
    bytes.push(0x02, 0x02, 0x44, 0x01, 0x00);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

/** A PNG holding the named chunks in order, with the right lengths. */
function png(chunks: readonly string[]): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const name of chunks) {
    bytes.push(0, 0, 0, 0); // Length zero: nothing between the name and the CRC.
    for (const character of name) bytes.push(character.charCodeAt(0));
    bytes.push(0, 0, 0, 0); // CRC.
  }
  return new Uint8Array(bytes);
}

/** A RIFF/WEBP file holding the named chunks, each empty. */
function webp(chunks: readonly string[]): Uint8Array {
  const bytes: number[] = [];
  for (const character of "RIFF") bytes.push(character.charCodeAt(0));
  bytes.push(0, 0, 0, 0);
  for (const character of "WEBP") bytes.push(character.charCodeAt(0));
  for (const name of chunks) {
    for (const character of name) bytes.push(character.charCodeAt(0));
    bytes.push(0, 0, 0, 0); // Length zero.
  }
  return new Uint8Array(bytes);
}

describe("counting a GIF's frames", () => {
  it("walks the block stream, with and without a global colour table", () => {
    expect(gifFrameCount(gif(1))).toBe(1);
    expect(gifFrameCount(gif(12))).toBe(12);
    expect(gifFrameCount(gif(6, { globalTable: false }))).toBe(6);
  });

  it("is nothing at all for a file that is not a GIF", () => {
    expect(gifFrameCount(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(0);
    expect(gifFrameCount(new Uint8Array())).toBe(0);
  });
});

describe("the other two formats that move", () => {
  it("reads an APNG's animation control chunk, and stops at the first IDAT", () => {
    expect(isAnimatedPng(png(["acTL", "IDAT"]))).toBe(true);
    expect(isAnimatedPng(png(["IHDR", "IDAT", "acTL"]))).toBe(false);
    expect(isAnimatedPng(png(["IHDR", "IDAT"]))).toBe(false);
  });

  it("reads a WebP's frame chunks", () => {
    expect(isAnimatedWebp(webp(["VP8X", "ANIM", "ANMF"]))).toBe(true);
    expect(isAnimatedWebp(webp(["VP8 "]))).toBe(false);
  });
});

describe("frameCount", () => {
  it("tells a still from a picture that moves, and gives up on the rest", () => {
    expect(frameCount(gif(9))).toBe(9);
    expect(frameCount(png(["acTL", "IDAT"]))).toBe(2);
    expect(frameCount(png(["IHDR", "IDAT"]))).toBe(1);
    expect(frameCount(webp(["ANMF"]))).toBe(2);
    expect(frameCount(webp(["VP8 "]))).toBe(1);
    // A JPEG: nothing here can say, and 0 is what "cannot tell" reads as.
    expect(frameCount(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(0);
  });
});
