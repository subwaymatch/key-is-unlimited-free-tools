/**
 * A picture placed on a PDF's pages: a logo in a corner, a signature at
 * the foot, a stamp across the middle.
 *
 * Placement is worked out on the page as its viewer shows it and then
 * turned into the page's own coordinates, so a page stored with a
 * quarter turn gets the picture where the visitor pointed, the right way
 * up. pdf-lib draws a picture by translating to (x, y), rotating
 * counter-clockwise, then scaling, so the anchor is the picture's
 * bottom-left corner before it is turned.
 */
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

import type { Corner } from "../images/edit";
import type { Size } from "../images/canvas";
import { PlainError } from "../plainQueue";
import { normalRotation, shownSize, type PageFace } from "./impose";
import { parsePageRanges, pageIndices } from "./ranges";

export type PageChoice = "all" | "first" | "last" | "ranges";

export const PAGE_CHOICES: readonly { id: PageChoice; label: string; blurb: string }[] = [
  { id: "all", label: "Every page", blurb: "The same mark on each" },
  { id: "first", label: "The first page", blurb: "A letterhead or a cover stamp" },
  { id: "last", label: "The last page", blurb: "Where a signature goes" },
  { id: "ranges", label: "Pages I name", blurb: "Typed the way a print dialog takes them" },
];

export const MARK_SIZES: readonly { value: number; label: string; blurb: string }[] = [
  { value: 0.1, label: "Small", blurb: "A tenth of the page's width" },
  { value: 0.2, label: "Medium", blurb: "A fifth of the page's width" },
  { value: 0.35, label: "Large", blurb: "A third of the page's width" },
  { value: 0.6, label: "Across", blurb: "Most of the page's width" },
];

export interface StampImageSettings {
  corner: Corner;
  /** The picture's width as a share of the shown page's width. */
  size: number;
  /** The gap from the edges as a share of the shown page's width. */
  margin: number;
  opacity: number;
  pages: PageChoice;
  ranges: string;
}

export const DEFAULT_STAMP_IMAGE_SETTINGS: StampImageSettings = { corner: "bottom-right", size: 0.2, margin: 0.04, opacity: 1, pages: "all", ranges: "" };

export interface StampDraw {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees counter-clockwise, which undo the page's own clockwise turn. */
  rotate: number;
}

/**
 * Where the picture is drawn in the page's stored coordinates, from the
 * corner it should appear in on the page as shown.
 */
export function stampPlacement(face: PageFace, mark: Size, settings: { corner: Corner; size: number; margin: number }): StampDraw {
  const shown = shownSize(face);
  let width = shown.width * settings.size;
  let height = (mark.height / mark.width) * width;
  const room = shown.height * 0.9;
  if (height > room) {
    width = (width * room) / height;
    height = room;
  }
  const margin = shown.width * settings.margin;
  // Bottom-left of the picture on the shown page, y up.
  let sx: number;
  let sy: number;
  switch (settings.corner) {
    case "top-left":
      sx = margin;
      sy = shown.height - margin - height;
      break;
    case "top-right":
      sx = shown.width - margin - width;
      sy = shown.height - margin - height;
      break;
    case "bottom-left":
      sx = margin;
      sy = margin;
      break;
    case "bottom-right":
      sx = shown.width - margin - width;
      sy = margin;
      break;
    default:
      sx = (shown.width - width) / 2;
      sy = (shown.height - height) / 2;
  }
  const rotation = normalRotation(face.rotation);
  // The shown point back in stored coordinates: the page's own turn undone.
  switch (rotation) {
    case 90:
      return { x: face.width - sy, y: sx, width, height, rotate: 90 };
    case 180:
      return { x: face.width - sx, y: face.height - sy, width, height, rotate: 180 };
    case 270:
      return { x: sy, y: face.height - sx, width, height, rotate: 270 };
    default:
      return { x: sx, y: sy, width, height, rotate: 0 };
  }
}

/** The 0-based pages the choice names, or the reason it names none. */
export function pagesToStamp(count: number, choice: PageChoice, ranges: string): { indices: number[]; problem: string | null } {
  if (count === 0) return { indices: [], problem: "The document has no pages." };
  if (choice === "all") return { indices: Array.from({ length: count }, (_, index) => index), problem: null };
  if (choice === "first") return { indices: [0], problem: null };
  if (choice === "last") return { indices: [count - 1], problem: null };
  const parsed = parsePageRanges(ranges, count);
  const indices = [...new Set(pageIndices(parsed.ranges))].sort((a, b) => a - b);
  if (indices.length === 0) return { indices, problem: parsed.problems[0] ?? "No pages were named." };
  return { indices, problem: null };
}

export interface StampPicture {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

/** The picture drawn on the pages chosen, at the corner and size asked. */
export async function stampImageOnPages(source: PDFDocumentType, picture: StampPicture, settings: StampImageSettings): Promise<{ bytes: Uint8Array; stamped: number }> {
  const { degrees } = await import("pdf-lib");
  const { indices, problem } = pagesToStamp(source.getPageCount(), settings.pages, settings.ranges);
  if (problem) throw new PlainError("No pages to stamp.", problem);
  const embedded = picture.mime === "image/png" ? await source.embedPng(picture.bytes) : await source.embedJpg(picture.bytes);
  for (const index of indices) {
    const page = source.getPage(index);
    const box = page.getCropBox();
    const face: PageFace = { width: box.width, height: box.height, rotation: normalRotation(page.getRotation().angle) };
    const draw = stampPlacement(face, picture, settings);
    page.drawImage(embedded, { x: box.x + draw.x, y: box.y + draw.y, width: draw.width, height: draw.height, rotate: degrees(draw.rotate), opacity: settings.opacity });
  }
  return { bytes: await source.save(), stamped: indices.length };
}
