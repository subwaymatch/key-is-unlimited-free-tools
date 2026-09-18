"use client";

import { useMemo, useState } from "react";

import { CsvParser, describeDelimiter, detectDelimiter } from "@/lib/data/csv";
import { buildXlsx, MAX_COLUMNS, MAX_ROWS, sheetName } from "@/lib/data/xlsx";
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

const tool = requireTool("csv-to-excel");

const ACCEPT = ".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values,text/plain";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface ExcelSettings {
  typed: boolean;
  boldHeader: boolean;
}

function isExcelSettings(value: unknown): value is ExcelSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ExcelSettings>;
  return typeof candidate.typed === "boolean" && typeof candidate.boldHeader === "boolean";
}

/** A CSV as a workbook Excel opens without a wizard. */
export function CsvToExcelApp() {
  const [settings, setSettings] = useState<ExcelSettings>({ typed: true, boldHeader: true });
  useStoredSettings(storageKey("settings", "csv-to-excel"), settings, setSettings, isExcelSettings);

  const queue = useMemo<PlainQueueOptions<ExcelSettings>>(
    () => ({
      key: "csv-to-excel",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there are no rows in it." } : null),
      run: async (file, current, report, signal) => {
        report("Looking at the first lines...", null);
        const sample = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
        if (looksBinary(sample)) throw new PlainError("This is not a text file.", "It has bytes no text file has. If it is already a workbook, it needs no converting.");
        const encoding = detectEncoding(sample);
        const delimiter = detectDelimiter(new TextDecoder(encoding.encoding).decode(sample));
        const parser = new CsvParser(delimiter);
        const rows: string[][] = [];
        let columns = 0;
        let done = 0;
        const take = (row: string[]) => {
          if (rows.length >= MAX_ROWS) throw new PlainError(`Excel holds ${MAX_ROWS.toLocaleString("en")} rows a sheet, and this file has more.`, "Split the CSV first, or keep it as CSV: a spreadsheet cannot open the rest.");
          if (row.length > MAX_COLUMNS) throw new PlainError(`Excel holds ${MAX_COLUMNS.toLocaleString("en")} columns, and a row here has more.`, "The file may be using the wrong delimiter; check the first line.");
          if (row.length > columns) columns = row.length;
          rows.push(row);
        };
        async function* counted() {
          for await (const chunk of fileChunks(file, 4 * 1024 * 1024)) {
            done += chunk.length;
            report(`Reading... ${formatBytes(done)} of ${formatBytes(file.size)}, ${rows.length.toLocaleString("en")} rows`, done / file.size);
            yield chunk;
          }
        }
        for await (const text of decodeChunks(counted(), encoding.encoding)) {
          if (signal.aborted) throw new PlainError("Cancelled.");
          for (const row of parser.push(text)) take(row);
        }
        for (const row of parser.end()) take(row);
        if (rows.length === 0) return { outputs: [], nothing: { message: "No rows were found.", hint: "The file has no lines with anything on them." } };
        report("Writing the workbook...", null);
        const stem = fileStem(file.name, "table");
        const bytes = buildXlsx([{ name: sheetName(stem), rows }], { typed: current.typed, boldHeader: current.boldHeader });
        return {
          facts: [`${rows.length.toLocaleString("en")} ${rows.length === 1 ? "row" : "rows"}, ${columns} ${columns === 1 ? "column" : "columns"}`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`],
          notes: encoding.sure ? [] : [`The file is not UTF-8 and carries no mark, so it was read as ${encoding.label.split(",")[0]}; if accented letters look wrong, that guess was.`],
          outputs: [{ label: "Excel workbook", fileName: `${stem}.xlsx`, blob: new Blob([bytes as BlobPart], { type: XLSX_MIME }), kind: "file", note: `One sheet, "${sheetName(stem)}", ${rows.length.toLocaleString("en")} rows` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Cells",
    summary: () => `${settings.typed ? "numbers as numbers" : "everything as text"}${settings.boldHeader ? ", bold header" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Numbers</legend>
          <RadioCards
            aria-label="Numbers"
            value={settings.typed ? "typed" : "text"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, typed: value === "typed" }))}
            options={[
              { value: "typed", label: "As numbers", blurb: "42 becomes a number cell that sums; codes with leading zeros stay text" },
              { value: "text", label: "All as text", blurb: "Every cell exactly as it was, for identifiers and phone numbers" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>First row</legend>
          <RadioCards
            aria-label="First row"
            value={settings.boldHeader ? "bold" : "plain"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, boldHeader: value === "bold" }))}
            options={[
              { value: "bold", label: "Bold, as a header", blurb: "The column names stand out" },
              { value: "plain", label: "Like every other row", blurb: "For a file with no header" },
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
      lead="Drop a CSV or TSV and get an .xlsx workbook that Excel, Numbers and Google Sheets open as a proper table: the delimiter and encoding worked out for you, accents intact, numbers as numbers and leading zeros kept. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Each becomes a one-sheet workbook as it lands" }}
      note="The workbook is written directly - an .xlsx is a ZIP of XML, and this writes the five files it needs - with every cell inline, which every spreadsheet reads. Excel's limits apply: a million rows and sixteen thousand columns a sheet, and a cell of at most 32,767 characters, which is cut there. A number is only a number when a spreadsheet would show it unchanged, so a sixteen-digit card number and a code with a leading zero stay text. The whole table is held in memory, so a file of a few hundred megabytes needs that much room in the browser."
    />
  );
}
