"use client";

import { useMemo, useState } from "react";

import { csvLine } from "@/lib/data/csv";
import { countRows, CSV_ACCEPT, csvHeader, describeHeader, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { compareTables, RelateError, type CompareMode } from "@/lib/data/relate";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("compare-csv");

interface CompareSettings {
  mode: CompareMode;
  key: string;
}

function isCompareSettings(value: unknown): value is CompareSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompareSettings>;
  return (candidate.mode === "key" || candidate.mode === "row") && typeof candidate.key === "string";
}

/** Two versions of a table, and the rows that were added, removed or changed between them. */
export function CompareCsvApp() {
  const [settings, setSettings] = useState<CompareSettings>({ mode: "key", key: "" });
  useStoredSettings(storageKey("settings", "compare-csv"), settings, setSettings, isCompareSettings);

  const queue = useMemo<CombineOptions<CompareSettings>>(
    () => ({
      key: "compare-csv",
      settings,
      reject: rejectNonCsv,
      inspect: async (file) => ({ facts: [describeHeader(await csvHeader(file))] }),
      run: async (files, current, report, signal) => {
        if (files.length !== 2) throw new PlainError("Drop exactly two files.", `There are ${files.length} in the list; a comparison takes two. Remove the extra ones.`);
        const [before, after] = files;
        const a = await readCsvRows(before, (phase, ratio) => report(`First file: ${phase}`, ratio === null ? null : ratio / 2), signal);
        const b = await readCsvRows(after, (phase, ratio) => report(`Second file: ${phase}`, ratio === null ? null : 0.5 + ratio / 2), signal);
        report("Comparing...", null);
        let result;
        try {
          result = compareTables(a.rows, b.rows, current.mode, { leftKey: current.key, rightKey: current.key, ignoreCase: false });
        } catch (error) {
          if (error instanceof RelateError) throw new PlainError("The files could not be compared.", error.message);
          throw error;
        }
        const summary = `${result.added.toLocaleString("en")} added, ${result.removed.toLocaleString("en")} removed${current.mode === "key" ? `, ${result.changed.toLocaleString("en")} changed` : ""}, ${result.unchanged.toLocaleString("en")} the same`;
        if (result.added + result.removed + result.changed === 0) return { outputs: [], nothing: { message: "The two tables hold the same rows.", hint: current.mode === "key" ? `Every row matched on "${result.keyName}" and every cell is the same.` : "Every row of one is a row of the other." } };
        const parts: string[] = [];
        let chunk = "";
        for (const row of result.rows) {
          chunk += `${csvLine(row, ",")}\r\n`;
          if (chunk.length > 1 << 20) {
            parts.push(chunk);
            chunk = "";
          }
        }
        parts.push(chunk);
        const notes = [`${summary}. The report reads from ${before.name} to ${after.name}${current.mode === "key" ? `, rows matched on "${result.keyName}"; a changed cell reads old -> new` : ""}.`];
        if (result.repeatedKeys > 0) notes.push(`${result.repeatedKeys.toLocaleString("en")} ${result.repeatedKeys === 1 ? "key appears" : "keys appear"} more than once, and were matched in the order they come. A column with a value unique to each row makes a better key.`);
        return {
          notes,
          outputs: [{ label: "Differences", fileName: `${fileStem(before.name, "before")}-vs-${fileStem(after.name, "after")}.csv`, blob: new Blob(parts, { type: "text/csv;charset=utf-8" }), kind: "file", note: countRows(result.rows.length - 1, "difference") }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Match rows by",
    summary: () => (settings.mode === "row" ? "the whole row" : settings.key.trim() ? `the column ${settings.key.trim()}` : "the first column name both share"),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Match rows by</legend>
          <RadioCards
            aria-label="Match rows by"
            value={settings.mode}
            onValueChange={(mode) => setSettings((previous) => ({ ...previous, mode: mode as CompareMode }))}
            options={[
              { value: "key", label: "A key column", blurb: "An ID or a code: rows are added, removed or changed" },
              { value: "row", label: "The whole row", blurb: "No key: a row is either in both or it is not" },
            ]}
            columns={2}
          />
        </fieldset>
        {settings.mode === "key" && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Key column</legend>
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Name or number</span>
                <input type="text" value={settings.key} placeholder="the first shared name" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, key: event.target.value }))} className={styles.input} style={{ width: "14rem" }} />
              </label>
            </div>
          </fieldset>
        )}
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop two versions of a CSV - last month's export and this month's, a price list before and after - and get the rows that were added, removed or changed, with each changed cell written old -> new. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Compare the files"
      minFiles={2}
      noun="files"
      busyLabel="Comparing"
      summary={(files) => (files.length === 2 ? `${files[0].file.name} (before) against ${files[1].file.name} (after).` : files.length > 2 ? `${files.length} files: a comparison takes two. Remove the extra ones.` : null)}
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose two CSV files", headline: "Drop two CSV files here", subhead: "The first is the old version, the second the new" }}
      note="Columns are matched by name, so a file whose columns moved compares cleanly, and a column only one file has shows as a change on every row that fills it. The report follows the first file's order for removed and changed rows and puts added rows at the end, with a column naming what changed. Cells are compared exactly as written: 1.0 and 1 differ."
    />
  );
}
