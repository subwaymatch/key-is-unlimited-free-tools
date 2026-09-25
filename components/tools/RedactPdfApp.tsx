"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { assembleRedacted, findOnPage, PATTERNS, termsPattern, type Rect, type TextItemLike } from "@/lib/pdf/redact";
import { closePdf, openPdf, renderPageRedacted } from "@/lib/pdf/render";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("redact-pdf");

interface RedactSettings {
  patterns: string[];
  dpi: number;
}

interface Options extends RedactSettings {
  terms: string;
}

const DPIS = [
  { value: "150", label: "150 dpi", blurb: "Smaller files; fine on a screen" },
  { value: "200", label: "200 dpi", blurb: "The usual choice: sharp to read and print" },
  { value: "300", label: "300 dpi", blurb: "Print quality, for small type" },
];

function isSettings(value: unknown): value is RedactSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RedactSettings>;
  return Array.isArray(candidate.patterns) && candidate.patterns.every((id) => PATTERNS.some((pattern) => pattern.id === id)) && DPIS.some((dpi) => Number(dpi.value) === candidate.dpi);
}

/** Words, names and numbers taken out of a PDF for good, not covered over. */
export function RedactPdfApp() {
  const [settings, setSettings] = useState<RedactSettings>({ patterns: ["email", "phone", "card", "id"], dpi: 200 });
  const [terms, setTerms] = useState("");
  useStoredSettings(storageKey("settings", "redact-pdf"), settings, setSettings, isSettings);
  const options = useMemo<Options>(() => ({ ...settings, terms }), [settings, terms]);

  const invalid = settings.patterns.length === 0 && termsPattern(terms) === null ? "Type something to remove, or tick a kind of detail, before adding a file." : null;

  const queue = useMemo<PlainQueueOptions<Options>>(
    () => ({
      key: "redact-pdf",
      settings: options,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const patterns: { id: string; pattern: RegExp; accept?: (match: string) => boolean }[] = PATTERNS.filter((pattern) => current.patterns.includes(pattern.id));
        const typed = termsPattern(current.terms);
        if (typed) patterns.push({ id: "terms", pattern: typed });
        const document = await openPdf(bytes.slice());
        const byPage = new Map<number, { rects: Rect[]; found: Map<string, number> }>();
        try {
          for (let index = 0; index < document.numPages; index += 1) {
            report(`Searching page ${index + 1} of ${document.numPages}...`, index / document.numPages / 2);
            const page = await document.getPage(index + 1);
            const content = await page.getTextContent();
            const items = content.items.filter((item) => "str" in item) as unknown as TextItemLike[];
            page.cleanup();
            const rects: Rect[] = [];
            const found = new Map<string, number>();
            for (const entry of patterns) {
              for (const match of findOnPage(items, [entry])) {
                rects.push(...match.rects);
                found.set(entry.id, (found.get(entry.id) ?? 0) + 1);
              }
            }
            if (rects.length > 0) byPage.set(index, { rects, found });
          }
          if (byPage.size === 0) {
            return {
              outputs: [],
              nothing: { message: "Nothing to redact was found.", hint: `None of the ${document.numPages} ${document.numPages === 1 ? "page" : "pages"} has text matching what was asked. A scanned page has no text to search; redact it with the screenshot redaction tool instead.` },
            };
          }
          const replacements = new Map<number, { image: Uint8Array; kind: "jpeg"; width: number; height: number }>();
          let done = 0;
          for (const [index, entry] of byPage) {
            report(`Redacting page ${index + 1}...`, 0.5 + (done / byPage.size) * 0.45);
            const drawn = await renderPageRedacted(document, index, current.dpi, entry.rects);
            replacements.set(index, { image: drawn.jpeg, kind: "jpeg", width: drawn.pointWidth, height: drawn.pointHeight });
            done += 1;
          }
          report("Writing the PDF...", 0.97);
          const out = await assembleRedacted(bytes, replacements);
          const label = (id: string) => (id === "terms" ? "typed words" : (PATTERNS.find((pattern) => pattern.id === id)?.label.toLowerCase() ?? id));
          const totals = new Map<string, number>();
          for (const entry of byPage.values()) for (const [id, count] of entry.found) totals.set(id, (totals.get(id) ?? 0) + count);
          const pages = [...byPage.keys()].map((index) => index + 1);
          return {
            facts: [`Removed: ${[...totals].map(([id, count]) => `${count} ${label(id)}`).join(", ")}`, `Pages redacted: ${pages.length === document.numPages ? "all" : pages.join(", ")} of ${document.numPages}`],
            notes: [
              `The redacted ${pages.length === 1 ? "page is" : "pages are"} now ${pages.length === 1 ? "a picture" : "pictures"} at ${current.dpi} dpi, so the text under the boxes is gone, not hidden, and the rest of ${pages.length === 1 ? "that page" : "those pages"} can no longer be selected or searched. Other pages are unchanged.`,
              "Document properties, bookmarks, attachments and form data are not carried over, since any of them can repeat what was removed. Check the result before sending it: a name written differently, or inside a picture, is not found.",
            ],
            outputs: [{ label: "Redacted PDF", fileName: pdfName(file, "-redacted"), blob: pdfBlob(out), kind: "pdf", note: `${formatBytes(out.length)}; ${pages.length} ${pages.length === 1 ? "page" : "pages"} rebuilt` }],
          };
        } finally {
          await closePdf(document);
        }
      },
    }),
    [options],
  );

  const toolSettings: PlainSettings = {
    title: "What to remove",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () => [...PATTERNS.filter((pattern) => settings.patterns.includes(pattern.id)).map((pattern) => pattern.label.toLowerCase()), ...(termsPattern(terms) ? ["typed words"] : [])].join(", ") || "nothing yet",
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Words and names</legend>
          <p className={styles.intro}>One per line. Case is ignored, and a word is matched whole: Ann does not match Anna. Nothing typed here is saved.</p>
          <textarea className={styles.textarea} rows={4} value={terms} onChange={(event) => setTerms(event.target.value)} spellCheck={false} aria-label="Words and names to remove" placeholder={"Jane Doe\nAcme Holdings\nProject Falcon"} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Details found by their shape</legend>
          <CheckboxCards aria-label="Details found by their shape" value={settings.patterns} onValueChange={(next) => setSettings((previous) => ({ ...previous, patterns: next }))} options={PATTERNS.map((pattern) => ({ value: pattern.id, label: pattern.label, blurb: pattern.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Redacted pages</legend>
          <RadioCards aria-label="Redacted pages" value={String(settings.dpi)} onValueChange={(value) => setSettings((previous) => ({ ...previous, dpi: Number(value) }))} options={DPIS} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type the names and words to hide, or tick e-mail addresses, phone, card and ID numbers, then drop a PDF: every match is blacked out and the text under the box is removed, not just covered, so it cannot be copied back out. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Redacting"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: invalid ? "Say what to remove above first" : "Redacted as they land" }}
      note="A black rectangle drawn over text hides it from the eye only: the text is still in the file, and a copy and paste brings it back, which is how many court filings and reports have leaked. Here each page with something to hide is redrawn as a picture with the boxes painted in and put in place of the original, so the words underneath no longer exist in the file. Matches are found in the PDF's text, so a scanned page, which has none, or a name inside a picture, is not found; check the result, and use the redaction checker on it."
    />
  );
}
