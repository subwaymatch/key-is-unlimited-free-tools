"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { imposePdf, LAYOUT_OPTIONS, SHEET_OPTIONS, type ImposeLayout, type ImposeSettings, type SheetChoice } from "@/lib/pdf/impose";
import { describePdf, loadPdf } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("pdf-booklet");

function isImposeSettings(value: unknown): value is ImposeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ImposeSettings>;
  return LAYOUT_OPTIONS.some((option) => option.id === candidate.layout) && SHEET_OPTIONS.some((option) => option.id === candidate.sheet);
}

const SUFFIX: Record<ImposeLayout, string> = { "2up": "-2-per-sheet", "4up": "-4-per-sheet", booklet: "-booklet" };

/** Pages laid onto sheets. */
export function PdfBookletApp() {
  const [settings, setSettings] = useState<ImposeSettings>({ layout: "booklet", sheet: "double" });
  useStoredSettings(storageKey("settings", "pdf-booklet"), settings, setSettings, isImposeSettings);

  const queue = useMemo<PlainQueueOptions<ImposeSettings>>(
    () => ({
      key: "pdf-booklet",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const count = document.getPageCount();
        const facts = [describePdf(document)];
        const { bytes, plan } = await imposePdf(document, current, (index, total) => report(`Laying out sheet ${index + 1} of ${total}...`, index / total));
        const sheets = plan.sheets.length;
        const notes: string[] = [];
        if (current.layout === "booklet") {
          const paper = Math.ceil(sheets / 2);
          notes.push(`${sheets} ${sheets === 1 ? "side" : "sides"} on ${paper} ${paper === 1 ? "sheet" : "sheets"} of paper for ${count} ${count === 1 ? "page" : "pages"}${count % 4 === 0 ? "" : `, with ${4 * paper - count} blank ${4 * paper - count === 1 ? "face" : "faces"} to round it out`}. Print double-sided, flipping on the short edge, then fold the stack down the middle.`);
        } else {
          notes.push(`${sheets} ${sheets === 1 ? "sheet" : "sheets"} for ${count} ${count === 1 ? "page" : "pages"}.`);
        }
        if (plan.scaled) notes.push("Pages were scaled down to fit their cells.");
        return {
          facts,
          notes,
          outputs: [{ label: LAYOUT_OPTIONS.find((option) => option.id === current.layout)?.label ?? "Sheets", fileName: pdfName(file, SUFFIX[current.layout]), blob: pdfBlob(bytes), kind: "pdf", note: `${sheets} ${sheets === 1 ? "sheet" : "sheets"}, ${Math.round(plan.sheets[0].width)} x ${Math.round(plan.sheets[0].height)} pt` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Layout & sheet",
    defaultOpen: true,
    summary: () => `${LAYOUT_OPTIONS.find((option) => option.id === settings.layout)?.label.toLowerCase()}, ${SHEET_OPTIONS.find((option) => option.id === settings.sheet)?.label.toLowerCase()}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Layout</legend>
          <RadioCards aria-label="Layout" value={settings.layout} onValueChange={(layout) => setSettings((previous) => ({ ...previous, layout: layout as ImposeLayout }))} options={LAYOUT_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Sheet</legend>
          <RadioCards aria-label="Sheet" value={settings.sheet} onValueChange={(sheet) => setSettings((previous) => ({ ...previous, sheet: sheet as SheetChoice }))} options={SHEET_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get its pages laid two or four to a sheet, or paired the way a booklet needs so that double-sided sheets fold in half into a book, with the pages in the right order once folded. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Laying out"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Laid out as they land - choose how above" }}
      note="A booklet's page count is rounded up to a multiple of four with blank faces at the end, since each sheet of paper carries four. Print it double-sided with the flip on the short edge, then fold the whole stack once down the middle; a viewer shows the sheets, not the book, so the order looks scrambled until it is folded. Each page keeps its own turn and size, so a landscape page in a portrait document lands sideways, as it would in print."
    />
  );
}
