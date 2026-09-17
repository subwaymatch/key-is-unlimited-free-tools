import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";

import {
  addPageNumbers,
  describePageSize,
  describePdf,
  extractPages,
  imagesToPdf,
  loadPdf,
  mergePdfs,
  pageNumberText,
  pdfPageCount,
  placeImage,
  removePages,
  rotatePages,
  splitPdf,
} from "@/lib/pdf/pages";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const dir = join(tmpdir(), "key-is-pdf-tests");

async function pdfOf(pages: [number, number][]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const size of pages) document.addPage(size);
  return document.save();
}

describe("PDF pages", () => {
  it("reads a document and describes it", async () => {
    const bytes = await pdfOf([[595.28, 841.89], [612, 792]]);
    expect(await pdfPageCount(bytes)).toBe(2);
    expect(describePdf(await loadPdf(bytes))).toBe("2 pages, A4");
    expect(describePageSize(841.89, 595.28)).toBe("A4 landscape");
    expect(describePageSize(612, 792)).toBe("Letter");
    expect(describePageSize(300, 300)).toBe("106 x 106 mm");
  });

  it("refuses what is not a PDF, with the reason", async () => {
    await expect(loadPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(/could not be read as a PDF/);
  });

  it("merges in order, extracts, and splits into ranges", async () => {
    const a = await pdfOf([[100, 100], [100, 100]]);
    const b = await pdfOf([[200, 300]]);
    const seen: number[] = [];
    const merged = await loadPdf(await mergePdfs([a, b], (index) => seen.push(index)));
    expect(merged.getPageCount()).toBe(3);
    expect(merged.getPage(2).getSize()).toEqual({ width: 200, height: 300 });
    expect(seen).toEqual([0, 1]);

    const extracted = await loadPdf(await extractPages(merged, [{ from: 3, to: 3 }, { from: 1, to: 1 }]));
    expect(extracted.getPageCount()).toBe(2);
    expect(extracted.getPage(0).getSize()).toEqual({ width: 200, height: 300 });

    const pieces = await splitPdf(merged, [{ from: 1, to: 2 }, { from: 3, to: 3 }]);
    expect(pieces.map((piece) => piece.label)).toEqual(["1-2", "3"]);
    expect(await pdfPageCount(pieces[0].bytes)).toBe(2);
    expect(await pdfPageCount(pieces[1].bytes)).toBe(1);
  });

  it("rotates all pages or some, and removes pages", async () => {
    const all = await loadPdf(await rotatePages(await loadPdf(await pdfOf([[100, 100], [100, 100]])), 90, null));
    expect(all.getPages().map((page) => page.getRotation().angle)).toEqual([90, 90]);
    const some = await loadPdf(await rotatePages(all, 270, [1]));
    expect(some.getPages().map((page) => page.getRotation().angle)).toEqual([90, 0]);

    const fewer = await loadPdf(await removePages(await loadPdf(await pdfOf([[1, 1], [2, 2], [3, 3]])), [0, 2, 2]));
    expect(fewer.getPageCount()).toBe(1);
    expect(fewer.getPage(0).getSize()).toEqual({ width: 2, height: 2 });
    await expect(removePages(await loadPdf(await pdfOf([[1, 1]])), [0])).rejects.toThrow(/every page/);
  });

  it("numbers pages", async () => {
    const settings = { position: "bottom-center" as const, ofTotal: true, fontSize: 11, startAt: 3 };
    expect(pageNumberText(0, 4, settings)).toBe("3 of 6");
    expect(pageNumberText(1, 4, { ...settings, ofTotal: false })).toBe("4");
    const numbered = await loadPdf(await addPageNumbers(await loadPdf(await pdfOf([[200, 200], [200, 200]])), settings));
    expect(numbered.getPageCount()).toBe(2);
    // The text went into the page's content stream.
    expect(numbered.getPage(0).node.Contents()).toBeDefined();
  });

  it("places a picture on a page", () => {
    const fit = placeImage({ width: 800, height: 600 }, { page: "fit", margin: 0 });
    expect(fit).toEqual({ page: [800, 600], x: 0, y: 0, width: 800, height: 600 });
    const a4 = placeImage({ width: 800, height: 600 }, { page: "a4", margin: 36 });
    expect(a4.page).toEqual([841.89, 595.28]);
    // The height is the tight side: 523.28 tall inside the margins, centred across.
    expect(a4.height).toBeCloseTo(595.28 - 72, 2);
    expect(a4.width).toBeCloseTo((595.28 - 72) * (800 / 600), 2);
    expect(a4.x).toBeCloseTo((841.89 - a4.width) / 2, 2);
    const portrait = placeImage({ width: 600, height: 800 }, { page: "letter", margin: 36 });
    expect(portrait.page).toEqual([612, 792]);
    expect(portrait.height).toBeCloseTo(720, 2);
  });

  describe.skipIf(!hasFfmpeg)("with real pictures", () => {
    let png: Uint8Array;
    let jpg: Uint8Array;

    beforeAll(() => {
      mkdirSync(dir, { recursive: true });
      const make = (name: string, args: string[]) => {
        const path = join(dir, name);
        if (!existsSync(path)) execFileSync("ffmpeg", ["-y", "-v", "error", ...args, path]);
        return new Uint8Array(readFileSync(path));
      };
      png = make("red.png", ["-f", "lavfi", "-i", "color=c=red:s=40x30", "-frames:v", "1"]);
      jpg = make("blue.jpg", ["-f", "lavfi", "-i", "color=c=blue:s=30x40", "-frames:v", "1"]);
    });

    it("makes a page per picture, turned to suit each", async () => {
      const bytes = await imagesToPdf(
        [
          { bytes: png, mime: "image/png", width: 40, height: 30 },
          { bytes: jpg, mime: "image/jpeg", width: 30, height: 40 },
        ],
        { page: "a4", margin: 36 },
      );
      const document = await loadPdf(bytes);
      expect(document.getPageCount()).toBe(2);
      expect(document.getPage(0).getSize().width).toBeCloseTo(841.89, 1);
      expect(document.getPage(1).getSize().width).toBeCloseTo(595.28, 1);
    });
  });
});
