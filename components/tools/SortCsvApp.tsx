"use client";

import { useMemo, useState } from "react";

import { csvLine, describeDelimiter } from "@/lib/data/csv";
import { countRows, CSV_ACCEPT, csvOutput, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { detectSortKind, findColumn, SORT_KINDS, sortRows, type SortKind, type SortOrder } from "@/lib/data/tables";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("sort-csv");

interface SortSettings {
  column: string;
  order: SortOrder;
  kind: SortKind;
  header: boolean;
}

const DEFAULT_SETTINGS: SortSettings = { column: "1", order: "asc", kind: "auto", header: true };

function isSortSettings(value: unknown): value is SortSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SortSettings>;
  return typeof candidate.column === "string" && (candidate.order === "asc" || candidate.order === "desc") && SORT_KINDS.some((kind) => kind.id === candidate.kind) && typeof candidate.header === "boolean";
}

/** A table's rows in order by one column. */
export function SortCsvApp() {
  const [settings, setSettings] = useState<SortSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "sort-csv"), settings, setSettings, isSortSettings);

  const queue = useMemo<PlainQueueOptions<SortSettings>>(
    () => ({
      key: "sort-csv",
      settings,
      reject: rejectNonCsv,
      run: async (file, current, report, signal) => {
        const { rows, delimiter, encoding } = await readCsvRows(file, report, signal);
        if (rows.length === 0) return { outputs: [], nothing: { message: "No rows were found.", hint: "The file has no lines with anything on them." } };
        const width = Math.max(0, ...rows.map((row) => row.length));
        const header = current.header ? rows[0] : null;
        const column = findColumn(header, current.column, width);
        if (column === null) {
          const names = header ? header.map((name, index) => `${index + 1} "${name.trim() || "(blank)"}"`).slice(0, 8).join(", ") : `1 to ${width}`;
          throw new PlainError(`There is no column "${current.column.trim() || "(blank)"}" in this file.`, `Its columns are ${names}${header && header.length > 8 ? ` and ${header.length - 8} more` : ""}. Type a column's name or its number.`);
        }
        const data = current.header ? rows.slice(1) : rows;
        const resolved = current.kind === "auto" ? detectSortKind(data.map((row) => row[column] ?? "")) : current.kind;
        report("Sorting...", null);
        const sorted = sortRows(rows, column, current.order, current.kind, current.header);
        const facts = [countRows(data.length), `Sorted by: column ${column + 1}${header ? ` "${header[column].trim()}"` : ""}, ${SORT_KINDS.find((kind) => kind.id === resolved)?.label.toLowerCase() ?? resolved}, ${current.order === "asc" ? "ascending" : "descending"}`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`];
        if (sorted.every((row, index) => row === rows[index] || row.every((cell, at) => cell === rows[index][at]))) {
          return { facts, outputs: [], nothing: { message: "The rows are already in that order.", hint: "Nothing would move." } };
        }
        const body = `${sorted.map((row) => csvLine(row, delimiter)).join("\r\n")}\r\n`;
        const { extension, mime } = csvOutput(delimiter);
        return {
          facts,
          outputs: [{ label: "Sorted table", fileName: `${fileStem(file.name, "table")}-sorted.${extension}`, blob: new Blob([body], { type: `${mime};charset=utf-8` }), kind: "file", note: `${countRows(data.length)}, empty cells last` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Sort by",
    defaultOpen: true,
    invalid: () => (settings.column.trim() === "" ? "Name the column to sort by." : null),
    summary: () => `column ${settings.column.trim() || "?"}, ${settings.order === "asc" ? "ascending" : "descending"}, ${SORT_KINDS.find((kind) => kind.id === settings.kind)?.label.toLowerCase()}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Column</legend>
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Name or number</span>
              <input type="text" value={settings.column} placeholder="date, or 3" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, column: event.target.value }))} className={styles.input} style={{ width: "14rem" }} />
            </label>
            <p className={styles.panelNote}>A header name, matched without regard to case, or the column&apos;s number counting from 1.</p>
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Order</legend>
          <RadioCards
            aria-label="Order"
            value={settings.order}
            onValueChange={(order) => setSettings((previous) => ({ ...previous, order: order as SortOrder }))}
            options={[
              { value: "asc", label: "Ascending", blurb: "A to Z, smallest first, earliest first" },
              { value: "desc", label: "Descending", blurb: "Z to A, largest first, latest first" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Compare the values</legend>
          <RadioCards aria-label="Compare the values" value={settings.kind} onValueChange={(kind) => setSettings((previous) => ({ ...previous, kind: kind as SortKind }))} options={SORT_KINDS.map((kind) => ({ value: kind.id, label: kind.label, blurb: kind.blurb }))} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row</legend>
          <RadioCards
            aria-label="The first row"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Stays at the top, and names the columns" },
              { value: "data", label: "Is data", blurb: "Sorted with the rest" },
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
      lead="Name a column and drop a CSV: it comes back with its rows in order by that column, as numbers when they are numbers and as text otherwise, the header kept at the top, empty cells last. Larger than a spreadsheet wants to open, and nothing uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Sorting"
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: `Sorted by column ${settings.column.trim() || "?"} as they land - change it above` }}
      note="Rows that compare equal keep the order they came in, so sorting by one column and then another sorts by both. Text is compared the way a person reads it, with item2 before item10 and without regard to case; dates written year first sort as dates. The table is written back with the file's own delimiter and in UTF-8, and is held in memory whole, so a few hundred megabytes is the practical limit."
    />
  );
}
