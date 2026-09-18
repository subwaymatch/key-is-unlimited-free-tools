"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, isIdentityOrder, loadPdf, pagesInOrder } from "@/lib/pdf/pages";
import { describeRange, pageIndices, parsePageRanges, rangeSyntaxProblem } from "@/lib/pdf/ranges";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import styles from "../Settings.module.css";

const tool = requireTool("extract-pdf-pages");

interface ExtractSettings {
  ranges: string;
}

function isExtractSettings(value: unknown): value is ExtractSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<ExtractSettings>).ranges === "string";
}

/** The pages named, as one new document. */
export function ExtractPdfPagesApp() {
  const [settings, setSettings] = useState<ExtractSettings>({ ranges: "" });
  useStoredSettings(storageKey("settings", "extract-pdf-pages"), settings, setSettings, isExtractSettings);

  const empty = settings.ranges.trim() === "";
  const unreadable = rangeSyntaxProblem(settings.ranges);

  const queue = useMemo<PlainQueueOptions<ExtractSettings>>(
    () => ({
      key: "extract-pdf-pages",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const count = document.getPageCount();
        const facts = [describePdf(document)];
        const parsed = parsePageRanges(current.ranges, count);
        if (parsed.ranges.length === 0) {
          throw new PlainError("No pages could be read from the ranges.", parsed.problems.join(" ") || "Type pages or ranges such as 1-3, 5, 8- in the panel.");
        }
        const indices = pageIndices(parsed.ranges);
        if (indices.length === count && isIdentityOrder(indices)) {
          return { facts, outputs: [], nothing: { message: "Those ranges name every page, in order.", hint: `The result would be this ${count}-page document as it is.` } };
        }
        report(`Copying ${indices.length} ${indices.length === 1 ? "page" : "pages"}...`, null);
        const bytes = await pagesInOrder(document, indices);
        const label = parsed.ranges.map(describeRange).join(",");
        return {
          facts,
          notes: parsed.problems,
          outputs: [
            {
              label: `${indices.length} ${indices.length === 1 ? "page" : "pages"}`,
              fileName: pdfName(file, `-pages-${label.length > 24 ? `${label.slice(0, 24)}-etc` : label}`),
              blob: pdfBlob(bytes),
              kind: "pdf",
              note: `Pages ${parsed.ranges.map(describeRange).join(", ")} of ${count}`,
            },
          ],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Pages to extract",
    defaultOpen: true,
    invalid: () => (empty ? "Type the pages to extract before adding a PDF." : unreadable),
    summary: () => settings.ranges.trim() || "no pages yet",
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Pages</legend>
        <p className={styles.intro}>The way a print dialog takes them: single pages, ranges, or both, in the order you want them.</p>
        <label>
          <span className={styles.fieldLabel}>Pages and ranges</span>
          <input
            type="text"
            value={settings.ranges}
            placeholder="1-3, 5, 8-"
            aria-invalid={empty || unreadable !== null}
            onChange={(event) => setSettings({ ranges: event.target.value })}
            className={styles.input}
            style={{ width: "20rem" }}
          />
        </label>
        <p className={styles.panelNote}>Pages are numbered from 1. &quot;8-&quot; runs to the end, &quot;-3&quot; from the start, and &quot;5, 1&quot; puts page 5 before page 1.</p>
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type the pages you want - 1-3, 5, 8- - drop a PDF, and get a new document of just those pages, in the order you typed them. Nothing is re-drawn, and nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Extracting"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: unreadable ?? "The pages typed above come out of each as they land" }}
      note="The pages are copied with their fonts, images and links, and the document keeps its title and author; bookmarks do not carry over, since they belong to the document rather than to a page. A range past the last page is cut there and the card says so. To take pages out instead, there is Delete PDF pages; to get every range as its own file, Split PDF."
    />
  );
}
