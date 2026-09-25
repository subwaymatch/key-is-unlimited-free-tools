"use client";

import { useMemo } from "react";

import { fileStem } from "@/lib/mediaTypes";
import { describeValues, fieldListCsv, formCsv, formJson, formTable, noFormError, readFormValues, type FieldValue } from "@/lib/pdf/formData";
import { PDF_ACCEPT, rejectNonPdf } from "@/lib/pdf/files";
import { loadPdf } from "@/lib/pdf/pages";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";

const tool = requireTool("pdf-form-data");

async function valuesOf(file: File) {
  return readFormValues(await loadPdf(new Uint8Array(await file.arrayBuffer())));
}

/** What was typed into one filled PDF form, or fifty, as a spreadsheet. */
export function PdfFormDataApp() {
  const queue = useMemo<CombineOptions<Record<string, never>>>(
    () => ({
      key: "pdf-form-data",
      settings: {},
      reject: rejectNonPdf,
      inspect: async (file) => ({ facts: [describeValues(await valuesOf(file))] }),
      run: async (files, _settings, report, signal) => {
        const documents: { file: string; fields: FieldValue[] }[] = [];
        const empty: string[] = [];
        for (const [index, file] of files.entries()) {
          if (signal.aborted) throw new PlainError("Cancelled.");
          report(`Reading ${file.name}...`, index / files.length);
          const values = await valuesOf(file);
          if (values.source === "none") empty.push(file.name);
          else documents.push({ file: file.name, fields: values.fields });
        }
        if (documents.length === 0) throw files.length === 1 ? noFormError(files[0].name) : new PlainError("None of these PDFs has form fields.", "Their text may look like a form, but nothing in them is a field that holds a value. A scanned form is a picture.");
        const table = formTable(documents);
        const stem = documents.length === 1 ? fileStem(documents[0].file, "form") : "form-data";
        const notes = empty.length > 0 ? [`Left out, having no form fields: ${empty.join(", ")}.`] : [];
        if (documents.some((document) => document.fields.some((field) => field.kind === "xfa"))) notes.push("An XFA form's values are read from the data packet inside it, and each is named by its place in the form, such as form1.page1.name.");
        const csv = documents.length === 1 ? fieldListCsv(documents[0].fields) : formCsv(table);
        return {
          notes,
          outputs: [
            { label: documents.length === 1 ? "Fields and values (CSV)" : "One row per form (CSV)", fileName: `${stem}.csv`, blob: new Blob([csv], { type: "text/csv;charset=utf-8" }), kind: "file", note: documents.length === 1 ? `${documents[0].fields.length} fields, one to a row` : `${documents.length} forms, ${table.columns.length - 1} fields` },
            { label: "JSON", fileName: `${stem}.json`, blob: new Blob([formJson(table)], { type: "application/json" }), kind: "file", note: `${documents.length === 1 ? "One record" : `${documents.length} records`}, keyed by field name` },
          ],
        };
      },
    }),
    [],
  );

  return (
    <CombineApp
      tool={tool}
      lead="Drop a filled PDF form, or a folder of them, and get what was typed in as a spreadsheet: one row per form and one column per field, for a pile of applications, registrations or surveys that arrived as PDFs. Nothing is uploaded."
      queue={queue}
      action="Extract the form data"
      minFiles={1}
      noun="PDFs"
      busyLabel="Reading"
      summary={(files) => (files.length > 1 ? `${files.length} forms: a row each, in the order above.` : files.length === 1 ? "One form: a row per field." : null)}
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose filled PDF forms", headline: "Drop filled PDF forms here", subhead: "Add as many as you have, then extract them in one table" }}
      note="Text fields come out as typed, check boxes as Yes or No, radio buttons and lists as the choice made, and a signature field as signed or empty. Columns follow the fields in the order they are first met, so forms of the same kind line up and a field only some forms have gets its own column. XFA forms made with Adobe LiveCycle are read from their data. A scanned form has no fields to read."
    />
  );
}
