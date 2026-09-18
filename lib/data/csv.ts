/**
 * CSV read a chunk at a time, and written back as JSON, JSON Lines, TSV or
 * CSV with another delimiter.
 *
 * The parser is a state machine that takes the file in pieces, so a
 * multi-gigabyte export is read without ever being one string: a quoted
 * field can be split across two chunks, a CRLF can be split across two
 * chunks, and the parser carries what it was in the middle of from one
 * push to the next. It follows RFC 4180 where the file does and is lenient
 * where files in the wild are not: a stray quote in the middle of a field
 * is a character, a blank line is skipped, and text after a closing quote
 * is kept.
 *
 * Pure, and tested with the chunk boundary in every awkward place.
 */

export type Delimiter = "," | ";" | "\t" | "|";

export const DELIMITERS: readonly { id: Delimiter; label: string; blurb: string }[] = [
  { id: ",", label: "Comma", blurb: "What CSV means almost everywhere" },
  { id: ";", label: "Semicolon", blurb: "What Excel writes where the decimal point is a comma" },
  { id: "\t", label: "Tab", blurb: "TSV: what a spreadsheet pastes as" },
  { id: "|", label: "Pipe", blurb: "Some database exports" },
];

export function describeDelimiter(delimiter: Delimiter): string {
  return DELIMITERS.find((entry) => entry.id === delimiter)?.label.toLowerCase() ?? "comma";
}

/** The complete lines at the start of a sample, at most `limit`, ignoring a last line the sample cuts short. */
function completeLines(sample: string, limit: number): string[] {
  const lines = sample.split(/\r\n|\r|\n/);
  // The sample ends mid-line unless it ends with a line break.
  if (!/[\r\n]$/.test(sample)) lines.pop();
  return lines.filter((line) => line.trim() !== "").slice(0, limit);
}

/** How many times a character appears in a line, outside quotes. */
function countOutsideQuotes(line: string, character: string): number {
  let count = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === character && !quoted) count += 1;
  }
  return count;
}

/**
 * The delimiter a sample most plausibly uses.
 *
 * A candidate that appears the same number of times on every line, and at
 * least once, is a delimiter; among those the one that appears most wins,
 * since a semicolon-delimited file can still have a comma in a price. If no
 * candidate is consistent, the one with the most appearances on the first
 * line is taken, and a file with none of them is one column of commas.
 */
export function detectDelimiter(sample: string): Delimiter {
  const lines = completeLines(sample, 20);
  if (lines.length === 0) return ",";
  let best: { delimiter: Delimiter; count: number } | null = null;
  for (const { id } of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, id));
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.every((count) => count === first);
    if (consistent && (best === null || first > best.count)) best = { delimiter: id, count: first };
  }
  if (best) return best.delimiter;
  let fallback: { delimiter: Delimiter; count: number } | null = null;
  for (const { id } of DELIMITERS) {
    const count = countOutsideQuotes(lines[0], id);
    if (count > 0 && (fallback === null || count > fallback.count)) fallback = { delimiter: id, count };
  }
  return fallback?.delimiter ?? ",";
}

/** Reads rows out of text that arrives in pieces. */
export class CsvParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  /** Inside quotes, a quote was just read: the next character says whether it closed the field or escaped a quote. */
  private quoteSeen = false;
  /** Something has been read into the current field, so a quote now is a character rather than an opening. */
  private fieldStarted = false;
  /** A carriage return ended the previous chunk; a line feed that follows belongs to it. */
  private afterCr = false;
  private rowsRead = 0;

  constructor(private readonly delimiter: Delimiter) {}

  /** The rows completed by this piece of text. */
  push(text: string): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (this.afterCr) {
        this.afterCr = false;
        if (ch === "\n") continue;
      }
      if (this.inQuotes) {
        if (!this.quoteSeen) {
          if (ch === '"') this.quoteSeen = true;
          else this.field += ch;
          continue;
        }
        this.quoteSeen = false;
        if (ch === '"') {
          this.field += '"';
          continue;
        }
        // The quote closed the field; this character is read unquoted.
        this.inQuotes = false;
      }
      if (ch === this.delimiter) {
        this.endField();
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r") this.afterCr = true;
        this.endRow(rows);
        continue;
      }
      if (ch === '"' && !this.fieldStarted) {
        this.inQuotes = true;
        this.fieldStarted = true;
        continue;
      }
      this.field += ch;
      this.fieldStarted = true;
    }
    return rows;
  }

  /** The last row, if the file did not end with a line break. */
  end(): string[][] {
    const rows: string[][] = [];
    this.quoteSeen = false;
    this.inQuotes = false;
    this.afterCr = false;
    if (this.fieldStarted || this.row.length > 0) this.endRow(rows);
    return rows;
  }

  /** How many rows have come out so far. */
  get count(): number {
    return this.rowsRead;
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = "";
    this.fieldStarted = false;
    this.inQuotes = false;
  }

  private endRow(rows: string[][]): void {
    // A line with nothing on it is skipped rather than read as one empty field.
    if (this.row.length === 0 && !this.fieldStarted && this.field === "") return;
    this.endField();
    rows.push(this.row);
    this.row = [];
    this.rowsRead += 1;
  }
}

/* ---- Values ------------------------------------------------------------- */

export type CsvValue = string | number | boolean | null;

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * A field as JSON: a number when it reads as one, a boolean when it is one,
 * null when it is empty, and the text otherwise.
 *
 * A number is only a number when JSON would give it back unchanged: "007"
 * and "1,000" stay text, and so does an integer of more than fifteen
 * digits, which is an identifier or a card number and would lose its last
 * digits as a double.
 */
export function typedValue(raw: string): CsvValue {
  if (raw === "") return null;
  if (NUMBER.test(raw)) {
    const digits = raw.replace(/^-/, "").split(/[.eE]/)[0];
    if (raw.includes(".") || /[eE]/.test(raw) || digits.length <= 15) {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    return raw;
  }
  const lower = raw.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return raw;
}

/** Column names from a header row, or made up, with a repeated name told apart by a number. */
export function columnNames(header: readonly string[] | null, columnCount: number): string[] {
  const names: string[] = [];
  const seen = new Map<string, number>();
  for (let index = 0; index < Math.max(columnCount, header?.length ?? 0); index += 1) {
    const raw = header?.[index]?.trim() ?? "";
    let name = raw === "" ? `column${index + 1}` : raw;
    const times = seen.get(name) ?? 0;
    seen.set(name, times + 1);
    if (times > 0) name = `${name}_${times + 1}`;
    names.push(name);
  }
  return names;
}

/** One row as an object under the column names, typed or as text. */
export function rowRecord(names: readonly string[], row: readonly string[], typed: boolean): Record<string, CsvValue> {
  const record: Record<string, CsvValue> = {};
  const width = Math.max(names.length, row.length);
  for (let index = 0; index < width; index += 1) {
    const name = names[index] ?? `column${index + 1}`;
    const raw = row[index] ?? "";
    record[name] = typed ? typedValue(raw) : raw;
  }
  return record;
}

/* ---- Writing ------------------------------------------------------------ */

/** A field quoted when it has to be: a delimiter, a quote, a line break, or space at either end. */
export function csvField(value: string, delimiter: Delimiter): string {
  if (value === "") return "";
  if (value.includes('"') || value.includes(delimiter) || value.includes("\n") || value.includes("\r") || value !== value.trim()) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvLine(fields: readonly string[], delimiter: Delimiter): string {
  return fields.map((field) => csvField(field, delimiter)).join(delimiter);
}

/** What a value becomes in a CSV cell: text as it is, everything else as JSON would print it. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    return value.every((entry) => entry === null || typeof entry !== "object") ? value.map(cellText).join("; ") : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/* ---- Records from JSON -------------------------------------------------- */

/**
 * Nested objects flattened into dotted names: { address: { city } } becomes
 * "address.city". A list of plain values is joined with semicolons; a list
 * of objects is left as JSON text, since a column per element would make a
 * table nobody asked for.
 */
export function flattenRecord(record: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    out.set(prefix || "value", cellText(record));
    return out;
  }
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, text] of flattenRecord(value, name)) out.set(inner, text);
    } else {
      out.set(name, cellText(value));
    }
  }
  return out;
}

/**
 * The records in a parsed JSON value: an array of them, an object that
 * holds one array of them under some key (an API's "data" or "results"),
 * or a single object as the one record.
 */
export function recordsOf(value: unknown): { records: unknown[]; from: string } {
  if (Array.isArray(value)) return { records: value, from: "an array" };
  if (value !== null && typeof value === "object") {
    const lists = Object.entries(value as Record<string, unknown>).filter(([, entry]) => Array.isArray(entry)) as [string, unknown[]][];
    if (lists.length === 1) return { records: lists[0][1], from: `the "${lists[0][0]}" list` };
    if (lists.length > 1) {
      const longest = lists.reduce((best, entry) => (entry[1].length > best[1].length ? entry : best));
      return { records: longest[1], from: `the "${longest[0]}" list, the longest of ${lists.length}` };
    }
    return { records: [value], from: "one object" };
  }
  return { records: [], from: "nothing" };
}

/** The columns every record needs, in the order they were first seen, and every record's cells. */
export function tabulate(records: readonly unknown[]): { columns: string[]; rows: Map<string, string>[] } {
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows = records.map((record) => {
    const flat = flattenRecord(record);
    for (const key of flat.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
    return flat;
  });
  return { columns, rows };
}
