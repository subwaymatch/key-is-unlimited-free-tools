"use client";

import { useMemo, useState } from "react";

import { csvLine, describeDelimiter } from "@/lib/data/csv";
import { countRows, CSV_ACCEPT, csvOutput, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { pieceCount, pieceSuffix, ROWS_PER_FILE, splitRows } from "@/lib/data/tables";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("split-csv");

const CUSTOM = "custom";

/** More files than this is not a split anyone wants. */
const MAX_PIECES = 500;

interface SplitSettings {
  perFile: number;
  customRows: string;
  header: boolean;
}

function isSplitSettings(value: unknown): value is SplitSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SplitSettings>;
  return typeof candidate.perFile === "number" && candidate.perFile >= 1 && typeof candidate.customRows === "string" && typeof candidate.header === "boolean";
}

function choiceFor(settings: SplitSettings): string {
  return ROWS_PER_FILE.some((option) => option.value === settings.perFile) ? String(settings.perFile) : CUSTOM;
}

/** A large CSV in files of so many rows. */
export function SplitCsvApp() {
  const [settings, setSettings] = useState<SplitSettings>({ perFile: 10_000, customRows: "5000", header: true });
  useStoredSettings(storageKey("settings", "split-csv"), settings, setSettings, isSplitSettings);

  const choice = choiceFor(settings);
  const customInvalid = choice === CUSTOM && !(Math.round(Number(settings.customRows)) >= 1);

  const queue = useMemo<PlainQueueOptions<SplitSettings>>(
    () => ({
      key: "split-csv",
      settings,
      reject: rejectNonCsv,
      run: async (file, current, report, signal) => {
        const { rows, delimiter, encoding } = await readCsvRows(file, report, signal);
        const data = current.header ? Math.max(0, rows.length - 1) : rows.length;
        const facts = [`${countRows(data)}${current.header ? " under the header" : ""}`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`];
        if (rows.length === 0) return { outputs: [], nothing: { message: "No rows were found.", hint: "The file has no lines with anything on them." } };
        const count = pieceCount(data, current.perFile);
        if (count === 1) return { facts, outputs: [], nothing: { message: `This file already has at most ${current.perFile.toLocaleString("en")} rows.`, hint: "One piece would be the whole file." } };
        if (count > MAX_PIECES) throw new PlainError(`That would be ${count.toLocaleString("en")} files.`, `This makes up to ${MAX_PIECES}; choose more rows per file.`);
        report("Writing...", null);
        const pieces = splitRows(rows, current.header, current.perFile);
        const { extension, mime } = csvOutput(delimiter);
        const stem = fileStem(file.name, "table");
        return {
          facts: [...facts, `${count} files of up to ${current.perFile.toLocaleString("en")} rows`],
          outputs: pieces.map((piece, index) => {
            const body = `${piece.map((row) => csvLine(row, delimiter)).join("\r\n")}\r\n`;
            const dataRows = current.header ? piece.length - 1 : piece.length;
            return { label: `Part ${index + 1} of ${count}`, fileName: `${stem}${pieceSuffix(index, count)}.${extension}`, blob: new Blob([body], { type: `${mime};charset=utf-8` }), kind: "file" as const, note: `${countRows(dataRows)}${current.header ? ", with the header" : ""}` };
          }),
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Rows per file",
    defaultOpen: true,
    invalid: () => (customInvalid ? "Type a number of rows of at least 1." : null),
    summary: () => `${settings.perFile.toLocaleString("en")} rows a file, ${settings.header ? "header repeated" : "no header"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Each file at most</legend>
          <RadioCards
            aria-label="Each file at most"
            value={choice}
            onValueChange={(value) => setSettings((previous) => (value === CUSTOM ? { ...previous, perFile: Math.max(1, Math.round(Number(previous.customRows))) || 1 } : { ...previous, perFile: Number(value) }))}
            options={[...ROWS_PER_FILE.map((option) => ({ value: String(option.value), label: option.label, blurb: option.blurb })), { value: CUSTOM, label: "Custom", blurb: "Any number of rows" }]}
          />
          {choice === CUSTOM && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Rows</span>
                <input type="number" inputMode="numeric" min={1} step="1" value={settings.customRows} aria-invalid={customInvalid} onChange={(event) => setSettings((previous) => ({ ...previous, customRows: event.target.value, perFile: Math.max(1, Math.round(Number(event.target.value))) || previous.perFile }))} className={styles.input} />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row</legend>
          <RadioCards
            aria-label="The first row"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Repeated at the top of every file, so each opens on its own" },
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
      lead="Drop a CSV too large for an import form, a spreadsheet or an email, and get it back as numbered files of 1,000, 10,000, 100,000 or any number of rows, each with the header at the top so it opens and imports on its own. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Splitting"
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: `Cut every ${settings.perFile.toLocaleString("en")} rows as they land - change it above` }}
      note="Rows are counted as the CSV parser reads them, so a quoted cell with a line break inside it is one row, not two, and a file is never cut in the middle of one. The pieces are written back with the file's own delimiter and in UTF-8. Download all as a ZIP saves the set at once. The whole table is held in memory, so a file of a few hundred megabytes needs that much room in the browser."
    />
  );
}
