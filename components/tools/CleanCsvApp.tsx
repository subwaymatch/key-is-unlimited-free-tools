"use client";

import { useMemo, useState } from "react";

import { cleanRows, DEFAULT_CLEAN_OPTIONS, type CleanOptions } from "@/lib/data/clean";
import { CsvParser, csvLine, describeDelimiter, detectDelimiter } from "@/lib/data/csv";
import { formatBytes } from "@/lib/format-utils";
import { fileChunks } from "@/lib/images/run";
import { fileExtension, fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { decodeChunks, detectEncoding, looksBinary } from "@/lib/text/encoding";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("clean-csv");

const ACCEPT = ".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values,text/plain";

type Step = "trim" | "dropEmptyRows" | "dedupe" | "dropEmptyColumns";

const STEPS: { value: Step; label: string; blurb: string }[] = [
  { value: "trim", label: "Trim cells", blurb: "Spaces and tabs off both ends of every cell" },
  { value: "dedupe", label: "Remove duplicate rows", blurb: "A row identical to an earlier one is dropped; the first stays" },
  { value: "dropEmptyRows", label: "Drop empty rows", blurb: "Rows with nothing in any cell" },
  { value: "dropEmptyColumns", label: "Drop empty columns", blurb: "Columns with nothing under the header" },
];

function isCleanOptions(value: unknown): value is CleanOptions {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CleanOptions>;
  return ["trim", "dropEmptyRows", "dedupe", "dropEmptyColumns", "header"].every((key) => typeof candidate[key as keyof CleanOptions] === "boolean");
}

/** A table tidied. */
export function CleanCsvApp() {
  const [settings, setSettings] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS);
  useStoredSettings(storageKey("settings", "clean-csv"), settings, setSettings, isCleanOptions);

  const chosen = STEPS.map((step) => step.value).filter((step) => settings[step]);

  const queue = useMemo<PlainQueueOptions<CleanOptions>>(
    () => ({
      key: "clean-csv",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there are no rows in it." } : null),
      run: async (file, current, report, signal) => {
        report("Looking at the first lines...", null);
        const sample = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
        if (looksBinary(sample)) throw new PlainError("This is not a text file.", "It has bytes no text file has. A workbook wants Excel to CSV first.");
        const encoding = detectEncoding(sample);
        const delimiter = detectDelimiter(new TextDecoder(encoding.encoding).decode(sample));
        const parser = new CsvParser(delimiter);
        const rows: string[][] = [];
        let done = 0;
        async function* counted() {
          for await (const chunk of fileChunks(file, 4 * 1024 * 1024)) {
            done += chunk.length;
            report(`Reading... ${formatBytes(done)} of ${formatBytes(file.size)}, ${rows.length.toLocaleString("en")} rows`, done / file.size);
            yield chunk;
          }
        }
        for await (const text of decodeChunks(counted(), encoding.encoding)) {
          if (signal.aborted) throw new PlainError("Cancelled.");
          rows.push(...parser.push(text));
        }
        rows.push(...parser.end());
        if (rows.length === 0) return { outputs: [], nothing: { message: "No rows were found.", hint: "The file has no lines with anything on them." } };
        report("Cleaning...", null);
        const result = cleanRows(rows, current);
        const facts = [`${rows.length.toLocaleString("en")} ${rows.length === 1 ? "row" : "rows"} in`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`];
        const changes: string[] = [];
        if (result.trimmed > 0) changes.push(`${result.trimmed.toLocaleString("en")} ${result.trimmed === 1 ? "cell" : "cells"} trimmed`);
        if (result.duplicates > 0) changes.push(`${result.duplicates.toLocaleString("en")} duplicate ${result.duplicates === 1 ? "row" : "rows"} removed`);
        if (result.emptyRows > 0) changes.push(`${result.emptyRows.toLocaleString("en")} empty ${result.emptyRows === 1 ? "row" : "rows"} dropped`);
        if (result.emptyColumns.length > 0) changes.push(`${result.emptyColumns.length} empty ${result.emptyColumns.length === 1 ? "column" : "columns"} dropped (${result.emptyColumns.join(", ")})`);
        if (result.padded > 0) changes.push(`${result.padded.toLocaleString("en")} short ${result.padded === 1 ? "row" : "rows"} padded to the full width`);
        if (changes.length === 0) return { facts, outputs: [], nothing: { message: "This file is already clean.", hint: "Nothing ticked above found anything to change." } };
        const body = `${result.rows.map((row) => csvLine(row, delimiter)).join("\r\n")}\r\n`;
        const extension = fileExtension(file.name) === "tsv" || delimiter === "\t" ? "tsv" : "csv";
        return {
          facts,
          notes: [`${changes.join("; ")}.`],
          outputs: [{ label: "Clean table", fileName: `${fileStem(file.name, "table")}-clean.${extension}`, blob: new Blob([body], { type: `${extension === "tsv" ? "text/tab-separated-values" : "text/csv"};charset=utf-8` }), kind: "file", note: `${result.rows.length.toLocaleString("en")} ${result.rows.length === 1 ? "row" : "rows"} out` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What to clean",
    defaultOpen: true,
    invalid: () => (chosen.length === 0 ? "Tick at least one step before adding a file." : null),
    summary: () => `${chosen.map((step) => STEPS.find((entry) => entry.value === step)?.label.toLowerCase()).join(", ")}; ${settings.header ? "first row is the header" : "no header"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Steps</legend>
          <CheckboxCards aria-label="Steps" value={chosen} onValueChange={(next) => setSettings((previous) => ({ ...previous, trim: next.includes("trim"), dedupe: next.includes("dedupe"), dropEmptyRows: next.includes("dropEmptyRows"), dropEmptyColumns: next.includes("dropEmptyColumns") }))} options={STEPS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row</legend>
          <RadioCards
            aria-label="The first row"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Kept as it is, and never counted as a duplicate" },
              { value: "data", label: "Is data", blurb: "Treated like every other row" },
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
      lead="Drop a CSV and get it back tidied: cells trimmed of stray spaces, duplicate rows removed, empty rows and empty columns dropped, every row the same width, written back with the delimiter it came with. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Cleaning"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Cleaned as they land - tick the steps above" }}
      note="Two rows are duplicates when every cell matches exactly, after trimming when that is on, so a row that differs only in capitalisation stays. The card counts what changed; a file that needed nothing is reported rather than written. The whole table is held in memory, so a file of a few hundred megabytes needs that much room in the browser."
    />
  );
}
