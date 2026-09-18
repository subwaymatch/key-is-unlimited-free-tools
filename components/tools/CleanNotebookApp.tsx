"use client";

import { useMemo, useState } from "react";

import { cleanNotebook, DEFAULT_NOTEBOOK_OPTIONS, NotebookError, type NotebookCleanOptions } from "@/lib/data/notebook";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("clean-notebook");

const ACCEPT = ".ipynb,application/x-ipynb+json,application/json";

type CleanChoice = keyof NotebookCleanOptions;

const CHOICES: { value: CleanChoice; label: string; blurb: string }[] = [
  { value: "outputs", label: "Remove outputs", blurb: "Every plot, table and printed line under a code cell" },
  { value: "counts", label: "Reset execution counts", blurb: "The In [12] numbers, so a rerun does not change the file" },
  { value: "cellMetadata", label: "Drop scratch metadata", blurb: "Execution timings, collapsed and scrolled state, widget state; tags and the kernel stay" },
];

function isCleanOptions(value: unknown): value is NotebookCleanOptions {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<NotebookCleanOptions>;
  return typeof candidate.outputs === "boolean" && typeof candidate.counts === "boolean" && typeof candidate.cellMetadata === "boolean";
}

/** A notebook stripped for committing. */
export function CleanNotebookApp() {
  const [settings, setSettings] = useState<NotebookCleanOptions>(DEFAULT_NOTEBOOK_OPTIONS);
  useStoredSettings(storageKey("settings", "clean-notebook"), settings, setSettings, isCleanOptions);

  const chosen = CHOICES.map((choice) => choice.value).filter((choice) => settings[choice]);

  const queue = useMemo<PlainQueueOptions<NotebookCleanOptions>>(
    () => ({
      key: "clean-notebook",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, which is not a notebook." } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await file.text();
        report("Cleaning...", null);
        let result;
        try {
          result = cleanNotebook(text, current);
        } catch (error) {
          if (error instanceof NotebookError) throw new PlainError(error.message, error.hint, { cause: error });
          throw error;
        }
        const facts = [`${result.cells} ${result.cells === 1 ? "cell" : "cells"}, ${result.codeCells} of them code`];
        if (result.text === null) {
          return { facts, outputs: [], nothing: { message: "This notebook is already clean.", hint: "Nothing ticked above was found in it." } };
        }
        const blob = new Blob([result.text], { type: "application/x-ipynb+json;charset=utf-8" });
        const done: string[] = [];
        if (result.outputsRemoved > 0) done.push(`${result.outputsRemoved} ${result.outputsRemoved === 1 ? "output" : "outputs"} removed`);
        if (result.countsReset > 0) done.push(`${result.countsReset} execution ${result.countsReset === 1 ? "count" : "counts"} reset`);
        if (result.metadataRemoved > 0) done.push(`${result.metadataRemoved} metadata ${result.metadataRemoved === 1 ? "entry" : "entries"} dropped`);
        return {
          facts,
          notes: [`${done.join(", ")}.`],
          outputs: [{ label: "Clean notebook", fileName: `${fileStem(file.name, "notebook")}-clean.ipynb`, blob, kind: "file", note: `${formatBytes(blob.size)} from ${formatBytes(file.size)}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What to strip",
    defaultOpen: true,
    invalid: () => (chosen.length === 0 ? "Tick at least one thing to strip before adding a notebook." : null),
    summary: () => chosen.map((choice) => CHOICES.find((entry) => entry.value === choice)?.label.toLowerCase()).join(", ") || "nothing",
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Strip</legend>
        <CheckboxCards aria-label="Strip" value={chosen} onValueChange={(next) => setSettings({ outputs: next.includes("outputs"), counts: next.includes("counts"), cellMetadata: next.includes("cellMetadata") })} options={CHOICES} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a Jupyter notebook and get it back without its outputs, execution counts and scratch metadata: the same code and text, a fraction of the size, and a clean diff when it is committed. What nbstripout does, with nothing installed and nothing uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Cleaning"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose notebook files", headline: "Drop .ipynb files here", subhead: "Cleaned as they land" }}
      note="The notebook is written back the way Jupyter writes one - one-space indentation, keys in order, a newline at the end - so the only lines that change are the ones stripped. The kernel and language, cell tags and slideshow settings stay, since a notebook needs them to run and present; what goes is state a front end wrote for itself. Version 3 notebooks are refused with a reason."
    />
  );
}
