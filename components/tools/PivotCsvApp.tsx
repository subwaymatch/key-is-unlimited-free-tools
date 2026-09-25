"use client";

import { useMemo, useState } from "react";

import { csvLine, describeDelimiter } from "@/lib/data/csv";
import { AGGREGATES, pivotTable, PivotError, type Aggregate } from "@/lib/data/pivot";
import { countRows, CSV_ACCEPT, csvOutput, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("pivot-csv");

interface PivotSettings {
  rows: string;
  columns: string;
  values: string;
  aggregate: Aggregate;
}

function isPivotSettings(value: unknown): value is PivotSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PivotSettings>;
  return typeof candidate.rows === "string" && typeof candidate.columns === "string" && typeof candidate.values === "string" && AGGREGATES.some((entry) => entry.id === candidate.aggregate);
}

/** A CSV summarised: counts, sums or averages by group, spread across a second column if asked. */
export function PivotCsvApp() {
  const [settings, setSettings] = useState<PivotSettings>({ rows: "", columns: "", values: "", aggregate: "count" });
  useStoredSettings(storageKey("settings", "pivot-csv"), settings, setSettings, isPivotSettings);

  const invalid = settings.rows.trim() === "" ? "Name the column to group rows by before adding a file." : settings.aggregate !== "count" && settings.values.trim() === "" ? "Name the column to take the values from." : null;

  const queue = useMemo<PlainQueueOptions<PivotSettings>>(
    () => ({
      key: "pivot-csv",
      settings,
      reject: rejectNonCsv,
      run: async (file, current, report, signal) => {
        const { rows, delimiter, encoding } = await readCsvRows(file, report, signal);
        report("Summarising...", null);
        let result;
        try {
          result = pivotTable(rows, current);
        } catch (error) {
          if (error instanceof PivotError) throw new PlainError("The table could not be summarised.", error.message);
          throw error;
        }
        const body = `${result.table.map((row) => csvLine(row, delimiter)).join("\r\n")}\r\n`;
        const { extension, mime } = csvOutput(delimiter);
        const notes: string[] = [];
        if (result.skipped > 0) notes.push(`${result.skipped.toLocaleString("en")} ${result.skipped === 1 ? "cell was" : "cells were"} not a number and ${result.skipped === 1 ? "was" : "were"} left out.`);
        return {
          facts: [`${countRows(rows.length - 1)}`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`],
          notes,
          outputs: [{ label: "Pivot table", fileName: `${fileStem(file.name, "table")}-pivot.${extension}`, blob: new Blob([body], { type: `${mime};charset=utf-8` }), kind: "file", note: `${result.groups.toLocaleString("en")} ${result.groups === 1 ? "group" : "groups"}, ${result.table[0].length - 1} ${result.table[0].length === 2 ? "column" : "columns"} of results` }],
        };
      },
    }),
    [settings],
  );

  const field = (key: "rows" | "columns" | "values", label: string, placeholder: string) => (
    <label>
      <span className={styles.fieldLabel}>{label}</span>
      <input type="text" value={settings[key]} placeholder={placeholder} spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, [key]: event.target.value }))} className={styles.input} style={{ width: "11rem" }} />
    </label>
  );

  const toolSettings: PlainSettings = {
    title: "Group, spread & measure",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () => (settings.rows.trim() ? `${AGGREGATES.find((entry) => entry.id === settings.aggregate)?.label.toLowerCase()}${settings.aggregate === "count" ? "" : ` of ${settings.values.trim() || "..."}`} by ${settings.rows.trim()}${settings.columns.trim() ? ` and ${settings.columns.trim()}` : ""}` : "not set yet"),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Columns</legend>
          <div className={styles.fileRow}>
            {field("rows", "Group rows by", "region")}
            {field("columns", "Spread across (optional)", "month")}
            {settings.aggregate !== "count" && field("values", "Values from", "amount")}
          </div>
          <p className={styles.panelNote}>A column&apos;s name as the header writes it, or its number counting from 1.</p>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>In each cell</legend>
          <RadioCards aria-label="In each cell" value={settings.aggregate} onValueChange={(aggregate) => setSettings((previous) => ({ ...previous, aggregate: aggregate as Aggregate }))} options={AGGREGATES.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} columns={3} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a CSV and get it summarised: rows grouped by one column, counted, summed or averaged, and spread across the values of a second column if you like - sales by region and month, tickets by status and team - with totals. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Summarising"
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: invalid ? "Name the columns above first" : "Summarised as they land" }}
      note="Numbers are read as people write them: 1,234.50, $12 and (12) for a negative all count, and a cell that is not a number is left out of a sum or an average and counted. Groups come out in natural order, with an empty value as (blank) at the end. The totals are worked out from the rows themselves, so the total of an average is the average of everything, not an average of averages."
    />
  );
}
