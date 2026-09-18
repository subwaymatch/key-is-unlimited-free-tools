import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { bookletSides, imposePdf, imposePlan, normalRotation, sequentialSides, shownSize } from "@/lib/pdf/impose";
import { describeForm, flattenPdf, isIdentityOrder, loadPdf, pagesInOrder, reversedOrder, typedOrder } from "@/lib/pdf/pages";

async function pdfOf(pages: [number, number][], rotations: number[] = [], drawn = false): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  pages.forEach((size, index) => {
    const page = document.addPage(size);
    if (rotations[index]) page.setRotation(degrees(rotations[index]));
    if (drawn) page.drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
  });
  return document.save();
}

describe("booklet order", () => {
  it("pairs the outside with the inside, front and back, padded to a multiple of four", () => {
    expect(bookletSides(8)).toEqual([[7, 0], [1, 6], [5, 2], [3, 4]]);
    expect(bookletSides(5)).toEqual([[null, 0], [1, null], [null, 2], [3, 4]]);
    expect(bookletSides(1)).toEqual([[null, 0], [null, null]]);
    expect(sequentialSides(5, 2)).toEqual([[0, 1], [2, 3], [4, null]]);
    expect(sequentialSides(0, 4)).toEqual([[null, null, null, null]]);
  });
});

describe("the imposition plan", () => {
  const a4 = { width: 595, height: 842, rotation: 0 };

  it("puts two pages on a sheet twice as wide, unscaled", () => {
    const plan = imposePlan([a4, a4, a4], { layout: "2up", sheet: "double" });
    expect(plan).toMatchObject({ columns: 2, rows: 1, scaled: false });
    expect(plan.sheets).toHaveLength(2);
    expect(plan.sheets[0]).toMatchObject({ width: 1190, height: 842 });
    expect(plan.sheets[0].draws).toEqual([
      { page: 0, x: 0, y: 0, width: 595, height: 842, rotate: 0 },
      { page: 1, x: 595, y: 0, width: 595, height: 842, rotate: 0 },
    ]);
    expect(plan.sheets[1].draws).toEqual([{ page: 2, x: 0, y: 0, width: 595, height: 842, rotate: 0 }]);
  });

  it("scales pages down to fit a named sheet, landscape for two across and a 2 x 2 grid of portrait pages upright", () => {
    const two = imposePlan([a4, a4], { layout: "2up", sheet: "a4" });
    expect(two.sheets[0]).toMatchObject({ width: 841.89, height: 595.28 });
    expect(two.scaled).toBe(true);
    const draw = two.sheets[0].draws[0];
    expect(draw.width / 595).toBeCloseTo(draw.height / 842, 5);
    expect(draw.width).toBeLessThanOrEqual(841.89 / 2);

    const four = imposePlan([a4, a4, a4, a4], { layout: "4up", sheet: "letter" });
    expect(four.sheets[0]).toMatchObject({ width: 612, height: 792 });
    expect(four.sheets[0].draws).toHaveLength(4);
    // Top row first: page 0 sits higher than page 2.
    expect(four.sheets[0].draws[0].y).toBeGreaterThan(four.sheets[0].draws[2].y);
  });

  it("lays a booklet out in folding order", () => {
    const plan = imposePlan([a4, a4, a4, a4], { layout: "booklet", sheet: "double" });
    expect(plan.sheets.map((sheet) => sheet.draws.map((draw) => draw.page))).toEqual([[3, 0], [1, 2]]);
    expect(plan.sheets[0].draws[0].x).toBe(0);
    expect(plan.sheets[0].draws[1].x).toBe(595);
  });

  it("turns a page stored on its side the way its viewer shows it", () => {
    expect(shownSize({ width: 842, height: 595, rotation: 90 })).toEqual({ width: 595, height: 842 });
    expect(normalRotation(-90)).toBe(270);
    expect(normalRotation(450)).toBe(90);
    const turned = { width: 842, height: 595, rotation: 90 };
    const plan = imposePlan([turned, a4], { layout: "2up", sheet: "double" });
    expect(plan.sheets[0]).toMatchObject({ width: 1190, height: 842 });
    expect(plan.sheets[0].draws[0]).toEqual({ page: 0, x: 0, y: 842, width: 842, height: 595, rotate: -90 });
    const upsideDown = imposePlan([{ ...a4, rotation: 180 }], { layout: "2up", sheet: "double" }).sheets[0].draws[0];
    expect(upsideDown).toEqual({ page: 0, x: 595, y: 842, width: 595, height: 842, rotate: 180 });
    const other = imposePlan([{ width: 842, height: 595, rotation: 270 }], { layout: "2up", sheet: "double" }).sheets[0].draws[0];
    expect(other).toEqual({ page: 0, x: 595, y: 0, width: 842, height: 595, rotate: 90 });
  });

  it("writes the sheets through pdf-lib", async () => {
    const source = await loadPdf(await pdfOf([[100, 200], [100, 200], [100, 200], [100, 200], [100, 200]], [0, 90], true));
    const seen: number[] = [];
    const { bytes, plan } = await imposePdf(source, { layout: "booklet", sheet: "double" }, (index) => seen.push(index));
    const out = await loadPdf(bytes);
    expect(out.getPageCount()).toBe(4);
    expect(plan.sheets).toHaveLength(4);
    expect(out.getPage(0).getSize()).toEqual({ width: 400, height: 200 });
    expect(seen).toEqual([0, 1, 2, 3]);

    // A page with no content stream at all is a blank cell rather than a failure.
    const blank = await loadPdf(await pdfOf([[100, 200], [100, 200]]));
    const result = await imposePdf(blank, { layout: "2up", sheet: "a4" });
    expect((await loadPdf(result.bytes)).getPageCount()).toBe(1);
  });
});

describe("page order", () => {
  it("reverses, and moves the typed pages to the front", () => {
    expect(reversedOrder(3)).toEqual([2, 1, 0]);
    expect(typedOrder(5, [2, 0, 2, 9])).toEqual({ order: [2, 0, 1, 3, 4], appended: 3 });
    expect(isIdentityOrder([0, 1, 2])).toBe(true);
    expect(isIdentityOrder(typedOrder(3, [0, 1]).order)).toBe(true);
    expect(isIdentityOrder([1, 0])).toBe(false);
  });

  it("copies the pages out in that order, repeats included", async () => {
    const source = await loadPdf(await pdfOf([[1, 1], [2, 2], [3, 3]]));
    const out = await loadPdf(await pagesInOrder(source, [2, 0, 2]));
    expect(out.getPages().map((page) => page.getSize().width)).toEqual([3, 1, 3]);
  });
});

describe("flattening", () => {
  async function formPdf(): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 300]);
    const form = document.getForm();
    const name = form.createTextField("name");
    name.setText("Ada");
    name.addToPage(page, { x: 20, y: 200, width: 200, height: 30 });
    const box = form.createCheckBox("agree");
    box.check();
    box.addToPage(page, { x: 20, y: 100, width: 20, height: 20 });
    return document.save();
  }

  it("describes the fields and annotations", async () => {
    const summary = await describeForm(await loadPdf(await formPdf()));
    expect(summary).toEqual({ fields: 2, kinds: [{ kind: "text field", count: 1 }, { kind: "check box", count: 1 }], annotations: 2 });
    expect(await describeForm(await loadPdf(await pdfOf([[1, 1]])))).toEqual({ fields: 0, kinds: [], annotations: 0 });
  });

  it("bakes the fields in, and removes what annotations are left when asked", async () => {
    const flattened = await loadPdf(await flattenPdf(await loadPdf(await formPdf()), { fields: true, annotations: false }));
    expect(await describeForm(flattened)).toMatchObject({ fields: 0, annotations: 0 });
    // The value is now page content: the page's stream mentions the widget's drawing.
    expect(flattened.getPage(0).node.Resources()?.toString()).toContain("FlatWidget");

    const stripped = await loadPdf(await flattenPdf(await loadPdf(await formPdf()), { fields: false, annotations: true }));
    expect(await describeForm(stripped)).toMatchObject({ fields: 0, annotations: 0 });
  });
});
