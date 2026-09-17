import { describe, expect, it } from "vitest";

import { createZip, readZip, shouldStore, uniqueNames } from "@/lib/zip/archive";

function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

describe("ZIP archives", () => {
  it("stores what is already compressed and tells repeated names apart", () => {
    expect(shouldStore("photo.JPG")).toBe(true);
    expect(shouldStore("notes.txt")).toBe(false);
    expect(uniqueNames(["a.txt", "a.txt", "b", "b", "a.txt"])).toEqual(["a.txt", "a (2).txt", "b", "b (2)", "a (3).txt"]);
  });

  it("packs files and unpacks them back to the same bytes", async () => {
    const text = new File([new TextEncoder().encode("hello ".repeat(2000))], "notes.txt", { lastModified: 1_700_000_000_000 });
    const binary = new File([bytesOf(70_000)], "photo.png");
    const progress: number[] = [];
    const zip = await createZip([text, binary, text], (done) => progress.push(done));
    expect(zip.type).toBe("application/zip");
    // The text deflates; the "picture" is stored, so the archive is about its size.
    expect(zip.size).toBeGreaterThan(70_000);
    expect(zip.size).toBeLessThan(70_000 + 12_000 + 2000);
    expect(progress[progress.length - 1]).toBe(text.size * 2 + binary.size);

    const entries = await readZip(new File([zip], "bundle.zip"));
    expect(entries.map((entry) => entry.path)).toEqual(["notes.txt", "photo.png", "notes (2).txt"]);
    expect(new Uint8Array(await entries[1].blob.arrayBuffer())).toEqual(bytesOf(70_000));
    expect(await entries[0].blob.text()).toBe("hello ".repeat(2000));
  });

  it("skips folders and names each entry by its last part", async () => {
    const { zipSync } = await import("fflate");
    const packed = zipSync({ "docs/": new Uint8Array(0), "docs/readme.md": new TextEncoder().encode("# hi") });
    const entries = await readZip(new File([packed], "docs.zip"));
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("docs/readme.md");
    expect(entries[0].fileName).toBe("readme.md");
  });

  it("refuses what is not a ZIP, with the reason", async () => {
    await expect(readZip(new File([bytesOf(100)], "not.zip"))).rejects.toThrow(/could not be read as a ZIP|unpacked/);
  });
});
