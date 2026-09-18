"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { ORIENTATION_OPTIONS, PAPER_SIZES, POINTS_PER_MM, resizePdfPages, type Orientation, type PaperSize, type ResizeSettings } from "@/lib/pdf/pageBoxes";
import { describePdf, loadPdf } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("resize-pdf-pages");

interface PageSizeSettings {
  paper: PaperSize;
  orientation: Orientation;
  enlarge: boolean;
  /** Millimetres of clear paper around the page. */
  marginMm: number;
}

const MARGIN_OPTIONS = [
  { value: "0", label: "None", blurb: "The page fills the paper" },
  { value: "10", label: "10 mm", blurb: "Room for a printer's edge" },
  { value: "20", label: "20 mm", blurb: "A generous border" },
];

function isPageSizeSettings(value: unknown): value is PageSizeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PageSizeSettings>;
  return PAPER_SIZES.some((paper) => paper.id === candidate.paper) && ORIENTATION_OPTIONS.some((option) => option.id === candidate.orientation) && typeof candidate.enlarge === "boolean" && typeof candidate.marginMm === "number";
}

/** Every page put on paper of one size. */
export function ResizePdfPagesApp() {
  const [settings, setSettings] = useState<PageSizeSettings>({ paper: "a4", orientation: "auto", enlarge: true, marginMm: 0 });
  useStoredSettings(storageKey("settings", "resize-pdf-pages"), settings, setSettings, isPageSizeSettings);

  const paper = PAPER_SIZES.find((entry) => entry.id === settings.paper) ?? PAPER_SIZES[0];

  const queue = useMemo<PlainQueueOptions<PageSizeSettings>>(
    () => ({
      key: "resize-pdf-pages",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const facts = [describePdf(document)];
        const resize: ResizeSettings = { paper: current.paper, orientation: current.orientation, enlarge: current.enlarge, margin: current.marginMm * POINTS_PER_MM };
        const { bytes, plan } = await resizePdfPages(document, resize, (index, count) => report(`Placing page ${index + 1} of ${count}...`, index / count));
        const unchanged = plan.pages.every((page, index) => {
          const size = document.getPage(index).getSize();
          return page.scale === 1 && Math.abs(size.width - page.width) < 0.5 && Math.abs(size.height - page.height) < 0.5;
        });
        if (unchanged) {
          return { facts, outputs: [], nothing: { message: `Every page is already ${paper.label} at this size.`, hint: "Nothing would change." } };
        }
        const notes: string[] = [];
        if (plan.scaledDown > 0) notes.push(`${plan.scaledDown} ${plan.scaledDown === 1 ? "page was" : "pages were"} scaled down to fit.`);
        if (plan.scaledUp > 0) notes.push(`${plan.scaledUp} ${plan.scaledUp === 1 ? "page was" : "pages were"} scaled up to fill the paper.`);
        const label = PAPER_SIZES.find((entry) => entry.id === current.paper)?.label ?? current.paper;
        return { facts, notes, outputs: [{ label: `${label} pages`, fileName: pdfName(file, `-${current.paper}`), blob: pdfBlob(bytes), kind: "pdf", note: `${plan.pages.length} ${plan.pages.length === 1 ? "page" : "pages"}` }] };
      },
    }),
    [settings, paper.label],
  );

  const toolSettings: PlainSettings = {
    title: "Paper",
    defaultOpen: true,
    summary: () => `${paper.label}, ${ORIENTATION_OPTIONS.find((option) => option.id === settings.orientation)?.label.toLowerCase()}, ${settings.marginMm} mm margin${settings.enlarge ? "" : ", never enlarged"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <RadioCards aria-label="Size" value={settings.paper} onValueChange={(next) => setSettings((previous) => ({ ...previous, paper: next as PaperSize }))} options={PAPER_SIZES.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Orientation</legend>
          <RadioCards aria-label="Orientation" value={settings.orientation} onValueChange={(next) => setSettings((previous) => ({ ...previous, orientation: next as Orientation }))} options={ORIENTATION_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Margin</legend>
          <RadioCards aria-label="Margin" value={String(settings.marginMm)} onValueChange={(value) => setSettings((previous) => ({ ...previous, marginMm: Number(value) }))} options={MARGIN_OPTIONS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Small pages</legend>
          <RadioCards
            aria-label="Small pages"
            value={settings.enlarge ? "fill" : "keep"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, enlarge: value === "fill" }))}
            options={[
              { value: "fill", label: "Scale up to fill", blurb: "An A5 page grows to fill A4" },
              { value: "keep", label: "Keep their size", blurb: "Centred on the paper with space around" },
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
      lead="Drop a PDF and get every page on A4, Letter, A5, A3, Legal or Tabloid paper, scaled to fit and centred, so a document of odd or mixed page sizes prints as one. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Resizing"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: `Put on ${paper.label} as they land - change it above` }}
      note="Each page is drawn whole onto a new sheet, keeping its proportions, so nothing is cropped or stretched: a page of another shape gets clear paper on two sides. A page stored with a turn is drawn the way its viewer shows it. Fonts, images and vector drawing carry over as they are; links, form fields and bookmarks do not, since the page is drawn rather than copied."
    />
  );
}
