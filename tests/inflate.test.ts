import { constants, deflateRawSync, deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { InflateError, inflateRaw, inflateZlib } from "@/lib/zip/inflate";

function sample(size: number, seed: number): Uint8Array {
  // Text-like data with repeats, so every block type and long matches appear.
  const words = ["alpha ", "beta ", "gamma ", "delta\n", "0123456789", "the quick brown fox "];
  const out = new Uint8Array(size);
  let state = seed;
  for (let at = 0; at < size; ) {
    state = (state * 1103515245 + 12345) >>> 0;
    const word = new TextEncoder().encode(words[state % words.length]);
    for (let index = 0; index < word.length && at < size; index += 1) out[at++] = state & 0x100 ? word[index] : (word[index] ^ (state >>> 24)) & 0xff;
  }
  return out;
}

describe("inflate", () => {
  it("reads what zlib writes at every level, and says where each stream ends", () => {
    for (const level of [0, 1, 6, 9]) {
      for (const size of [0, 1, 100, 70_000, 300_000]) {
        const data = sample(size, size + level);
        const packed = deflateSync(data, { level });
        // Two streams back to back, as a git packfile lays them out.
        const joined = new Uint8Array(packed.length * 2);
        joined.set(packed, 0);
        joined.set(packed, packed.length);
        const first = inflateZlib(joined, 0);
        expect(first.consumed, `level ${level}, ${size} bytes`).toBe(packed.length);
        expect(Buffer.from(first.data).equals(Buffer.from(data))).toBe(true);
        const second = inflateZlib(joined, first.consumed);
        expect(second.consumed).toBe(packed.length);
        expect(Buffer.from(second.data).equals(Buffer.from(data))).toBe(true);
      }
    }
  });

  it("reads fixed-Huffman and stored blocks, and raw streams", () => {
    const data = sample(5000, 3);
    const fixed = deflateRawSync(data, { strategy: constants.Z_FIXED });
    expect(Buffer.from(inflateRaw(fixed).data).equals(Buffer.from(data))).toBe(true);
    expect(inflateRaw(fixed).consumed).toBe(fixed.length);
    const stored = deflateRawSync(data, { level: 0 });
    expect(Buffer.from(inflateRaw(stored).data).equals(Buffer.from(data))).toBe(true);
  });

  it("refuses damage: a bad header, a wrong checksum, data cut short", () => {
    const packed = deflateSync(sample(2000, 9));
    expect(() => inflateZlib(Uint8Array.from([0x12, 0x34]))).toThrow(InflateError);
    const wrong = Uint8Array.from(packed);
    wrong[wrong.length - 1] ^= 1;
    expect(() => inflateZlib(wrong)).toThrow(/checksum/);
    expect(() => inflateZlib(packed.subarray(0, packed.length - 10))).toThrow(InflateError);
  });
});
