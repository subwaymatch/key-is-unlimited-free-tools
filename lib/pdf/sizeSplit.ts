/**
 * A PDF cut into pieces that each land under a size.
 *
 * How large a run of pages will be when saved is not the sum of the pages:
 * a font shared by every page is written once per piece, and a page's
 * pictures may be shared too. So the only honest measure is to save and
 * look, and the search for the longest run that fits is a bisection over
 * page counts with a save at each step, a handful per piece.
 */
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

import { pagesInOrder } from "./pages";

export const SIZE_LIMITS: readonly { bytes: number; label: string; blurb: string }[] = [
  { bytes: 2 * 1024 * 1024, label: "2 MB", blurb: "For a strict form upload" },
  { bytes: 5 * 1024 * 1024, label: "5 MB", blurb: "A cautious email attachment" },
  { bytes: 10 * 1024 * 1024, label: "10 MB", blurb: "Most email and messaging limits" },
  { bytes: 25 * 1024 * 1024, label: "25 MB", blurb: "Gmail and Outlook's limit" },
];

export interface Fit {
  /** How many pages from the start fit, at least 1. */
  count: number;
  bytes: number;
  /** True when even the first page alone is over the limit. */
  over: boolean;
}

/**
 * The most pages from the start of a run that save under the limit,
 * assuming more pages never make a smaller file.
 *
 * `sizeOf` saves a run of that many pages and says how large it came out.
 * The whole run is tried first, since most pieces are the last one, and
 * one page next, since a page over the limit ends the search; between
 * those the answer is found by bisection.
 */
export async function largestFitting(sizeOf: (count: number) => Promise<number>, maxBytes: number, available: number): Promise<Fit> {
  const whole = await sizeOf(available);
  if (whole <= maxBytes) return { count: available, bytes: whole, over: false };
  if (available === 1) return { count: 1, bytes: whole, over: true };
  const one = await sizeOf(1);
  if (one > maxBytes) return { count: 1, bytes: one, over: true };
  let low = 1;
  let lowBytes = one;
  let high = available;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    const bytes = await sizeOf(middle);
    if (bytes <= maxBytes) {
      low = middle;
      lowBytes = bytes;
    } else {
      high = middle;
    }
  }
  return { count: low, bytes: lowBytes, over: false };
}

export interface SizePiece {
  bytes: Uint8Array;
  /** 0-based, inclusive. */
  first: number;
  last: number;
  /** True when this one page alone could not be brought under the limit. */
  over: boolean;
}

/** The document in pieces, each the longest run of pages that fits under the limit. */
export async function splitPdfBySize(source: PDFDocumentType, maxBytes: number, report?: (pageDone: number, count: number) => void, signal?: AbortSignal): Promise<SizePiece[]> {
  const count = source.getPageCount();
  const pieces: SizePiece[] = [];
  let at = 0;
  while (at < count) {
    if (signal?.aborted) throw new Error("Cancelled.");
    report?.(at, count);
    const start = at;
    let last: Uint8Array | null = null;
    let lastCount = 0;
    const sizeOf = async (pages: number) => {
      const bytes = await pagesInOrder(source, Array.from({ length: pages }, (_, index) => start + index));
      last = bytes;
      lastCount = pages;
      return bytes.length;
    };
    const fit = await largestFitting(sizeOf, maxBytes, count - at);
    const bytes: Uint8Array = lastCount === fit.count && last ? last : await pagesInOrder(source, Array.from({ length: fit.count }, (_, index) => start + index));
    pieces.push({ bytes, first: at, last: at + fit.count - 1, over: fit.over });
    at += fit.count;
  }
  report?.(count, count);
  return pieces;
}
