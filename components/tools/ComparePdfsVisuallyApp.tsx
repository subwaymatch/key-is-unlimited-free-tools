"use client";

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { useMemo, useState } from "react";

import { encodeCanvas } from "@/lib/images/canvas";
import { describeShare, DIFF_TOLERANCES, type DiffTolerance } from "@/lib/images/shape";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { PDF_ACCEPT, pdfBlob, rejectNonPdf } from "@/lib/pdf/files";
import { closePdf, openPdf, renderPagePixels } from "@/lib/pdf/render";
import { diffPages } from "@/lib/pdf/visualDiff";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("compare-pdfs-visually");

const DPI = 110;
const MAX_PAGES = 500;

interface VisualSettings {
  tolerance: DiffTolerance;
}

function isSettings(value: unknown): value is VisualSettings {
  return typeof value === "object" && value !== null && DIFF_TOLERANCES.some((option) => option.id === (value as Partial<VisualSettings>).tolerance);
}

async function png(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): Promise<Uint8Array> {
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  (canvas.getContext("2d") as CanvasRenderingContext2D).putImageData(new ImageData(pixels, width, height), 0, 0);
  return new Uint8Array(await (await encodeCanvas(canvas, "image/png")).arrayBuffer());
}

/** Two versions of a PDF compared as they look: every change on every page, marked in colour. */
export function ComparePdfsVisuallyApp() {
  const [settings, setSettings] = useState<VisualSettings>({ tolerance: "small" });
  useStoredSettings(storageKey("settings", "compare-pdfs-visually"), settings, setSettings, isSettings);

  const queue = useMemo<CombineOptions<VisualSettings>>(
    () => ({
      key: "compare-pdfs-visually",
      settings,
      reject: rejectNonPdf,
      run: async (files, current, report) => {
        if (files.length !== 2) throw new PlainError("Drop exactly two PDFs.", `There are ${files.length} in the list; remove the extra ones.`);
        const [a, b] = files;
        report("Opening...", null);
        const first = await openPdf(new Uint8Array(await a.arrayBuffer()));
        const second = await openPdf(new Uint8Array(await b.arrayBuffer()));
        try {
          const pages = Math.min(Math.max(first.numPages, second.numPages), MAX_PAGES);
          const tolerance = DIFF_TOLERANCES.find((option) => option.id === current.tolerance)?.value ?? 16;
          const report_ = await PDFDocument.create();
          const font = await report_.embedFont(StandardFonts.Helvetica);
          const changedPages: { page: number; share: string; added: number; removed: number }[] = [];
          const onlyIn: string[] = [];
          for (let index = 0; index < pages; index += 1) {
            report(`Comparing page ${index + 1} of ${pages}...`, index / pages);
            if (index >= first.numPages || index >= second.numPages) {
              onlyIn.push(`page ${index + 1} is only in ${index >= first.numPages ? b.name : a.name}`);
              continue;
            }
            const left = await renderPagePixels(first, index, DPI);
            const right = await renderPagePixels(second, index, DPI);
            const diff = diffPages(left, right, tolerance);
            if (diff.changed === 0) continue;
            changedPages.push({ page: index + 1, share: describeShare(diff.changed, diff.total), added: diff.added, removed: diff.removed });
            const image = await report_.embedPng(await png(diff.out, diff.width, diff.height));
            const pointWidth = (diff.width * 72) / DPI;
            const pointHeight = (diff.height * 72) / DPI;
            const out = report_.addPage([pointWidth, pointHeight + 28]);
            out.drawImage(image, { x: 0, y: 0, width: pointWidth, height: pointHeight });
            out.drawText(`Page ${index + 1}: red is only in ${a.name}, green only in ${b.name}`.slice(0, 110), { x: 10, y: pointHeight + 10, size: 9, font, color: rgb(0.25, 0.25, 0.3) });
          }
          const summary = `${first.numPages} ${first.numPages === 1 ? "page" : "pages"} against ${second.numPages}; ${changedPages.length === 0 ? "no page changed" : `changed: ${changedPages.length === 1 ? "page" : "pages"} ${changedPages.map((entry) => entry.page).join(", ")}`}.`;
          if (changedPages.length === 0 && onlyIn.length === 0) {
            return { outputs: [], nothing: { message: "The two PDFs look the same.", hint: `Every page was drawn at ${DPI} dpi and matches${tolerance > 0 ? ` to within ${tolerance} on every colour channel` : " exactly"}.` } };
          }
          const notes = [summary, ...changedPages.slice(0, 12).map((entry) => `Page ${entry.page}: ${entry.share} changed${entry.removed > 0 ? `, ink removed` : ""}${entry.added > 0 ? `${entry.removed > 0 ? " and" : ","} ink added` : ""}.`)];
          if (onlyIn.length > 0) notes.push(`${onlyIn.slice(0, 5).join("; ")}${onlyIn.length > 5 ? "..." : ""}.`);
          if (Math.max(first.numPages, second.numPages) > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} pages were compared.`);
          if (changedPages.length === 0) return { notes, outputs: [] };
          report("Writing the comparison...", null);
          const bytes = await report_.save();
          return {
            notes,
            outputs: [{ label: "Changes, page by page", fileName: `${fileStem(a.name, "a")}-vs-${fileStem(b.name, "b")}.pdf`, blob: pdfBlob(bytes), kind: "pdf", note: `${changedPages.length} changed ${changedPages.length === 1 ? "page" : "pages"}: red removed, green added, the rest faded` }],
          };
        } finally {
          await closePdf(first);
          await closePdf(second);
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What counts as a change",
    summary: () => DIFF_TOLERANCES.find((option) => option.id === settings.tolerance)?.label.toLowerCase() ?? settings.tolerance,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Tolerance</legend>
        <RadioCards aria-label="Tolerance" value={settings.tolerance} onValueChange={(tolerance) => setSettings({ tolerance: tolerance as DiffTolerance })} options={DIFF_TOLERANCES.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop two versions of a PDF - a contract before and after, a drawing revision, a proof and its reprint - and see every change as it looks on the page: what was removed in red, what was added in green, page by page. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Compare the two PDFs"
      minFiles={2}
      noun="PDFs"
      busyLabel="Comparing"
      summary={(files) => (files.length === 2 ? `${files[0].file.name} (before) against ${files[1].file.name} (after).` : files.length > 2 ? `${files.length} files: a comparison takes two. Remove the extra ones.` : null)}
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose two PDFs", headline: "Drop two PDFs here", subhead: "The first is the old version, the second the new" }}
      note="Each page of both files is drawn at 110 dpi and compared pixel by pixel, so changes in pictures, drawings, layout and signatures show as well as changes in the words; for the words alone, the text comparison tool gives a line-by-line diff. Pages are paired by number, so a page inserted near the start makes every page after it differ. Only pages that changed go into the comparison PDF."
    />
  );
}
