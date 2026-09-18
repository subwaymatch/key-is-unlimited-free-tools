import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { cropPdfPages, insetBox, insetsFromBounds, pageFaces, resizePdfPages, resizePlan, unrotatedInsets } from "@/lib/pdf/pageBoxes";
import { loadPdf } from "@/lib/pdf/pages";
import { contentBounds, rgbaFrom } from "@/lib/pdf/pixels";

const a4 = { width: 595.28, height: 841.89, rotation: 0 };

describe("resizing pages", () => {
  it("fits each page on its paper, turned the way the page goes", () => {
    const plan = resizePlan([a4, { width: 800, height: 400, rotation: 0 }, { width: 100, height: 100, rotation: 0 }], { paper: "letter", orientation: "auto", enlarge: false, margin: 0 });
    expect(plan.pages[0]).toMatchObject({ width: 612, height: 792 });
    expect(plan.pages[0].scale).toBeCloseTo(792 / 841.89, 5);
    expect(plan.pages[1]).toMatchObject({ width: 792, height: 612 });
    expect(plan.pages[2].scale).toBe(1);
    expect(plan.pages[2].draw).toMatchObject({ x: 256, y: 346, width: 100, height: 100, rotate: 0 });
    expect(plan).toMatchObject({ scaledDown: 2, scaledUp: 0 });
  });

  it("enlarges when asked, keeps a margin, and honours a page's own turn", () => {
    const grown = resizePlan([{ width: 100, height: 100, rotation: 0 }], { paper: "a5", orientation: "portrait", enlarge: true, margin: 20 });
    expect(grown.pages[0].scale).toBeCloseTo((419.53 - 40) / 100, 5);
    expect(grown.scaledUp).toBe(1);
    const turned = resizePlan([{ width: 841.89, height: 595.28, rotation: 90 }], { paper: "a4", orientation: "auto", enlarge: false, margin: 0 });
    // Shown portrait, so portrait paper, drawn turned back into place.
    expect(turned.pages[0]).toMatchObject({ width: 595.28, height: 841.89 });
    expect(turned.pages[0].draw.rotate).toBe(-90);
    expect(turned.pages[0].scale).toBe(1);
  });

  it("writes the pages through pdf-lib, blank pages included", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 300]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    source.addPage([300, 300]);
    const document = await loadPdf(await source.save());
    expect(pageFaces(document)).toEqual([{ width: 300, height: 300, rotation: 0 }, { width: 300, height: 300, rotation: 0 }]);
    const { bytes, plan } = await resizePdfPages(document, { paper: "letter", orientation: "portrait", enlarge: true, margin: 0 });
    const out = await loadPdf(bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(1).getSize()).toEqual({ width: 612, height: 792 });
    expect(plan.scaledUp).toBe(2);
  });
});

describe("cropping pages", () => {
  const insets = { top: 1, right: 2, bottom: 3, left: 4 };

  it("maps the shown edges onto the stored ones for each turn", () => {
    expect(unrotatedInsets(insets, 0)).toEqual(insets);
    // A clockwise quarter turn shows the stored left edge at the top.
    expect(unrotatedInsets(insets, 90)).toEqual({ top: 2, right: 3, bottom: 4, left: 1 });
    expect(unrotatedInsets(insets, 180)).toEqual({ top: 3, right: 4, bottom: 1, left: 2 });
    expect(unrotatedInsets(insets, 270)).toEqual({ top: 4, right: 1, bottom: 2, left: 3 });
    expect(unrotatedInsets(insets, -90)).toEqual(unrotatedInsets(insets, 270));
  });

  it("insets a box and never crops a page away", () => {
    expect(insetBox({ x: 0, y: 0, width: 300, height: 400 }, insets)).toEqual({ x: 4, y: 3, width: 294, height: 396 });
    expect(insetBox({ x: 10, y: 20, width: 300, height: 400 }, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual({ x: 10, y: 20, width: 300, height: 400 });
    const tiny = insetBox({ x: 0, y: 0, width: 100, height: 100 }, { top: 90, right: 90, bottom: 90, left: 90 });
    expect(tiny.width).toBe(18);
    expect(tiny.x + tiny.width).toBeLessThanOrEqual(100);
  });

  it("turns rendered bounds into insets, keeping a little around", () => {
    const rendered = { width: 200, height: 400, scale: 2 };
    expect(insetsFromBounds({ left: 20, top: 40, right: 180, bottom: 380 }, rendered, 5)).toEqual({ top: 15, left: 5, right: 5, bottom: 5 });
    expect(insetsFromBounds({ left: 2, top: 0, right: 200, bottom: 400 }, rendered, 5)).toEqual({ top: 0, left: 0, right: 0, bottom: 0 });
  });

  it("finds where the ink is on a rendered page", () => {
    const width = 10;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x: number, y: number) => pixels.set([0, 0, 0, 255], (y * width + x) * 4);
    paint(3, 2);
    paint(7, 5);
    expect(contentBounds(pixels, width, height)).toEqual({ left: 3, top: 2, right: 8, bottom: 6 });
    expect(contentBounds(new Uint8ClampedArray(width * height * 4).fill(255), width, height)).toBeNull();
    // Faint grey is paper, not ink; a transparent pixel is nothing.
    const faint = new Uint8ClampedArray(width * height * 4).fill(255);
    faint.set([240, 240, 240, 255], 0);
    faint.set([0, 0, 0, 0], 4);
    expect(contentBounds(faint, width, height)).toBeNull();
  });

  it("sets every page box through pdf-lib, through the page's turn", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const turned = source.addPage([400, 300]);
    turned.setRotation(degrees(90));
    const document = await loadPdf(await source.save());
    const { bytes, cropped } = await cropPdfPages(document, (index) => (index === 0 ? { top: 50, right: 0, bottom: 0, left: 0 } : { top: 50, right: 0, bottom: 0, left: 0 }));
    expect(cropped).toBe(2);
    const out = await loadPdf(bytes);
    expect(out.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 300, height: 350 });
    expect(out.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 350 });
    // The turned page shows its stored left edge at the top, so 50 comes off the left.
    expect(out.getPage(1).getCropBox()).toEqual({ x: 50, y: 0, width: 350, height: 300 });
  });
});

describe("pixels from PDF.js image data", () => {
  it("expands the three layouts to RGBA", () => {
    expect(Array.from(rgbaFrom("rgb", new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1))).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(Array.from(rgbaFrom("rgba", new Uint8Array([1, 2, 3, 4]), 1, 1))).toEqual([1, 2, 3, 4]);
    // Ten pixels wide: one byte and two bits per row, rows padded to a byte.
    const bits = new Uint8Array([0b10000000, 0b01000000, 0b00000000, 0b11000000]);
    const grey = rgbaFrom("gray1", bits, 10, 2);
    const white = (x: number, y: number) => grey[(y * 10 + x) * 4] === 255;
    expect(white(0, 0)).toBe(true);
    expect(white(1, 0)).toBe(false);
    expect(white(8, 0)).toBe(false);
    expect(white(9, 0)).toBe(true);
    expect(white(0, 1)).toBe(false);
    expect(white(8, 1)).toBe(true);
    expect(white(9, 1)).toBe(true);
    expect(grey[3]).toBe(255);
  });
});
