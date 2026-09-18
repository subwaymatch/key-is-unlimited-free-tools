import { describe, expect, it } from "vitest";

import { chunkNonce, decryptBlob, encryptBlob, HEADER_BYTES, isSealed, readHeader, sealedName, sealedSize, TAG_BYTES, unsealedName, writeHeader } from "@/lib/crypto/passphrase";

function bytesOf(length: number, seed = 3): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

const FAST = { iterations: 1000, chunkBytes: 16 };
const blobBytes = async (blob: Blob): Promise<Uint8Array<ArrayBuffer>> => new Uint8Array(await blob.arrayBuffer());

/** The failure's message and hint together, since the block number is in the hint. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const plain = error as { message: string; hint?: string };
    return `${plain.message} ${plain.hint ?? ""}`;
  }
  throw new Error("expected a failure");
}

describe("sealing a file with a passphrase", () => {
  it("round-trips at every chunk boundary, with the size the card predicts", async () => {
    for (const length of [0, 1, 15, 16, 17, 31, 32, 33, 100]) {
      const plain = bytesOf(length, length + 1);
      const sealed = await encryptBlob(new Blob([plain]), "correct horse", FAST);
      expect(sealed.size, `${length} bytes`).toBe(sealedSize(length, FAST.chunkBytes));
      expect(isSealed(await blobBytes(sealed))).toBe(true);
      const opened = await decryptBlob(sealed, "correct horse");
      expect(await blobBytes(opened), `${length} bytes`).toEqual(plain);
    }
    expect(sealedSize(0)).toBe(HEADER_BYTES + TAG_BYTES);
  });

  it("refuses the wrong passphrase, and says so before blaming the file", async () => {
    const sealed = await encryptBlob(new Blob([bytesOf(50)]), "correct horse", FAST);
    await expect(decryptBlob(sealed, "wrong horse")).rejects.toThrow(/Wrong passphrase/);
  });

  it("refuses a changed, reordered or shortened file, naming the block", async () => {
    const sealed = await blobBytes(await encryptBlob(new Blob([bytesOf(50)]), "pw", FAST));
    const chunk = FAST.chunkBytes + TAG_BYTES;

    const flipped = sealed.slice();
    flipped[HEADER_BYTES + chunk + 3] ^= 0x01;
    expect(await failure(decryptBlob(new Blob([flipped]), "pw"))).toMatch(/has been changed.*Block 2 of 4/);

    const swapped = sealed.slice();
    swapped.set(sealed.subarray(HEADER_BYTES + chunk, HEADER_BYTES + chunk * 2), HEADER_BYTES);
    swapped.set(sealed.subarray(HEADER_BYTES, HEADER_BYTES + chunk), HEADER_BYTES + chunk);
    await expect(decryptBlob(new Blob([swapped]), "pw")).rejects.toThrow(/Wrong passphrase/);

    // The last block is the only one flagged last, so dropping it is caught.
    const shortened = sealed.subarray(0, HEADER_BYTES + chunk * 3);
    expect(await failure(decryptBlob(new Blob([shortened]), "pw"))).toMatch(/Block 3 of 3/);

    const cut = sealed.subarray(0, sealed.length - 5);
    await expect(decryptBlob(new Blob([cut]), "pw")).rejects.toThrow(/cut short/);

    const tampered = sealed.slice();
    tampered[HEADER_BYTES - 1] ^= 0xff;
    await expect(decryptBlob(new Blob([tampered]), "pw")).rejects.toThrow(/Wrong passphrase/);
  });

  it("refuses what was not sealed here", async () => {
    await expect(decryptBlob(new Blob([bytesOf(100)]), "pw")).rejects.toThrow(/not encrypted here/);
    expect(() => readHeader(bytesOf(10))).toThrow(/not encrypted here/);
    const header = writeHeader(bytesOf(16), 1000, 16, bytesOf(7));
    expect(readHeader(header)).toMatchObject({ iterations: 1000, chunkBytes: 16 });
    const newer = header.slice();
    newer[8] = 2;
    expect(() => readHeader(newer)).toThrow(/newer version/);
  });

  it("gives every chunk a nonce of its own", () => {
    const prefix = bytesOf(7);
    const first = chunkNonce(prefix, 0, false);
    const second = chunkNonce(prefix, 1, false);
    const last = chunkNonce(prefix, 1, true);
    expect(first.length).toBe(12);
    expect(first).not.toEqual(second);
    expect(second).not.toEqual(last);
    expect(Array.from(second.subarray(7))).toEqual([0, 0, 0, 1, 0]);
  });

  it("names the files", () => {
    expect(sealedName("photo.jpg")).toBe("photo.jpg.enc");
    expect(unsealedName("photo.jpg.enc")).toBe("photo.jpg");
    expect(unsealedName("photo.jpg")).toBe("photo-decrypted.jpg");
    expect(unsealedName("notes")).toBe("notes-decrypted");
  });
});
