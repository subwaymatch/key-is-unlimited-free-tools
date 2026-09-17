"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { countEdits, describePdf, loadPdfForMetadata, readMetadata, rewriteMetadata, type MetadataEdits } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import settingsStyles from "../Settings.module.css";
import styles from "./EditTagsApp.module.css";

const tool = requireTool("pdf-metadata");

interface MetadataSettings {
  action: "clear" | "edit" | "both";
  edits: MetadataEdits;
}

const EMPTY_EDITS: MetadataEdits = { title: "", author: "", subject: "", keywords: "" };

function isMetadataSettings(value: unknown): value is MetadataSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MetadataSettings>;
  return (candidate.action === "clear" || candidate.action === "edit" || candidate.action === "both") && typeof candidate.edits === "object" && candidate.edits !== null && Object.keys(EMPTY_EDITS).every((key) => typeof (candidate.edits as unknown as Record<string, unknown>)[key] === "string");
}

const FIELDS: { key: keyof MetadataEdits; label: string; placeholder: string }[] = [
  { key: "title", label: "Title", placeholder: "What the document is" },
  { key: "author", label: "Author", placeholder: "Who wrote it" },
  { key: "subject", label: "Subject", placeholder: "What it is about" },
  { key: "keywords", label: "Keywords", placeholder: "comma, separated" },
];

/** What a PDF says of itself, removed or rewritten. */
export function PdfMetadataApp() {
  const [settings, setSettings] = useState<MetadataSettings>({ action: "clear", edits: EMPTY_EDITS });
  useStoredSettings(storageKey("settings", "pdf-metadata"), settings, setSettings, isMetadataSettings);

  const edits = countEdits(settings.edits);
  const invalid = settings.action !== "clear" && edits === 0 ? "Fill in at least one field, or choose to remove everything." : null;

  const queue = useMemo<PlainQueueOptions<MetadataSettings>>(
    () => ({
      key: "pdf-metadata",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdfForMetadata(new Uint8Array(await file.arrayBuffer()));
        const before = readMetadata(document);
        const facts = [describePdf(document)];
        for (const [label, value] of [
          ["Title", before.title],
          ["Author", before.author],
          ["Subject", before.subject],
          ["Keywords", before.keywords],
          ["Made with", [before.creator, before.producer].filter(Boolean).join(" / ")],
          ["Created", before.created],
          ["Modified", before.modified],
          ["XMP metadata", before.hasXmp ? "present" : ""],
        ] as const) {
          if (value) facts.push(`${label}: ${value}`);
        }
        const clear = current.action !== "edit";
        report(clear ? "Clearing..." : "Writing...", null);
        const bytes = await rewriteMetadata(document, current.action === "clear" ? null : current.edits, clear);
        return {
          facts,
          outputs: [{ label: clear && current.action === "clear" ? "PDF without metadata" : "PDF with the metadata set", fileName: pdfName(file, clear ? "-clean" : "-retitled"), blob: pdfBlob(bytes), kind: "pdf" }],
          notes: facts.length === 1 ? ["This file carried no metadata worth listing; the copy is written all the same, with any hidden entries removed."] : [],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What to do",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () => (settings.action === "clear" ? "remove everything" : settings.action === "edit" ? `set ${edits} ${edits === 1 ? "field" : "fields"}, keep the rest` : `clear, then set ${edits} ${edits === 1 ? "field" : "fields"}`),
    render: () => (
      <>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Action</legend>
          <RadioCards
            aria-label="Action"
            value={settings.action}
            onValueChange={(action) => setSettings((previous) => ({ ...previous, action: action as MetadataSettings["action"] }))}
            options={[
              { value: "clear", label: "Remove everything", blurb: "Title, author, the software, the dates and the XMP block: gone" },
              { value: "edit", label: "Set these, keep the rest", blurb: "Only the fields filled in below change" },
              { value: "both", label: "Remove everything, then set these", blurb: "A clean slate with only what you type" },
            ]}
          />
        </fieldset>
        {settings.action !== "clear" && (
          <fieldset className={settingsStyles.fieldset}>
            <legend className={settingsStyles.legend}>Fields</legend>
            <div className={styles.grid}>
              {FIELDS.map((field) => (
                <label key={field.key} className={styles.field}>
                  <span className={settingsStyles.fieldLabel}>{field.label}</span>
                  <input type="text" value={settings.edits[field.key]} placeholder={field.placeholder} onChange={(event) => setSettings((previous) => ({ ...previous, edits: { ...previous.edits, [field.key]: event.target.value } }))} className={styles.input} />
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
      lead="Drop a PDF and see what it says about itself - the title, the author, the software that made it, when it was made and last changed - then save a copy with all of it removed, or with a title and author of your own. Every page is left exactly as it was. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Reading"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: invalid ? "Fill in a field above before adding a PDF" : "Read as they land; what each file carries is listed on its card" }}
      note="Removing everything empties the document's information dictionary and drops its XMP metadata stream, which is where an editor's name, a company and a document ID tend to hide. The pages themselves can still carry names in their text, in form fields or in annotations, which this does not read."
    />
  );
}
