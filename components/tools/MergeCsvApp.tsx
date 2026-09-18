"use client";

import { useMemo, useState } from "react";

import { csvLine, describeDelimiter } from "@/lib/data/csv";
import { countRows, CSV_ACCEPT, csvOutput, readCsvRows, rejectNonCsv, sampleCsv } from "@/lib/data/readCsv";
import { mergeTables, type Table } from "@/lib/data/tables";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("merge-csv");

interface MergeSettings {
  header: boolean;
  sourceColumn: boolean;
}

function isMergeSettings(value: unknown): value is MergeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MergeSettings>;
  return typeof candidate.header === "boolean" && typeof candidate.sourceColumn === "boolean";
}

/** Several CSVs stacked into one. */
export function MergeCsvApp() {
  const [settings, setSettings] = useState<MergeSettings>({ header: true, sourceColumn: false });
  useStoredSettings(storageKey("settings", "merge-csv"), settings, setSettings, isMergeSettings);

  const queue = useMemo<CombineOptions<MergeSettings>>(
    () => ({
      key: "merge-csv",
      settings,
      reject: rejectNonCsv,
      inspect: async (file) => {
        const sample = await sampleCsv(file);
        return { facts: [`${describeDelimiter(sample.delimiter)}-separated, ${sample.encoding.label.split(",")[0]}`] };
      },
      run: async (files, current, report, signal) => {
        const tables: Table[] = [];
        let delimiter = null as ReturnType<typeof describeDelimiter> | null;
        let first: Awaited<ReturnType<typeof readCsvRows>> | null = null;
        for (const [index, file] of files.entries()) {
          const read = await readCsvRows(file, (phase, ratio) => report(`File ${index + 1} of ${files.length}: ${phase}`, ratio === null ? null : (index + ratio) / files.length), signal);
          if (!first) first = read;
          delimiter ??= describeDelimiter(read.delimiter);
          tables.push({ name: file.name, rows: read.rows });
        }
        if (!first) return { outputs: [], nothing: { message: "No files to merge.", hint: "Add at least two CSV files." } };
        report("Merging...", null);
        const merged = mergeTables(tables, current);
        if (merged.rows.length === 0) return { outputs: [], nothing: { message: "The files have no rows beyond their headers.", hint: "There is nothing to merge." } };
        const lines = merged.columns ? [csvLine(merged.columns, first.delimiter)] : [];
        for (const row of merged.rows) lines.push(csvLine(row, first.delimiter));
        const body = `${lines.join("\r\n")}\r\n`;
        const { extension, mime } = csvOutput(first.delimiter);
        const notes: string[] = [];
        if (current.header && merged.added.length > 0) notes.push(`${merged.added.length} ${merged.added.length === 1 ? "column" : "columns"} not in the first file ${merged.added.length === 1 ? "was" : "were"} added at the end: ${merged.added.slice(0, 6).join(", ")}${merged.added.length > 6 ? ` and ${merged.added.length - 6} more` : ""}. Rows from files without a column have it empty.`);
        if (current.header && merged.matching < files.length) notes.push(`${files.length - merged.matching} of the files ${files.length - merged.matching === 1 ? "has" : "have"} a header that differs from the first file's; their columns were matched by name.`);
        const width = merged.columns?.length ?? Math.max(0, ...merged.rows.map((row) => row.length));
        return {
          notes,
          outputs: [{ label: `Merged ${extension.toUpperCase()}`, fileName: `${fileStem(files[0].name, "table")}-merged.${extension}`, blob: new Blob([body], { type: `${mime};charset=utf-8` }), kind: "file", note: `${countRows(merged.rows.length)} from ${files.length} files, ${width} ${width === 1 ? "column" : "columns"}, ${delimiter}-separated like the first file` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Headers & source",
    summary: () => `${settings.header ? "first row is the header, columns matched by name" : "no headers"}${settings.sourceColumn ? ", file name in a column" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row of each file</legend>
          <RadioCards
            aria-label="The first row of each file"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Written once, and columns matched by name whatever their order" },
              { value: "data", label: "Is data", blurb: "Rows stacked as they are" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Where each row came from</legend>
          <RadioCards
            aria-label="Where each row came from"
            value={settings.sourceColumn ? "column" : "none"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, sourceColumn: value === "column" }))}
            options={[
              { value: "none", label: "Not recorded", blurb: "Just the rows" },
              { value: "column", label: "In a first column", blurb: 'A "source" column with the file name' },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop the CSV files of a year's monthly exports, a dozen survey batches, one file per region, and get one table back: headers matched by name so files whose columns are in a different order still line up, a column a later file adds appended, and the file each row came from noted if you like. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Merge the files"
      minFiles={2}
      noun="files"
      busyLabel="Merging"
      summary={(files) => (files.length >= 2 ? `${files.length} files, in the order above.` : null)}
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Stacked in the order below; add them all, then arrange them" }}
      note="Each file's delimiter and encoding are worked out on its own, so a comma-separated file and a semicolon-separated one merge, and the result uses the first file's delimiter. With headers, a column is the same column when its name matches without regard to case; a row with more cells than its header has the extras dropped. Every row is held in memory, so a few hundred megabytes in all is the practical limit."
    />
  );
}
