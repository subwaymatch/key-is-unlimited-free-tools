/**
 * Checksums of a file of any size, a chunk at a time.
 *
 * The Web Crypto API hashes a buffer, which means the whole file in memory,
 * which is the one thing this site does not do. These are the same
 * algorithms written to take the file in pieces, so a 40 GB disk image is
 * hashed from a stream at a few hundred megabytes a second with the heap
 * flat. MD5 and SHA-1 are here because download pages still print them, not
 * because they are safe against anyone trying; the page says so.
 *
 * Pure, and tested against Node's own digests.
 */

export type HashAlgorithm = "sha256" | "sha1" | "md5" | "crc32";

export const HASH_ALGORITHMS: readonly { id: HashAlgorithm; label: string; blurb: string }[] = [
  { id: "sha256", label: "SHA-256", blurb: "What download pages print today, and what to verify against" },
  { id: "sha1", label: "SHA-1", blurb: "Git and older download pages; fine for spotting a corrupt copy, not a forged one" },
  { id: "md5", label: "MD5", blurb: "The oldest still in use; the same caveat as SHA-1" },
  { id: "crc32", label: "CRC-32", blurb: "The short check inside ZIP and PNG files" },
];

export interface Digest {
  update(bytes: Uint8Array): void;
  /** The hash as lower-case hex. Finishes the digest; do not update afterwards. */
  hex(): string;
}

const hex = (words: number[] | Uint32Array, bigEndian: boolean) =>
  Array.from(words, (word) => {
    const value = bigEndian ? word >>> 0 : ((word & 0xff) << 24) | ((word & 0xff00) << 8) | ((word >>> 8) & 0xff00) | (word >>> 24);
    return (value >>> 0).toString(16).padStart(8, "0");
  }).join("");

/** The 64-byte block buffering every Merkle-Damgard hash here shares. */
abstract class BlockDigest implements Digest {
  private buffer = new Uint8Array(64);
  private buffered = 0;
  private length = 0;
  protected finished = false;

  protected abstract block(bytes: Uint8Array, offset: number): void;
  protected abstract digestHex(): string;
  protected abstract readonly bigEndianLength: boolean;

  update(bytes: Uint8Array): void {
    if (this.finished) throw new Error("The digest is finished.");
    this.length += bytes.length;
    let at = 0;
    if (this.buffered > 0) {
      const take = Math.min(64 - this.buffered, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.buffered);
      this.buffered += take;
      at = take;
      if (this.buffered < 64) return;
      this.block(this.buffer, 0);
      this.buffered = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.block(bytes, at);
    if (at < bytes.length) {
      this.buffer.set(bytes.subarray(at));
      this.buffered = bytes.length - at;
    }
  }

  hex(): string {
    if (!this.finished) {
      const bits = this.length * 8;
      const padding = new Uint8Array(this.buffered < 56 ? 64 - this.buffered : 128 - this.buffered);
      padding[0] = 0x80;
      const view = new DataView(padding.buffer);
      const high = Math.floor(bits / 2 ** 32);
      const low = bits >>> 0;
      if (this.bigEndianLength) {
        view.setUint32(padding.length - 8, high);
        view.setUint32(padding.length - 4, low);
      } else {
        view.setUint32(padding.length - 8, low, true);
        view.setUint32(padding.length - 4, high, true);
      }
      this.update(padding);
      this.finished = true;
    }
    return this.digestHex();
  }
}

/* ---- SHA-256 ------------------------------------------------------------ */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256 extends BlockDigest {
  protected readonly bigEndianLength = true;
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Uint32Array(64);

  protected block(bytes: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }

  protected digestHex(): string {
    return hex(this.h, true);
  }
}

/* ---- SHA-1 -------------------------------------------------------------- */

class Sha1 extends BlockDigest {
  protected readonly bigEndianLength = true;
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private w = new Uint32Array(80);

  protected block(bytes: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    }
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let [a, b, c, d, e] = this.h;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
  }

  protected digestHex(): string {
    return hex(this.h, true);
  }
}

/* ---- MD5 ---------------------------------------------------------------- */

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = new Uint32Array(Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)));

class Md5 extends BlockDigest {
  protected readonly bigEndianLength = false;
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private m = new Uint32Array(16);

  protected block(bytes: Uint8Array, offset: number): void {
    const m = this.m;
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      m[i] = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
    }
    let [a, b, c, d] = this.h;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const t = d;
      d = c;
      c = b;
      const x = (a + f + MD5_K[i] + m[g]) >>> 0;
      b = (b + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) >>> 0;
      a = t;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
  }

  protected digestHex(): string {
    return hex(this.h, false);
  }
}

/* ---- CRC-32 ------------------------------------------------------------- */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let crc = i;
  for (let j = 0; j < 8; j += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  CRC_TABLE[i] = crc >>> 0;
}

class Crc32 implements Digest {
  private crc = 0xffffffff;

  update(bytes: Uint8Array): void {
    let crc = this.crc;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    this.crc = crc;
  }

  hex(): string {
    return ((this.crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  }
}

export function createDigest(algorithm: HashAlgorithm): Digest {
  switch (algorithm) {
    case "sha256":
      return new Sha256();
    case "sha1":
      return new Sha1();
    case "md5":
      return new Md5();
    case "crc32":
      return new Crc32();
  }
}

/** One pass over a byte source, feeding every digest asked for. */
export async function digestStream(
  chunks: AsyncIterable<Uint8Array>,
  algorithms: readonly HashAlgorithm[],
  onProgress?: (bytesDone: number) => void,
  signal?: AbortSignal,
): Promise<Record<HashAlgorithm, string>> {
  const digests = algorithms.map((algorithm) => [algorithm, createDigest(algorithm)] as const);
  let done = 0;
  for await (const chunk of chunks) {
    if (signal?.aborted) throw new Error("Cancelled.");
    for (const [, digest] of digests) digest.update(chunk);
    done += chunk.length;
    onProgress?.(done);
  }
  const out = {} as Record<HashAlgorithm, string>;
  for (const [algorithm, digest] of digests) out[algorithm] = digest.hex();
  return out;
}

/** Whether a typed hash is one of these, and which. */
export function matchDigest(expected: string, digests: Partial<Record<HashAlgorithm, string>>): HashAlgorithm | null {
  const wanted = expected.trim().toLowerCase().replace(/^(sha256|sha1|md5|crc32)[:=\s]+/, "");
  if (!/^[0-9a-f]{8,64}$/.test(wanted)) return null;
  for (const algorithm of Object.keys(digests) as HashAlgorithm[]) {
    if (digests[algorithm] === wanted) return algorithm;
  }
  return null;
}
