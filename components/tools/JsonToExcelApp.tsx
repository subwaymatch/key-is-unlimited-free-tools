"use client";

import { useMemo, useState } from "react";

import { recordsOf, tabulate } from "@/lib/data/csv";
import { looksLikeJsonLines, parseJson, parseJsonLines } from "@/lib/data/json";
import { buildXlsx, MAX_COLUMNS, MAX_ROWS, sheetName } from "@/lib/data/xlsx";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";
import { describeProblem } from "./JsonToCsvApp";

const tool = requireTool("json-to-excel");

const ACCEPT = ".json,.jsonl,.ndjson,.txt,application/json,application/x-ndjson,text/plain";

/** Past this the whole file has to be parsed into memory at once, which a tab cannot do. */
const MAX_BYTES = 256 * 1024 * 1024;

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

/** JSON records as a workbook. */
export function JsonToExcelApp() {
  const [settings, setSettings] = useState<ExcelSettings>({ typed: true, boldHeader: true });
  useStoredSettings(storageKey("settings", "json-to-excel"), settings, setSettings, isExcelSettings);

  const queue = useMemo<PlainQueueOptions<ExcelSettings>>(
    () => ({
      key: "json-to-excel",
      settings,
      reject: (file) =>
        file.size === 0
          ? { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to read." }
          : file.size > MAX_BYTES
            ? { message: "This file is too large to parse in a browser tab.", hint: `JSON has to be read whole; this reads files up to ${formatBytes(MAX_BYTES)}.` }
            : null,
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await file.text();
        report("Parsing...", null);
        let values: unknown[];
        let from: string;
        const parsed = parseJson(text);
        if ("value" in parsed) {
          const records = recordsOf(parsed.value);
          values = records.records;
          from = records.from;
        } else if (looksLikeJsonLines(text)) {
          const lines = parseJsonLines(text);
          if ("problem" in lines) throw new PlainError("This JSON Lines file has a line that does not read.", describeProblem(lines.problem));
          values = lines.values;
          from = `${lines.values.length} lines of JSON`;
        } else {
          throw new PlainError("This file is not valid JSON.", describeProblem(parsed.problem));
        }
        if (values.length === 0) {
          return { facts: [`Read as ${from}`], outputs: [], nothing: { message: "There are no records in this file.", hint: "It reads as JSON, but holds no list of objects and no object to make a row of." } };
        }
        report("Laying out the columns...", null);
        const { columns, rows } = tabulate(values);
        if (rows.length + 1 > MAX_ROWS) throw new PlainError(`This file has ${rows.length.toLocaleString("en")} records, more than a sheet's ${MAX_ROWS.toLocaleString("en")} rows.`, "Split the file first.");
        if (columns.length > MAX_COLUMNS) throw new PlainError(`This file has ${columns.length.toLocaleString("en")} fields, more than a sheet's ${MAX_COLUMNS.toLocaleString("en")} columns.`, "Flatten or trim the records first.");
        report("Writing...", null);
        const cells = [columns, ...rows.map((row) => columns.map((column) => row.get(column) ?? ""))];
        const bytes = buildXlsx([{ name: sheetName(fileStem(file.name, "Sheet1")), rows: cells }], { typed: current.typed, boldHeader: current.boldHeader });
        const plain = values.filter((value) => value === null || typeof value !== "object" || Array.isArray(value)).length;
        return {
          facts: [`${values.length.toLocaleString("en")} ${values.length === 1 ? "record" : "records"} from ${from}`, `${columns.length} ${columns.length === 1 ? "column" : "columns"}`],
          notes: plain > 0 ? [`${plain} of the records ${plain === 1 ? "is" : "are"} not an object and ${plain === 1 ? "lands" : "land"} in a "value" column.`] : [],
          outputs: [{ label: "Excel workbook", fileName: `${fileStem(file.name, "records")}.xlsx`, blob: new Blob([bytes as BlobPart], { type: XLSX_MIME }), kind: "file", note: `one sheet, ${rows.length.toLocaleString("en")} rows and a header, ${columns.length} columns${columns.some((column) => column.includes(".")) ? ", nested fields as dotted names" : ""}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Cells",
    summary: () => `${settings.typed ? "numbers as numbers" : "everything as text"}, ${settings.boldHeader ? "bold header" : "plain header"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Values</legend>
          <RadioCards
            aria-label="Values"
            value={settings.typed ? "typed" : "text"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, typed: value === "typed" }))}
            options={[
              { value: "typed", label: "Numbers as numbers", blurb: "So Excel can sum and sort them; a leading zero stays text" },
              { value: "text", label: "Everything as text", blurb: "Nothing reinterpreted: what an identifier or a phone number wants" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Header row</legend>
          <RadioCards
            aria-label="Header row"
            value={settings.boldHeader ? "bold" : "plain"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, boldHeader: value === "bold" }))}
            options={[
              { value: "bold", label: "Bold", blurb: "Stands out as a header" },
              { value: "plain", label: "Plain", blurb: "Like every other row" },
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
      lead="Drop a JSON file - an array of objects, an API response with a list inside it, or JSON Lines - and get an .xlsx back that opens as a proper table, a column for every field, nested objects flattened into dotted names, numbers as numbers. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose JSON files", headline: "Drop JSON files here", subhead: "An array of records, an object holding one, or JSON Lines" }}
      note='The records are laid out the way JSON to CSV lays them out: a nested object becomes dotted columns such as "address.city", a list of plain values is joined with semicolons in one cell, and a list of objects stays as JSON text in its cell. The workbook is written by hand, every cell inline, and opens in Excel, Numbers and Google Sheets without a wizard.'
    />
  );
}
