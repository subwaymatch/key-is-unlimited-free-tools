/**
 * Two scans of one double-sided stack, collated into one document.
 *
 * A single-sided scanner takes a stack of double-sided sheets as two
 * passes: the fronts in order, then the stack turned over for the backs,
 * which come out last page first. The pages of the two files are
 * interleaved, with the second run through backwards unless the visitor
 * says otherwise.
 */
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

export interface CollateStep {
  /** 0 for the first file, 1 for the second. */
  source: 0 | 1;
  /** 0-based page in that file. */
  index: number;
}

export interface CollateOrder {
  order: CollateStep[];
  /** Something to say when the two files do not pair up page for page. */
  note: string | null;
}

/**
 * Front, back, front, back: page i of the first file followed by its back
 * from the second, which is read from its end when the backs came out in
 * reverse. Pages either file has over the other follow at the end.
 */
export function interleaveOrder(frontCount: number, backCount: number, backsReversed: boolean): CollateOrder {
  const order: CollateStep[] = [];
  const back = (position: number) => (backsReversed ? backCount - 1 - position : position);
  const paired = Math.min(frontCount, backCount);
  for (let position = 0; position < paired; position += 1) {
    order.push({ source: 0, index: position });
    order.push({ source: 1, index: back(position) });
  }
  for (let position = paired; position < frontCount; position += 1) order.push({ source: 0, index: position });
  for (let position = paired; position < backCount; position += 1) order.push({ source: 1, index: back(position) });
  const note =
    frontCount === backCount
      ? null
      : `The first file has ${frontCount} ${frontCount === 1 ? "page" : "pages"} and the second ${backCount}, so they do not pair up page for page; the ${Math.abs(frontCount - backCount)} extra ${Math.abs(frontCount - backCount) === 1 ? "page comes" : "pages come"} at the end.`;
  return { order, note };
}

/** One document of both files' pages in the collated order. */
export async function collatePdfs(front: PDFDocumentType, back: PDFDocumentType, backsReversed: boolean, report?: (done: number, count: number) => void): Promise<{ bytes: Uint8Array; order: CollateOrder }> {
  const { PDFDocument } = await import("pdf-lib");
  const order = interleaveOrder(front.getPageCount(), back.getPageCount(), backsReversed);
  const out = await PDFDocument.create();
  const frontPages = await out.copyPages(front, front.getPageIndices());
  const backPages = await out.copyPages(back, back.getPageIndices());
  order.order.forEach((step, position) => {
    report?.(position, order.order.length);
    out.addPage(step.source === 0 ? frontPages[step.index] : backPages[step.index]);
  });
  return { bytes: await out.save(), order };
}
