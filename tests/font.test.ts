import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { coverage, FontError, readFont, readFontContainer } from "@/lib/files/font";

import { SUBSET_WOFF } from "./fontFixture";

// Every expected value below is what fontTools 4.66 reads from the same file.
const DEJAVU = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));

describe("a TrueType font", () => {
  const font = readFont(DEJAVU);

  it("reads its names, metrics and licence", () => {
    expect(font.flavor).toBe("TrueType");
    expect(font.names).toMatchObject({ family: "DejaVu Sans", subfamily: "Book", version: "Version 2.37", postScriptName: "DejaVuSans" });
    expect(font).toMatchObject({ glyphs: 6253, unitsPerEm: 2048, weight: 400, vendor: "PfEd", italic: false, monospaced: false });
    expect(font.embedding).toMatch(/^installable/);
  });

  it("finds every character its best cmap maps", () => {
    expect(font.codePoints.size).toBe(5918);
    expect(font.codePoints.has(0x41)).toBe(true);
    expect(font.codePoints.has(0x4e00)).toBe(false);
  });

  it("lists its OpenType features and scripts", () => {
    expect(font.features).toEqual([" RQD", "aalt", "case", "ccmp", "dlig", "fina", "hlig", "init", "kern", "liga", "locl", "mark", "medi", "mkmk", "rlig", "salt"]);
    expect(font.scripts).toEqual(["DFLT", "arab", "armn", "brai", "cans", "cher", "cyrl", "geor", "grek", "hani", "hebr", "kana", "lao ", "latn", "math", "nko ", "ogam", "runr", "tfng", "thai"]);
    expect(font.tables.map((table) => table.tag).sort()).toEqual(["FFTM", "GDEF", "GPOS", "GSUB", "MATH", "OS/2", "cmap", "cvt", "fpgm", "gasp", "glyf", "head", "hhea", "hmtx", "kern", "loca", "maxp", "name", "post", "prep"]);
  });

  it("says which languages it can set", () => {
    const { languages, blocks } = coverage(font.codePoints);
    const full = languages.filter((language) => language.missing.length === 0).map((language) => language.name.split(" ")[0]);
    expect(full).toEqual(expect.arrayContaining(["English", "Western", "Central", "Turkish", "Greek", "Russian", "Ukrainian", "Hebrew"]));
    expect(full).not.toContain("Chinese");
    expect(blocks.find((block) => block.name === "Basic Latin")).toEqual({ name: "Basic Latin", covered: 95, total: 95 });
  });
});

describe("a WOFF font", () => {
  it("inflates its tables and reads the same way", () => {
    const font = readFont(SUBSET_WOFF);
    expect(font.flavor).toBe("WOFF (TrueType)");
    expect(font.names.family).toBe("DejaVu Sans");
    expect(font.glyphs).toBe(20);
    expect([...font.codePoints].sort((a, b) => a - b)).toEqual([32, 33, 44, 72, 87, 100, 101, 108, 111, 114, 233, 261, 945, 1046]);
    // H, W, d, e, l, o and r are the only letters of English it has.
    expect(coverage(font.codePoints).languages[0].missing.length).toBe(52 - 7);
  });

  it("refuses WOFF2 and things that are not fonts", () => {
    expect(() => readFontContainer(new TextEncoder().encode("wOF2 and some more bytes"))).toThrow(/WOFF2/);
    expect(() => readFontContainer(deflateSync(new Uint8Array(100)))).toThrow(FontError);
  });
});
