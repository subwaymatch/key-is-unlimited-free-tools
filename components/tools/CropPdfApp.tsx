"use client";

import { useMemo, useState } from "react";

import { pagePixels } from "@/lib/pdf/extract";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { cropPdfPages, insetsFromBounds, POINTS_PER_MM, type Insets } from "@/lib/pdf/pageBoxes";
import { describePdf, loadPdf } from "@/lib/pdf/pages";
import { contentBounds } from "@/lib/pdf/pixels";
import { closePdf, openPdf } from "@/lib/pdf/render";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("crop-pdf");

type CropMode = "content" | "margins";

interface CropSettings {
  mode: CropMode;
  /** Millimetres, as typed. */
  top: string;
  right: string;
  bottom: string;
  left: string;
  /** Millimetres kept around the content when trimming to it. */
  keepMm: number;
}

const DEFAULT_SETTINGS: CropSettings = { mode: "content", top: "10", right: "10", bottom: "10", left: "10", keepMm: 3 };

/** The resolution the pages are drawn at to find their content: coarse is plenty for a bounding box. */
const MEASURE_DPI = 36;

function isCropSettings(value: unknown): value is CropSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CropSettings>;
  return (candidate.mode === "content" || candidate.mode === "margins") && ["top", "right", "bottom", "left"].every((side) => typeof candidate[side as keyof CropSettings] === "string") && typeof candidate.keepMm === "number";
}

/** A typed margin in millimetres, or null when it is not a number at or above zero. */
function readMm(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 1000 ? value : null;
}

const KEEP_OPTIONS = [
  { value: "0", label: "Nothing", blurb: "Tight to the ink" },
  { value: "3", label: "3 mm", blurb: "A hair of white" },
  { value: "8", label: "8 mm", blurb: "A small margin" },
];

/** Margins taken off every page, by measurement or down to the content. */
export function CropPdfApp() {
  const [settings, setSettings] = useState<CropSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "crop-pdf"), settings, setSettings, isCropSettings);

  const margins = { top: readMm(settings.top), right: readMm(settings.right), bottom: readMm(settings.bottom), left: readMm(settings.left) };
  const marginsInvalid = settings.mode === "margins" && Object.values(margins).some((value) => value === null);
  const marginsZero = settings.mode === "margins" && !marginsInvalid && Object.values(margins).every((value) => value === 0);

  const queue = useMemo<PlainQueueOptions<CropSettings>>(
    () => ({
      key: "crop-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report, signal) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const document = await loadPdf(bytes);
        const count = document.getPageCount();
        const facts = [describePdf(document)];
        let insetsFor: (index: number) => Insets | null;
        const notes: string[] = [];
        if (current.mode === "margins") {
          const mm = { top: readMm(current.top) ?? 0, right: readMm(current.right) ?? 0, bottom: readMm(current.bottom) ?? 0, left: readMm(current.left) ?? 0 };
          const insets: Insets = { top: mm.top * POINTS_PER_MM, right: mm.right * POINTS_PER_MM, bottom: mm.bottom * POINTS_PER_MM, left: mm.left * POINTS_PER_MM };
          insetsFor = () => insets;
          notes.push(`${mm.top} mm off the top, ${mm.right} mm off the right, ${mm.bottom} mm off the bottom and ${mm.left} mm off the left of every page.`);
        } else {
          // PDF.js hands its bytes to a worker, which detaches the buffer; pdf-lib still needs the original to save.
          const rendered = await openPdf(bytes.slice());
          const perPage: (Insets | null)[] = [];
          let blank = 0;
          try {
            for (let index = 0; index < count; index += 1) {
              if (signal.aborted) break;
              report(`Measuring page ${index + 1} of ${count}...`, index / count);
              const pixels = await pagePixels(rendered, index, MEASURE_DPI);
              const bounds = contentBounds(pixels.data, pixels.width, pixels.height);
              if (!bounds) {
                blank += 1;
                perPage.push(null);
                continue;
              }
              perPage.push(insetsFromBounds(bounds, pixels, current.keepMm * POINTS_PER_MM));
            }
          } finally {
            await closePdf(rendered);
          }
          insetsFor = (index) => perPage[index] ?? null;
          if (blank > 0) notes.push(`${blank} blank ${blank === 1 ? "page was" : "pages were"} left as ${blank === 1 ? "it is" : "they are"}.`);
          const trimmed = perPage.filter((entry) => entry && Object.values(entry).some((value) => value > 1)).length;
          if (trimmed === 0) {
            return { facts, notes, outputs: [], nothing: { message: "There is no margin to trim on these pages.", hint: "The content already runs to the edges, or the pages are blank." } };
          }
          notes.push(`Each page trimmed to its own content, keeping ${current.keepMm} mm around it.`);
        }
        report("Writing...", null);
        const { bytes: out } = await cropPdfPages(document, insetsFor);
        return { facts, notes, outputs: [{ label: "Cropped PDF", fileName: pdfName(file, "-cropped"), blob: pdfBlob(out), kind: "pdf" }] };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "How to crop",
    defaultOpen: true,
    invalid: () => (marginsInvalid ? "Each margin needs a number of millimetres, 0 or more." : marginsZero ? "Every margin is 0, so nothing would be cropped." : null),
    summary: () => (settings.mode === "content" ? `to the content, keeping ${settings.keepMm} mm` : `${settings.top}/${settings.right}/${settings.bottom}/${settings.left} mm off top/right/bottom/left`),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Crop</legend>
          <RadioCards
            aria-label="Crop"
            value={settings.mode}
            onValueChange={(mode) => setSettings((previous) => ({ ...previous, mode: mode as CropMode }))}
            options={[
              { value: "content", label: "To the content", blurb: "Each page measured and its white margins trimmed away: for reading on a small screen" },
              { value: "margins", label: "By a measurement", blurb: "The same millimetres off each edge of every page" },
            ]}
            columns={2}
          />
        </fieldset>
        {settings.mode === "content" ? (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Keep around the content</legend>
            <RadioCards aria-label="Keep around the content" value={String(settings.keepMm)} onValueChange={(value) => setSettings((previous) => ({ ...previous, keepMm: Number(value) }))} options={KEEP_OPTIONS} />
          </fieldset>
        ) : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Millimetres off each edge, as the page is shown</legend>
            <div className={styles.fileRow}>
              {(["top", "right", "bottom", "left"] as const).map((side) => (
                <label key={side}>
                  <span className={styles.fieldLabel}>{side[0].toUpperCase() + side.slice(1)}</span>
                  <input type="number" inputMode="decimal" min={0} max={1000} step="0.5" value={settings[side]} aria-invalid={margins[side] === null} onChange={(event) => setSettings((previous) => ({ ...previous, [side]: event.target.value }))} className={styles.input} style={{ width: "5.5rem" }} />
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get its margins cropped away: trimmed to the content of each page, for reading a paper on a phone or an e-reader, or by the millimetres you type off each edge. Nothing is redrawn, and nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Cropping"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Cropped as they land - choose how above" }}
      note="Cropping sets each page's boxes, which is what a viewer's own crop does: the page shows the part inside and the rest is still in the file, so this hides a margin rather than redacting anything. Trimming to the content draws each page small and finds where the ink stops, so a scan's faint grey background is ignored but a page border or a header line counts as content. Every viewer honours the crop; a few printers print the whole media box, and the tool sets that too."
    />
  );
}
