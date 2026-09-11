/**
 * Two languages in one subtitle file.
 *
 * Two ways, because players differ. "Stacked" keeps every cue from both
 * files and puts the second language at the top of the picture, which every
 * player that understands a position tag shows as two rows; SRT and ASS take
 * `{\an8}` and WebVTT takes a `line` setting. "Combined" folds each second-
 * language cue into the first-language cue it overlaps, so a player that
 * shows one cue at a time still shows both languages, at the cost of the
 * second language following the first's timing.
 */
import type { Cue } from "./types";

export type MergeLayout = "stacked" | "combined";

/**
 * How much of the shorter cue two cues must share in time to be the same
 * line in two languages rather than neighbours that happen to touch.
 */
const OVERLAP_SHARE = 0.5;

function overlapSeconds(a: Cue, b: Cue): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function sameLine(a: Cue, b: Cue): boolean {
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  if (shorter <= 0) return false;
  return overlapSeconds(a, b) >= shorter * OVERLAP_SHARE;
}

const byStart = (a: Cue, b: Cue) => a.start - b.start || a.end - b.end;

/** Every cue from both files, the second language's marked for the top. */
export function stackCues(primary: readonly Cue[], secondary: readonly Cue[]): Cue[] {
  return [
    ...primary.map((cue) => ({ ...cue })),
    ...secondary.map((cue) => ({ ...cue, position: "top" as const })),
  ].sort(byStart);
}

export interface CombineResult {
  cues: Cue[];
  /** Second-language cues that overlapped no first-language cue and were kept on their own. */
  unmatched: number;
}

/**
 * Each first-language cue with the second-language text that overlaps it
 * underneath; second-language cues that match nothing are kept as they are.
 */
export function combineCues(primary: readonly Cue[], secondary: readonly Cue[]): CombineResult {
  const remaining = secondary.map((cue) => ({ ...cue }));
  const cues: Cue[] = [];

  for (const cue of [...primary].sort(byStart)) {
    const matched: Cue[] = [];
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (sameLine(cue, remaining[i])) matched.unshift(...remaining.splice(i, 1));
    }
    const extra = matched
      .sort(byStart)
      .map((match) => match.text)
      .join("\n");
    cues.push({ ...cue, text: extra ? `${cue.text}\n${extra}` : cue.text });
  }

  cues.push(...remaining);
  return { cues: cues.sort(byStart), unmatched: remaining.length };
}

export function mergeCues(
  primary: readonly Cue[],
  secondary: readonly Cue[],
  layout: MergeLayout,
): CombineResult {
  if (layout === "stacked") return { cues: stackCues(primary, secondary), unmatched: 0 };
  return combineCues(primary, secondary);
}
