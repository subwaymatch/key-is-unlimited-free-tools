"use client";

import { useMemo, useState } from "react";

import { columnNames, CsvParser, describeDelimiter, detectDelimiter } from "@/lib/data/csv";
import { profileReport, Profiler } from "@/lib/data/profile";
import { formatBytes } from "@/lib/format-utils";
import { fileChunks } from "@/lib/images/run";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { decodeChunks, detectEncoding, looksBinary } from "@/lib/text/encoding";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("profile-csv");

const ACCEPT = ".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values,text/plain";

const TYPE_WORDS: Record<string, string> = { empty: "empty", integer: "whole numbers", number: "numbers", boolean: "true/false", date: "dates", text: "text" };

interface ProfileSettings {
  header: boolean;
}

function isProfileSettings(value: unknown): value is ProfileSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<ProfileSettings>).header === "boolean";
}

/** What is in each column of a table. */
export function ProfileCsvApp() {
  const [settings, setSettings] = useState<ProfileSettings>({ header: true });
  useStoredSettings(storageKey("settings", "profile-csv"), settings, setSettings, isProfileSettings);

  const queue = useMemo<PlainQueueOptions<ProfileSettings>>(
    () => ({
      key: "profile-csv",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there are no rows in it." } : null),
      run: async (file, current, report, signal) => {
        report("Looking at the first lines...", null);
        const sample = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
        if (looksBinary(sample)) throw new PlainError("This is not a text file.", "It has bytes no text file has. A workbook wants Excel to CSV first.");
        const encoding = detectEncoding(sample);
        const delimiter = detectDelimiter(new TextDecoder(encoding.encoding).decode(sample));
        const parser = new CsvParser(delimiter);
        let profiler: Profiler | null = null;
        let names: string[] = [];
        let done = 0;
        const take = (row: string[]) => {
          if (!profiler) {
            names = columnNames(current.header ? row : null, row.length);
            profiler = new Profiler(names);
            if (current.header) return;
          }
          profiler.add(row);
        };
        async function* counted() {
          for await (const chunk of fileChunks(file, 4 * 1024 * 1024)) {
            done += chunk.length;
            report(`Reading... ${formatBytes(done)} of ${formatBytes(file.size)}, ${parser.count.toLocaleString("en")} rows`, done / file.size);
            yield chunk;
          }
        }
        for await (const text of decodeChunks(counted(), encoding.encoding)) {
          if (signal.aborted) throw new PlainError("Cancelled.");
          for (const row of parser.push(text)) take(row);
        }
        for (const row of parser.end()) take(row);
        if (!profiler) return { outputs: [], nothing: { message: "No rows were found.", hint: "The file has no lines with anything on them." } };
        const rows = (profiler as Profiler).rowCount;
        const profiles = (profiler as Profiler).finish();
        if (rows === 0) return { outputs: [], nothing: { message: "There is a header and nothing under it.", hint: "No rows to profile." } };
        const stem = fileStem(file.name, "table");
        const report_ = profileReport(profiles, rows, file.name);
        const shown = profiles.slice(0, 24).map((column) => `${column.name}: ${TYPE_WORDS[column.type]}${column.empty > 0 ? `, ${column.empty.toLocaleString("en")} empty` : ""}${column.distinct !== null && column.type !== "empty" ? `, ${column.distinct.toLocaleString("en")} distinct` : ""}${column.min !== null && column.max !== null ? `, ${column.min} to ${column.max}` : ""}`);
        return {
          facts: [`${rows.toLocaleString("en")} ${rows === 1 ? "row" : "rows"}, ${profiles.length} ${profiles.length === 1 ? "column" : "columns"}`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`],
          notes: [...shown, ...(profiles.length > 24 ? [`... and ${profiles.length - 24} more columns, in the report.`] : [])],
          outputs: [
            { label: "Report", fileName: `${stem}-profile.txt`, blob: new Blob([report_], { type: "text/plain;charset=utf-8" }), kind: "file", note: "Every column: type, empties, range, lengths, commonest values" },
            { label: "As JSON", fileName: `${stem}-profile.json`, blob: new Blob([`${JSON.stringify({ file: file.name, rows, columns: profiles }, null, 2)}\n`], { type: "application/json;charset=utf-8" }), kind: "file" },
          ],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "The first row",
    summary: () => (settings.header ? "is the header" : "is data"),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>The first row</legend>
        <RadioCards
          aria-label="The first row"
          value={settings.header ? "header" : "data"}
          onValueChange={(value) => setSettings({ header: value === "header" })}
          options={[
            { value: "header", label: "Is the header", blurb: "Its names label the columns" },
            { value: "data", label: "Is data", blurb: "Columns are numbered" },
          ]}
          columns={2}
        />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a CSV and see what is in it before you trust it: every column's type, how many cells are empty, the range of the numbers, how many distinct values there are and which come up most, in one pass over a file of any size. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Profiling"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Profiled as they land, a row at a time" }}
      note="A column is whole numbers, numbers, true/false or dates only when every filled cell is; one stray word makes it text, which is exactly the thing worth knowing. Distinct values are counted up to twenty thousand per column, and a column with more is reported as having more. Dates are recognised in ISO form, 2024-01-31 with or without a time; other date styles count as text."
    />
  );
}
