"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { rebuildFromImages, type RenderedPageImage } from "@/lib/pdf/pages";
import { closePdf, openPdf, renderPage } from "@/lib/pdf/render";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("compress-pdf");

const PRESETS: readonly { id: string; dpi: number; quality: number; label: string; blurb: string }[] = [
  { id: "screen", dpi: 96, quality: 0.6, label: "Screen", blurb: "96 dpi: the smallest, readable on a screen" },
  { id: "ebook", dpi: 150, quality: 0.75, label: "E-book", blurb: "150 dpi: sharp on a screen, fine to print" },
  { id: "print", dpi: 200, quality: 0.85, label: "Print", blurb: "200 dpi: little visible loss on paper" },
];

interface CompressSettings {
  presetId: string;
}

function isCompressSettings(value: unknown): value is CompressSettings {
  return typeof value === "object" && value !== null && PRESETS.some((preset) => preset.id === (value as Partial<CompressSettings>).presetId);
}

/** Every page redrawn as a JPEG at a lower resolution. */
export function CompressPdfApp() {
  const [settings, setSettings] = useState<CompressSettings>({ presetId: "ebook" });
  useStoredSettings(storageKey("settings", "compress-pdf"), settings, setSettings, isCompressSettings);

  const preset = PRESETS.find((entry) => entry.id === settings.presetId) ?? PRESETS[1];

  const queue = useMemo<PlainQueueOptions<CompressSettings>>(
    () => ({
      key: "compress-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report, signal) => {
        const chosen = PRESETS.find((entry) => entry.id === current.presetId) ?? PRESETS[1];
        report("Opening...", null);
        const document = await openPdf(new Uint8Array(await file.arrayBuffer()));
        try {
          const count = document.numPages;
          const pages: RenderedPageImage[] = [];
          for (let index = 0; index < count; index += 1) {
            if (signal.aborted) break;
            report(`Redrawing page ${index + 1} of ${count}...`, (index / (count + 1)) * 0.9);
            const page = await renderPage(document, index, chosen.dpi, "image/jpeg", chosen.quality);
            pages.push({ bytes: new Uint8Array(await page.blob.arrayBuffer()), pointWidth: page.pointWidth, pointHeight: page.pointHeight });
          }
          report("Writing the PDF...", 0.95);
          const bytes = await rebuildFromImages(pages);
          const facts = [`${count} ${count === 1 ? "page" : "pages"}`];
          if (bytes.length >= file.size) {
            return { facts, outputs: [], nothing: { message: `Redrawing at ${chosen.label.toLowerCase()} quality would not make this PDF smaller.`, hint: `It would be ${formatBytes(bytes.length)} against ${formatBytes(file.size)}. A document that is mostly text is already small; choose the screen preset to shrink a scan further.` } };
          }
          return {
            facts,
            outputs: [{ label: "Compressed PDF", fileName: pdfName(file, "-compressed"), blob: pdfBlob(bytes), kind: "pdf", note: `${formatBytes(bytes.length)} from ${formatBytes(file.size)}, ${chosen.dpi} dpi` }],
            notes: ["Every page is now a picture of the page: its text can no longer be selected or searched."],
          };
        } finally {
          await closePdf(document);
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Quality",
    defaultOpen: true,
    summary: () => `${preset.label.toLowerCase()}, ${preset.dpi} dpi`,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Redraw at</legend>
        <RadioCards aria-label="Redraw at" value={settings.presetId} onValueChange={(presetId) => setSettings({ presetId })} options={PRESETS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a scanned or picture-heavy PDF and get it back several times smaller: every page is redrawn as a JPEG at screen, e-book or print resolution and put back on a page its own size. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Redrawing"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: `Redrawn at ${preset.label.toLowerCase()} quality as they land - change it below` }}
      note="This is honest about what it does: each page becomes a picture of the page, which is what shrinks a scan and what turns a text document into one that cannot be searched or have its text selected. A PDF that is mostly text is already small and comes back no smaller, and the card says so. Links, bookmarks and form fields do not survive."
    />
  );
}
