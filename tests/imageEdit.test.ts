import { describe, expect, it } from "vitest";

import { candidatesBySize, duplicatesReport, groupDuplicates, wastedBytes } from "@/lib/hash/duplicates";
import { ASPECTS, base64Length, base64Snippets, centredCrop, faviconSnippet, icoFromPngs, isAlreadyShape, markPlacement } from "@/lib/images/edit";

describe("cropping to a shape", () => {
  it("takes the largest centred rectangle of the shape", () => {
    expect(centredCrop({ width: 4000, height: 3000 }, { width: 1, height: 1 })).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
    expect(centredCrop({ width: 4000, height: 3000 }, { width: 16, height: 9 })).toEqual({ x: 0, y: 375, width: 4000, height: 2250 });
    expect(centredCrop({ width: 3000, height: 4000 }, { width: 9, height: 16 })).toEqual({ x: 375, y: 0, width: 2250, height: 4000 });
    expect(isAlreadyShape({ width: 1600, height: 900 }, { width: 16, height: 9 })).toBe(true);
    expect(isAlreadyShape({ width: 1600, height: 901 }, { width: 16, height: 9 })).toBe(false);
    expect(ASPECTS.map((aspect) => aspect.id)).toContain("4:5");
  });
});

describe("placing a mark", () => {
  it("insets from the chosen corner by a share of the width", () => {
    const base = { width: 1000, height: 500 };
    const mark = { width: 100, height: 40 };
    expect(markPlacement(base, mark, "top-left", 0.02)).toEqual({ x: 20, y: 20 });
    expect(markPlacement(base, mark, "bottom-right", 0.02)).toEqual({ x: 880, y: 440 });
    expect(markPlacement(base, mark, "center", 0.02)).toEqual({ x: 450, y: 230 });
  });
});

describe("favicons", () => {
  it("writes an ICO directory over PNG entries", () => {
    const small = new Uint8Array([1, 2, 3]);
    const large = new Uint8Array([4, 5, 6, 7]);
    const ico = icoFromPngs([
      { size: 16, bytes: small },
      { size: 256, bytes: large },
    ]);
    const view = new DataView(ico.buffer);
    expect(ico.length).toBe(6 + 32 + 7);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(2);
    expect(ico[6]).toBe(16);
    // 256 is written as 0, the ICO convention.
    expect(ico[22]).toBe(0);
    expect(view.getUint32(14, true)).toBe(3);
    expect(view.getUint32(18, true)).toBe(38);
    expect(view.getUint32(34, true)).toBe(41);
    expect(Array.from(ico.subarray(38, 41))).toEqual([1, 2, 3]);
    expect(faviconSnippet()).toContain('rel="apple-touch-icon"');
  });
});

describe("base64", () => {
  it("knows the size and writes the snippets", () => {
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
    const snippets = base64Snippets("data:image/png;base64,AAAA", 'a "quoted" alt');
    expect(snippets.html).toBe('<img src="data:image/png;base64,AAAA" alt="a &quot;quoted&quot; alt">');
    expect(snippets.css).toBe('background-image: url("data:image/png;base64,AAAA");');
  });
});

describe("duplicates", () => {
  it("hashes only what shares a size, and groups what matches", () => {
    const files = [
      { name: "a.jpg", size: 10 },
      { name: "b.jpg", size: 10 },
      { name: "c.jpg", size: 11 },
      { name: "d.jpg", size: 10 },
    ];
    expect(candidatesBySize(files).map((file) => file.name)).toEqual(["a.jpg", "b.jpg", "d.jpg"]);
    const groups = groupDuplicates([
      { name: "a.jpg", size: 10, hash: "x" },
      { name: "b.jpg", size: 10, hash: "x" },
      { name: "d.jpg", size: 10, hash: "y" },
      { name: "e.bin", size: 100, hash: "z" },
      { name: "f.bin", size: 100, hash: "z" },
      { name: "g.bin", size: 100, hash: "z" },
    ]);
    expect(groups).toEqual([
      { size: 100, hash: "z", names: ["e.bin", "f.bin", "g.bin"] },
      { size: 10, hash: "x", names: ["a.jpg", "b.jpg"] },
    ]);
    expect(wastedBytes(groups)).toBe(210);
    expect(duplicatesReport(groups, 6)).toContain("2 groups of identical files among 6:");
    expect(duplicatesReport([], 3)).toBe("No duplicates among 3 files.\n");
  });
});

describe("an exact size", () => {
  it("crops to the shape and covers, fits inside with bands, or stretches", async () => {
    const { exactPlan } = await import("@/lib/images/edit");
    const photo = { width: 4000, height: 3000 };
    expect(exactPlan(photo, { width: 1080, height: 1080 }, "crop")).toEqual({ crop: { x: 500, y: 0, width: 3000, height: 3000 }, x: 0, y: 0, width: 1080, height: 1080 });
    expect(exactPlan(photo, { width: 1080, height: 1080 }, "pad")).toEqual({ crop: { x: 0, y: 0, width: 4000, height: 3000 }, x: 0, y: 135, width: 1080, height: 810 });
    expect(exactPlan(photo, { width: 1200, height: 630 }, "stretch")).toEqual({ crop: { x: 0, y: 0, width: 4000, height: 3000 }, x: 0, y: 0, width: 1200, height: 630 });
    // Enlarging is allowed: an exact size is exact.
    expect(exactPlan({ width: 100, height: 50 }, { width: 400, height: 400 }, "pad")).toMatchObject({ x: 0, y: 100, width: 400, height: 200 });
  });
});
