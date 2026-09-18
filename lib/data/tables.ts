/**
 * Tables as rows of cells, merged, split, sorted, and read as records.
 *
 * Everything here works on the rows the CSV parser or the workbook reader
 * hands over, so the same code serves a CSV, a TSV and a sheet.
 */
import { columnNames, rowRecord, typedValue, type CsvValue } from "./csv";

/* ---- Merging ------------------------------------------------------------ */

export interface Table {
  name: string;
  rows: readonly (readonly string[])[];
}

export interface MergeOptions {
  /** The first row of every file is its header, and columns are matched by name. */
  header: boolean;
  /** A first column naming the file each row came from. */
  sourceColumn: boolean;
}

export interface Merged {
  /** The header row, or null when the files had none. */
  columns: string[] | null;
  rows: string[][];
  /** Columns found only in later files, added after the first file's. */
  added: string[];
  /** Files whose header is exactly the first file's. */
  matching: number;
}

const SOURCE_COLUMN = "source";

/**
 * Every file's rows in one table. With headers, columns are matched by
 * name whatever their order, and a column a later file adds is appended;
 * without, rows are stacked as they are and padded to the widest.
 */
export function mergeTables(tables: readonly Table[], options: MergeOptions): Merged {
  const rows: string[][] = [];
  if (!options.header) {
    const width = Math.max(0, ...tables.flatMap((table) => table.rows.map((row) => row.length)));
    for (const table of tables) {
      for (const row of table.rows) {
        const padded = [...row, ...Array.from({ length: width - row.length }, () => "")];
        rows.push(options.sourceColumn ? [table.name, ...padded] : padded);
      }
    }
    return { columns: null, rows, added: [], matching: tables.length };
  }
  const columns: string[] = [];
  const index = new Map<string, number>();
  const added: string[] = [];
  let matching = 0;
  const first = tables[0]?.rows[0] ?? [];
  for (const [position, table] of tables.entries()) {
    const header = (table.rows[0] ?? []).map((cell) => cell.trim());
    if (position > 0 && header.length === first.length && header.every((cell, at) => cell.toLowerCase() === first[at].trim().toLowerCase())) matching += 1;
    const places = header.map((name) => {
      const key = name.toLowerCase();
      let at = index.get(key);
      if (at === undefined) {
        at = columns.length;
        index.set(key, at);
        columns.push(name || `Column ${at + 1}`);
        if (position > 0) added.push(name || `Column ${at + 1}`);
      }
      return at;
    });
    for (const row of table.rows.slice(1)) {
      const out: string[] = Array.from({ length: columns.length }, () => "");
      row.forEach((cell, at) => {
        const place = at < places.length ? places[at] : null;
        if (place !== null) out[place] = cell;
      });
      rows.push(options.sourceColumn ? [table.name, ...out] : out);
    }
  }
  for (const row of rows) {
    const want = columns.length + (options.sourceColumn ? 1 : 0);
    while (row.length < want) row.push("");
  }
  const sourceName = columns.some((column) => column.toLowerCase() === SOURCE_COLUMN) ? "source file" : SOURCE_COLUMN;
  return { columns: options.sourceColumn ? [sourceName, ...columns] : columns, rows, added, matching: matching + 1 };
}

/* ---- Splitting ---------------------------------------------------------- */

export const ROWS_PER_FILE: readonly { value: number; label: string; blurb: string }[] = [
  { value: 1000, label: "1,000 rows", blurb: "Small enough to read through" },
  { value: 10_000, label: "10,000 rows", blurb: "What most import forms take at once" },
  { value: 100_000, label: "100,000 rows", blurb: "For a spreadsheet that chokes on a million" },
  { value: 500_000, label: "500,000 rows", blurb: "Under the million-row sheet limit with room" },
];

/** How many files rows of data make at this many a file. */
export function pieceCount(dataRows: number, perFile: number): number {
  return Math.max(1, Math.ceil(dataRows / Math.max(1, perFile)));
}

/** The rows in pieces of at most `perFile` data rows, the header repeated on each. */
export function splitRows(rows: readonly (readonly string[])[], header: boolean, perFile: number): (readonly string[])[][] {
  const head = header ? rows[0] : null;
  const data = header ? rows.slice(1) : rows;
  const size = Math.max(1, perFile);
  const pieces: (readonly string[])[][] = [];
  for (let at = 0; at < data.length; at += size) {
    const piece = data.slice(at, at + size);
    pieces.push(head ? [head, ...piece] : piece);
  }
  if (pieces.length === 0 && head) pieces.push([head]);
  return pieces;
}

/** "-part-03" for a piece, padded to the count's width. */
export function pieceSuffix(index: number, count: number): string {
  return `-part-${String(index + 1).padStart(String(count).length, "0")}`;
}

/* ---- Sorting ------------------------------------------------------------ */

export type SortKind = "auto" | "number" | "text" | "natural";
export type SortOrder = "asc" | "desc";

export const SORT_KINDS: readonly { id: SortKind; label: string; blurb: string }[] = [
  { id: "auto", label: "Work it out", blurb: "As numbers when every value is one, otherwise as text with numbers in order" },
  { id: "number", label: "As numbers", blurb: "10 after 9; anything that is not a number goes last" },
  { id: "natural", label: "As text, numbers in order", blurb: "file2 before file10" },
  { id: "text", label: "As text, character by character", blurb: "file10 before file2" },
];

/**
 * The 0-based column a visitor named: a number counted from 1, or a
 * header name matched without regard to case or spaces around it.
 */
export function findColumn(header: readonly string[] | null, spec: string, width: number): number | null {
  const wanted = spec.trim();
  if (wanted === "") return null;
  if (/^\d+$/.test(wanted)) {
    const number = Number(wanted);
    return number >= 1 && number <= width ? number - 1 : null;
  }
  if (!header) return null;
  const key = wanted.toLowerCase();
  const at = header.findIndex((name) => name.trim().toLowerCase() === key);
  return at === -1 ? null : at;
}

const NUMBER = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;

/** Numbers when every filled cell reads as one, otherwise text with its numbers in order. */
export function detectSortKind(values: readonly string[]): Exclude<SortKind, "auto"> {
  const filled = values.filter((value) => value.trim() !== "");
  if (filled.length === 0) return "natural";
  return filled.every((value) => NUMBER.test(value)) ? "number" : "natural";
}

function comparator(kind: Exclude<SortKind, "auto">): (a: string, b: string) => number {
  if (kind === "number") {
    return (a, b) => {
      const x = NUMBER.test(a) ? Number(a) : Number.NaN;
      const y = NUMBER.test(b) ? Number(b) : Number.NaN;
      if (Number.isNaN(x) && Number.isNaN(y)) return a.localeCompare(b, "en");
      if (Number.isNaN(x)) return 1;
      if (Number.isNaN(y)) return -1;
      return x - y;
    };
  }
  const collator = new Intl.Collator("en", { numeric: kind === "natural", sensitivity: "base" });
  return (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The rows sorted by one column, the header (when there is one) left at
 * the top, empty cells last whichever way the order runs, and rows that
 * tie kept in the order they came.
 */
export function sortRows(rows: readonly (readonly string[])[], column: number, order: SortOrder, kind: SortKind, header: boolean): string[][] {
  const head = header ? rows[0] : null;
  const data = header ? rows.slice(1) : rows;
  const resolved = kind === "auto" ? detectSortKind(data.map((row) => row[column] ?? "")) : kind;
  const compare = comparator(resolved);
  const direction = order === "asc" ? 1 : -1;
  const indexed = data.map((row, position) => ({ row, position, value: (row[column] ?? "").trim() }));
  indexed.sort((a, b) => {
    if (a.value === "" && b.value === "") return a.position - b.position;
    if (a.value === "") return 1;
    if (b.value === "") return -1;
    const result = compare(a.value, b.value) * direction;
    return result !== 0 ? result : a.position - b.position;
  });
  const sorted = indexed.map((entry) => [...entry.row]);
  return head ? [[...head], ...sorted] : sorted;
}

/* ---- Records ------------------------------------------------------------ */

/** Every data row as an object keyed by the header, or by made-up column names. */
export function recordsFromRows(rows: readonly (readonly string[])[], header: boolean, typed: boolean): Record<string, CsvValue>[] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const names = columnNames(header ? rows[0] ?? null : null, width);
  const data = header ? rows.slice(1) : rows;
  return data.map((row) => rowRecord(names, row, typed));
}

/** A cell as the JSON value it reads as, or the text. */
export function cellValue(raw: string, typed: boolean): CsvValue {
  return typed ? typedValue(raw) : raw;
}
