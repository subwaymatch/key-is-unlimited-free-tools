/**
 * A pivot table from a CSV: rows grouped by one column, optionally spread
 * across the values of another, and a count, sum, average, minimum,
 * maximum or count of distinct values in each cell, with totals.
 */
import { findColumn } from "./tables";

export type Aggregate = "count" | "sum" | "mean" | "min" | "max" | "distinct";

export const AGGREGATES: readonly { id: Aggregate; label: string; blurb: string }[] = [
  { id: "count", label: "Count of rows", blurb: "How many rows fall in each group" },
  { id: "sum", label: "Sum", blurb: "The values added up" },
  { id: "mean", label: "Average", blurb: "The mean of the values" },
  { id: "min", label: "Smallest", blurb: "The least value" },
  { id: "max", label: "Largest", blurb: "The greatest value" },
  { id: "distinct", label: "Count of different values", blurb: "How many distinct values each group has" },
];

export interface PivotOptions {
  /** The column whose values become rows: a name or a 1-based number. */
  rows: string;
  /** The column whose values become columns, or empty for one column of results. */
  columns: string;
  /** The column the aggregate is taken of; not needed to count rows. */
  values: string;
  aggregate: Aggregate;
}

export class PivotError extends Error {}

const PLAIN_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const GROUPED_NUMBER = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/** A cell as a number: plain, with thousands separators, or behind a currency sign; null when it is none of those. */
export function parseNumber(text: string): number | null {
  let value = text.trim().replace(/^[$\u20ac\u00a3\u00a5]\s*/, "").replace(/\s*[$\u20ac\u00a3\u00a5]$/, "");
  if (value.startsWith("(") && value.endsWith(")")) value = `-${value.slice(1, -1)}`;
  if (GROUPED_NUMBER.test(value)) value = value.replace(/,/g, "");
  return PLAIN_NUMBER.test(value) ? Number(value) : null;
}

/** A result without the noise binary fractions leave: 0.1 + 0.2 as 0.3. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toPrecision(15)));
}

class Cell {
  count = 0;
  numbers = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  distinct = new Set<string>();

  add(raw: string | null, aggregate: Aggregate): boolean {
    this.count += 1;
    if (raw === null || aggregate === "count") return true;
    if (aggregate === "distinct") {
      if (raw.trim() !== "") this.distinct.add(raw.trim());
      return true;
    }
    if (raw.trim() === "") return true;
    const number = parseNumber(raw);
    if (number === null) return false;
    this.numbers += 1;
    this.sum += number;
    if (number < this.min) this.min = number;
    if (number > this.max) this.max = number;
    return true;
  }

  result(aggregate: Aggregate): string {
    switch (aggregate) {
      case "count":
        return String(this.count);
      case "distinct":
        return String(this.distinct.size);
      case "sum":
        return formatNumber(this.sum);
      case "mean":
        return this.numbers === 0 ? "" : formatNumber(this.sum / this.numbers);
      case "min":
        return this.numbers === 0 ? "" : formatNumber(this.min);
      case "max":
        return this.numbers === 0 ? "" : formatNumber(this.max);
    }
  }
}

export interface PivotResult {
  table: string[][];
  groups: number;
  /** Cells in the value column that were not numbers, left out of a sum or an average. */
  skipped: number;
}

const BLANK = "(blank)";

export function pivotTable(rows: readonly (readonly string[])[], options: PivotOptions): PivotResult {
  if (rows.length < 2) throw new PivotError("The file needs a header row and at least one row of data.");
  const header = rows[0];
  const width = header.length;
  const find = (spec: string, what: string) => {
    const at = findColumn(header, spec, width);
    if (at === null) throw new PivotError(`There is no column "${spec.trim()}" to ${what}. The columns are: ${header.join(", ")}.`);
    return at;
  };
  if (options.rows.trim() === "") throw new PivotError("Name the column to group rows by.");
  const rowColumn = find(options.rows, "group rows by");
  const spreadColumn = options.columns.trim() === "" ? null : find(options.columns, "spread across columns");
  const needsValues = options.aggregate !== "count";
  if (needsValues && options.values.trim() === "") throw new PivotError("Name the column to take the values from.");
  const valueColumn = needsValues ? find(options.values, "take the values from") : null;

  const cells = new Map<string, Map<string, Cell>>();
  const rowTotals = new Map<string, Cell>();
  const columnTotals = new Map<string, Cell>();
  const grand = new Cell();
  const spreadValues = new Set<string>();
  let skipped = 0;
  const cellFor = (map: Map<string, Cell>, key: string) => {
    let cell = map.get(key);
    if (!cell) {
      cell = new Cell();
      map.set(key, cell);
    }
    return cell;
  };
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.every((cell) => cell.trim() === "")) continue;
    const group = (row[rowColumn] ?? "").trim() || BLANK;
    const spread = spreadColumn === null ? "" : (row[spreadColumn] ?? "").trim() || BLANK;
    const value = valueColumn === null ? null : (row[valueColumn] ?? "");
    let groupCells = cells.get(group);
    if (!groupCells) {
      groupCells = new Map();
      cells.set(group, groupCells);
    }
    spreadValues.add(spread);
    if (!cellFor(groupCells, spread).add(value, options.aggregate)) skipped += 1;
    cellFor(rowTotals, group).add(value, options.aggregate);
    cellFor(columnTotals, spread).add(value, options.aggregate);
    grand.add(value, options.aggregate);
  }

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const order = (a: string, b: string) => (a === BLANK ? 1 : b === BLANK ? -1 : collator.compare(a, b));
  const groups = [...cells.keys()].sort(order);
  const label = AGGREGATES.find((entry) => entry.id === options.aggregate)!.label;
  const valueName = valueColumn === null ? "" : ` of ${header[valueColumn]}`;
  const table: string[][] = [];
  if (spreadColumn === null) {
    table.push([header[rowColumn], `${label}${valueName}`]);
    for (const group of groups) table.push([group, cells.get(group)!.get("")!.result(options.aggregate)]);
  } else {
    const spreads = [...spreadValues].sort(order);
    table.push([`${header[rowColumn]} / ${header[spreadColumn]}`, ...spreads, "Total"]);
    for (const group of groups) {
      const groupCells = cells.get(group)!;
      table.push([group, ...spreads.map((spread) => groupCells.get(spread)?.result(options.aggregate) ?? (options.aggregate === "count" || options.aggregate === "distinct" || options.aggregate === "sum" ? "0" : "")), rowTotals.get(group)!.result(options.aggregate)]);
    }
    table.push(["Total", ...spreads.map((spread) => columnTotals.get(spread)!.result(options.aggregate)), grand.result(options.aggregate)]);
    return { table, groups: groups.length, skipped };
  }
  table.push(["Total", grand.result(options.aggregate)]);
  return { table, groups: groups.length, skipped };
}
