"use client";

import { useMemo, useState } from "react";

import { recordsFromRows } from "@/lib/data/tables";
import { readXlsx, sheetName, XlsxError } from "@/lib/data/xlsx";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("excel-to-json");

const ACCEPT = ".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12";

/** Past this the unpacked XML cannot be held in a tab. */
const MAX_BYTES = 256 * 1024 * 1024;

type Shape = "array" | "lines";

interface JsonSettings {
  shape: Shape;
  typed: boolean;
  header: boolean;
}

function isJsonSettings(value: unknown): value is JsonSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<JsonSettings>;
  return (candidate.shape === "array" || candidate.shape === "lines") && typeof candidate.typed === "boolean" && typeof candidate.header === "boolean";
}

/** Every sheet of a workbook as JSON records. */
export function ExcelToJsonApp() {
  const [settings, setSettings] = useState<JsonSettings>({ shape: "array", typed: true, header: true });
  useStoredSettings(storageKey("settings", "excel-to-json"), settings, setSettings, isJsonSettings);

  const queue = useMemo<PlainQueueOptions<JsonSettings>>(
    () => ({
      key: "excel-to-json",
      settings,
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to read." };
        if (file.size > MAX_BYTES) return { message: "This workbook is too large to unpack in a browser tab.", hint: `This reads workbooks up to ${formatBytes(MAX_BYTES)}.` };
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension === "xls") return { message: "This is an .xls from Excel 2003 or earlier.", hint: "That is a different, binary format. Open it in a spreadsheet and save it as .xlsx first." };
        return null;
      },
      run: async (file, current, report) => {
        report("Unpacking...", null);
        let workbook;
        try {
          workbook = readXlsx(new Uint8Array(await file.arrayBuffer()));
        } catch (error) {
          if (error instanceof XlsxError) throw new PlainError(error.message, error.hint, { cause: error });
          throw error;
        }
        report("Writing...", null);
        const stem = fileStem(file.name, "workbook");
        const filled = workbook.sheets.filter((sheet) => sheet.rows.length > (current.header ? 1 : 0));
        if (filled.length === 0) {
          return { facts: [`${workbook.sheets.length} ${workbook.sheets.length === 1 ? "sheet" : "sheets"}`], outputs: [], nothing: { message: "Every sheet in this workbook is empty.", hint: current.header ? "None has a row under its header." : "There are no cells with anything in them." } };
        }
        const extension = current.shape === "lines" ? "jsonl" : "json";
        const mime = current.shape === "lines" ? "application/x-ndjson" : "application/json";
        const outputs = filled.map((sheet) => {
          const records = recordsFromRows(sheet.rows, current.header, current.typed);
          const text = current.shape === "lines" ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : `${JSON.stringify(records, null, 2)}\n`;
          const columns = Object.keys(records[0] ?? {}).length;
          return {
            label: `Sheet "${sheet.name}"`,
            fileName: filled.length === 1 ? `${stem}.${extension}` : `${stem}-${sheetName(sheet.name).replace(/\s+/g, "-").toLowerCase()}.${extension}`,
            blob: new Blob([text], { type: `${mime};charset=utf-8` }),
            kind: "file" as const,
            note: `${records.length.toLocaleString("en")} ${records.length === 1 ? "record" : "records"}, ${columns} ${columns === 1 ? "field" : "fields"} each`,
          };
        });
        const skipped = workbook.sheets.length - filled.length;
        return {
          facts: [`${workbook.sheets.length} ${workbook.sheets.length === 1 ? "sheet" : "sheets"}: ${workbook.sheets.map((sheet) => sheet.name).join(", ")}`],
          notes: [...(skipped > 0 ? [`${skipped} empty ${skipped === 1 ? "sheet was" : "sheets were"} skipped.`] : []), ...(workbook.date1904 ? ["This workbook counts dates from 1904, and they were read that way."] : [])],
          outputs,
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Shape & values",
    summary: () => `${settings.shape === "lines" ? "JSON Lines" : "a JSON array"}, ${settings.typed ? "numbers as numbers" : "everything as text"}, ${settings.header ? "keyed by the first row" : "keyed by column"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Shape</legend>
          <RadioCards
            aria-label="Shape"
            value={settings.shape}
            onValueChange={(shape) => setSettings((previous) => ({ ...previous, shape: shape as Shape }))}
            options={[
              { value: "array", label: "A JSON array", blurb: "One array of objects, indented: what most code wants" },
              { value: "lines", label: "JSON Lines", blurb: "One object per line: for streaming and big data tools" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Values</legend>
          <RadioCards
            aria-label="Values"
            value={settings.typed ? "typed" : "text"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, typed: value === "typed" }))}
            options={[
              { value: "typed", label: "Numbers and booleans as such", blurb: "42, true and null for an empty cell" },
              { value: "text", label: "Everything as text", blurb: '"42", "true" and "" - nothing reinterpreted' },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row of each sheet</legend>
          <RadioCards
            aria-label="The first row of each sheet"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Its cells become the field names" },
              { value: "data", label: "Is data", blurb: "Fields are named column1, column2 and so on" },
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
      lead="Drop an .xlsx workbook and get every sheet back as JSON: an array of objects keyed by the header row, numbers as numbers and dates as dates, or one object per line for tools that stream. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose Excel files", headline: "Drop .xlsx files here", subhead: "Every sheet comes out as a file of its own" }}
      note="The workbook is unpacked and read directly, cell by cell, the way Excel to CSV reads it: a number the sheet formats as a date is written as a date, a formula gives its last calculated value, and a leading zero is kept because an identifier that reads as a number stays text. A header cell that is empty or repeated is named so the keys stay distinct. Formatting, merged cells and charts do not exist in JSON and are left behind."
    />
  );
}
