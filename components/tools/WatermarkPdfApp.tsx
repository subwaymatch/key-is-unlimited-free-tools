"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { DEFAULT_STAMP_SETTINGS, describePdf, loadPdf, stampPages, type StampLayout, type StampSettings } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import { Select } from "../ui/Select";
import styles from "../Settings.module.css";

const tool = requireTool("watermark-pdf");

function isStampSettings(value: unknown): value is StampSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StampSettings>;
  return typeof candidate.text === "string" && (candidate.layout === "diagonal" || candidate.layout === "center" || candidate.layout === "bottom") && typeof candidate.opacity === "number" && typeof candidate.fontSize === "number";
}

const LAYOUT_OPTIONS: { value: StampLayout; label: string; blurb: string }[] = [
  { value: "diagonal", label: "Across the page", blurb: "Corner to corner, the classic stamp" },
  { value: "center", label: "In the middle", blurb: "Level, across the centre" },
  { value: "bottom", label: "At the foot", blurb: "A line under the page's content" },
];

const SIZE_OPTIONS = [30, 45, 60, 90, 120].map((size) => ({ value: size, label: `${size} pt` }));

/** A word across every page. */
export function WatermarkPdfApp() {
  const [settings, setSettings] = useState<StampSettings>(DEFAULT_STAMP_SETTINGS);
  useStoredSettings(storageKey("settings", "watermark-pdf"), settings, setSettings, isStampSettings);

  const invalid = settings.text.trim() === "";

  const queue = useMemo<PlainQueueOptions<StampSettings>>(
    () => ({
      key: "watermark-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const facts = [describePdf(document)];
        report("Stamping...", null);
        const bytes = await stampPages(document, current);
        return { facts, outputs: [{ label: "Stamped PDF", fileName: pdfName(file, "-watermarked"), blob: pdfBlob(bytes), kind: "pdf", note: `"${current.text.trim()}" on every page` }] };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Stamp",
    defaultOpen: true,
    invalid: () => (invalid ? "Type the words to stamp before adding a PDF." : null),
    summary: () => (invalid ? "no text yet" : `"${settings.text.trim()}", ${LAYOUT_OPTIONS.find((option) => option.value === settings.layout)?.label.toLowerCase()}`),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Words</legend>
          <input type="text" value={settings.text} placeholder="CONFIDENTIAL" aria-label="Words" aria-invalid={invalid} onChange={(event) => setSettings((previous) => ({ ...previous, text: event.target.value }))} className={styles.input} style={{ width: "20rem" }} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Where</legend>
          <RadioCards aria-label="Where" value={settings.layout} onValueChange={(layout) => setSettings((previous) => ({ ...previous, layout }))} options={LAYOUT_OPTIONS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>How</legend>
          <RadioCards
            aria-label="Opacity"
            value={String(settings.opacity)}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, opacity: Number(value) }))}
            options={[
              { value: "0.15", label: "Faint", blurb: "Readable through it" },
              { value: "0.25", label: "Clear", blurb: "The usual stamp" },
              { value: "0.5", label: "Bold", blurb: "Hard to miss" },
            ]}
          />
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Size</span>
              <Select aria-label="Size" value={settings.fontSize} options={SIZE_OPTIONS} onValueChange={(fontSize) => setSettings((previous) => ({ ...previous, fontSize }))} />
            </label>
            <p className={styles.panelNote}>Shrunk to fit where the page is too small for it.</p>
          </div>
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type a word or a line - CONFIDENTIAL, DRAFT, a name, a date - and drop a PDF: every page comes back with it stamped across, in the middle or at the foot, as faint or as bold as you like, with the pages themselves untouched. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Stamping"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: invalid ? "Type the words above before adding a PDF" : `"${settings.text.trim()}" will be stamped on each PDF you drop` }}
      note="The stamp is drawn over the page's content in Helvetica, one of the fonts every viewer carries, so the file barely grows. It is a mark, not a lock: anyone with an editor can draw over it or take the page apart. For a PDF nobody can copy from, password protection is what you want, and that needs a tool with encryption, which this site does not have."
    />
  );
}
