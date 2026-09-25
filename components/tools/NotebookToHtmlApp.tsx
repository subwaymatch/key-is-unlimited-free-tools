"use client";

import { useMemo, useState } from "react";

import { NotebookError } from "@/lib/data/notebook";
import { notebookToHtml, type NotebookHtmlOptions } from "@/lib/data/notebookHtml";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("notebook-to-html");

const ACCEPT = ".ipynb,application/x-ipynb+json,application/json";

/** Past this a notebook, pictures and all, is too much to hold twice in a tab. */
const MAX_BYTES = 300 * 1024 * 1024;

type Choice = keyof NotebookHtmlOptions;

const CHOICES: { value: Choice; label: string; blurb: string }[] = [
  { value: "showCode", label: "Show the code", blurb: "Untick for a report of the text and results only" },
  { value: "showPrompts", label: "Show In [n] numbers", blurb: "The execution counts beside each cell" },
];

function isOptions(value: unknown): value is NotebookHtmlOptions {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<NotebookHtmlOptions>;
  return typeof candidate.showCode === "boolean" && typeof candidate.showPrompts === "boolean";
}

/** A Jupyter notebook as one web page, outputs and all, readable without Jupyter. */
export function NotebookToHtmlApp() {
  const [settings, setSettings] = useState<NotebookHtmlOptions>({ showCode: true, showPrompts: true });
  useStoredSettings(storageKey("settings", "notebook-to-html"), settings, setSettings, isOptions);

  const queue = useMemo<PlainQueueOptions<NotebookHtmlOptions>>(
    () => ({
      key: "notebook-to-html",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, which is not a notebook." } : file.size > MAX_BYTES ? { message: "This notebook is too large to render in a browser tab.", hint: `This renders notebooks up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await file.text();
        report("Rendering...", null);
        let result;
        try {
          result = notebookToHtml(text, fileStem(file.name, "notebook"), current);
        } catch (error) {
          if (error instanceof NotebookError) throw new PlainError(error.message, error.hint, { cause: error });
          throw error;
        }
        const { cells } = result;
        const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
        const facts = [`Cells: ${cells.code} code, ${cells.markdown} text`, `Outputs: ${cells.outputs === 0 ? "none" : `${cells.outputs}${cells.images > 0 ? `, ${cells.images} of them ${cells.images === 1 ? "a picture" : "pictures"}` : ""}`}`, `Title: ${result.title}`];
        const notes: string[] = [];
        if (cells.code > 0 && cells.outputs === 0) notes.push("The notebook has no outputs saved in it, so the page shows the code and text only. Run it in Jupyter and save before converting to include results.");
        if (!current.showCode && cells.outputs === 0) notes.push("With the code hidden and no outputs, only the text cells are left.");
        return {
          facts,
          notes,
          outputs: [{ label: "Web page", fileName: `${fileStem(file.name, "notebook")}.html`, blob, kind: "file", note: `${formatBytes(blob.size)}, pictures embedded${current.showCode ? "" : ", code hidden"}` }],
        };
      },
    }),
    [settings],
  );

  const chosen = CHOICES.map((choice) => choice.value).filter((choice) => settings[choice]);

  const toolSettings: PlainSettings = {
    title: "What to show",
    summary: () => `${settings.showCode ? "code and results" : "results only"}${settings.showPrompts ? ", with In [n] numbers" : ""}`,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Show</legend>
        <CheckboxCards aria-label="Show" value={chosen} onValueChange={(next) => setSettings({ showCode: next.includes("showCode"), showPrompts: next.includes("showPrompts") })} options={CHOICES} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a Jupyter notebook and get one web page anyone can open: the Markdown rendered, the code in blocks, and the saved outputs - tables, charts, printed lines and errors - exactly as the notebook last showed them. No Jupyter, no Python, nothing uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Rendering"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose notebooks", headline: "Drop .ipynb files here", subhead: "Rendered as they land" }}
      note="Nothing is run: the page shows the outputs saved in the file, so a notebook saved without running shows only its code. Charts saved as PNG, JPEG or SVG are embedded in the page, so it is one file to send. Interactive outputs such as Plotly or widgets need their JavaScript, which a page opened from disk cannot load, so they fall back to the picture or text saved beside them. Scripts are always taken out."
    />
  );
}
