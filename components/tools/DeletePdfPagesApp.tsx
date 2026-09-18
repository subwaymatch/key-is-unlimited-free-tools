"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, loadPdf, removePages } from "@/lib/pdf/pages";
import { describeRange, pageIndices, parsePageRanges, rangeSyntaxProblem } from "@/lib/pdf/ranges";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import styles from "../Settings.module.css";

const tool = requireTool("delete-pdf-pages");

interface DeleteSettings {
  ranges: string;
}

function isDeleteSettings(value: unknown): value is DeleteSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<DeleteSettings>).ranges === "string";
}

/** Pages taken out. */
export function DeletePdfPagesApp() {
  const [settings, setSettings] = useState<DeleteSettings>({ ranges: "" });
  useStoredSettings(storageKey("settings", "delete-pdf-pages"), settings, setSettings, isDeleteSettings);

  const invalid = settings.ranges.trim() === "";
  const unreadable = rangeSyntaxProblem(settings.ranges);

  const queue = useMemo<PlainQueueOptions<DeleteSettings>>(
    () => ({
      key: "delete-pdf-pages",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const count = document.getPageCount();
        const facts = [describePdf(document)];
        const parsed = parsePageRanges(current.ranges, count);
        if (parsed.ranges.length === 0) throw new PlainError("No pages could be read from the list.", parsed.problems.join(" ") || "Type pages such as 2, 5-7 in the panel.");
        const indices = pageIndices(parsed.ranges);
        report("Removing...", null);
        const bytes = await removePages(document, indices);
        return {
          facts,
          notes: parsed.problems,
          outputs: [
            {
              label: "PDF without those pages",
              fileName: pdfName(file, "-pages-removed"),
              blob: pdfBlob(bytes),
              kind: "pdf",
              note: `Removed ${indices.length === 1 ? "page" : "pages"} ${parsed.ranges.map(describeRange).join(", ")}; ${count - indices.length} left`,
            },
          ],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Pages to remove",
    defaultOpen: true,
    invalid: () => (invalid ? "Type the pages to remove before adding a PDF." : unreadable),
    summary: () => settings.ranges.trim() || "none yet",
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Remove</legend>
        <p className={styles.intro}>Pages are numbered from 1, the way a viewer shows them. Ranges take the print dialog&apos;s forms: 2, 5-7, 10-, -1.</p>
        <input type="text" value={settings.ranges} placeholder="2, 5-7" aria-invalid={invalid || unreadable !== null} aria-label="Pages to remove" onChange={(event) => setSettings({ ranges: event.target.value })} className={styles.input} style={{ width: "20rem" }} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type the pages to take out - a blank one, a cover, a range in the middle - then drop the PDF and get it back without them, everything else exactly as it was. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Removing"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: invalid ? "Type the pages to remove above before adding a PDF" : `Pages ${settings.ranges.trim()} will be removed from each PDF you drop` }}
      note="The pages are removed from the document's page list; their content stays in the file where other pages share it, so the file may not shrink by much. A list that would remove every page is refused. To keep a set of pages rather than remove one, split the PDF by ranges instead."
    />
  );
}
