"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePdf, loadPdf } from "@/lib/pdf/pages";
import { SIZE_LIMITS, splitPdfBySize } from "@/lib/pdf/sizeSplit";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("split-pdf-by-size");

const CUSTOM = "custom";

/** More pieces than this is a document that wants a different tool. */
const MAX_PIECES = 200;

interface SizeSettings {
  maxBytes: number;
  customMb: string;
}

function isSizeSettings(value: unknown): value is SizeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SizeSettings>;
  return typeof candidate.maxBytes === "number" && candidate.maxBytes > 0 && typeof candidate.customMb === "string";
}

function choiceFor(settings: SizeSettings): string {
  return SIZE_LIMITS.some((option) => option.bytes === settings.maxBytes) ? String(settings.maxBytes) : CUSTOM;
}

function bytesOfMb(text: string): number {
  return Math.max(1, Math.round(Number(text) * 1024 * 1024)) || 1;
}

/** A PDF in pieces that each fit under a size. */
export function SplitPdfBySizeApp() {
  const [settings, setSettings] = useState<SizeSettings>({ maxBytes: SIZE_LIMITS[2].bytes, customMb: "15" });
  useStoredSettings(storageKey("settings", "split-pdf-by-size"), settings, setSettings, isSizeSettings);

  const choice = choiceFor(settings);
  const customInvalid = choice === CUSTOM && !(Number(settings.customMb) > 0);

  const queue = useMemo<PlainQueueOptions<SizeSettings>>(
    () => ({
      key: "split-pdf-by-size",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report, signal) => {
        report("Opening...", null);
        const source = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const facts = [describePdf(source)];
        if (file.size <= current.maxBytes) {
          return { facts, outputs: [], nothing: { message: `This PDF is already under ${formatBytes(current.maxBytes)}.`, hint: `It is ${formatBytes(file.size)}; one piece would be the whole file.` } };
        }
        if (source.getPageCount() === 1) {
          throw new PlainError("This PDF is one page, and that page is over the limit.", "A page cannot be split. Compress PDF can make its pictures smaller.");
        }
        const pieces = await splitPdfBySize(source, current.maxBytes, (done, count) => report(`Measuring from page ${done + 1} of ${count}...`, done / count), signal);
        if (pieces.length > MAX_PIECES) throw new PlainError(`That would be ${pieces.length} pieces.`, `This makes up to ${MAX_PIECES}; choose a larger size.`);
        const over = pieces.filter((piece) => piece.over);
        const width = String(pieces.length).length;
        return {
          facts: [...facts, `${pieces.length} pieces under ${formatBytes(current.maxBytes)}`],
          notes: over.length > 0 ? [`${over.length} ${over.length === 1 ? "page is" : "pages are"} over the limit on ${over.length === 1 ? "its" : "their"} own and ${over.length === 1 ? "comes" : "come"} out as a piece each anyway: ${over.map((piece) => `page ${piece.first + 1}`).join(", ")}. Compress PDF can shrink them.`] : [],
          outputs: pieces.map((piece, index) => ({
            label: `Piece ${index + 1} of ${pieces.length}`,
            fileName: pdfName(file, `-part-${String(index + 1).padStart(width, "0")}`),
            blob: pdfBlob(piece.bytes),
            kind: "pdf" as const,
            note: piece.first === piece.last ? `page ${piece.first + 1}${piece.over ? ", over the limit on its own" : ""}` : `pages ${piece.first + 1} to ${piece.last + 1}`,
          })),
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Size limit",
    defaultOpen: true,
    invalid: () => (customInvalid ? "Type a number of megabytes above zero." : null),
    summary: () => formatBytes(settings.maxBytes),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Each piece under</legend>
        <RadioCards
          aria-label="Each piece under"
          value={choice}
          onValueChange={(value) => setSettings((previous) => (value === CUSTOM ? { ...previous, maxBytes: bytesOfMb(previous.customMb) } : { ...previous, maxBytes: Number(value) }))}
          options={[...SIZE_LIMITS.map((option) => ({ value: String(option.bytes), label: option.label, blurb: option.blurb })), { value: CUSTOM, label: "Custom", blurb: "Any number of megabytes" }]}
        />
        {choice === CUSTOM && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Megabytes</span>
              <input type="number" inputMode="decimal" min={0.1} step="0.5" value={settings.customMb} aria-invalid={customInvalid} onChange={(event) => setSettings((previous) => ({ ...previous, customMb: event.target.value, maxBytes: bytesOfMb(event.target.value) }))} className={styles.input} />
            </label>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF too large to attach and get it back as several PDFs that each fit under the limit - 10 MB, 25 MB or a number you type - each a run of whole pages in order, each one a document that opens on its own. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Measuring"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: `Cut into pieces under ${formatBytes(settings.maxBytes)} as they land - change it above` }}
      note="How large a run of pages will be is only known by writing it: a font or a picture shared by many pages is written once per piece, so the pieces are not simply the file's size divided up. Each piece is the longest run from where the last one ended that saves under the limit, found by writing a few candidates. A single page larger than the limit cannot be split and comes out as a piece of its own, and the card says so."
    />
  );
}
