"use client";

import { useMemo, useState } from "react";

import { csvLine, DELIMITERS, recordsOf, tabulate, type Delimiter } from "@/lib/data/csv";
import { BOM, looksLikeJsonLines, parseJson, parseJsonLines, type JsonProblem } from "@/lib/data/json";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("json-to-csv");

const ACCEPT = ".json,.jsonl,.ndjson,.txt,application/json,application/x-ndjson,text/plain";

/** Past this the whole file has to be parsed into memory at once, which a tab cannot do. */
const MAX_BYTES = 512 * 1024 * 1024;

interface JsonCsvSettings {
  delimiter: Delimiter;
  bom: boolean;
}

function isJsonCsvSettings(value: unknown): value is JsonCsvSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<JsonCsvSettings>;
  return DELIMITERS.some((entry) => entry.id === candidate.delimiter) && typeof candidate.bom === "boolean";
}

/** "Line 12, column 5: unexpected token. Near: ..." */
export function describeProblem(problem: JsonProblem): string {
  const where = problem.line !== null ? `Line ${problem.line}${problem.column !== null ? `, column ${problem.column}` : ""}: ` : "";
  return `${where}${problem.message}${problem.near ? ` Near: ${problem.near}` : ""}`;
}

/** Records out of JSON, as rows. */
export function JsonToCsvApp() {
  const [settings, setSettings] = useState<JsonCsvSettings>({ delimiter: ",", bom: false });
  useStoredSettings(storageKey("settings", "json-to-csv"), settings, setSettings, isJsonCsvSettings);

  const queue = useMemo<PlainQueueOptions<JsonCsvSettings>>(
    () => ({
      key: "json-to-csv",
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
        const lines = [csvLine(columns, current.delimiter)];
        for (const row of rows) lines.push(csvLine(columns.map((column) => row.get(column) ?? ""), current.delimiter));
        const body = `${lines.join("\r\n")}\r\n`;
        const extension = current.delimiter === "\t" ? "tsv" : "csv";
        const blob = new Blob(current.bom ? [BOM, body] : [body], { type: `${extension === "tsv" ? "text/tab-separated-values" : "text/csv"};charset=utf-8` });
        const plain = values.filter((value) => value === null || typeof value !== "object" || Array.isArray(value)).length;
        return {
          facts: [`${values.length.toLocaleString("en")} ${values.length === 1 ? "record" : "records"} from ${from}`, `${columns.length} ${columns.length === 1 ? "column" : "columns"}`],
          notes: plain > 0 ? [`${plain} of the records ${plain === 1 ? "is" : "are"} not an object and ${plain === 1 ? "lands" : "land"} in a "value" column.`] : [],
          outputs: [{ label: extension.toUpperCase(), fileName: `${fileStem(file.name, "records")}.${extension}`, blob, kind: "file", note: `${rows.length.toLocaleString("en")} rows, ${columns.length} columns${columns.some((column) => column.includes(".")) ? ", nested fields as dotted names" : ""}` }],
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
              { value: "bom", label: "With a byte-order mark", blurb: "Excel then reads accents and other non-ASCII text correctly on opening" },
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
      lead="Drop a JSON file - an array of objects, an API response with a list inside it, or JSON Lines - and get a CSV or TSV with a column for every field, nested objects flattened into dotted names, ready for a spreadsheet. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose JSON files", headline: "Drop JSON files here", subhead: "An array of records, an object holding one, or JSON Lines" }}
      note='A nested object becomes dotted columns: "address.city". A list of plain values is joined with semicolons in one cell, and a list of objects is left as JSON text in its cell, since a column per element would make a table nobody asked for. An object with one list in it - "data", "results", "items" - is read as that list; an object with none is one record. Fields are written in the order they are first seen.'
    />
  );
}
