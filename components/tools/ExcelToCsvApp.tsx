"use client";

import { useMemo, useState } from "react";

import { csvLine, DELIMITERS, type Delimiter } from "@/lib/data/csv";
import { BOM } from "@/lib/data/json";
import { readXlsx, sheetName, XlsxError } from "@/lib/data/xlsx";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("excel-to-csv");

const ACCEPT = ".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12";

/** Past this the unpacked XML cannot be held in a tab. */
const MAX_BYTES = 256 * 1024 * 1024;

interface CsvSettings {
  delimiter: Delimiter;
  bom: boolean;
}

function isCsvSettings(value: unknown): value is CsvSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CsvSettings>;
  return DELIMITERS.some((entry) => entry.id === candidate.delimiter) && typeof candidate.bom === "boolean";
}

/** Every sheet of a workbook as its own CSV. */
export function ExcelToCsvApp() {
  const [settings, setSettings] = useState<CsvSettings>({ delimiter: ",", bom: false });
  useStoredSettings(storageKey("settings", "excel-to-csv"), settings, setSettings, isCsvSettings);

  const queue = useMemo<PlainQueueOptions<CsvSettings>>(
    () => ({
      key: "excel-to-csv",
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
        const extension = current.delimiter === "\t" ? "tsv" : "csv";
        const mime = extension === "tsv" ? "text/tab-separated-values" : "text/csv";
        const filled = workbook.sheets.filter((sheet) => sheet.rows.length > 0);
        if (filled.length === 0) {
          return { facts: [`${workbook.sheets.length} ${workbook.sheets.length === 1 ? "sheet" : "sheets"}`], outputs: [], nothing: { message: "Every sheet in this workbook is empty.", hint: "There are no cells with anything in them." } };
        }
        const outputs = filled.map((sheet) => {
          const body = `${sheet.rows.map((row) => csvLine(row, current.delimiter)).join("\r\n")}\r\n`;
          const columns = sheet.rows[0]?.length ?? 0;
          return {
            label: `Sheet "${sheet.name}"`,
            fileName: filled.length === 1 ? `${stem}.${extension}` : `${stem}-${sheetName(sheet.name).replace(/\s+/g, "-").toLowerCase()}.${extension}`,
            blob: new Blob(current.bom ? [BOM, body] : [body], { type: `${mime};charset=utf-8` }),
            kind: "file" as const,
            note: `${sheet.rows.length.toLocaleString("en")} ${sheet.rows.length === 1 ? "row" : "rows"}, ${columns} ${columns === 1 ? "column" : "columns"}`,
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
    title: "Delimiter & Excel",
    summary: () => `${DELIMITERS.find((entry) => entry.id === settings.delimiter)?.label.toLowerCase()}${settings.bom ? ", with a byte-order mark" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Delimiter</legend>
          <RadioCards aria-label="Delimiter" value={settings.delimiter} onValueChange={(delimiter) => setSettings((previous) => ({ ...previous, delimiter }))} options={DELIMITERS.filter((entry) => entry.id !== "|").map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>For Excel</legend>
          <RadioCards
            aria-label="For Excel"
            value={settings.bom ? "bom" : "plain"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, bom: value === "bom" }))}
            options={[
              { value: "plain", label: "Plain UTF-8", blurb: "What every other program wants" },
              { value: "bom", label: "With a byte-order mark", blurb: "Excel then reads accents correctly if the CSV goes back into it" },
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
      lead="Drop an .xlsx workbook and get a CSV for every sheet in it, with dates written as dates rather than the serial numbers Excel keeps underneath, ready for anything that reads plain text. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose Excel files", headline: "Drop .xlsx files here", subhead: "Every sheet comes out as a file of its own" }}
      note="The workbook is unpacked and read directly, cell by cell: shared and inline strings, numbers, booleans and errors, with a number the sheet formats as a date turned back into one, 1900 and 1904 systems both. Formulas give their last calculated value, since nothing here calculates. Formatting, merged cells, charts and comments do not exist in CSV and are left behind; an empty row inside the used range comes out empty, as Excel's own export writes it. An .xls from Excel 2003 or earlier is a different, binary format and is refused with a reason."
    />
  );
}
