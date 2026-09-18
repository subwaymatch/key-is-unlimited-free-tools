/**
 * A table written for somewhere other than a spreadsheet: a Markdown
 * table for a README, an HTML table for a page, and SQL to load it into
 * a database.
 */
import { columnNames, typedValue } from "./csv";
import { escapeXml } from "./xlsx";

const NUMERIC = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;

/** Whether every filled cell of a column is a number, which right-aligns it. */
function numericColumn(rows: readonly (readonly string[])[], column: number): boolean {
  const filled = rows.map((row) => row[column] ?? "").filter((cell) => cell.trim() !== "");
  return filled.length > 0 && filled.every((cell) => NUMERIC.test(cell));
}

function headerAndData(rows: readonly (readonly string[])[], header: boolean): { names: string[]; data: readonly (readonly string[])[]; width: number } {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const names = columnNames(header ? rows[0] ?? null : null, width);
  return { names, data: header ? rows.slice(1) : rows, width };
}

/* ---- Markdown ----------------------------------------------------------- */

function markdownCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/**
 * A GitHub-flavoured Markdown table, columns padded so the source reads
 * as a table too, numeric columns aligned right.
 */
export function markdownTable(rows: readonly (readonly string[])[], header: boolean): string {
  const { names, data, width } = headerAndData(rows, header);
  if (width === 0) return "";
  const cells = [names.map(markdownCell), ...data.map((row) => Array.from({ length: width }, (_, column) => markdownCell(row[column] ?? "")))];
  const widths = Array.from({ length: width }, (_, column) => Math.max(3, ...cells.map((row) => row[column].length)));
  const numeric = Array.from({ length: width }, (_, column) => numericColumn(data, column));
  const line = (row: readonly string[]) => `| ${row.map((cell, column) => (numeric[column] ? cell.padStart(widths[column]) : cell.padEnd(widths[column]))).join(" | ")} |`;
  const rule = `| ${widths.map((w, column) => (numeric[column] ? `${"-".repeat(w - 1)}:` : "-".repeat(w))).join(" | ")} |`;
  return [line(cells[0]), rule, ...cells.slice(1).map(line)].join("\n").concat("\n");
}

/* ---- HTML --------------------------------------------------------------- */

/** A plain HTML table with a header row, every cell escaped. */
export function htmlTable(rows: readonly (readonly string[])[], header: boolean): string {
  const { names, data, width } = headerAndData(rows, header);
  if (width === 0) return "";
  const lines = ["<table>", "  <thead>", `    <tr>${names.map((name) => `<th>${escapeXml(name)}</th>`).join("")}</tr>`, "  </thead>", "  <tbody>"];
  for (const row of data) {
    lines.push(`    <tr>${Array.from({ length: width }, (_, column) => `<td>${escapeXml(row[column] ?? "")}</td>`).join("")}</tr>`);
  }
  lines.push("  </tbody>", "</table>");
  return lines.join("\n").concat("\n");
}

/* ---- SQL ---------------------------------------------------------------- */

export type SqlDialect = "generic" | "mysql" | "postgres" | "sqlite";

export const SQL_DIALECTS: readonly { id: SqlDialect; label: string; blurb: string }[] = [
  { id: "generic", label: "Standard SQL", blurb: 'Names in "double quotes"; runs on most databases' },
  { id: "postgres", label: "PostgreSQL", blurb: "Double-quoted names, DOUBLE PRECISION, TRUE and FALSE" },
  { id: "mysql", label: "MySQL and MariaDB", blurb: "Backticked names, backslashes escaped" },
  { id: "sqlite", label: "SQLite", blurb: "Double-quoted names, 1 and 0 for booleans" },
];

export type SqlType = "INTEGER" | "REAL" | "BOOLEAN" | "TEXT";

export interface SqlOptions {
  table: string;
  dialect: SqlDialect;
  header: boolean;
  createTable: boolean;
  rowsPerInsert: number;
}

export const DEFAULT_SQL_OPTIONS: SqlOptions = { table: "", dialect: "generic", header: true, createTable: true, rowsPerInsert: 500 };

const INTEGER = /^\s*[-+]?\d{1,18}\s*$/;
const BOOLEAN = /^\s*(true|false)\s*$/i;

/** A name a database accepts: letters, digits and underscores, lower case, never starting with a digit. */
export function sqlIdentifier(name: string, fallback = "column"): string {
  const clean = name
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 63);
  if (clean === "") return fallback;
  return /^\d/.test(clean) ? `${fallback}_${clean}` : clean;
}

/** Column names as identifiers, a repeated one told apart by a number. */
export function sqlColumnNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name, index) => {
    const base = sqlIdentifier(name, `column_${index + 1}`);
    const times = seen.get(base) ?? 0;
    seen.set(base, times + 1);
    return times === 0 ? base : `${base}_${times + 1}`;
  });
}

/** The narrowest type every filled cell fits: INTEGER, REAL, BOOLEAN, else TEXT. */
export function sqlColumnType(values: readonly string[]): SqlType {
  const filled = values.filter((value) => value.trim() !== "");
  if (filled.length === 0) return "TEXT";
  if (filled.every((value) => INTEGER.test(value))) return "INTEGER";
  if (filled.every((value) => NUMERIC.test(value))) return "REAL";
  if (filled.every((value) => BOOLEAN.test(value))) return "BOOLEAN";
  return "TEXT";
}

function typeName(type: SqlType, dialect: SqlDialect): string {
  if (type === "REAL") return dialect === "postgres" ? "DOUBLE PRECISION" : dialect === "mysql" ? "DOUBLE" : "REAL";
  if (type === "BOOLEAN") return dialect === "sqlite" ? "INTEGER" : "BOOLEAN";
  return type;
}

export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  return dialect === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`;
}

/** A cell as a literal of its column's type: NULL when empty, a number bare, text quoted. */
export function sqlLiteral(value: string, type: SqlType, dialect: SqlDialect): string {
  if (value.trim() === "") return "NULL";
  if (type === "INTEGER" || type === "REAL") {
    const number = typedValue(value.trim());
    if (typeof number === "number") return String(number);
    return String(Number(value.trim()));
  }
  if (type === "BOOLEAN") {
    const truth = value.trim().toLowerCase() === "true";
    return dialect === "sqlite" ? (truth ? "1" : "0") : truth ? "TRUE" : "FALSE";
  }
  const escaped = value.replace(/'/g, "''");
  return `'${dialect === "mysql" ? escaped.replace(/\\/g, "\\\\") : escaped}'`;
}

export interface SqlScript {
  sql: string;
  columns: string[];
  types: SqlType[];
  rows: number;
}

/** CREATE TABLE and INSERT statements that load the table. */
export function sqlStatements(rows: readonly (readonly string[])[], options: SqlOptions): SqlScript {
  const { names, data, width } = headerAndData(rows, options.header);
  const columns = sqlColumnNames(names);
  const types = Array.from({ length: width }, (_, column) => sqlColumnType(data.map((row) => row[column] ?? "")));
  const table = quoteIdentifier(sqlIdentifier(options.table, "imported"), options.dialect);
  const lines: string[] = [];
  if (options.createTable) {
    lines.push(`CREATE TABLE ${table} (`);
    lines.push(columns.map((column, index) => `  ${quoteIdentifier(column, options.dialect)} ${typeName(types[index], options.dialect)}`).join(",\n"));
    lines.push(");", "");
  }
  const list = columns.map((column) => quoteIdentifier(column, options.dialect)).join(", ");
  const batch = Math.max(1, options.rowsPerInsert);
  for (let at = 0; at < data.length; at += batch) {
    const values = data.slice(at, at + batch).map((row) => `  (${Array.from({ length: width }, (_, column) => sqlLiteral(row[column] ?? "", types[column], options.dialect)).join(", ")})`);
    lines.push(`INSERT INTO ${table} (${list}) VALUES`, `${values.join(",\n")};`, "");
  }
  return { sql: lines.join("\n"), columns, types, rows: data.length };
}
