"use client";

import { useMemo, useState } from "react";

import { describeDelimiter } from "@/lib/data/csv";
import { DEFAULT_SQL_OPTIONS, SQL_DIALECTS, sqlIdentifier, sqlStatements, type SqlDialect } from "@/lib/data/export";
import { countRows, CSV_ACCEPT, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("csv-to-sql");

interface SqlSettings {
  table: string;
  dialect: SqlDialect;
  header: boolean;
  createTable: boolean;
}

function isSqlSettings(value: unknown): value is SqlSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SqlSettings>;
  return typeof candidate.table === "string" && SQL_DIALECTS.some((dialect) => dialect.id === candidate.dialect) && typeof candidate.header === "boolean" && typeof candidate.createTable === "boolean";
}

/** A CSV as the SQL that loads it. */
export function CsvToSqlApp() {
  const [settings, setSettings] = useState<SqlSettings>({ table: "", dialect: "generic", header: true, createTable: true });
  useStoredSettings(storageKey("settings", "csv-to-sql"), settings, setSettings, isSqlSettings);

  const queue = useMemo<PlainQueueOptions<SqlSettings>>(
    () => ({
      key: "csv-to-sql",
      settings,
      reject: rejectNonCsv,
      run: async (file, current, report, signal) => {
        const { rows, delimiter, encoding } = await readCsvRows(file, report, signal);
        if (rows.length === 0) return { outputs: [], nothing: { message: "No rows were found.", hint: "The file has no lines with anything on them." } };
        report("Writing...", null);
        const table = sqlIdentifier(current.table.trim() || fileStem(file.name, "imported"), "imported");
        const script = sqlStatements(rows, { ...DEFAULT_SQL_OPTIONS, table, dialect: current.dialect, header: current.header, createTable: current.createTable });
        const facts = [`${countRows(script.rows)}`, `Table: ${table}`, `Columns: ${script.columns.map((column, index) => `${column} ${script.types[index]}`).join(", ")}`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`];
        return {
          facts,
          outputs: [{ label: `SQL for ${SQL_DIALECTS.find((dialect) => dialect.id === current.dialect)?.label ?? current.dialect}`, fileName: `${fileStem(file.name, "table")}.sql`, blob: new Blob([script.sql], { type: "application/sql;charset=utf-8" }), kind: "file", note: `${current.createTable ? "CREATE TABLE and " : ""}INSERT statements for ${countRows(script.rows)}, ${DEFAULT_SQL_OPTIONS.rowsPerInsert} rows an INSERT` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Table & dialect",
    summary: () => `${settings.table.trim() ? sqlIdentifier(settings.table) : "named after the file"}, ${SQL_DIALECTS.find((dialect) => dialect.id === settings.dialect)?.label}, ${settings.createTable ? "with CREATE TABLE" : "INSERTs only"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Table name</legend>
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Name</span>
              <input type="text" value={settings.table} placeholder="named after the file" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, table: event.target.value }))} className={styles.input} style={{ width: "14rem" }} />
            </label>
            <p className={styles.panelNote}>Spaces and punctuation become underscores; left empty, the file&apos;s name is used.</p>
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Dialect</legend>
          <RadioCards aria-label="Dialect" value={settings.dialect} onValueChange={(dialect) => setSettings((previous) => ({ ...previous, dialect: dialect as SqlDialect }))} options={SQL_DIALECTS.map((dialect) => ({ value: dialect.id, label: dialect.label, blurb: dialect.blurb }))} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Statements</legend>
          <RadioCards
            aria-label="Statements"
            value={settings.createTable ? "create" : "insert"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, createTable: value === "create" }))}
            options={[
              { value: "create", label: "CREATE TABLE, then INSERT", blurb: "Column types worked out from the values" },
              { value: "insert", label: "INSERT only", blurb: "The table already exists" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row</legend>
          <RadioCards
            aria-label="The first row"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Names the columns" },
              { value: "data", label: "Is data", blurb: "Columns are named column_1, column_2 and so on" },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a CSV and get the SQL that loads it: a CREATE TABLE with a type worked out for every column and INSERT statements for the rows, with names quoted and text escaped the way PostgreSQL, MySQL, SQLite or standard SQL want. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Writing"
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Written as SQL as they land" }}
      note="A column is INTEGER when every filled cell is a whole number, REAL when every one is a number, BOOLEAN when every one is true or false, and TEXT otherwise; an empty cell is NULL. Column names are lower-cased with punctuation made underscores and a repeated name numbered. Rows go in batches of five hundred to an INSERT, which every database takes and none chokes on. Nothing here runs the SQL; read it before your database does."
    />
  );
}
