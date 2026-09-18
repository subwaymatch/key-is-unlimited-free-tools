/**
 * Two texts compared line by line, and the difference written the way
 * `diff -u` writes it.
 *
 * Patience diff with Myers underneath: the lines that appear exactly once
 * in both files are matched first, by the longest run of them in the same
 * order, and the gaps between those anchors are diffed by Myers' algorithm
 * where they are small enough. Unique lines are what a reader would use to
 * line two versions up, so the result reads better than a plain shortest
 * edit script, and the recursion keeps the expensive part to the gaps.
 *
 * Pure, and tested against a naive edit distance on random inputs.
 */

export type EditKind = "equal" | "delete" | "insert";

export interface Edit {
  kind: EditKind;
  text: string;
}

/** The most a gap may cost before it is written off as wholly replaced. */
const MYERS_LIMIT = 4000;

export function diffLines(a: readonly string[], b: readonly string[]): Edit[] {
  const out: Edit[] = [];
  diffRange(a, 0, a.length, b, 0, b.length, out);
  return out;
}

function diffRange(a: readonly string[], aLo: number, aHi: number, b: readonly string[], bLo: number, bHi: number, out: Edit[]): void {
  // Common prefix and suffix: equal and cheap.
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    out.push({ kind: "equal", text: a[aLo] });
    aLo += 1;
    bLo += 1;
  }
  let suffix = 0;
  while (aLo < aHi - suffix && bLo < bHi - suffix && a[aHi - 1 - suffix] === b[bHi - 1 - suffix]) suffix += 1;
  const aEnd = aHi - suffix;
  const bEnd = bHi - suffix;

  if (aLo === aEnd) {
    for (let index = bLo; index < bEnd; index += 1) out.push({ kind: "insert", text: b[index] });
  } else if (bLo === bEnd) {
    for (let index = aLo; index < aEnd; index += 1) out.push({ kind: "delete", text: a[index] });
  } else {
    const anchors = uniqueAnchors(a, aLo, aEnd, b, bLo, bEnd);
    if (anchors.length > 0) {
      let aFrom = aLo;
      let bFrom = bLo;
      for (const [aAt, bAt] of anchors) {
        diffRange(a, aFrom, aAt, b, bFrom, bAt, out);
        out.push({ kind: "equal", text: a[aAt] });
        aFrom = aAt + 1;
        bFrom = bAt + 1;
      }
      diffRange(a, aFrom, aEnd, b, bFrom, bEnd, out);
    } else {
      const edits = myers(a.slice(aLo, aEnd), b.slice(bLo, bEnd));
      if (edits) {
        out.push(...edits);
      } else {
        for (let index = aLo; index < aEnd; index += 1) out.push({ kind: "delete", text: a[index] });
        for (let index = bLo; index < bEnd; index += 1) out.push({ kind: "insert", text: b[index] });
      }
    }
  }

  for (let index = 0; index < suffix; index += 1) out.push({ kind: "equal", text: a[aEnd + index] });
}

/**
 * The lines unique to both ranges, paired, in the longest sequence that is
 * in order on both sides: the patience sort.
 */
function uniqueAnchors(a: readonly string[], aLo: number, aHi: number, b: readonly string[], bLo: number, bHi: number): [number, number][] {
  const aCounts = new Map<string, { count: number; at: number }>();
  for (let index = aLo; index < aHi; index += 1) {
    const entry = aCounts.get(a[index]);
    if (entry) entry.count += 1;
    else aCounts.set(a[index], { count: 1, at: index });
  }
  const bCounts = new Map<string, { count: number; at: number }>();
  for (let index = bLo; index < bHi; index += 1) {
    const entry = bCounts.get(b[index]);
    if (entry) entry.count += 1;
    else bCounts.set(b[index], { count: 1, at: index });
  }
  const pairs: [number, number][] = [];
  for (let index = aLo; index < aHi; index += 1) {
    const inA = aCounts.get(a[index]);
    const inB = bCounts.get(a[index]);
    if (inA?.count === 1 && inB?.count === 1) pairs.push([index, inB.at]);
  }
  return longestIncreasing(pairs);
}

/** The longest subsequence of pairs whose second members rise, given the first already do. */
function longestIncreasing(pairs: readonly [number, number][]): [number, number][] {
  if (pairs.length === 0) return [];
  const tails: number[] = [];
  const tailIndex: number[] = [];
  const previous = new Array<number>(pairs.length).fill(-1);
  for (let index = 0; index < pairs.length; index += 1) {
    const value = pairs[index][1];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
    tailIndex[low] = index;
    previous[index] = low > 0 ? tailIndex[low - 1] : -1;
  }
  const result: [number, number][] = [];
  for (let at = tailIndex[tails.length - 1]; at !== -1; at = previous[at]) result.push(pairs[at]);
  return result.reverse();
}

/** Myers' shortest edit script, or null when it would cost more than the limit. */
function myers(a: readonly string[], b: readonly string[]): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MYERS_LIMIT);
  const offset = max;
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 2);
  for (let d = 0; d <= max; d += 1) {
    const snapshot = new Int32Array(v);
    trace.push(snapshot);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, offset, d);
    }
    v = new Int32Array(v);
  }
  return null;
}

function backtrack(a: readonly string[], b: readonly string[], trace: readonly Int32Array[], offset: number, dFinal: number): Edit[] {
  const edits: Edit[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dFinal; d > 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    let previousK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) previousK = k + 1;
    else previousK = k - 1;
    const previousX = v[offset + previousK];
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      edits.push({ kind: "equal", text: a[x] });
    }
    if (x === previousX) {
      y -= 1;
      edits.push({ kind: "insert", text: b[y] });
    } else {
      x -= 1;
      edits.push({ kind: "delete", text: a[x] });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    edits.push({ kind: "equal", text: a[x] });
  }
  return edits.reverse();
}

export interface DiffStats {
  inserted: number;
  deleted: number;
  equal: number;
}

export function diffStats(edits: readonly Edit[]): DiffStats {
  const stats: DiffStats = { inserted: 0, deleted: 0, equal: 0 };
  for (const edit of edits) {
    if (edit.kind === "insert") stats.inserted += 1;
    else if (edit.kind === "delete") stats.deleted += 1;
    else stats.equal += 1;
  }
  return stats;
}

export interface TextDiff {
  edits: Edit[];
  aFinalNewline: boolean;
  bFinalNewline: boolean;
}

/**
 * Two texts diffed by line.
 *
 * A last line that lost or gained its line break reads the same as a line
 * but is not the same file, so when only that changed the last line is
 * reported as replaced, the way diff reports it.
 */
export function diffTexts(a: string, b: string): TextDiff {
  const left = splitLines(a);
  const right = splitLines(b);
  const edits = diffLines(left.lines, right.lines);
  if (left.finalNewline !== right.finalNewline && left.lines.length > 0 && right.lines.length > 0) {
    const last = edits[edits.length - 1];
    if (last?.kind === "equal") edits.splice(edits.length - 1, 1, { kind: "delete", text: last.text }, { kind: "insert", text: last.text });
  }
  return { edits, aFinalNewline: left.finalNewline, bFinalNewline: right.finalNewline };
}

/** The lines of a text, and whether it ended with a line break. */
export function splitLines(text: string): { lines: string[]; finalNewline: boolean } {
  if (text === "") return { lines: [], finalNewline: true };
  const finalNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

interface Hunk {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  lines: string[];
}

/**
 * The edits as a unified diff with `context` lines of context, the form
 * `diff -u` writes and `patch` and every code host read.
 */
export function unifiedDiff(edits: readonly Edit[], aName: string, bName: string, options: { context?: number; aFinalNewline?: boolean; bFinalNewline?: boolean } = {}): string {
  const context = options.context ?? 3;
  const aFinal = options.aFinalNewline ?? true;
  const bFinal = options.bFinalNewline ?? true;
  const aTotal = edits.filter((edit) => edit.kind !== "insert").length;
  const bTotal = edits.filter((edit) => edit.kind !== "delete").length;
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let aLine = 0;
  let bLine = 0;
  let trailing = 0;

  const line = (edit: Edit, aIndex: number, bIndex: number): string => {
    const prefix = edit.kind === "equal" ? " " : edit.kind === "delete" ? "-" : "+";
    const text = `${prefix}${edit.text}`;
    // The last line of a file with no line break at its end says so, as diff does.
    const lastOfA = edit.kind !== "insert" && aIndex === aTotal - 1 && !aFinal;
    const lastOfB = edit.kind !== "delete" && bIndex === bTotal - 1 && !bFinal;
    return lastOfA || lastOfB ? `${text}\n\\ No newline at end of file` : text;
  };

  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (edit.kind === "equal") {
      if (hunk) {
        if (trailing < context) {
          hunk.lines.push(line(edit, aLine, bLine));
          hunk.aCount += 1;
          hunk.bCount += 1;
          trailing += 1;
        } else {
          // Enough context after the last change: close the hunk unless another change is near.
          let nextChange = -1;
          for (let look = index; look < edits.length && look <= index + context; look += 1) {
            if (edits[look].kind !== "equal") {
              nextChange = look;
              break;
            }
          }
          if (nextChange === -1) {
            hunks.push(hunk);
            hunk = null;
          } else {
            hunk.lines.push(line(edit, aLine, bLine));
            hunk.aCount += 1;
            hunk.bCount += 1;
          }
        }
      }
      aLine += 1;
      bLine += 1;
      continue;
    }
    if (!hunk) {
      const before = Math.min(context, index);
      let leading = 0;
      for (let look = index - before; look < index; look += 1) if (edits[look].kind === "equal") leading += 1;
      hunk = { aStart: aLine - leading, aCount: 0, bStart: bLine - leading, bCount: 0, lines: [] };
      for (let look = index - leading; look < index; look += 1) {
        hunk.lines.push(line(edits[look], aLine - (index - look), bLine - (index - look)));
        hunk.aCount += 1;
        hunk.bCount += 1;
      }
    }
    trailing = 0;
    hunk.lines.push(line(edit, aLine, bLine));
    if (edit.kind === "delete") {
      hunk.aCount += 1;
      aLine += 1;
    } else {
      hunk.bCount += 1;
      bLine += 1;
    }
  }
  if (hunk) hunks.push(hunk);

  const range = (start: number, count: number) => (count === 1 ? String(start + 1) : `${count === 0 ? start : start + 1},${count}`);
  const header = [`--- ${aName}`, `+++ ${bName}`];
  const body = hunks.flatMap((entry) => [`@@ -${range(entry.aStart, entry.aCount)} +${range(entry.bStart, entry.bCount)} @@`, ...entry.lines]);
  return `${[...header, ...body].join("\n")}\n`;
}

/** Where two byte arrays first differ, or -1 when the shorter is a prefix of the other. */
export function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return index;
  return -1;
}
