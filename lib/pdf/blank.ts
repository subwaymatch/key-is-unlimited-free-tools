/**
 * Telling a blank page from one with something on it.
 *
 * A page is drawn small and its dark pixels counted: a scanner's back side
 * of a single-sided sheet has a speck or two, a page with a paragraph on it
 * has thousands. The share of dark pixels against a threshold decides, and
 * the threshold is the visitor's to pick.
 */

export type BlankSensitivity = "strict" | "normal" | "loose";

export const BLANK_OPTIONS: readonly { id: BlankSensitivity; label: string; blurb: string; share: number }[] = [
  { id: "strict", label: "Nothing at all", blurb: "Only a page with no mark on it is blank", share: 0.0002 },
  { id: "normal", label: "Nearly nothing", blurb: "A speck or two of scanner noise is still blank", share: 0.002 },
  { id: "loose", label: "Almost nothing", blurb: "A page number or a punch hole is still blank", share: 0.01 },
];

/** Below this luminance a pixel is ink rather than paper or scanner haze. */
export const INK_THRESHOLD = 176;

/** Pages are drawn at this resolution to be judged: an A4 page is about 400 by 580 pixels. */
export const BLANK_DPI = 50;

/** The share of a page's pixels that are ink, 0 to 1. */
export function inkShare(data: Uint8ClampedArray, width: number, height: number): number {
  const total = width * height;
  if (total === 0) return 0;
  let ink = 0;
  for (let index = 0; index < total; index += 1) {
    const at = index * 4;
    const alpha = data[at + 3];
    if (alpha === 0) continue;
    const luminance = 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2];
    if (luminance < INK_THRESHOLD) ink += 1;
  }
  return ink / total;
}

export function blankShare(sensitivity: BlankSensitivity): number {
  return BLANK_OPTIONS.find((option) => option.id === sensitivity)?.share ?? 0.002;
}

/** Whether a page with this share of ink counts as blank at this sensitivity. */
export function isBlank(share: number, sensitivity: BlankSensitivity): boolean {
  return share < blankShare(sensitivity);
}

/** "pages 2, 4 and 7" for a note. */
export function describePages(pages: readonly number[]): string {
  const numbers = pages.map((page) => String(page + 1));
  if (numbers.length === 0) return "no pages";
  if (numbers.length === 1) return `page ${numbers[0]}`;
  if (numbers.length <= 12) return `pages ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
  return `pages ${numbers.slice(0, 10).join(", ")} and ${numbers.length - 10} more`;
}
