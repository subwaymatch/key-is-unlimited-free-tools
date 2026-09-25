"use client";

import { useMemo, useState } from "react";

import { csvLine } from "@/lib/data/csv";
import { cellOf, isSqlite, jsonOf, SqliteDatabase, SqliteError, type SqliteValue } from "@/lib/data/sqlite";
import { buildXlsx, MAX_ROWS, sheetName } from "@/lib/data/xlsx";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";
import { uniqueNames } from "@/lib/zip/archive";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("sqlite-to-csv");

/** Past this the database cannot be held in a tab. */
const MAX_BYTES = 1024 * 1024 * 1024;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type SqliteFormat = "csv" | "xlsx" | "json";

const FORMATS: { id: SqliteFormat; label: string; blurb: string }[] = [
  { id: "csv", label: "CSV", blurb: "One file per table" },
  { id: "xlsx", label: "Excel workbook", blurb: "One sheet per table, in one file" },
  { id: "json", label: "JSON", blurb: "One file per table, an object per row" },
];

interface SqliteSettings {
  format: SqliteFormat;
}

function isSqliteSettings(value: unknown): value is SqliteSettings {
  return typeof value === "object" && value !== null && FORMATS.some((format) => format.id === (value as Partial<SqliteSettings>).format);
}

/** Every table of a SQLite database as CSV, JSON or a workbook. */
export function SqliteToCsvApp() {
  const [settings, setSettings] = useState<SqliteSettings>({ format: "csv" });
  useStoredSettings(storageKey("settings", "sqlite-to-csv"), settings, setSettings, isSqliteSettings);

  const queue = useMemo<PlainQueueOptions<SqliteSettings>>(
    () => ({
      key: "sqlite-to-csv",
      settings,
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is no database in it." };
        if (file.size > MAX_BYTES) return { message: "This database is too large to hold in a browser tab.", hint: `This reads databases up to ${formatBytes(MAX_BYTES)}.` };
        if (/-(wal|shm|journal)$/i.test(file.name)) return { message: "This is SQLite's scratch file, not the database.", hint: "Drop the database itself: the file with the same name without -wal, -shm or -journal." };
        return null;
      },
      run: async (file, current, report, signal) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isSqlite(bytes)) throw new PlainError("This is not a SQLite database.", "A SQLite file starts with the words \"SQLite format 3\", and this one does not. An encrypted database does not either.");
        let db: SqliteDatabase;
        try {
          db = new SqliteDatabase(bytes);
        } catch (error) {
          throw new PlainError("This database could not be read.", error instanceof Error ? error.message : String(error), { cause: error });
        }
        const tables = db.tables();
        if (tables.length === 0) return { facts: [`Pages: ${db.pageCount.toLocaleString("en")} of ${formatBytes(db.pageSize)}`], outputs: [], nothing: { message: "This database has no tables with rows to export.", hint: "It may hold only views, indexes or virtual tables, which have no rows of their own." } };

        const names = uniqueNames(tables.map((table) => table.name.replace(/[\\/:*?"<>|]+/g, "_")));
        const counts: string[] = [];
        const outputs: PlainOutputSpec[] = [];
        const sheets: { name: string; rows: string[][] }[] = [];
        const notes: string[] = [];
        let blobs = false;
        for (const [index, table] of tables.entries()) {
          if (signal.aborted) throw new PlainError("Cancelled.");
          report(`Reading ${table.name}...`, index / tables.length);
          const rows: SqliteValue[][] = [];
          try {
            for (const row of db.tableRows(table)) rows.push(row);
          } catch (error) {
            if (!(error instanceof SqliteError)) throw error;
            notes.push(`${table.name} stopped partway: ${error.message} ${rows.length.toLocaleString("en")} rows were read before it.`);
          }
          counts.push(`${table.name} (${rows.length.toLocaleString("en")})`);
          blobs ||= rows.some((row) => row.some((value) => value instanceof Uint8Array));
          if (current.format === "json") {
            const records = rows.map((row) => Object.fromEntries(table.columns.map((column, position) => [column, jsonOf(row[position])])));
            outputs.push({ label: table.name, fileName: `${names[index]}.json`, blob: new Blob([`${JSON.stringify(records, null, 2)}\n`], { type: "application/json" }), kind: "file", note: `${rows.length.toLocaleString("en")} rows, ${table.columns.length} columns` });
          } else if (current.format === "xlsx" && rows.length < MAX_ROWS) {
            const sheet: string[][] = [table.columns];
            for (const row of rows) sheet.push(row.map(cellOf));
            sheets.push({ name: sheetName(table.name), rows: sheet });
          } else {
            if (current.format === "xlsx") notes.push(`${table.name} has more rows than a sheet holds, so it is written as a CSV instead.`);
            const parts: string[] = [`${csvLine(table.columns, ",")}\r\n`];
            let chunk = "";
            for (const row of rows) {
              chunk += `${csvLine(row.map(cellOf), ",")}\r\n`;
              if (chunk.length > 1 << 20) {
                parts.push(chunk);
                chunk = "";
              }
            }
            parts.push(chunk);
            outputs.push({ label: table.name, fileName: `${names[index]}.csv`, blob: new Blob(parts, { type: "text/csv;charset=utf-8" }), kind: "file", note: `${rows.length.toLocaleString("en")} rows, ${table.columns.length} columns` });
          }
        }
        if (sheets.length > 0) {
          report("Writing the workbook...", null);
          const workbook = buildXlsx(sheets, { typed: true, boldHeader: true });
          outputs.unshift({ label: "Excel workbook", fileName: `${fileStem(file.name, "database")}.xlsx`, blob: new Blob([workbook as BlobPart], { type: XLSX_MIME }), kind: "file", note: `${sheets.length} ${sheets.length === 1 ? "sheet" : "sheets"}, one per table` });
        }
        if (db.wal) notes.push("This database was last written in WAL mode. Changes SQLite had not yet copied in from its -wal file are not in the database file alone, so the latest rows may be missing; closing the app that uses it first copies them in.");
        if (blobs) notes.push("Blobs - pictures and other binary values - are written as hexadecimal.");
        return {
          facts: [`${tables.length} ${tables.length === 1 ? "table" : "tables"}`, `Tables: ${counts.join(", ")}`, `Text: ${db.encoding.toUpperCase()}`],
          notes,
          outputs,
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Output",
    summary: () => FORMATS.find((format) => format.id === settings.format)?.label ?? "",
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Write each table as</legend>
        <RadioCards aria-label="Write each table as" value={settings.format} onValueChange={(format) => setSettings({ format: format as SqliteFormat })} options={FORMATS.map((format) => ({ value: format.id, label: format.label, blurb: format.blurb }))} columns={3} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a SQLite database - an app's .db, .sqlite or .sqlite3 file, a browser's history, a phone backup's contacts - and get every table as a CSV, a JSON file or a sheet of one workbook, with no database software installed. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Reading"
      dropZone={{ accept: ".db,.sqlite,.sqlite3,.db3,.s3db,.sl3,application/vnd.sqlite3,application/x-sqlite3", inputLabel: "Choose SQLite files", headline: "Drop SQLite databases here", subhead: "Every table exported as they land" }}
      note="The database's own file format is read here page by page, with no SQLite engine and no SQL: tables in any page size and text encoding, rows that spill onto overflow pages, WITHOUT ROWID tables and columns added after the table was made. Views, indexes and virtual tables have no rows of their own and are left out. An encrypted database, such as a messaging app's, cannot be read without its key."
    />
  );
}
