/**
 * Two tables related by a key column: joined, the way a VLOOKUP or a SQL
 * JOIN does it, or compared, to say which rows were added, removed or
 * changed between two versions of an export.
 *
 * Both work on rows already read, the header first. Keys are matched
 * after trimming, and without regard to case when asked, since two
 * exports of the same system rarely agree on either.
 */
import { findColumn } from "./tables";

export type JoinKind = "inner" | "left" | "full";

export const JOIN_KINDS: readonly { id: JoinKind; label: string; blurb: string }[] = [
  { id: "left", label: "Every row of the first", blurb: "Matches filled in from the second, blanks where there is none, as VLOOKUP does" },
  { id: "inner", label: "Only rows in both", blurb: "Rows whose key appears in both files" },
  { id: "full", label: "Every row of both", blurb: "Rows of the second with no match are added at the end" },
];

export interface KeyOptions {
  /** A name or a 1-based number; empty to use the first column name the two files share. */
  leftKey: string;
  rightKey: string;
  ignoreCase: boolean;
}

export class RelateError extends Error {}

function normalize(value: string, ignoreCase: boolean): string {
  const trimmed = value.trim();
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}

/** The key columns of both tables: named, numbered, or the first header the two share. */
export function keyColumns(left: readonly string[], right: readonly string[], options: KeyOptions): { left: number; right: number } {
  if (options.leftKey.trim() === "" && options.rightKey.trim() === "") {
    const names = new Map(right.map((name, index) => [name.trim().toLowerCase(), index]));
    for (const [index, name] of left.entries()) {
      const match = names.get(name.trim().toLowerCase());
      if (match !== undefined && name.trim() !== "") return { left: index, right: match };
    }
    throw new RelateError("The two files share no column name to match rows by. Name the key column of each in the settings.");
  }
  const leftSpec = options.leftKey.trim() || options.rightKey.trim();
  const rightSpec = options.rightKey.trim() || options.leftKey.trim();
  const leftIndex = findColumn(left, leftSpec, left.length);
  const rightIndex = findColumn(right, rightSpec, right.length);
  if (leftIndex === null) throw new RelateError(`The first file has no column "${leftSpec}". Its columns are: ${left.join(", ")}.`);
  if (rightIndex === null) throw new RelateError(`The second file has no column "${rightSpec}". Its columns are: ${right.join(", ")}.`);
  return { left: leftIndex, right: rightIndex };
}

export interface JoinResult {
  rows: string[][];
  matched: number;
  /** First-file rows with no match. */
  unmatchedLeft: number;
  /** Second-file rows no first-file row matched. */
  unmatchedRight: number;
  /** Keys that appear more than once in the second file, which multiplies rows. */
  repeatedKeys: number;
  keyName: string;
}

/**
 * The two tables joined on their key columns. The result has every column
 * of the first file, then every column of the second but its key, a name
 * both files use told apart by a suffix. A key the second file repeats
 * gives a row per match, as SQL does.
 */
export function joinTables(left: readonly (readonly string[])[], right: readonly (readonly string[])[], kind: JoinKind, options: KeyOptions): JoinResult {
  if (left.length === 0 || right.length === 0) throw new RelateError("Both files need a header row.");
  const leftHeader = left[0];
  const rightHeader = right[0];
  const keys = keyColumns(leftHeader, rightHeader, options);
  const leftWidth = leftHeader.length;
  const rightColumns = rightHeader.map((_, index) => index).filter((index) => index !== keys.right);
  const taken = new Set(leftHeader.map((name) => name.trim().toLowerCase()));
  const header = [...leftHeader];
  for (const index of rightColumns) {
    let name = rightHeader[index];
    if (taken.has(name.trim().toLowerCase())) name = `${name} (2)`;
    taken.add(name.trim().toLowerCase());
    header.push(name);
  }

  const index = new Map<string, number[]>();
  for (let row = 1; row < right.length; row += 1) {
    const key = normalize(right[row][keys.right] ?? "", options.ignoreCase);
    if (key === "") continue;
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }
  let repeatedKeys = 0;
  for (const list of index.values()) if (list.length > 1) repeatedKeys += 1;

  const rows: string[][] = [header];
  const used = new Set<number>();
  let matched = 0;
  let unmatchedLeft = 0;
  const pad = (row: readonly string[]) => {
    const out = row.slice(0, leftWidth);
    while (out.length < leftWidth) out.push("");
    return out;
  };
  for (let row = 1; row < left.length; row += 1) {
    const key = normalize(left[row][keys.left] ?? "", options.ignoreCase);
    const matches = key === "" ? undefined : index.get(key);
    if (matches) {
      matched += 1;
      for (const match of matches) {
        used.add(match);
        const out = pad(left[row]);
        for (const column of rightColumns) out.push(right[match][column] ?? "");
        rows.push(out);
      }
    } else {
      unmatchedLeft += 1;
      if (kind === "inner") continue;
      const out = pad(left[row]);
      for (let column = 0; column < rightColumns.length; column += 1) out.push("");
      rows.push(out);
    }
  }
  let unmatchedRight = 0;
  for (let row = 1; row < right.length; row += 1) {
    if (used.has(row)) continue;
    unmatchedRight += 1;
    if (kind !== "full") continue;
    const out: string[] = new Array(leftWidth).fill("");
    out[keys.left] = right[row][keys.right] ?? "";
    for (const column of rightColumns) out.push(right[row][column] ?? "");
    rows.push(out);
  }
  return { rows, matched, unmatchedLeft, unmatchedRight, repeatedKeys, keyName: leftHeader[keys.left] };
}

/* ---- Comparing ----------------------------------------------------------- */

export type CompareMode = "key" | "row";

export interface CompareResult {
  /** The report: a change column, a changed-columns column, then the union of both headers. */
  rows: string[][];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** Keys that appear more than once in either file, matched in the order they come. */
  repeatedKeys: number;
  keyName: string | null;
}

/**
 * What changed from the first table to the second. By key, a row whose
 * key is only in the second was added, only in the first was removed, and
 * in both with any cell different was changed, the changed cells written
 * "old -> new". By whole row, with no key, rows are only added or removed.
 */
export function compareTables(before: readonly (readonly string[])[], after: readonly (readonly string[])[], mode: CompareMode, options: KeyOptions): CompareResult {
  if (before.length === 0 || after.length === 0) throw new RelateError("Both files need a header row.");
  const beforeHeader = before[0];
  const afterHeader = after[0];
  const columns: string[] = [...beforeHeader];
  const lower = new Set(beforeHeader.map((name) => name.trim().toLowerCase()));
  for (const name of afterHeader) {
    if (!lower.has(name.trim().toLowerCase())) {
      columns.push(name);
      lower.add(name.trim().toLowerCase());
    }
  }
  const position = (header: readonly string[]) => columns.map((name) => header.findIndex((entry) => entry.trim().toLowerCase() === name.trim().toLowerCase()));
  const beforeAt = position(beforeHeader);
  const afterAt = position(afterHeader);
  const cells = (row: readonly string[], at: number[]) => at.map((index) => (index < 0 ? "" : (row[index] ?? "")));

  const report: string[][] = [["change", "changed columns", ...columns]];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  let repeatedKeys = 0;

  if (mode === "row") {
    const counts = new Map<string, number>();
    for (let row = 1; row < before.length; row += 1) {
      const key = JSON.stringify(cells(before[row], beforeAt));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (let row = 1; row < after.length; row += 1) {
      const values = cells(after[row], afterAt);
      const key = JSON.stringify(values);
      const left = counts.get(key) ?? 0;
      if (left > 0) {
        counts.set(key, left - 1);
        unchanged += 1;
      } else {
        added += 1;
        report.push(["added", "", ...values]);
      }
    }
    for (let row = 1; row < before.length; row += 1) {
      const values = cells(before[row], beforeAt);
      const key = JSON.stringify(values);
      const left = counts.get(key) ?? 0;
      if (left > 0) {
        counts.set(key, left - 1);
        removed += 1;
        report.push(["removed", "", ...values]);
      }
    }
    return { rows: report, added, removed, changed, unchanged, repeatedKeys, keyName: null };
  }

  const keys = keyColumns(beforeHeader, afterHeader, options);
  const keyName = beforeHeader[keys.left];
  const queue = new Map<string, number[]>();
  for (let row = 1; row < after.length; row += 1) {
    const key = normalize(after[row][keys.right] ?? "", options.ignoreCase);
    const list = queue.get(key);
    if (list) list.push(row);
    else queue.set(key, [row]);
  }
  const seenBefore = new Map<string, number>();
  const used = new Set<number>();
  for (let row = 1; row < before.length; row += 1) {
    const key = normalize(before[row][keys.left] ?? "", options.ignoreCase);
    seenBefore.set(key, (seenBefore.get(key) ?? 0) + 1);
    const list = queue.get(key);
    const match = list?.shift();
    const oldValues = cells(before[row], beforeAt);
    if (match === undefined) {
      removed += 1;
      report.push(["removed", "", ...oldValues]);
      continue;
    }
    used.add(match);
    const newValues = cells(after[match], afterAt);
    const differing: string[] = [];
    const merged = newValues.map((value, index) => {
      if (value === oldValues[index]) return value;
      differing.push(columns[index]);
      return `${oldValues[index]} -> ${value}`;
    });
    if (differing.length === 0) unchanged += 1;
    else {
      changed += 1;
      report.push(["changed", differing.join(", "), ...merged]);
    }
  }
  for (let row = 1; row < after.length; row += 1) {
    if (used.has(row)) continue;
    added += 1;
    report.push(["added", "", ...cells(after[row], afterAt)]);
  }
  const afterCounts = new Map<string, number>();
  for (let row = 1; row < after.length; row += 1) {
    const key = normalize(after[row][keys.right] ?? "", options.ignoreCase);
    afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seenBefore) if (count > 1 || (afterCounts.get(key) ?? 0) > 1) repeatedKeys += 1;
  for (const [key, count] of afterCounts) if (count > 1 && !seenBefore.has(key)) repeatedKeys += 1;
  return { rows: report, added, removed, changed, unchanged, repeatedKeys, keyName };
}
