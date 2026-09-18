"use client";

import { useMemo, useState } from "react";

import { columnNames, CsvParser, csvLine, DELIMITERS, describeDelimiter, detectDelimiter, rowRecord, type Delimiter } from "@/lib/data/csv";
import { formatBytes } from "@/lib/format-utils";
import { fileChunks } from "@/lib/images/run";
import { fileExtension, fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { decodeChunks, detectEncoding, looksBinary } from "@/lib/text/encoding";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("convert-csv");

const ACCEPT = ".csv,.tsv,.tab,.txt,.dat,text/csv,text/tab-separated-values,text/plain";

type OutputId = "json" | "jsonl" | "csv" | "semicolon" | "tsv";

const OUTPUTS: readonly { id: OutputId; label: string; blurb: string; extension: string; mime: string; delimiter: Delimiter | null }[] = [
  { id: "json", label: "JSON", blurb: "An array of objects, one per row, keyed by the header", extension: "json", mime: "application/json", delimiter: null },
  { id: "jsonl", label: "JSON Lines", blurb: "One object per line: what data tools stream", extension: "jsonl", mime: "application/x-ndjson", delimiter: null },
  { id: "csv", label: "CSV, commas", blurb: "Standard CSV, quoted where it has to be", extension: "csv", mime: "text/csv", delimiter: "," },
  { id: "semicolon", label: "CSV, semicolons", blurb: "What Excel opens cleanly where the decimal point is a comma", extension: "csv", mime: "text/csv", delimiter: ";" },
  { id: "tsv", label: "TSV", blurb: "Tab-separated: pastes straight into a spreadsheet", extension: "tsv", mime: "text/tab-separated-values", delimiter: "\t" },
];

interface CsvSettings {
  outputs: OutputId[];
  header: boolean;
  typed: boolean;
  delimiter: "auto" | Delimiter;
}

const DEFAULT_SETTINGS: CsvSettings = { outputs: ["json"], header: true, typed: true, delimiter: "auto" };

function isCsvSettings(value: unknown): value is CsvSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CsvSettings>;
  return (
    Array.isArray(candidate.outputs) &&
    candidate.outputs.every((id) => OUTPUTS.some((output) => output.id === id)) &&
    typeof candidate.header === "boolean" &&
    typeof candidate.typed === "boolean" &&
    (candidate.delimiter === "auto" || DELIMITERS.some((entry) => entry.id === candidate.delimiter))
  );
}

/** Collects one output format as the rows stream past. */
interface Writer {
  spec: (typeof OUTPUTS)[number];
  parts: string[];
  rows: number;
}

function startWriter(writer: Writer, header: readonly string[] | null, source: Delimiter): void {
  if (writer.spec.delimiter !== null) {
    if (header) writer.parts.push(`${csvLine(header, writer.spec.delimiter)}\n`);
  } else if (writer.spec.id === "json") {
    writer.parts.push("[");
  }
  void source;
}

function writeRow(writer: Writer, row: readonly string[], names: readonly string[], typed: boolean): void {
  if (writer.spec.delimiter !== null) {
    writer.parts.push(`${csvLine(row, writer.spec.delimiter)}\n`);
  } else {
    const record = JSON.stringify(rowRecord(names, row, typed));
    writer.parts.push(writer.spec.id === "json" ? `${writer.rows === 0 ? "\n  " : ",\n  "}${record}` : `${record}\n`);
  }
  writer.rows += 1;
}

function finishWriter(writer: Writer, file: File, sourceDelimiter: Delimiter): PlainOutputSpec {
  if (writer.spec.id === "json") writer.parts.push(writer.rows === 0 ? "]\n" : "\n]\n");
  const blob = new Blob(writer.parts, { type: `${writer.spec.mime};charset=utf-8` });
  const stem = fileStem(file.name, "table");
  const sameKind = writer.spec.delimiter !== null && writer.spec.delimiter === sourceDelimiter && fileExtension(file.name) === writer.spec.extension;
  return { label: writer.spec.label, fileName: `${stem}${sameKind ? "-converted" : ""}.${writer.spec.extension}`, blob, kind: "file", note: `${writer.rows} ${writer.rows === 1 ? "row" : "rows"}` };
}

/** Bytes counted as they pass, for the progress line. */
async function* counted(chunks: AsyncIterable<Uint8Array>, tick: (bytes: number) => void): AsyncGenerator<Uint8Array> {
  let done = 0;
  for await (const chunk of chunks) {
    done += chunk.length;
    tick(done);
    yield chunk;
  }
}

/** A CSV read in pieces and written as anything. */
export function ConvertCsvApp() {
  const [settings, setSettings] = useState<CsvSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "convert-csv"), settings, setSettings, isCsvSettings);

  const queue = useMemo<PlainQueueOptions<CsvSettings>>(
    () => ({
      key: "convert-csv",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there are no rows in it." } : null),
      run: async (file, current, report, signal) => {
        report("Looking at the first lines...", null);
        const sample = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
        if (looksBinary(sample)) throw new PlainError("This is not a text file.", "It has bytes no text file has. A spreadsheet's own .xlsx is a ZIP; save it as CSV first.");
        const encoding = detectEncoding(sample);
        const sampleText = new TextDecoder(encoding.encoding).decode(sample);
        const delimiter = current.delimiter === "auto" ? detectDelimiter(sampleText) : current.delimiter;
        const parser = new CsvParser(delimiter);
        const writers: Writer[] = OUTPUTS.filter((spec) => current.outputs.includes(spec.id)).map((spec) => ({ spec, parts: [], rows: 0 }));
        let names: string[] | null = null;
        let columns = 0;
        let ragged = 0;
        let rows = 0;
        const take = (row: string[]) => {
          if (names === null) {
            columns = row.length;
            names = columnNames(current.header ? row : null, row.length);
            for (const writer of writers) startWriter(writer, current.header ? row : null, delimiter);
            if (current.header) return;
          }
          if (row.length !== columns) ragged += 1;
          rows += 1;
          for (const writer of writers) writeRow(writer, row, names, current.typed);
        };
        const chunks = counted(fileChunks(file, 4 * 1024 * 1024), (done) => report(`Reading... ${formatBytes(done)} of ${formatBytes(file.size)}, ${parser.count.toLocaleString("en")} rows`, done / file.size));
        for await (const text of decodeChunks(chunks, encoding.encoding)) {
          if (signal.aborted) throw new PlainError("Cancelled.");
          for (const row of parser.push(text)) take(row);
        }
        for (const row of parser.end()) take(row);
        const facts = [`${rows.toLocaleString("en")} ${rows === 1 ? "row" : "rows"}, ${columns} ${columns === 1 ? "column" : "columns"}`, `Delimiter: ${describeDelimiter(delimiter)}${current.delimiter === "auto" ? " (detected)" : ""}`, `Encoding: ${encoding.label}`];
        if (rows === 0) {
          return { facts, outputs: [], nothing: { message: "No rows were found.", hint: current.header ? "The file has a header line and nothing under it." : "The file has no lines with anything on them." } };
        }
        const notes: string[] = [];
        if (ragged > 0) notes.push(`${ragged.toLocaleString("en")} ${ragged === 1 ? "row has" : "rows have"} a different number of fields from the header; ${ragged === 1 ? "it is" : "they are"} written with the fields ${ragged === 1 ? "it has" : "they have"}.`);
        if (!encoding.sure) notes.push(`The file is not UTF-8 and carries no mark, so it was read as ${encoding.label.split(",")[0]}; if accented letters look wrong, that guess was.`);
        return { facts, notes, outputs: writers.map((writer) => finishWriter(writer, file, delimiter)) };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Outputs & how to read the file",
    defaultOpen: true,
    invalid: () => (settings.outputs.length === 0 ? "Tick at least one output before adding a file." : null),
    summary: () => `${settings.outputs.map((id) => OUTPUTS.find((output) => output.id === id)?.label ?? id).join(", ") || "no output"}; ${settings.header ? "first row is the header" : "no header"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Outputs</legend>
          <CheckboxCards aria-label="Outputs" value={settings.outputs} onValueChange={(outputs) => setSettings((previous) => ({ ...previous, outputs }))} options={OUTPUTS.map((output) => ({ value: output.id, label: output.label, blurb: output.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row</legend>
          <RadioCards
            aria-label="The first row"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Its names become the JSON keys" },
              { value: "data", label: "Is data", blurb: "Columns are named column1, column2 and so on" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Values in JSON</legend>
          <RadioCards
            aria-label="Values in JSON"
            value={settings.typed ? "typed" : "text"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, typed: value === "typed" }))}
            options={[
              { value: "typed", label: "Numbers and booleans as such", blurb: '42 becomes 42, "true" becomes true, an empty cell becomes null; codes with leading zeros stay text' },
              { value: "text", label: "Everything as text", blurb: "Every value is a string, exactly as it was in the cell" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Delimiter in the file</legend>
          <RadioCards
            aria-label="Delimiter in the file"
            value={settings.delimiter === "auto" ? "auto" : settings.delimiter}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, delimiter: value === "auto" ? "auto" : (value as Delimiter) }))}
            options={[{ value: "auto", label: "Detect it", blurb: "From the first lines: the character that appears the same number of times on each" }, ...DELIMITERS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a CSV or TSV export and get it back as JSON, JSON Lines, tab-separated or CSV with the other delimiter, however large it is: the file is read in pieces, quoted fields and all, and never uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Converted as they land, with the delimiter and encoding worked out from the first lines" }}
      note="Quoted fields, quotes inside them and line breaks inside them are read the way the standard says; a blank line is skipped. The encoding is worked out from the first 64 KB: a byte-order mark, valid UTF-8, or Windows-1252 for anything else, and the card says which. The outputs are built in memory, so a file of a few gigabytes needs that much room in the browser."
    />
  );
}
