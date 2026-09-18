"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, loadPdf, rotatePages } from "@/lib/pdf/pages";
import { pageIndices, parsePageRanges, rangeSyntaxProblem } from "@/lib/pdf/ranges";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("rotate-pdf");

interface RotateSettings {
  degrees: 90 | 180 | 270;
  pages: "all" | "some";
  ranges: string;
}

const DEFAULT_SETTINGS: RotateSettings = { degrees: 90, pages: "all", ranges: "" };

function isRotateSettings(value: unknown): value is RotateSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RotateSettings>;
  return (candidate.degrees === 90 || candidate.degrees === 180 || candidate.degrees === 270) && (candidate.pages === "all" || candidate.pages === "some") && typeof candidate.ranges === "string";
}

const TURN_OPTIONS = [
  { value: "90", label: "Quarter turn clockwise", blurb: "The top goes to the right" },
  { value: "180", label: "Half turn", blurb: "Upside down, the right way up" },
  { value: "270", label: "Quarter turn anticlockwise", blurb: "The top goes to the left" },
];

const PAGE_OPTIONS = [
  { value: "all", label: "Every page", blurb: "The whole document turned" },
  { value: "some", label: "The pages I name", blurb: "2, 5-7: only those, the rest as they were" },
];

function describeTurn(degrees: number): string {
  return degrees === 90 ? "a quarter turn clockwise" : degrees === 180 ? "a half turn" : "a quarter turn anticlockwise";
}

/** Pages turned. */
export function RotatePdfApp() {
  const [settings, setSettings] = useState<RotateSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "rotate-pdf"), settings, setSettings, isRotateSettings);

  const rangesInvalid = settings.pages === "some" && settings.ranges.trim() === "";
  const rangesUnreadable = settings.pages === "some" ? rangeSyntaxProblem(settings.ranges) : null;

  const queue = useMemo<PlainQueueOptions<RotateSettings>>(
    () => ({
      key: "rotate-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const facts = [describePdf(document)];
        const notes: string[] = [];
        let indices: number[] | null = null;
        if (current.pages === "some") {
          const parsed = parsePageRanges(current.ranges, document.getPageCount());
          if (parsed.ranges.length === 0) throw new PlainError("No pages could be read from the list.", parsed.problems.join(" ") || "Type pages such as 2, 5-7 in the panel.");
          notes.push(...parsed.problems);
          indices = pageIndices(parsed.ranges);
        }
        report("Turning...", null);
        const bytes = await rotatePages(document, current.degrees, indices);
        const turned = indices ? indices.length : document.getPageCount();
        return {
          facts,
          notes,
          outputs: [{ label: "Rotated PDF", fileName: pdfName(file, "-rotated"), blob: pdfBlob(bytes), kind: "pdf", note: `${turned} ${turned === 1 ? "page" : "pages"} given ${describeTurn(current.degrees)}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Turn & pages",
    defaultOpen: true,
    invalid: () => (rangesInvalid ? "Name at least one page before adding a PDF." : rangesUnreadable),
    summary: () => `${describeTurn(settings.degrees)}, ${settings.pages === "all" ? "every page" : settings.ranges.trim() || "no pages yet"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Turn</legend>
          <RadioCards aria-label="Turn" value={String(settings.degrees)} onValueChange={(value) => setSettings((previous) => ({ ...previous, degrees: Number(value) as 90 | 180 | 270 }))} options={TURN_OPTIONS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Pages</legend>
          <RadioCards aria-label="Pages" value={settings.pages} onValueChange={(pages) => setSettings((previous) => ({ ...previous, pages: pages as "all" | "some" }))} options={PAGE_OPTIONS} columns={2} />
          {settings.pages === "some" && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Pages to turn</span>
                <input type="text" value={settings.ranges} placeholder="2, 5-7" aria-invalid={rangesInvalid || rangesUnreadable !== null} onChange={(event) => setSettings((previous) => ({ ...previous, ranges: event.target.value }))} className={styles.input} style={{ width: "20rem" }} />
              </label>
            </div>
          )}
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF whose pages came out sideways or upside down and get it back the right way up: every page, or only the ones you name, turned a quarter or a half. The turn is written into the page, so every viewer honours it. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Turning"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: `Every page turned ${describeTurn(settings.degrees)} as they land - change it below` }}
      note="The rotation is set on the page rather than the content re-drawn, which is how PDF means it to be done: the file barely changes size and nothing is lost. A turn is added to whatever the page already had, so a page stored on its side and turned back reads as upright."
    />
  );
}
