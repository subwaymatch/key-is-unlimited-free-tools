/**
 * Page ranges the way a print dialog takes them: "1-3, 5, 8-".
 *
 * Pure, so the parsing is tested without a PDF in sight.
 */

export interface PageRange {
  /** 1-based, inclusive. */
  from: number;
  to: number;
}

export interface ParsedRanges {
  ranges: PageRange[];
  /** What could not be read, worded for the panel. */
  problems: string[];
}

/**
 * Reads a range list against a page count. "8-" runs to the end, "-3" from
 * the start; a range past the end is clipped and said so; nonsense is
 * skipped and said so.
 */
export function parsePageRanges(text: string, pageCount: number): ParsedRanges {
  const ranges: PageRange[] = [];
  const problems: string[] = [];
  // "3 - 4" is one range; the spaces around a dash are not separators.
  for (const raw of text.replace(/\s*-\s*/g, "-").split(/[,;\s]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const match = part.match(/^(\d*)(?:\s*-\s*(\d*))?$/);
    if (!match || (match[1] === "" && (match[2] === undefined || match[2] === ""))) {
      problems.push(`"${part}" is not a page or a range.`);
      continue;
    }
    const from = match[1] === "" ? 1 : Number(match[1]);
    const to = match[2] === undefined ? from : match[2] === "" ? pageCount : Number(match[2]);
    if (from < 1 || to < 1) {
      problems.push(`"${part}" starts before page 1.`);
      continue;
    }
    if (from > pageCount) {
      problems.push(`"${part}" is past the last page, ${pageCount}.`);
      continue;
    }
    if (to < from) {
      problems.push(`"${part}" ends before it starts.`);
      continue;
    }
    if (to > pageCount) problems.push(`"${part}" was cut at the last page, ${pageCount}.`);
    ranges.push({ from, to: Math.min(to, pageCount) });
  }
  return { ranges, problems };
}

/**
 * What is wrong with a range list, read on its own, or null when it reads.
 *
 * The panel has no page count to check against until a file is dropped, but
 * "abc" is not a range whatever the document turns out to be. Catching that
 * in the panel is what stops a typo from being accepted into the box and
 * failing every file added after it.
 */
export function rangeSyntaxProblem(text: string): string | null {
  const parts = text.replace(/\s*-\s*/g, "-").split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const match = part.match(/^(\d*)(?:-(\d*))?$/);
    if (!match || (match[1] === "" && (match[2] === undefined || match[2] === ""))) return `"${part}" is not a page or a range.`;
    const from = match[1] === "" ? 1 : Number(match[1]);
    if (from < 1) return `"${part}" starts before page 1.`;
    if (match[2] !== undefined && match[2] !== "") {
      const to = Number(match[2]);
      if (to < 1) return `"${part}" ends before page 1.`;
      if (to < from) return `"${part}" ends before it starts.`;
    }
  }
  return null;
}

/** The 0-based page indices a range list names, in order, without repeats. */
export function pageIndices(ranges: readonly PageRange[]): number[] {
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const range of ranges) {
    for (let page = range.from; page <= range.to; page += 1) {
      if (seen.has(page)) continue;
      seen.add(page);
      indices.push(page - 1);
    }
  }
  return indices;
}

/** "1-3", "5", "8-12": a range as the panel and the filename say it. */
export function describeRange(range: PageRange): string {
  return range.from === range.to ? String(range.from) : `${range.from}-${range.to}`;
}

/** Every N pages, as ranges. */
export function everyPages(pageCount: number, size: number): PageRange[] {
  const ranges: PageRange[] = [];
  for (let from = 1; from <= pageCount; from += size) ranges.push({ from, to: Math.min(pageCount, from + size - 1) });
  return ranges;
}
