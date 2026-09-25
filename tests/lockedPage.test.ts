import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { encryptBlob } from "@/lib/crypto/passphrase";
import { CORE_SCRIPT, lockedPageParts, readLockedPage } from "@/lib/crypto/lockedPage";

/** The page's own functions, run as the page runs them. */
const core = new Function(`${CORE_SCRIPT}; return { keyisBase64, keyisOpen, keyisReadZip };`)() as {
  keyisBase64: (text: string) => Uint8Array;
  keyisOpen: (sealed: Uint8Array, passphrase: string, progress?: (share: number) => void) => Promise<Uint8Array>;
  keyisReadZip: (bytes: Uint8Array) => { name: string; data: Uint8Array }[];
};

const FAST = { iterations: 1000, chunkBytes: 1000 };

async function seal(bytes: Uint8Array, passphrase: string): Promise<Uint8Array> {
  return new Uint8Array(await (await encryptBlob(new Blob([bytes as BlobPart]), passphrase, FAST)).arrayBuffer());
}

function payloadText(parts: string[]): string {
  const html = parts.join("");
  return /<script type="application\/x-keyis-sealed"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1];
}

describe("a locked page", () => {
  const files = {
    "report.pdf": new Uint8Array(5000).map((_, index) => (index * 7) & 0xff),
    "notes/caf\u00e9.txt": strToU8("Meet at noon.\n"),
    "empty.bin": new Uint8Array(0),
  };

  it("carries the sealed bytes, which read back unchanged", async () => {
    const sealed = await seal(zipSync(files, { level: 0 }), "correct horse");
    const parts = lockedPageParts({ sealed, kind: "files", message: "From Ada", summary: "3 files, 5 KB." });
    const read = readLockedPage(parts.join(""));
    expect(read?.kind).toBe("files");
    expect(Buffer.from(read!.sealed).equals(Buffer.from(sealed))).toBe(true);
    // Every line but the last is exactly 4,096 characters, so the page can decode them one at a time.
    const lines = payloadText(parts).trim().split("\n");
    expect(lines.slice(0, -1).every((line) => line.length === 4096)).toBe(true);
    expect(Buffer.from(core.keyisBase64(payloadText(parts))).equals(Buffer.from(sealed))).toBe(true);
  });

  it("opens with the page's own script, across chunk boundaries, and lists the files", async () => {
    const zip = zipSync(files, { level: 0 });
    const sealed = await seal(zip, "correct horse");
    const shares: number[] = [];
    const plain = await core.keyisOpen(sealed, "correct horse", (share) => shares.push(share));
    expect(Buffer.from(plain).equals(Buffer.from(zip))).toBe(true);
    expect(shares.length).toBe(Math.ceil(zip.length / 1000));
    expect(shares[shares.length - 1]).toBe(1);
    const listed = core.keyisReadZip(plain);
    expect(listed.map((file) => file.name)).toEqual(Object.keys(files));
    for (const file of listed) expect(Buffer.from(file.data).equals(Buffer.from(files[file.name as keyof typeof files]))).toBe(true);
    // fflate agrees about what is in it.
    expect(Object.keys(unzipSync(plain))).toEqual(Object.keys(files));
  });

  it("says which of the passphrase or the file is wrong", async () => {
    const sealed = await seal(new Uint8Array(3500).fill(9), "right one");
    await expect(core.keyisOpen(sealed, "wrong one")).rejects.toThrow("passphrase");
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(core.keyisOpen(tampered, "right one")).rejects.toThrow("damaged");
    await expect(core.keyisOpen(sealed.subarray(0, sealed.length - 20), "right one")).rejects.toThrow("damaged");
  });

  it("holds a note, and escapes the message it shows in the clear", async () => {
    const sealed = await seal(strToU8("The code is 4417."), "pass phrase");
    const html = lockedPageParts({ sealed, kind: "note", message: '<img src=x onerror="alert(1)">', summary: "A note." }).join("");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(new TextDecoder().decode(await core.keyisOpen(readLockedPage(html)!.sealed, "pass phrase"))).toBe("The code is 4417.");
  });

  it("allows the page no network access", () => {
    const html = lockedPageParts({ sealed: new Uint8Array(60), kind: "files", message: "", summary: "" }).join("");
    expect(html).toContain(`content="default-src 'none'; script-src 'unsafe-inline'`);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=/);
  });

  it("is not fooled by HTML that is not a locked page", () => {
    expect(readLockedPage("<html><body>hello</body></html>")).toBeNull();
  });
});
