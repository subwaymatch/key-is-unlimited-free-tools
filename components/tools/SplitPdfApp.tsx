"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, loadPdf, splitPdf } from "@/lib/pdf/pages";
import { everyPages, parsePageRanges, rangeSyntaxProblem, type PageRange } from "@/lib/pdf/ranges";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("split-pdf");

type SplitMode = "each" | "every" | "ranges";

interface SplitSettings {
  mode: SplitMode;
  every: number;
  ranges: string;
}

const DEFAULT_SETTINGS: SplitSettings = { mode: "each", every: 2, ranges: "" };

function isSplitSettings(value: unknown): value is SplitSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SplitSettings>;
  return (candidate.mode === "each" || candidate.mode === "every" || candidate.mode === "ranges") && typeof candidate.every === "number" && typeof candidate.ranges === "string";
}

const MODE_OPTIONS = [
  { value: "each", label: "Every page on its own", blurb: "One PDF per page" },
  { value: "every", label: "Every N pages", blurb: "Pieces of a set number of pages" },
  { value: "ranges", label: "The ranges I type", blurb: "1-3, 5, 8-: one PDF per range" },
];

/** A PDF in pieces. */
export function SplitPdfApp() {
  const [settings, setSettings] = useState<SplitSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "split-pdf"), settings, setSettings, isSplitSettings);

  const everyInvalid = settings.mode === "every" && !(Number.isInteger(settings.every) && settings.every >= 1);
  const rangesInvalid = settings.mode === "ranges" && settings.ranges.trim() === "";
  const rangesUnreadable = settings.mode === "ranges" ? rangeSyntaxProblem(settings.ranges) : null;

  const queue = useMemo<PlainQueueOptions<SplitSettings>>(
    () => ({
      key: "split-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const count = document.getPageCount();
        const facts = [describePdf(document)];
        let ranges: PageRange[];
        const notes: string[] = [];
        if (current.mode === "ranges") {
          const parsed = parsePageRanges(current.ranges, count);
          if (parsed.ranges.length === 0) throw new PlainError("No page ranges could be read.", parsed.problems.join(" ") || "Type ranges such as 1-3, 5, 8- in the panel.");
          notes.push(...parsed.problems);
          ranges = parsed.ranges;
        } else {
          const size = current.mode === "each" ? 1 : current.every;
          if (count <= size) {
            return { facts, outputs: [], nothing: { message: `This PDF has ${count} ${count === 1 ? "page" : "pages"}, which is one piece.`, hint: current.mode === "each" ? "There is nothing to split." : `Choose fewer than ${count} pages per piece.` } };
          }
          ranges = everyPages(count, size);
        }
        const pieces = await splitPdf(document, ranges, (index) => report(`Writing piece ${index + 1} of ${ranges.length}...`, index / ranges.length));
        return {
          facts,
          notes,
          outputs: pieces.map((piece) => ({
            label: `${piece.range.from === piece.range.to ? "Page" : "Pages"} ${piece.label}`,
            fileName: pdfName(file, `-pages-${piece.label}`),
            blob: pdfBlob(piece.bytes),
            kind: "pdf" as const,
          })),
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "How to split",
    defaultOpen: true,
    invalid: () => (everyInvalid ? "A whole number of pages per piece is needed." : rangesInvalid ? "Type at least one page range before adding a PDF." : rangesUnreadable),
    summary: () => (settings.mode === "each" ? "every page on its own" : settings.mode === "every" ? `every ${settings.every} pages` : settings.ranges.trim() || "no ranges yet"),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Pieces</legend>
        <RadioCards aria-label="Pieces" value={settings.mode} onValueChange={(mode) => setSettings((previous) => ({ ...previous, mode: mode as SplitMode }))} options={MODE_OPTIONS} />
        {settings.mode === "every" && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Pages per piece</span>
              <input type="number" inputMode="numeric" min={1} step="1" value={settings.every} aria-invalid={everyInvalid} onChange={(event) => setSettings((previous) => ({ ...previous, every: Number(event.target.value) }))} className={styles.input} />
            </label>
          </div>
        )}
        {settings.mode === "ranges" && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Ranges, one PDF each</span>
              <input type="text" value={settings.ranges} placeholder="1-3, 5, 8-" aria-invalid={rangesInvalid || rangesUnreadable !== null} onChange={(event) => setSettings((previous) => ({ ...previous, ranges: event.target.value }))} className={styles.input} style={{ width: "20rem" }} />
            </label>
            <p className={styles.panelNote}>Pages are numbered from 1. &quot;8-&quot; runs to the end and &quot;-3&quot; from the start.</p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get it back in pieces: one file per page, pieces of a set number of pages, or the ranges you type the way a print dialog takes them. Nothing is re-drawn, and nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Splitting"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: rangesUnreadable ?? "Split as they land - choose how below" }}
      note="Each piece is a new document holding copies of its pages, with their fonts and images; bookmarks do not carry over. A range past the last page is cut there and the card says so; a document too short to split says so too."
    />
  );
}
