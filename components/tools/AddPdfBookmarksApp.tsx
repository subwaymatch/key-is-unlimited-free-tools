"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { countOutline, parseOutline, writeOutline } from "@/lib/pdf/outline";
import { describePdf, loadPdf } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import styles from "../Settings.module.css";

const tool = requireTool("add-pdf-bookmarks");

const EXAMPLE = "1 Cover\n2 Introduction\n5 Chapter 1: The plan\n  6 Where it started\n  9 What changed\n14 Chapter 2: The build\n30 Appendix";

interface BookmarkSettings {
  text: string;
}

function isBookmarkSettings(value: unknown): value is BookmarkSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<BookmarkSettings>).text === "string";
}

/** A typed table of contents written into a PDF as bookmarks. */
export function AddPdfBookmarksApp() {
  const [settings, setSettings] = useState<BookmarkSettings>({ text: "" });
  useStoredSettings(storageKey("settings", "add-pdf-bookmarks"), settings, setSettings, isBookmarkSettings);

  // Parsed against a generous page count for the panel; the real count is checked when a file runs.
  const preview = parseOutline(settings.text, 100_000);

  const queue = useMemo<PlainQueueOptions<BookmarkSettings>>(
    () => ({
      key: "add-pdf-bookmarks",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Opening...", null);
        const source = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const count = source.getPageCount();
        const facts = [describePdf(source)];
        const existing = await countOutline(source);
        if (existing > 0) facts.push(`Bookmarks already in it: ${existing}`);
        const parsed = parseOutline(current.text, count);
        if (parsed.items.length === 0) {
          throw new PlainError("No bookmarks could be read from the list.", parsed.problems[0] ?? "Type one per line: the page number, then the title.");
        }
        report("Writing...", null);
        const bytes = await writeOutline(source, parsed.items);
        const nested = parsed.items.filter((item) => item.level > 0).length;
        const notes = parsed.problems.map((problem) => `Skipped: ${problem}`);
        if (existing > 0) notes.push(`The ${existing} ${existing === 1 ? "bookmark" : "bookmarks"} the file had ${existing === 1 ? "was" : "were"} replaced.`);
        return {
          facts,
          notes,
          outputs: [{ label: "With bookmarks", fileName: pdfName(file, "-bookmarked"), blob: pdfBlob(bytes), kind: "pdf", note: `${parsed.items.length} ${parsed.items.length === 1 ? "bookmark" : "bookmarks"}${nested > 0 ? `, ${nested} nested` : ""}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Bookmarks",
    defaultOpen: true,
    invalid: () => (preview.items.length === 0 ? "Type at least one bookmark before adding a file." : null),
    summary: () => (preview.items.length === 0 ? "none yet" : `${preview.items.length} ${preview.items.length === 1 ? "bookmark" : "bookmarks"}`),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>The list</legend>
        <p className={styles.intro}>
          One bookmark per line: the page number, then the title. Indent a line with two spaces, a tab
          or a dash to nest it under the one above. A contents page pasted as &quot;Title ...... 12&quot; reads too.
        </p>
        <textarea aria-label="Bookmark list" value={settings.text} onChange={(event) => setSettings({ text: event.target.value })} placeholder={EXAMPLE} rows={8} spellCheck={false} className={styles.textarea} />
        {preview.problems.slice(0, 3).map((problem) => (
          <p key={problem} className={styles.warning}>
            {problem}
          </p>
        ))}
        {preview.items.length > 0 && (
          <p className={styles.panelNote}>
            {preview.items.length} {preview.items.length === 1 ? "bookmark" : "bookmarks"}: {preview.items.slice(0, 3).map((item) => `"${item.title}" on page ${item.page + 1}`).join(", ")}
            {preview.items.length > 3 ? ` and ${preview.items.length - 3} more` : ""}.
          </p>
        )}
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type a table of contents - a page number and a title per line, indented to nest - and drop PDFs: each comes back with those bookmarks in its side panel, the way a viewer shows a book's chapters, opening on the panel. A scanned book, a merged report, a manual with no outline. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Writing"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: preview.items.length > 0 ? `${preview.items.length} bookmarks written into each as it lands` : "Type the bookmarks above before adding PDFs" }}
      note="Bookmarks are the PDF's outline: a tree of titles each pointing at the top of a page, which every viewer shows in a side panel and which the file then opens on. The list typed here replaces any outline the file had, and the card says how many it had. Page numbers count from the first page of the file, not from what is printed on the page, so a book with a preface numbered in roman numerals wants the offset added. Pages are copied untouched."
    />
  );
}
