"use client";

import { useMemo, useState } from "react";

import { BLANK_DPI, BLANK_OPTIONS, describePages, inkShare, isBlank, type BlankSensitivity } from "@/lib/pdf/blank";
import { pagePixels } from "@/lib/pdf/extract";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, loadPdf, removePages } from "@/lib/pdf/pages";
import { closePdf, openPdf } from "@/lib/pdf/render";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("remove-blank-pages");

interface BlankSettings {
  sensitivity: BlankSensitivity;
}

function isBlankSettings(value: unknown): value is BlankSettings {
  return typeof value === "object" && value !== null && BLANK_OPTIONS.some((option) => option.id === (value as Partial<BlankSettings>).sensitivity);
}

/** The empty pages of a scan taken out. */
export function RemoveBlankPagesApp() {
  const [settings, setSettings] = useState<BlankSettings>({ sensitivity: "normal" });
  useStoredSettings(storageKey("settings", "remove-blank-pages"), settings, setSettings, isBlankSettings);

  const queue = useMemo<PlainQueueOptions<BlankSettings>>(
    () => ({
      key: "remove-blank-pages",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report, signal) => {
        report("Opening...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const source = await loadPdf(bytes);
        const count = source.getPageCount();
        const facts = [describePdf(source)];
        const rendered = await openPdf(bytes.slice());
        const blank: number[] = [];
        try {
          for (let index = 0; index < count; index += 1) {
            if (signal.aborted) throw new PlainError("Cancelled.");
            report(`Looking at page ${index + 1} of ${count}...`, index / count);
            const pixels = await pagePixels(rendered, index, BLANK_DPI);
            if (isBlank(inkShare(pixels.data, pixels.width, pixels.height), current.sensitivity)) blank.push(index);
          }
        } finally {
          await closePdf(rendered);
        }
        if (blank.length === 0) return { facts, outputs: [], nothing: { message: "No page in this PDF is blank.", hint: "Every page has something on it at this sensitivity. A looser one counts a page with only a speck or a page number as blank." } };
        if (blank.length === count) return { facts, outputs: [], nothing: { message: "Every page in this PDF is blank.", hint: "There would be nothing left. If the pages are not blank, the sensitivity is too loose." } };
        report("Writing...", null);
        const out = await removePages(source, blank);
        return {
          facts,
          notes: [`${blank.length} blank ${blank.length === 1 ? "page" : "pages"} removed: ${describePages(blank)}.`],
          outputs: [{ label: "Without the blank pages", fileName: pdfName(file, "-no-blank-pages"), blob: pdfBlob(out), kind: "pdf", note: `${count - blank.length} ${count - blank.length === 1 ? "page" : "pages"} left of ${count}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What counts as blank",
    summary: () => BLANK_OPTIONS.find((option) => option.id === settings.sensitivity)?.label.toLowerCase() ?? settings.sensitivity,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>A page is blank when it has</legend>
        <RadioCards aria-label="A page is blank when it has" value={settings.sensitivity} onValueChange={(sensitivity) => setSettings({ sensitivity: sensitivity as BlankSensitivity })} options={BLANK_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a scanned PDF and get it back without its blank pages: the backs of single-sided sheets a duplex scanner adds, the separator sheets, the empty page at the end. Each page is drawn and its ink measured, so a page with a speck of scanner noise still counts as blank. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Looking"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Their blank pages are found and removed as they land" }}
      note="Every page is drawn small by PDF.js and the share of dark pixels counted: under the threshold chosen above, the page goes. A page carrying nothing but a page number or a punch hole is a judgement call, which is what the sensitivity is for; the card names the pages removed so the call can be checked. The pages that stay are copied as they are, nothing redrawn."
    />
  );
}
