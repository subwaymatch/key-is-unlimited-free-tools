"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { addPageNumbers, DEFAULT_PAGE_NUMBER_SETTINGS, describePdf, loadPdf, pageNumberText, type NumberPosition, type PageNumberSettings } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import { Select } from "../ui/Select";
import styles from "../Settings.module.css";

const tool = requireTool("add-page-numbers");

function isNumberSettings(value: unknown): value is PageNumberSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PageNumberSettings>;
  return typeof candidate.position === "string" && typeof candidate.ofTotal === "boolean" && typeof candidate.fontSize === "number" && typeof candidate.startAt === "number";
}

const POSITION_OPTIONS: { value: NumberPosition; label: string }[] = [
  { value: "bottom-center", label: "Bottom, centred" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-center", label: "Top, centred" },
  { value: "top-right", label: "Top right" },
];

const FORMAT_OPTIONS = [
  { value: "plain", label: "3", blurb: "The number alone" },
  { value: "of", label: "3 of 12", blurb: "With the count, so a reader knows how far there is to go" },
];

const SIZE_OPTIONS = [9, 10, 11, 12, 14, 16].map((size) => ({ value: size, label: `${size} pt` }));

/** Every page numbered. */
export function AddPageNumbersApp() {
  const [settings, setSettings] = useState<PageNumberSettings>(DEFAULT_PAGE_NUMBER_SETTINGS);
  useStoredSettings(storageKey("settings", "add-page-numbers"), settings, setSettings, isNumberSettings);

  const startInvalid = !Number.isInteger(settings.startAt) || settings.startAt < 0;

  const queue = useMemo<PlainQueueOptions<PageNumberSettings>>(
    () => ({
      key: "add-page-numbers",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const facts = [describePdf(document)];
        report("Numbering...", null);
        const bytes = await addPageNumbers(document, current);
        const count = document.getPageCount();
        return {
          facts,
          outputs: [{ label: "Numbered PDF", fileName: pdfName(file, "-numbered"), blob: pdfBlob(bytes), kind: "pdf", note: `"${pageNumberText(0, count, current)}" to "${pageNumberText(count - 1, count, current)}", ${current.position.replace("-", " ")}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Where & how",
    defaultOpen: true,
    invalid: () => (startInvalid ? "The first number has to be a whole number." : null),
    summary: () => `${settings.position.replace("-", " ")}, ${settings.ofTotal ? "N of M" : "N"}, from ${settings.startAt}, ${settings.fontSize} pt`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Position</legend>
          <RadioCards aria-label="Position" value={settings.position} onValueChange={(position) => setSettings((previous) => ({ ...previous, position }))} options={POSITION_OPTIONS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards aria-label="Format" value={settings.ofTotal ? "of" : "plain"} onValueChange={(value) => setSettings((previous) => ({ ...previous, ofTotal: value === "of" }))} options={FORMAT_OPTIONS} columns={2} />
          <div className={styles.panel} style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            <label>
              <span className={styles.fieldLabel}>First number</span>
              <input type="number" inputMode="numeric" min={0} step="1" value={settings.startAt} aria-invalid={startInvalid} onChange={(event) => setSettings((previous) => ({ ...previous, startAt: Number(event.target.value) }))} className={styles.input} />
            </label>
            <label>
              <span className={styles.fieldLabel}>Size</span>
              <Select aria-label="Size" value={settings.fontSize} options={SIZE_OPTIONS} onValueChange={(fontSize) => setSettings((previous) => ({ ...previous, fontSize }))} />
            </label>
          </div>
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get it back with a number on every page: at the bottom or the top, centred or to a side, as a plain number or as N of M, starting from any number you like. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Numbering"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Numbered as they land - choose where below" }}
      note="Numbers are set in Helvetica, one of the fonts every PDF viewer carries, so nothing is embedded and the file barely grows. They are drawn over the page, so a page that already has a number in that corner gets a second one; choose another position for those."
    />
  );
}
