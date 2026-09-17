"use client";

import { useMemo, useState } from "react";

import { MIME_LABELS, type ImageMime } from "@/lib/images/canvas";
import { fileStem } from "@/lib/mediaTypes";
import { PDF_ACCEPT, rejectNonPdf } from "@/lib/pdf/files";
import { DPI_OPTIONS, closePdf, openPdf, renderPage } from "@/lib/pdf/render";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("pdf-to-images");

/** The most pages drawn from one file; a card with more pictures than this is a wall. */
const MAX_PAGES = 200;

interface RenderSettings {
  dpi: number;
  mime: "image/jpeg" | "image/png";
}

function isRenderSettings(value: unknown): value is RenderSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RenderSettings>;
  return DPI_OPTIONS.some((entry) => entry.dpi === candidate.dpi) && (candidate.mime === "image/jpeg" || candidate.mime === "image/png");
}

/** Every page as a picture. */
export function PdfToImagesApp() {
  const [settings, setSettings] = useState<RenderSettings>({ dpi: 150, mime: "image/jpeg" });
  useStoredSettings(storageKey("settings", "pdf-to-images"), settings, setSettings, isRenderSettings);

  const queue = useMemo<PlainQueueOptions<RenderSettings>>(
    () => ({
      key: "pdf-to-images",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report, signal) => {
        report("Opening...", null);
        const document = await openPdf(new Uint8Array(await file.arrayBuffer()));
        try {
          const count = Math.min(document.numPages, MAX_PAGES);
          const outputs = [];
          const extension = current.mime === "image/png" ? "png" : "jpg";
          for (let index = 0; index < count; index += 1) {
            if (signal.aborted) break;
            report(`Drawing page ${index + 1} of ${count}...`, index / count);
            const page = await renderPage(document, index, current.dpi, current.mime, current.mime === "image/jpeg" ? 0.9 : null);
            outputs.push({
              label: `Page ${index + 1}`,
              fileName: `${fileStem(file.name, "document")}-page-${String(index + 1).padStart(2, "0")}.${extension}`,
              blob: page.blob,
              kind: "image" as const,
              note: `${page.width}x${page.height}`,
            });
          }
          return {
            facts: [`${document.numPages} ${document.numPages === 1 ? "page" : "pages"}`],
            notes: document.numPages > MAX_PAGES ? [`Only the first ${MAX_PAGES} pages were drawn. Split the document to draw the rest.`] : [],
            outputs,
          };
        } finally {
          await closePdf(document);
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Resolution & format",
    defaultOpen: true,
    summary: () => `${settings.dpi} dpi, ${MIME_LABELS[settings.mime as ImageMime]}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Resolution</legend>
          <RadioCards aria-label="Resolution" value={String(settings.dpi)} onValueChange={(value) => setSettings((previous) => ({ ...previous, dpi: Number(value) }))} options={DPI_OPTIONS.map((entry) => ({ value: String(entry.dpi), label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime: mime as RenderSettings["mime"] }))}
            options={[
              { value: "image/jpeg", label: "JPEG", blurb: "Small; right for scans and photos" },
              { value: "image/png", label: "PNG", blurb: "Lossless; right for text and line art" },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get every page back as a picture, at screen, e-book or print resolution, as JPEG or PNG: for a slide to paste somewhere, a page to send as a photo, or a scan to get out of its wrapper. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Drawing"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: `Every page drawn at ${settings.dpi} dpi as it lands - change it below` }}
      note={`Pages are drawn by PDF.js, the engine Firefox reads PDFs with, so what comes out is what a viewer shows, fonts and all. 300 dpi makes an A4 page 2480 pixels wide, which is a lot of picture; 150 is sharp on any screen. Up to ${MAX_PAGES} pages per file are drawn.`}
    />
  );
}
