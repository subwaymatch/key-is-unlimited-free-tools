"use client";

import { useMemo, useState } from "react";

import { describeDelimiter } from "@/lib/data/csv";
import { htmlTable, markdownTable } from "@/lib/data/export";
import { countRows, CSV_ACCEPT, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("csv-to-markdown");

/** A Markdown table past this many rows is not something anyone reads or pastes. */
const MAX_ROWS = 20_000;

type Output = "markdown" | "html";

const OUTPUTS: { value: Output; label: string; blurb: string }[] = [
  { value: "markdown", label: "Markdown", blurb: "For a README, an issue, a wiki page" },
  { value: "html", label: "HTML", blurb: "A plain table element to paste into a page" },
];

interface TableSettings {
  outputs: Output[];
  header: boolean;
}

function isTableSettings(value: unknown): value is TableSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TableSettings>;
  return Array.isArray(candidate.outputs) && candidate.outputs.every((entry) => entry === "markdown" || entry === "html") && typeof candidate.header === "boolean";
}

/** A CSV as a table for a document or a page. */
export function CsvToMarkdownApp() {
  const [settings, setSettings] = useState<TableSettings>({ outputs: ["markdown"], header: true });
  useStoredSettings(storageKey("settings", "csv-to-markdown"), settings, setSettings, isTableSettings);

  const queue = useMemo<PlainQueueOptions<TableSettings>>(
    () => ({
      key: "csv-to-markdown",
      settings,
      reject: rejectNonCsv,
      run: async (file, current, report, signal) => {
        const { rows, delimiter, encoding } = await readCsvRows(file, report, signal);
        if (rows.length === 0) return { outputs: [], nothing: { message: "No rows were found.", hint: "The file has no lines with anything on them." } };
        if (rows.length > MAX_ROWS) throw new PlainError(`This file has ${countRows(rows.length)}, and a table for a document stops being one long before that.`, `This writes tables of up to ${MAX_ROWS.toLocaleString("en")} rows. Split the CSV first, or take the rows you want.`);
        const width = Math.max(0, ...rows.map((row) => row.length));
        const data = current.header ? rows.length - 1 : rows.length;
        const facts = [`${countRows(data)}, ${width} ${width === 1 ? "column" : "columns"}`, `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`];
        report("Writing...", null);
        const stem = fileStem(file.name, "table");
        const outputs: PlainOutputSpec[] = [];
        if (current.outputs.includes("markdown")) {
          const text = markdownTable(rows, current.header);
          outputs.push({ label: "Markdown table", fileName: `${stem}.md`, blob: new Blob([text], { type: "text/markdown;charset=utf-8" }), kind: "text", text, note: `${countRows(data)}, numbers aligned right` });
        }
        if (current.outputs.includes("html")) {
          const text = htmlTable(rows, current.header);
          outputs.push({ label: "HTML table", fileName: `${stem}.html`, blob: new Blob([text], { type: "text/html;charset=utf-8" }), kind: "file", note: `a plain table element, ${countRows(data)}` });
        }
        return { facts, outputs };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Output",
    invalid: () => (settings.outputs.length === 0 ? "Tick at least one output before adding a file." : null),
    summary: () => `${settings.outputs.map((entry) => OUTPUTS.find((option) => option.value === entry)?.label).join(" and ") || "nothing"}, ${settings.header ? "first row is the header" : "made-up headers"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Write</legend>
          <CheckboxCards aria-label="Write" value={settings.outputs} onValueChange={(outputs) => setSettings((previous) => ({ ...previous, outputs }))} options={OUTPUTS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The first row</legend>
          <RadioCards
            aria-label="The first row"
            value={settings.header ? "header" : "data"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, header: value === "header" }))}
            options={[
              { value: "header", label: "Is the header", blurb: "Becomes the table's heading row" },
              { value: "data", label: "Is data", blurb: "Columns are headed column1, column2 and so on" },
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
      lead="Drop a CSV and get it back as a Markdown table, ready to paste into a README, an issue, a pull request or a wiki, columns padded so it reads as a table in the source too, numbers aligned right; or as a plain HTML table for a page. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Writing"
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Written as a table as they land; copy it from the card" }}
      note="A pipe inside a cell is escaped, and a line break inside one becomes a <br> tag, which is what GitHub's Markdown wants. A column whose every filled cell is a number is right-aligned with a colon in the rule row. The HTML is a bare table with thead and tbody and every cell escaped, no styles, for the page's own stylesheet to dress."
    />
  );
}
