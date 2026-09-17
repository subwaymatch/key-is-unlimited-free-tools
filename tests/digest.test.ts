import { createHash } from "node:crypto";
import { crc32 as nodeCrc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createDigest, digestStream, HASH_ALGORITHMS, matchDigest, type HashAlgorithm } from "@/lib/hash/digest";

function bytesOf(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

function expected(algorithm: HashAlgorithm, bytes: Uint8Array): string {
  if (algorithm === "crc32") return nodeCrc32(bytes).toString(16).padStart(8, "0");
  return createHash(algorithm).update(bytes).digest("hex");
}

async function* inChunks(bytes: Uint8Array, size: number) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

describe("the digests", () => {
  const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 129, 1000, 100_003];

  for (const { id } of HASH_ALGORITHMS) {
    it(`${id} matches Node whatever the length and however the bytes arrive`, () => {
      for (const length of lengths) {
        const bytes = bytesOf(length, length + 1);
        for (const chunk of [1, 7, 64, 100, 4096]) {
          const digest = createDigest(id);
          for (let at = 0; at < length; at += chunk) digest.update(bytes.subarray(at, at + chunk));
          expect(digest.hex(), `${id} of ${length} bytes in ${chunk}-byte chunks`).toBe(expected(id, bytes));
        }
      }
    });
  }

  it("knows the classic answers", () => {
    const abc = new TextEncoder().encode("abc");
    const sha256 = createDigest("sha256");
    sha256.update(abc);
    expect(sha256.hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const md5 = createDigest("md5");
    md5.update(abc);
    expect(md5.hex()).toBe("900150983cd24fb0d6963f7d28e17f72");
    const sha1 = createDigest("sha1");
    sha1.update(abc);
    expect(sha1.hex()).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(createDigest("sha256").hex()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("refuses more bytes once finished", () => {
    const digest = createDigest("sha1");
    digest.hex();
    expect(() => digest.update(new Uint8Array(1))).toThrow(/finished/);
  });

  it("streams every digest asked for in one pass, reporting progress", async () => {
    const bytes = bytesOf(10_000);
    const progress: number[] = [];
    const result = await digestStream(inChunks(bytes, 3000), ["sha256", "md5", "crc32"], (done) => progress.push(done));
    expect(result.sha256).toBe(expected("sha256", bytes));
    expect(result.md5).toBe(expected("md5", bytes));
    expect(result.crc32).toBe(expected("crc32", bytes));
    expect(progress).toEqual([3000, 6000, 9000, 10_000]);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(digestStream(inChunks(bytesOf(100), 10), ["sha1"], undefined, controller.signal)).rejects.toThrow(/Cancelled/);
  });

  it("matches a typed hash against the ones it computed, however it was pasted", () => {
    const digests = { sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", md5: "900150983cd24fb0d6963f7d28e17f72" };
    expect(matchDigest("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD", digests)).toBe("sha256");
    expect(matchDigest("  md5: 900150983cd24fb0d6963f7d28e17f72 ", digests)).toBe("md5");
    expect(matchDigest("900150983cd24fb0d6963f7d28e17f73", digests)).toBeNull();
    expect(matchDigest("not a hash", digests)).toBeNull();
  });
});
