"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { fileExtension, fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { detectEncoding, looksBinary } from "@/lib/text/encoding";
import { DEFAULT_LINE_OPTIONS, joinLines, LINE_ORDERS, processLines, type LineOptions, type LineOrder } from "@/lib/text/lines";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("sort-lines");

const ACCEPT = ".txt,.csv,.log,.md,.list,text/plain,text/*";

/** Past this the lines cannot be held and sorted in a tab. */
const MAX_BYTES = 256 * 1024 * 1024;

type Step = "dedupe" | "dropBlank" | "trim" | "ignoreCase";

const STEPS: { value: Step; label: string; blurb: string }[] = [
  { value: "dedupe", label: "Remove duplicate lines", blurb: "A line the same as an earlier one is dropped; the first stays" },
  { value: "dropBlank", label: "Drop blank lines", blurb: "Lines with nothing on them" },
  { value: "trim", label: "Trim the lines", blurb: "Spaces and tabs off both ends" },
  { value: "ignoreCase", label: "Ignore case", blurb: "apple and Apple sort together and count as the same line" },
];

function isLineOptions(value: unknown): value is LineOptions {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LineOptions>;
  return LINE_ORDERS.some((order) => order.id === candidate.order) && ["ignoreCase", "dedupe", "dropBlank", "trim"].every((key) => typeof candidate[key as keyof LineOptions] === "boolean");
}

/** The lines of a text file put in order. */
export function SortLinesApp() {
  const [settings, setSettings] = useState<LineOptions>(DEFAULT_LINE_OPTIONS);
  useStoredSettings(storageKey("settings", "sort-lines"), settings, setSettings, isLineOptions);

  const chosen = STEPS.map((step) => step.value).filter((step) => settings[step]);

  const queue = useMemo<PlainQueueOptions<LineOptions>>(
    () => ({
      key: "sort-lines",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there are no lines in it." } : file.size > MAX_BYTES ? { message: "This file is too large to hold in a browser tab.", hint: `Every line is kept in memory; this reads files up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (looksBinary(bytes.subarray(0, 64 * 1024))) throw new PlainError("This is not a text file.", "It has bytes no text file has.");
        const encoding = detectEncoding(bytes.subarray(0, 64 * 1024));
        const text = new TextDecoder(encoding.encoding).decode(bytes);
        report("Sorting...", null);
        const result = processLines(text, current);
        const facts = [`${result.total.toLocaleString("en")} ${result.total === 1 ? "line" : "lines"} in`, `Encoding: ${encoding.label}`];
        const out = joinLines(result);
        if (out === text) return { facts, outputs: [], nothing: { message: "The lines are already in that order.", hint: "Nothing would move, and nothing ticked found anything to drop." } };
        const changes: string[] = [];
        if (result.blanks > 0) changes.push(`${result.blanks.toLocaleString("en")} blank ${result.blanks === 1 ? "line" : "lines"} dropped`);
        if (result.duplicates > 0) changes.push(`${result.duplicates.toLocaleString("en")} duplicate ${result.duplicates === 1 ? "line" : "lines"} removed`);
        const order = LINE_ORDERS.find((entry) => entry.id === current.order)?.label ?? current.order;
        const extension = fileExtension(file.name) ?? "txt";
        return {
          facts,
          notes: changes.length > 0 ? [`${changes.join("; ")}.`] : [],
          outputs: [{ label: order, fileName: `${fileStem(file.name, "lines")}-${current.order === "keep" ? "cleaned" : "sorted"}.${extension}`, blob: new Blob([out], { type: "text/plain;charset=utf-8" }), kind: "file", note: `${result.lines.length.toLocaleString("en")} ${result.lines.length === 1 ? "line" : "lines"} out` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Order & steps",
    defaultOpen: true,
    invalid: () => (settings.order === "keep" && !settings.dedupe && !settings.dropBlank && !settings.trim ? "Choose an order, or tick a step, before adding a file." : null),
    summary: () => `${LINE_ORDERS.find((order) => order.id === settings.order)?.label.toLowerCase()}${chosen.length > 0 ? `; ${chosen.map((step) => STEPS.find((entry) => entry.value === step)?.label.toLowerCase()).join(", ")}` : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Order</legend>
          <RadioCards aria-label="Order" value={settings.order} onValueChange={(order) => setSettings((previous) => ({ ...previous, order: order as LineOrder }))} options={LINE_ORDERS.map((order) => ({ value: order.id, label: order.label, blurb: order.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Steps</legend>
          <CheckboxCards aria-label="Steps" value={chosen} onValueChange={(next) => setSettings((previous) => ({ ...previous, dedupe: next.includes("dedupe"), dropBlank: next.includes("dropBlank"), trim: next.includes("trim"), ignoreCase: next.includes("ignoreCase") }))} options={STEPS} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a text file - a word list, a log, a list of names or addresses or URLs - and get its lines back sorted A to Z with numbers in order, reversed, shuffled or by length, with duplicates and blank lines removed if you like. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Sorting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose text files", headline: "Drop text files here", subhead: "Sorted as they land - choose the order above" }}
      note="A to Z compares lines the way a person reads them, so item2 comes before item10 and accents sort with their letters; character by character is what a computer does, which puts capitals first and item10 before item2. Duplicates are removed after trimming when that is ticked, and the first of them stays. The file's own line endings are kept; it is written back in UTF-8."
    />
  );
}
