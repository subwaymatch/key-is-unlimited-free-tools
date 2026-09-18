/**
 * What a table's columns hold: their types, how many cells are empty, the
 * range of the numbers, the lengths of the text, how many distinct values
 * there are and which come up most.
 *
 * Fed a row at a time, so a large file costs one pass and a bounded amount
 * of memory: distinct values are counted up to a cap, after which the
 * column is reported as having more than that many.
 */

export type ColumnType = "empty" | "integer" | "number" | "boolean" | "date" | "text";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  filled: number;
  empty: number;
  /** Distinct values, or null when there were more than the cap. */
  distinct: number | null;
  /** For numbers. */
  min: number | null;
  max: number | null;
  mean: number | null;
  /** For text: the shortest and longest value. */
  minLength: number;
  maxLength: number;
  /** The commonest values, most common first. */
  top: { value: string; count: number }[];
}

/** How many distinct values a column is counted up to. */
export const DISTINCT_CAP = 20_000;

const NUMBER = /^-?(?:0|[1-9]\d*|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const INTEGER = /^-?\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

interface ColumnState {
  name: string;
  filled: number;
  empty: number;
  numbers: number;
  integers: number;
  booleans: number;
  dates: number;
  sum: number;
  min: number | null;
  max: number | null;
  minLength: number;
  maxLength: number;
  counts: Map<string, number>;
  overflowed: boolean;
}

/** Counts a table's columns as its rows go past. */
export class Profiler {
  private readonly columns: ColumnState[];
  private rows = 0;

  constructor(names: readonly string[]) {
    this.columns = names.map((name) => ({ name, filled: 0, empty: 0, numbers: 0, integers: 0, booleans: 0, dates: 0, sum: 0, min: null, max: null, minLength: Number.POSITIVE_INFINITY, maxLength: 0, counts: new Map(), overflowed: false }));
  }

  add(row: readonly string[]): void {
    this.rows += 1;
    for (let index = 0; index < this.columns.length; index += 1) {
      const column = this.columns[index];
      const raw = (row[index] ?? "").trim();
      if (raw === "") {
        column.empty += 1;
        continue;
      }
      column.filled += 1;
      if (raw.length < column.minLength) column.minLength = raw.length;
      if (raw.length > column.maxLength) column.maxLength = raw.length;
      if (NUMBER.test(raw)) {
        const value = Number(raw);
        if (Number.isFinite(value)) {
          column.numbers += 1;
          if (INTEGER.test(raw)) column.integers += 1;
          column.sum += value;
          if (column.min === null || value < column.min) column.min = value;
          if (column.max === null || value > column.max) column.max = value;
        }
      } else if (/^(true|false)$/i.test(raw)) {
        column.booleans += 1;
      } else if (DATE.test(raw)) {
        column.dates += 1;
      }
      const seen = column.counts.get(raw);
      if (seen !== undefined) column.counts.set(raw, seen + 1);
      else if (column.counts.size < DISTINCT_CAP) column.counts.set(raw, 1);
      else column.overflowed = true;
    }
  }

  get rowCount(): number {
    return this.rows;
  }

  finish(): ColumnProfile[] {
    return this.columns.map((column) => {
      let type: ColumnType = "text";
      if (column.filled === 0) type = "empty";
      else if (column.integers === column.filled) type = "integer";
      else if (column.numbers === column.filled) type = "number";
      else if (column.booleans === column.filled) type = "boolean";
      else if (column.dates === column.filled) type = "date";
      const numeric = type === "integer" || type === "number";
      return {
        name: column.name,
        type,
        filled: column.filled,
        empty: column.empty,
        distinct: column.overflowed ? null : column.counts.size,
        min: numeric ? column.min : null,
        max: numeric ? column.max : null,
        mean: numeric && column.filled > 0 ? column.sum / column.filled : null,
        minLength: column.filled === 0 ? 0 : column.minLength,
        maxLength: column.maxLength,
        top: [...column.counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([value, count]) => ({ value, count })),
      };
    });
  }
}

const TYPE_LABELS: Record<ColumnType, string> = { empty: "empty", integer: "whole numbers", number: "numbers", boolean: "true or false", date: "dates", text: "text" };

function shortNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString();
}

/** The profile as a plain-text report, one block per column. */
export function profileReport(profiles: readonly ColumnProfile[], rows: number, fileName: string): string {
  const lines = [`Profile of ${fileName}`, `${rows.toLocaleString("en")} rows, ${profiles.length} columns`, ""];
  for (const column of profiles) {
    lines.push(`${column.name}`);
    lines.push(`  type: ${TYPE_LABELS[column.type]}`);
    lines.push(`  filled: ${column.filled.toLocaleString("en")}${column.empty > 0 ? `, empty: ${column.empty.toLocaleString("en")} (${Math.round((column.empty / Math.max(1, rows)) * 100)}%)` : ""}`);
    if (column.filled > 0) {
      lines.push(`  distinct: ${column.distinct === null ? `more than ${DISTINCT_CAP.toLocaleString("en")}` : column.distinct.toLocaleString("en")}`);
      if (column.min !== null && column.max !== null && column.mean !== null) lines.push(`  range: ${shortNumber(column.min)} to ${shortNumber(column.max)}, mean ${shortNumber(column.mean)}`);
      lines.push(`  length: ${column.minLength === column.maxLength ? `${column.minLength} characters` : `${column.minLength} to ${column.maxLength} characters`}`);
      if (column.top.length > 0 && (column.distinct === null || column.distinct < column.filled)) {
        lines.push(`  most common: ${column.top.map((entry) => `${JSON.stringify(entry.value)} (${entry.count.toLocaleString("en")})`).join(", ")}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
