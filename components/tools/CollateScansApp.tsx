"use client";

import { useMemo, useState } from "react";

import { fileStem } from "@/lib/mediaTypes";
import { collatePdfs } from "@/lib/pdf/collate";
import { inspectPdf, PDF_ACCEPT, pdfBlob, rejectNonPdf } from "@/lib/pdf/files";
import { loadPdf } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("collate-scans");

interface CollateSettings {
  backsReversed: boolean;
}

function isCollateSettings(value: unknown): value is CollateSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<CollateSettings>).backsReversed === "boolean";
}

/** Fronts and backs from two passes through a single-sided scanner, as one document. */
export function CollateScansApp() {
  const [settings, setSettings] = useState<CollateSettings>({ backsReversed: true });
  useStoredSettings(storageKey("settings", "collate-scans"), settings, setSettings, isCollateSettings);

  const queue = useMemo<CombineOptions<CollateSettings>>(
    () => ({
      key: "collate-scans",
      settings,
      reject: rejectNonPdf,
      inspect: inspectPdf,
      run: async (files, current, report) => {
        if (files.length !== 2) throw new PlainError("Drop exactly two PDFs.", `There are ${files.length} in the list: the fronts first, then the backs.`);
        const [frontFile, backFile] = files;
        report("Opening...", null);
        const front = await loadPdf(new Uint8Array(await frontFile.arrayBuffer()));
        const back = await loadPdf(new Uint8Array(await backFile.arrayBuffer()));
        const { bytes, order } = await collatePdfs(front, back, current.backsReversed, (done, count) => report(`Collating page ${done + 1} of ${count}...`, done / count));
        const count = order.order.length;
        return {
          notes: order.note ? [order.note] : [],
          outputs: [{ label: "Collated", fileName: `${fileStem(frontFile.name, "scan")}-collated.pdf`, blob: pdfBlob(bytes), kind: "pdf", note: `${count} ${count === 1 ? "page" : "pages"}: ${frontFile.name} and ${backFile.name}, ${current.backsReversed ? "backs read from the end" : "backs read in order"}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "The second file",
    defaultOpen: true,
    summary: () => (settings.backsReversed ? "backs in reverse, as a flipped stack comes out" : "backs in order"),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>The backs came out</legend>
        <RadioCards
          aria-label="The backs came out"
          value={settings.backsReversed ? "reversed" : "forward"}
          onValueChange={(value) => setSettings({ backsReversed: value === "reversed" })}
          options={[
            { value: "reversed", label: "Last page first", blurb: "The stack was turned over and fed again, so the backs are in reverse: the usual case" },
            { value: "forward", label: "In order", blurb: "The backs were scanned first page first" },
          ]}
          columns={2}
        />
      </fieldset>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="A single-sided scanner scans a double-sided stack as two files: the fronts, then the stack turned over for the backs, last page first. Drop the two here, fronts first, and get one PDF with the pages in reading order: front 1, back 1, front 2, back 2, and so on. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Collate the two files"
      minFiles={2}
      noun="PDFs"
      busyLabel="Collating"
      summary={(files) => (files.length === 2 ? `Fronts from ${files[0].file.name}, backs from ${files[1].file.name}.` : files.length > 2 ? `${files.length} files: collating takes two. Remove the extra ones.` : null)}
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose two PDFs", headline: "Drop two PDFs here", subhead: "The fronts first, then the backs" }}
      note="Page one of the first file is followed by the last page of the second, page two by the second to last, and so on, which is the order a stack turned over and fed again produces; a stack whose backs were scanned in order is collated straight. The two files should have the same number of pages; when they do not, the extra pages of the longer one go at the end and the card says so. Pages are copied as they are, nothing redrawn."
    />
  );
}
