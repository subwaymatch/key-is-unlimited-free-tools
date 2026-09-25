/**
 * Redaction that removes what it hides, and a check for redaction that
 * does not.
 *
 * Drawing a black box over text in a PDF hides it from the eye and from
 * nobody else: the text is still in the page, one copy-and-paste away.
 * Real redaction takes the text out. Here the words to hide are found in
 * the page's own text, and each page that has any is drawn as a picture
 * with the boxes painted on, then put in place of the original page, so
 * the text under the boxes no longer exists; pages with nothing to hide
 * stay as they were.
 *
 * The check does the opposite: it finds dark filled rectangles in each
 * page's drawing instructions, and redaction annotations, and reports any
 * text still sitting underneath.
 */
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** An axis-aligned rectangle in PDF user space: x and y from the bottom left, in points. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Pattern {
  id: string;
  label: string;
  blurb: string;
  pattern: RegExp;
  /** A further check on each match, to cut false alarms: Luhn for card numbers. */
  accept?: (match: string) => boolean;
}

function luhn(digits: string): boolean {
  const only = digits.replace(/\D/g, "");
  if (only.length < 13 || only.length > 19) return false;
  let sum = 0;
  for (let index = 0; index < only.length; index += 1) {
    let digit = Number(only[only.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export const PATTERNS: readonly Pattern[] = [
  { id: "email", label: "E-mail addresses", blurb: "name@example.com", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: "phone", label: "Phone numbers", blurb: "+44 20 7946 0958, (555) 010-4477", pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){2,4}\b/g, accept: (match) => match.replace(/\D/g, "").length >= 9 && match.replace(/\D/g, "").length <= 15 },
  { id: "card", label: "Card numbers", blurb: "Checked with the Luhn digit, so order numbers pass", pattern: /\b(?:\d[ -]?){12,18}\d\b/g, accept: luhn },
  { id: "id", label: "ID numbers", blurb: "US Social Security, UK National Insurance", pattern: /\b\d{3}-\d{2}-\d{4}\b|\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  { id: "iban", label: "Bank accounts (IBAN)", blurb: "GB29 NWBK 6016 1331 9268 19", pattern: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The words typed, one per line, as a pattern: case ignored, whole words where they start and end with letters. */
export function termsPattern(terms: string): RegExp | null {
  const list = terms
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  const parts = list.map((term) => `${/^[\p{L}\p{N}]/u.test(term) ? "(?<![\\p{L}\\p{N}])" : ""}${escapeRegExp(term).replace(/\s+/g, "\\s+")}${/[\p{L}\p{N}]$/u.test(term) ? "(?![\\p{L}\\p{N}])" : ""}`);
  return new RegExp(parts.join("|"), "giu");
}

interface Segment {
  item: number;
  start: number;
  end: number;
}

/** The page's text as one string, and where each character came from. */
function pageString(items: TextItemLike[]): { text: string; origin: (Segment | null)[] } {
  let text = "";
  const origin: (Segment | null)[] = [];
  let previous: TextItemLike | null = null;
  items.forEach((item, index) => {
    if (previous && text !== "" && !text.endsWith("\n")) {
      const sameLine = Math.abs(item.transform[5] - previous.transform[5]) < Math.max(2, item.height * 0.3);
      if (!sameLine) {
        text += "\n";
        origin.push(null);
      } else if (!/\s$/.test(text) && !/^\s/.test(item.str)) {
        const gap = item.transform[4] - (previous.transform[4] + previous.width);
        if (gap > item.height * 0.15) {
          text += " ";
          origin.push(null);
        }
      }
    }
    for (let character = 0; character < item.str.length; character += 1) {
      text += item.str[character];
      origin.push({ item: index, start: character, end: character + 1 });
    }
    if (item.hasEOL) {
      text += "\n";
      origin.push(null);
    }
    previous = item;
  });
  return { text, origin };
}

/** The part of a text item between two character offsets, as a rectangle in user space. */
export function itemRect(item: TextItemLike, start: number, end: number): Rect {
  const [a, b, c, d, e, f] = item.transform;
  const length = Math.max(1, item.str.length);
  const size = Math.hypot(c, d) || item.height || 10;
  const along = Math.hypot(a, b) || 1;
  const [ux, uy] = [a / along, b / along];
  const [vx, vy] = [-uy, ux];
  const from = (item.width * start) / length;
  const to = (item.width * end) / length;
  // A little past the glyphs on every side: descenders, accents, and proportional widths guessed evenly.
  const corners = [
    [from - size * 0.1, -size * 0.3],
    [to + size * 0.1, -size * 0.3],
    [to + size * 0.1, size * 1.05],
    [from - size * 0.1, size * 1.05],
  ].map(([s, t]) => [e + ux * s + vx * t, f + uy * s + vy * t]);
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export interface Found {
  text: string;
  rects: Rect[];
}

/** Every match of the patterns on a page, with the rectangles that cover it. */
export function findOnPage(items: TextItemLike[], patterns: readonly { pattern: RegExp; accept?: (match: string) => boolean }[]): Found[] {
  const { text, origin } = pageString(items);
  const found: (Found & { start: number; end: number })[] = [];
  for (const { pattern, accept } of patterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (let match = global.exec(text); match; match = global.exec(text)) {
      if (match[0].length === 0) {
        global.lastIndex += 1;
        continue;
      }
      if (accept && !accept(match[0])) continue;
      const start = match.index;
      const end = start + match[0].length;
      // Two patterns can find the same words, an ID number that also reads as a phone number: keep one.
      if (found.some((entry) => start < entry.end && end > entry.start)) continue;
      // Characters from one item run together into one rectangle.
      const runs = new Map<number, { start: number; end: number }>();
      for (let offset = match.index; offset < match.index + match[0].length; offset += 1) {
        const segment = origin[offset];
        if (!segment) continue;
        const run = runs.get(segment.item);
        if (run) {
          run.start = Math.min(run.start, segment.start);
          run.end = Math.max(run.end, segment.end);
        } else runs.set(segment.item, { start: segment.start, end: segment.end });
      }
      const rects = [...runs].map(([item, run]) => itemRect(items[item], run.start, run.end));
      if (rects.length > 0) found.push({ text: match[0], rects, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start).map(({ text: matched, rects }) => ({ text: matched, rects }));
}

/** Pages rebuilt from pictures, the rest copied, and nothing else: no properties, outline or attachments. */
export async function assembleRedacted(original: Uint8Array, replacements: Map<number, { image: Uint8Array; kind: "png" | "jpeg"; width: number; height: number }>): Promise<Uint8Array> {
  const source = await PDFDocument.load(original, { updateMetadata: false });
  const out = await PDFDocument.create({ updateMetadata: false });
  out.setProducer("key.is");
  out.setCreator("key.is redaction");
  const copied = await out.copyPages(
    source,
    source.getPageIndices().filter((index) => !replacements.has(index)),
  );
  let next = 0;
  for (const index of source.getPageIndices()) {
    const replacement = replacements.get(index);
    if (!replacement) {
      out.addPage(copied[next++]);
      continue;
    }
    const image = replacement.kind === "png" ? await out.embedPng(replacement.image) : await out.embedJpg(replacement.image);
    const page = out.addPage([replacement.width, replacement.height]);
    page.drawImage(image, { x: 0, y: 0, width: replacement.width, height: replacement.height });
  }
  return out.save();
}

/* ---- Checking ------------------------------------------------------------- */

export interface HiddenText {
  page: number;
  /** The text under the box, as far as it can be told. */
  text: string;
  /** The whole line the text belongs to. */
  line: string;
  how: "black box" | "redaction mark" | "dark annotation";
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

function darkness(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return 0;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16) / 255);
  return 1 - (0.299 * r + 0.587 * g + 0.114 * b);
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** The dark filled rectangles a page draws, in user space. */
export function darkRectangles(fnArray: number[], argsArray: unknown[][], ops: Record<string, number>): Rect[] {
  const fills = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke].filter((value) => value !== undefined));
  const stack: { ctm: Matrix; fill: number }[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let fill = 1;
  const rects: Rect[] = [];
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index];
    const args = argsArray[index] ?? [];
    if (fn === ops.save) stack.push({ ctm, fill });
    else if (fn === ops.restore) ({ ctm, fill } = stack.pop() ?? { ctm, fill });
    else if (fn === ops.transform) ctm = multiply(ctm, args as unknown as Matrix);
    else if (fn === ops.setFillRGBColor) fill = darkness(String(args[0]));
    else if (fn === ops.setFillGray) fill = 1 - Number(args[0]);
    else if (fn === ops.constructPath) {
      const [paint, , box] = args as [number, unknown, ArrayLike<number> | null];
      if (!fills.has(paint) || fill < 0.8 || !box || box.length < 4) continue;
      const corners = [
        [box[0], box[1]],
        [box[2], box[1]],
        [box[2], box[3]],
        [box[0], box[3]],
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = corners.map((corner) => corner[0]);
      const ys = corners.map((corner) => corner[1]);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      // Rules and underlines are dark and thin; a redaction box is tall enough to cover a line.
      if (rect.width > 2 && rect.height > 4) rects.push(rect);
    }
  }
  return rects;
}

/** The text a covering rectangle hides, character by character. */
function coveredText(item: TextItemLike, box: Rect): string {
  let out = "";
  for (let character = 0; character < item.str.length; character += 1) {
    const rect = itemRect(item, character, character + 1);
    const shrunk = { x: rect.x + rect.width * 0.3, y: rect.y + rect.height * 0.3, width: rect.width * 0.4, height: rect.height * 0.3 };
    if (overlap(shrunk, box) > 0) out += item.str[character];
  }
  return out.trim();
}

/** Text still present under black boxes and redaction marks, page by page. */
export async function findHiddenText(document: PDFDocumentProxy, ops: Record<string, number>, report?: (page: number, total: number) => void): Promise<{ hidden: HiddenText[]; textless: number[]; boxes: number }> {
  const hidden: HiddenText[] = [];
  const textless: number[] = [];
  let boxes = 0;
  for (let number = 1; number <= document.numPages; number += 1) {
    report?.(number, document.numPages);
    const page = await document.getPage(number);
    const [content, list, annotations] = await Promise.all([page.getTextContent(), page.getOperatorList(), page.getAnnotations()]);
    const items = content.items.filter((item): item is TextItemLike & typeof item => "str" in item && item.str.trim() !== "") as unknown as TextItemLike[];
    if (items.length === 0) textless.push(number);
    const covers: { rect: Rect; how: HiddenText["how"] }[] = darkRectangles(list.fnArray, list.argsArray, ops).map((rect) => ({ rect, how: "black box" as const }));
    for (const annotation of annotations as { subtype?: string; rect?: number[]; interiorColor?: Uint8ClampedArray | number[] | null; color?: Uint8ClampedArray | number[] | null }[]) {
      if (!annotation.rect) continue;
      const [x1, y1, x2, y2] = annotation.rect;
      const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      const colour = annotation.interiorColor ?? null;
      const dark = colour && colour.length >= 3 ? 1 - (0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2]) / 255 : 0;
      if (annotation.subtype === "Redact") covers.push({ rect, how: "redaction mark" });
      else if ((annotation.subtype === "Square" || annotation.subtype === "Polygon" || annotation.subtype === "Ink") && dark >= 0.8) covers.push({ rect, how: "dark annotation" });
    }
    boxes += covers.length;
    for (const cover of covers) {
      for (const item of items) {
        const whole = itemRect(item, 0, item.str.length);
        if (overlap(whole, cover.rect) <= 0) continue;
        const text = coveredText(item, cover.rect);
        if (text) hidden.push({ page: number, text, line: item.str.trim(), how: cover.how });
      }
    }
    page.cleanup();
  }
  return { hidden, textless, boxes };
}
