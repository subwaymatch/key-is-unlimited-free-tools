import { PDFDict, PDFDocument, PDFHexString, PDFName, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { BLANK_OPTIONS, describePages, inkShare, isBlank } from "@/lib/pdf/blank";
import { collatePdfs, interleaveOrder } from "@/lib/pdf/collate";
import { countOutline, parseOutline, writeOutline } from "@/lib/pdf/outline";
import { loadPdf } from "@/lib/pdf/pages";
import { largestFitting, splitPdfBySize } from "@/lib/pdf/sizeSplit";
import { pagesToStamp, stampImageOnPages, stampPlacement } from "@/lib/pdf/stampImage";

async function pdfOf(count: number, label = "", rotations: number[] = []): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) {
    const page = document.addPage([300, 400]);
    if (rotations[index]) page.setRotation(degrees(rotations[index]));
    page.drawText(`${label}${index + 1}`, { x: 20, y: 200, size: 24 });
  }
  return document.save();
}

/** A 1x1 red PNG. */
const RED_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
  (ch) => ch.charCodeAt(0),
);

describe("blank pages", () => {
  it("measures the share of ink and judges it by sensitivity", () => {
    const white = new Uint8ClampedArray(1000 * 4).fill(255);
    expect(inkShare(white, 40, 25)).toBe(0);
    const speck = new Uint8ClampedArray(1000 * 4).fill(255);
    speck.set([0, 0, 0, 255], 0);
    expect(inkShare(speck, 40, 25)).toBe(0.001);
    expect(isBlank(0.001, "strict")).toBe(false);
    expect(isBlank(0.001, "normal")).toBe(true);
    expect(isBlank(0.05, "loose")).toBe(false);
    // Light grey haze is paper, not ink.
    const haze = new Uint8ClampedArray(1000 * 4).fill(200);
    expect(inkShare(haze, 40, 25)).toBe(0);
    expect(BLANK_OPTIONS.map((option) => option.share)).toEqual([0.0002, 0.002, 0.01]);
  });

  it("names pages for a note", () => {
    expect(describePages([])).toBe("no pages");
    expect(describePages([1])).toBe("page 2");
    expect(describePages([1, 3, 6])).toBe("pages 2, 4 and 7");
    expect(describePages(Array.from({ length: 15 }, (_, index) => index))).toBe("pages 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 5 more");
  });
});

describe("collating two scans", () => {
  it("interleaves fronts with backs read backwards", () => {
    expect(interleaveOrder(3, 3, true).order).toEqual([
      { source: 0, index: 0 },
      { source: 1, index: 2 },
      { source: 0, index: 1 },
      { source: 1, index: 1 },
      { source: 0, index: 2 },
      { source: 1, index: 0 },
    ]);
    expect(interleaveOrder(3, 3, true).note).toBeNull();
    expect(interleaveOrder(2, 2, false).order.map((step) => `${step.source}:${step.index}`)).toEqual(["0:0", "1:0", "0:1", "1:1"]);
  });

  it("puts the extra pages of a longer file at the end and says so", () => {
    const order = interleaveOrder(3, 2, true);
    expect(order.order.map((step) => `${step.source}:${step.index}`)).toEqual(["0:0", "1:1", "0:1", "1:0", "0:2"]);
    expect(order.note).toContain("3 pages and the second 2");
    expect(interleaveOrder(1, 3, false).order.map((step) => `${step.source}:${step.index}`)).toEqual(["0:0", "1:0", "1:1", "1:2"]);
  });

  it("writes the collated document", async () => {
    const front = await loadPdf(await pdfOf(2, "F"));
    const back = await loadPdf(await pdfOf(2, "B"));
    const { bytes, order } = await collatePdfs(front, back, true);
    expect(order.order).toHaveLength(4);
    const merged = await loadPdf(bytes);
    expect(merged.getPageCount()).toBe(4);
  });
});

describe("splitting by size", () => {
  it("finds the longest run that fits by bisection", async () => {
    const calls: number[] = [];
    const sizeOf = async (count: number) => {
      calls.push(count);
      return 100 + count * 50;
    };
    expect(await largestFitting(sizeOf, 400, 10)).toEqual({ count: 6, bytes: 400, over: false });
    expect(calls[0]).toBe(10);
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(await largestFitting(sizeOf, 1000, 10)).toEqual({ count: 10, bytes: 600, over: false });
    expect(await largestFitting(sizeOf, 120, 10)).toEqual({ count: 1, bytes: 150, over: true });
    expect(await largestFitting(sizeOf, 120, 1)).toEqual({ count: 1, bytes: 150, over: true });
  });

  it("cuts a document into pieces under a limit", async () => {
    const source = await loadPdf(await pdfOf(6));
    const whole = (await source.save()).length;
    const pieces = await splitPdfBySize(source, Math.ceil(whole / 2), undefined);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces[0].first).toBe(0);
    expect(pieces[pieces.length - 1].last).toBe(5);
    for (const piece of pieces) expect(piece.bytes.length).toBeLessThanOrEqual(Math.ceil(whole / 2));
    let pages = 0;
    for (const piece of pieces) pages += (await loadPdf(piece.bytes)).getPageCount();
    expect(pages).toBe(6);
  });
});

describe("stamping a picture", () => {
  const mark = { width: 200, height: 100 };
  const settings = { corner: "bottom-right" as const, size: 0.2, margin: 0.05 };

  it("places it by the corner on an unrotated page", () => {
    const draw = stampPlacement({ width: 500, height: 800, rotation: 0 }, mark, settings);
    expect(draw).toEqual({ x: 500 - 25 - 100, y: 25, width: 100, height: 50, rotate: 0 });
    expect(stampPlacement({ width: 500, height: 800, rotation: 0 }, mark, { ...settings, corner: "top-left" })).toEqual({ x: 25, y: 800 - 25 - 50, width: 100, height: 50, rotate: 0 });
    expect(stampPlacement({ width: 500, height: 800, rotation: 0 }, mark, { ...settings, corner: "center" })).toEqual({ x: 200, y: 375, width: 100, height: 50, rotate: 0 });
  });

  it("turns the anchor with the page's own rotation", () => {
    // Stored 800 wide by 500 tall, shown turned a quarter clockwise: 500 by 800 like the page above.
    const face = { width: 800, height: 500, rotation: 90 };
    expect(stampPlacement(face, mark, settings)).toEqual({ x: 800 - 25, y: 375, width: 100, height: 50, rotate: 90 });
    expect(stampPlacement({ width: 500, height: 800, rotation: 180 }, mark, settings)).toEqual({ x: 500 - 375, y: 800 - 25, width: 100, height: 50, rotate: 180 });
    expect(stampPlacement({ width: 800, height: 500, rotation: 270 }, mark, settings)).toEqual({ x: 25, y: 500 - 375, width: 100, height: 50, rotate: 270 });
  });

  it("keeps a tall mark inside a short page", () => {
    const draw = stampPlacement({ width: 500, height: 100, rotation: 0 }, { width: 100, height: 400 }, { ...settings, size: 0.6 });
    expect(draw.height).toBe(90);
    expect(draw.width).toBe(22.5);
  });

  it("names the pages to stamp", () => {
    expect(pagesToStamp(5, "all", "")).toEqual({ indices: [0, 1, 2, 3, 4], problem: null });
    expect(pagesToStamp(5, "first", "")).toEqual({ indices: [0], problem: null });
    expect(pagesToStamp(5, "last", "")).toEqual({ indices: [4], problem: null });
    expect(pagesToStamp(5, "ranges", "2-3, 5, 3")).toEqual({ indices: [1, 2, 4], problem: null });
    expect(pagesToStamp(5, "ranges", "").problem).toBeTruthy();
    expect(pagesToStamp(0, "all", "").problem).toBeTruthy();
  });

  it("draws the picture on the pages asked", async () => {
    const source = await loadPdf(await pdfOf(3));
    const { bytes, stamped } = await stampImageOnPages(source, { bytes: RED_PNG, mime: "image/png", width: 1, height: 1 }, { corner: "bottom-right", size: 0.2, margin: 0.04, opacity: 0.8, pages: "last", ranges: "" });
    expect(stamped).toBe(1);
    const out = await loadPdf(bytes);
    expect(out.getPageCount()).toBe(3);
    const xobjects = (page: number) => out.getPage(page).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.keys().length ?? 0;
    expect(xobjects(2)).toBe(1);
    expect(xobjects(0)).toBe(0);
  });
});

describe("outlines", () => {
  it("parses page-then-title lines with nesting", () => {
    const parsed = parseOutline("1 Introduction\n3: Method\n  4 Sampling\n  5. Analysis\n\t\t6 Deep\n- 7 Dash\n8) Results\n", 10);
    expect(parsed.problems).toEqual([]);
    expect(parsed.items).toEqual([
      { page: 0, title: "Introduction", level: 0 },
      { page: 2, title: "Method", level: 0 },
      { page: 3, title: "Sampling", level: 1 },
      { page: 4, title: "Analysis", level: 1 },
      { page: 5, title: "Deep", level: 2 },
      { page: 6, title: "Dash", level: 1 },
      { page: 7, title: "Results", level: 0 },
    ]);
  });

  it("takes a contents page's title-then-number lines, and reports the rest", () => {
    const parsed = parseOutline("Introduction ........ 2\nMethod 4\nAppendix p. 9\nNo number here\n12 Past the end\n3\n", 10);
    expect(parsed.items).toEqual([
      { page: 1, title: "Introduction", level: 0 },
      { page: 3, title: "Method", level: 0 },
      { page: 8, title: "Appendix", level: 0 },
    ]);
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.problems[0]).toContain("no page number");
    expect(parsed.problems[1]).toContain("page 12");
  });

  it("writes bookmarks a reader can walk, replacing any there", async () => {
    const source = await loadPdf(await pdfOf(4));
    expect(await countOutline(source)).toBe(0);
    const items = parseOutline("1 One\n2 Two\n  3 Two point one\n  4 Two point two\n", 4).items;
    const bytes = await writeOutline(source, items);
    const written = await loadPdf(bytes);
    expect(await countOutline(written)).toBe(4);
    const outlines = written.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    const first = written.context.lookup(outlines.get(PDFName.of("First")), PDFDict);
    expect((first.get(PDFName.of("Title")) as PDFHexString).decodeText()).toBe("One");
    const second = written.context.lookup(first.get(PDFName.of("Next")), PDFDict);
    expect((second.get(PDFName.of("Title")) as PDFHexString).decodeText()).toBe("Two");
    expect(second.has(PDFName.of("First"))).toBe(true);
    expect(written.catalog.get(PDFName.of("PageMode"))?.toString()).toBe("/UseOutlines");
    const again = await writeOutline(written, items.slice(0, 1));
    expect(await countOutline(await loadPdf(again))).toBe(1);
  });
});
