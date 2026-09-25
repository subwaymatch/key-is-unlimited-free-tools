"use client";

import { useMemo, useState } from "react";

import { ANONYMIZE_ACTIONS, anonymizeRows, detectColumns, hasher, masker, PII_LABELS, pseudonymizer, randomSalt, type AnonymizeAction } from "@/lib/data/anonymize";
import { csvLine, describeDelimiter } from "@/lib/data/csv";
import { countRows, CSV_ACCEPT, csvOutput, readCsvRows, rejectNonCsv } from "@/lib/data/readCsv";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("anonymize-csv");

interface AnonymizeSettings {
  action: AnonymizeAction;
  extra: string;
  keep: string;
  scrubText: boolean;
}

function isAnonymizeSettings(value: unknown): value is AnonymizeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AnonymizeSettings>;
  return ANONYMIZE_ACTIONS.some((action) => action.id === candidate.action) && typeof candidate.extra === "string" && typeof candidate.keep === "string" && typeof candidate.scrubText === "boolean";
}

/** Names, addresses, numbers and the rest found in a CSV and replaced before it is shared. */
export function AnonymizeCsvApp() {
  const [settings, setSettings] = useState<AnonymizeSettings>({ action: "pseudonym", extra: "", keep: "", scrubText: true });
  useStoredSettings(storageKey("settings", "anonymize-csv"), settings, setSettings, isAnonymizeSettings);

  const queue = useMemo<PlainQueueOptions<AnonymizeSettings>>(
    () => ({
      key: "anonymize-csv",
      settings,
      reject: rejectNonCsv,
      run: async (file, current, report, signal) => {
        const { rows, delimiter, encoding } = await readCsvRows(file, report, signal);
        report("Looking for personal data...", null);
        const targets = detectColumns(rows, current.extra, current.keep);
        const header = rows[0] ?? [];
        const facts = [countRows(Math.max(0, rows.length - 1)), `Delimiter: ${describeDelimiter(delimiter)} (detected)`, `Encoding: ${encoding.label}`];
        if (targets.length > 0) facts.push(`Found: ${targets.map((target) => `${header[target.index] || `column ${target.index + 1}`} (${PII_LABELS[target.kind]}${target.how === "content" ? ", by its values" : ""})`).join(", ")}`);
        if (targets.length === 0 && !current.scrubText) return { facts, outputs: [], nothing: { message: "No column of personal data was found.", hint: "None is named or filled like one. Name columns to treat in the settings, under Also treat." } };
        report("Replacing...", null);
        const anonymizer = current.action === "hash" ? hasher(randomSalt()) : current.action === "mask" ? masker() : pseudonymizer();
        const result = anonymizeRows(rows, targets, current.action, anonymizer, current.scrubText);
        if (result.replaced === 0 && result.scrubbed === 0) return { facts, outputs: [], nothing: { message: "Nothing needed replacing.", hint: targets.length > 0 ? "The columns found are empty." : "No column of personal data was found, and no address or number was written inside the text." } };
        const parts: string[] = [];
        let chunk = "";
        for (const row of result.rows) {
          chunk += `${csvLine(row, delimiter)}\r\n`;
          if (chunk.length > 1 << 20) {
            parts.push(chunk);
            chunk = "";
          }
        }
        parts.push(chunk);
        const { extension, mime } = csvOutput(delimiter);
        const notes = [`${result.replaced.toLocaleString("en")} ${result.replaced === 1 ? "cell" : "cells"} ${current.action === "remove" ? "removed with their columns" : "replaced"}${result.scrubbed > 0 ? `, and ${result.scrubbed.toLocaleString("en")} e-mail ${result.scrubbed === 1 ? "address or phone number" : "addresses and phone numbers"} inside other text` : ""}. Read the file before sharing it: a column this did not recognise, such as free text naming a person, is left as it was.`];
        return {
          facts,
          notes,
          outputs: [{ label: "Anonymised CSV", fileName: `${fileStem(file.name, "table")}-anonymised.${extension}`, blob: new Blob(parts, { type: `${mime};charset=utf-8` }), kind: "file", note: ANONYMIZE_ACTIONS.find((action) => action.id === current.action)?.label ?? "" }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What to do with it",
    defaultOpen: true,
    summary: () => `${ANONYMIZE_ACTIONS.find((action) => action.id === settings.action)?.label.toLowerCase()}${settings.extra.trim() ? `, also ${settings.extra.trim()}` : ""}${settings.keep.trim() ? `, not ${settings.keep.trim()}` : ""}${settings.scrubText ? ", text scrubbed" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Personal data becomes</legend>
          <RadioCards aria-label="Personal data becomes" value={settings.action} onValueChange={(action) => setSettings((previous) => ({ ...previous, action: action as AnonymizeAction }))} options={ANONYMIZE_ACTIONS.map((action) => ({ value: action.id, label: action.label, blurb: action.blurb }))} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Columns</legend>
          <div className={styles.fileRow}>
            <label>
              <span className={styles.fieldLabel}>Also treat</span>
              <input type="text" value={settings.extra} placeholder="customer_ref, 7" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, extra: event.target.value }))} className={styles.input} style={{ width: "14rem" }} />
            </label>
            <label>
              <span className={styles.fieldLabel}>Leave alone</span>
              <input type="text" value={settings.keep} placeholder="city" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, keep: event.target.value }))} className={styles.input} style={{ width: "14rem" }} />
            </label>
          </div>
          <p className={styles.panelNote}>Names as the header writes them, or numbers counting from 1, separated by commas. Everything else is found by its header or its values.</p>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Inside other columns</legend>
          <CheckboxCards aria-label="Inside other columns" value={settings.scrubText ? ["scrub"] : []} onValueChange={(next) => setSettings((previous) => ({ ...previous, scrubText: next.includes("scrub") }))} options={[{ value: "scrub", label: "Scrub e-mail addresses and phone numbers", blurb: "Written inside notes or comments, not only in their own columns" }]} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a CSV before sharing it with a vendor, a colleague or a chatbot, and get it back with the personal data replaced: names, e-mail addresses, phone numbers, street and IP addresses, card and ID numbers and birth dates, found by their headers and by what their values look like. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Anonymising"
      dropZone={{ accept: CSV_ACCEPT, inputLabel: "Choose CSV files", headline: "Drop CSV or TSV files here", subhead: "Anonymised as they land - the card says what was found" }}
      note="Stand-ins are consistent: the same address becomes the same user12@example.com in every row and every column of that kind, so the table still joins and counts. Hashes are salted with a random value made for this run and thrown away, so they match each other but cannot be looked up. Birth dates keep only the year. Detection reads headers in English and values by their shape; it is a strong first pass, not a guarantee, so read the result before it leaves your hands."
    />
  );
}
