/**
 * Bookmarks: the outline a viewer shows in its side panel, typed as a
 * list and written into the document.
 *
 * pdf-lib has no outline API, but an outline is only a linked list of
 * dictionaries hanging off the catalog, and its low-level objects are
 * enough to write one: each item names its title, its parent, the items
 * either side of it, its first and last children, and where it goes.
 */
import type { PDFDocument as PDFDocumentType, PDFDict as PDFDictType, PDFRef as PDFRefType } from "pdf-lib";

export interface OutlineItem {
  /** 0-based page. */
  page: number;
  title: string;
  /** 0 for a top-level entry, 1 for one nested under the entry before it, and so on. */
  level: number;
}

export interface ParsedOutline {
  items: OutlineItem[];
  /** Lines that could not be read, with why. */
  problems: string[];
}

export const MAX_OUTLINE_LEVEL = 4;

/**
 * A list of bookmarks from lines of "page  title", one per line, nested by
 * indenting: two spaces, a tab or a dash for each level. "Title ... 12",
 * the way a printed contents page reads, is taken too.
 */
export function parseOutline(text: string, pageCount: number): ParsedOutline {
  const items: OutlineItem[] = [];
  const problems: string[] = [];
  let previousLevel = -1;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (raw.trim() === "") continue;
    const indent = /^[ \t]*/.exec(raw)?.[0] ?? "";
    let level = 0;
    for (const ch of indent) level += ch === "\t" ? 1 : 0.5;
    let line = raw.trim();
    while (/^[-*]\s+/.test(line)) {
      level += 1;
      line = line.replace(/^[-*]\s+/, "");
    }
    level = Math.min(Math.floor(level), MAX_OUTLINE_LEVEL, previousLevel + 1);
    const leading = /^(\d+)\s*(?:[.:)\-]\s*)?(.+)$/.exec(line);
    const trailing = /^(.+?)\s*(?:\.{2,}|\s)\s*(?:p\.?\s*|page\s*)?(\d+)$/i.exec(line);
    let page: number;
    let title: string;
    if (leading) {
      page = Number(leading[1]);
      title = leading[2].trim();
    } else if (trailing) {
      page = Number(trailing[2]);
      title = trailing[1].trim();
    } else {
      problems.push(`Line ${index + 1} has no page number: "${line.length > 40 ? `${line.slice(0, 40)}...` : line}".`);
      continue;
    }
    if (page < 1 || page > pageCount) {
      problems.push(`Line ${index + 1} names page ${page}, and the document has ${pageCount}.`);
      continue;
    }
    if (!title) {
      problems.push(`Line ${index + 1} has a page number and no title.`);
      continue;
    }
    items.push({ page: page - 1, title, level });
    previousLevel = level;
  }
  return { items, problems };
}

/** How many bookmarks the document already carries, at every level. */
export async function countOutline(document: PDFDocumentType): Promise<number> {
  const { PDFDict, PDFName, PDFRef } = await import("pdf-lib");
  const outlines = document.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!outlines) return 0;
  const seen = new Set<string>();
  const walk = (parent: PDFDictType): number => {
    let count = 0;
    let ref = parent.get(PDFName.of("First"));
    while (ref instanceof PDFRef && !seen.has(ref.toString()) && seen.size < 10_000) {
      seen.add(ref.toString());
      const item = document.context.lookupMaybe(ref, PDFDict);
      if (!item) break;
      count += 1 + walk(item);
      ref = item.get(PDFName.of("Next"));
    }
    return count;
  };
  return walk(outlines);
}

/** The document with these bookmarks in place of any it had, the panel shown on opening. */
export async function writeOutline(document: PDFDocumentType, items: readonly OutlineItem[]): Promise<Uint8Array> {
  const { PDFHexString, PDFName } = await import("pdf-lib");
  const context = document.context;
  const outlinesRef = context.nextRef();
  const refs = items.map(() => context.nextRef());
  // The parent of each item: the nearest one before it a level up, or the root.
  const parents: (PDFRefType | null)[] = items.map((item, index) => {
    for (let back = index - 1; back >= 0; back -= 1) {
      if (items[back].level < item.level) return refs[back];
    }
    return null;
  });
  const children = new Map<PDFRefType | null, number[]>();
  parents.forEach((parent, index) => {
    const list = children.get(parent) ?? [];
    list.push(index);
    children.set(parent, list);
  });
  const descendants = (index: number): number => (children.get(refs[index]) ?? []).reduce((sum, child) => sum + 1 + descendants(child), 0);
  items.forEach((item, index) => {
    const page = document.getPage(item.page);
    const box = page.getCropBox();
    const siblings = children.get(parents[index]) ?? [];
    const position = siblings.indexOf(index);
    const own = children.get(refs[index]) ?? [];
    const dict = context.obj({
      Title: PDFHexString.fromText(item.title),
      Parent: parents[index] ?? outlinesRef,
      Dest: [page.ref, "XYZ", box.x, box.y + box.height, null],
    });
    if (position > 0) dict.set(PDFName.of("Prev"), refs[siblings[position - 1]]);
    if (position < siblings.length - 1) dict.set(PDFName.of("Next"), refs[siblings[position + 1]]);
    if (own.length > 0) {
      dict.set(PDFName.of("First"), refs[own[0]]);
      dict.set(PDFName.of("Last"), refs[own[own.length - 1]]);
      dict.set(PDFName.of("Count"), context.obj(descendants(index)));
    }
    context.assign(refs[index], dict);
  });
  const top = children.get(null) ?? [];
  const outlines = context.obj({ Type: "Outlines", Count: items.length });
  if (top.length > 0) {
    outlines.set(PDFName.of("First"), refs[top[0]]);
    outlines.set(PDFName.of("Last"), refs[top[top.length - 1]]);
  }
  context.assign(outlinesRef, outlines);
  document.catalog.set(PDFName.of("Outlines"), outlinesRef);
  document.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  return document.save();
}
