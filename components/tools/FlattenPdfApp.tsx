"use client";

import { useMemo, useState } from "react";

import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describeForm, describePdf, flattenPdf, loadPdf, type FlattenSettings } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("flatten-pdf");

type FlattenChoice = "fields" | "annotations";

function isFlattenSettings(value: unknown): value is FlattenSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FlattenSettings>;
  return typeof candidate.fields === "boolean" && typeof candidate.annotations === "boolean";
}

const CHOICES: { value: FlattenChoice; label: string; blurb: string }[] = [
  { value: "fields", label: "Flatten the form fields", blurb: "What was typed and ticked is drawn into the page, and the fields are gone: nobody can edit them" },
  { value: "annotations", label: "Remove annotations", blurb: "Comments, highlights, stamps, links and any fields left over come off the pages" },
];

/** A form made into a plain document. */
export function FlattenPdfApp() {
  const [settings, setSettings] = useState<FlattenSettings>({ fields: true, annotations: false });
  useStoredSettings(storageKey("settings", "flatten-pdf"), settings, setSettings, isFlattenSettings);

  const chosen: FlattenChoice[] = [...(settings.fields ? ["fields" as const] : []), ...(settings.annotations ? ["annotations" as const] : [])];

  const queue = useMemo<PlainQueueOptions<FlattenSettings>>(
    () => ({
      key: "flatten-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        const summary = await describeForm(document);
        const kinds = summary.kinds.map((entry) => `${entry.count} ${entry.kind}${entry.count === 1 ? "" : entry.kind.endsWith("x") ? "es" : "s"}`).join(", ");
        const facts = [describePdf(document), `Form fields: ${summary.fields === 0 ? "none" : kinds}`, `Annotations: ${summary.annotations === 0 ? "none" : summary.annotations}`];
        const fieldsToDo = current.fields && summary.fields > 0;
        const annotationsToDo = current.annotations && summary.annotations > 0;
        if (!fieldsToDo && !annotationsToDo) {
          return {
            facts,
            outputs: [],
            nothing: {
              message: current.fields && !current.annotations ? "This PDF has no form fields to flatten." : "This PDF has nothing to flatten or remove.",
              hint: summary.annotations > 0 && !current.annotations ? `It carries ${summary.annotations} annotations; tick "Remove annotations" to take those off.` : "It is already a plain document.",
            },
          };
        }
        report(fieldsToDo ? "Drawing the fields into the pages..." : "Removing annotations...", null);
        const bytes = await flattenPdf(document, { fields: current.fields, annotations: current.annotations });
        const notes: string[] = [];
        if (fieldsToDo) notes.push(`${summary.fields} ${summary.fields === 1 ? "field" : "fields"} drawn into the pages and removed.`);
        if (annotationsToDo) notes.push(`${summary.annotations} ${summary.annotations === 1 ? "annotation" : "annotations"} removed.`);
        return { facts, notes, outputs: [{ label: "Flattened PDF", fileName: pdfName(file, "-flattened"), blob: pdfBlob(bytes), kind: "pdf" }] };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What to flatten",
    defaultOpen: true,
    invalid: () => (chosen.length === 0 ? "Tick at least one of the two before adding a PDF." : null),
    summary: () => chosen.map((choice) => (choice === "fields" ? "form fields" : "annotations")).join(" and ") || "nothing chosen",
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Flatten</legend>
        <CheckboxCards aria-label="Flatten" value={chosen} onValueChange={(next) => setSettings({ fields: next.includes("fields"), annotations: next.includes("annotations") })} options={CHOICES} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a filled-in form and get it back as a plain PDF: what was typed and ticked is drawn into the pages so it shows the same in every viewer and cannot be edited, and comments, highlights and stamps can come off too. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Flattening"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Flattened as they land" }}
      note="Flattening draws each field's current appearance into its page and removes the field, which is what a viewer's own flatten does; a field that was never given an appearance is drawn in Helvetica. Removing annotations takes off everything that sits on top of a page - links included - and leaves the page itself as it was. A signed document loses its signature either way, since the signature is a field."
    />
  );
}
