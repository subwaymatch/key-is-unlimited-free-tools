"use client";

import { useMemo, useState } from "react";

import { csvLine } from "@/lib/data/csv";
import { countRows, CSV_ACCEPT, csvHeader, csvOutput, describeHeader, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { JOIN_KINDS, joinTables, RelateError, type JoinKind } from "@/lib/data/relate";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("join-csv");

interface JoinSettings {
  leftKey: string;
  rightKey: string;
  kind: JoinKind;
  ignoreCase: boolean;
}

function isJoinSettings(value: unknown): value is JoinSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<JoinSettings>;
  return typeof candidate.leftKey === "string" && typeof candidate.rightKey === "string" && JOIN_KINDS.some((kind) => kind.id === candidate.kind) && typeof candidate.ignoreCase === "boolean";
}

/** Two CSVs joined on a column they share: a VLOOKUP without the spreadsheet. */
export function JoinCsvApp() {
  const [settings, setSettings] = useState<JoinSettings>({ leftKey: "", rightKey: "", kind: "left", ignoreCase: true });
  useStoredSettings(storageKey("settings", "join-csv"), settings, setSettings, isJoinSettings);

  const queue = useMemo<CombineOptions<JoinSettings>>(
    () => ({
      key: "join-csv",
      settings,
      reject: rejectNonCsv,
      inspect: async (file) => ({ facts: [describeHeader(await csvHeader(file))] }),
      run: async (files, current, report, signal) => {
        if (files.length !== 2) throw new PlainError("Drop exactly two files.", `There are ${files.length} in the list; a join takes two. Remove the extra ones.`);
        const [left, right] = files;
        const a = await readCsvRows(left, (phase, ratio) => report(`First file: ${phase}`, ratio === null ? null : ratio / 2), signal);
        const b = await readCsvRows(right, (phase, ratio) => report(`Second file: ${phase}`, ratio === null ? null : 0.5 + ratio / 2), signal);
        report("Joining...", null);
        let result;
        try {
          result = joinTables(a.rows, b.rows, current.kind, current);
        } catch (error) {
          if (error instanceof RelateError) throw new PlainError("The files could not be joined.", error.message);
          throw error;
        }
        const parts: string[] = [];
        let chunk = "";
        for (const row of result.rows) {
          chunk += `${csvLine(row, a.delimiter)}\r\n`;
          if (chunk.length > 1 << 20) {
            parts.push(chunk);
            chunk = "";
          }
        }
        parts.push(chunk);
        const { extension, mime } = csvOutput(a.delimiter);
        const notes = [`Matched on "${result.keyName}": ${result.matched.toLocaleString("en")} of ${(a.rows.length - 1).toLocaleString("en")} rows of the first file found a match; ${result.unmatchedRight.toLocaleString("en")} ${result.unmatchedRight === 1 ? "row" : "rows"} of the second matched nothing${current.kind === "full" ? " and were added at the end" : ""}.`];
        if (result.repeatedKeys > 0) notes.push(`${result.repeatedKeys.toLocaleString("en")} ${result.repeatedKeys === 1 ? "key appears" : "keys appear"} more than once in the second file, so the rows that match ${result.repeatedKeys === 1 ? "it come" : "them come"} out once per match.`);
        return {
          notes,
          outputs: [{ label: `Joined ${extension.toUpperCase()}`, fileName: `${fileStem(left.name, "left")}-joined.${extension}`, blob: new Blob(parts, { type: `${mime};charset=utf-8` }), kind: "file", note: `${countRows(result.rows.length - 1)}, ${result.rows[0].length} columns` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Key & rows kept",
    defaultOpen: true,
    summary: () => `${settings.leftKey.trim() || settings.rightKey.trim() ? `on ${settings.leftKey.trim() || settings.rightKey.trim()}${settings.rightKey.trim() && settings.rightKey.trim() !== settings.leftKey.trim() ? ` = ${settings.rightKey.trim()}` : ""}` : "on the first column name both share"}, ${JOIN_KINDS.find((kind) => kind.id === settings.kind)?.label.toLowerCase()}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Match rows on</legend>
          <div className={styles.fileRow}>
            <label>
              <span className={styles.fieldLabel}>Column in the first file</span>
              <input type="text" value={settings.leftKey} placeholder="a shared name" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, leftKey: event.target.value }))} className={styles.input} style={{ width: "12rem" }} />
            </label>
            <label>
              <span className={styles.fieldLabel}>Column in the second</span>
              <input type="text" value={settings.rightKey} placeholder="the same name" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, rightKey: event.target.value }))} className={styles.input} style={{ width: "12rem" }} />
            </label>
          </div>
          <p className={styles.panelNote}>A column&apos;s name or its number, counting from 1. Left empty, the first column name the two files share is used.</p>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Keep</legend>
          <RadioCards aria-label="Keep" value={settings.kind} onValueChange={(kind) => setSettings((previous) => ({ ...previous, kind: kind as JoinKind }))} options={JOIN_KINDS.map((kind) => ({ value: kind.id, label: kind.label, blurb: kind.blurb }))} columns={3} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Matching</legend>
          <CheckboxCards aria-label="Matching" value={settings.ignoreCase ? ["case"] : []} onValueChange={(next) => setSettings((previous) => ({ ...previous, ignoreCase: next.includes("case") }))} options={[{ value: "case", label: "Ignore case", blurb: "ABC-1 matches abc-1; spaces around a key are always ignored" }]} />
        </fieldset>
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop two CSVs that share a column - customers and orders, products and prices, an export and a lookup list - and get one table with the second file's columns added to each matching row of the first, the way VLOOKUP or a SQL join does it. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Join the files"
      minFiles={2}
      noun="files"
      busyLabel="Joining"
      summary={(files) => (files.length === 2 ? `${files[0].file.name} joined with columns from ${files[1].file.name}.` : files.length > 2 ? `${files.length} files: a join takes two. Remove the extra ones.` : null)}
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose two CSV files", headline: "Drop two CSV files here", subhead: "The first keeps its rows; the second supplies columns" }}
      note="Every column of the first file comes first, then every column of the second but its key; a name both files use gets (2) on the second. A key the second file lists twice gives the first file's row twice, once per match, as a database would. Each file's delimiter and encoding are worked out on its own, and the result uses the first file's delimiter."
    />
  );
}
