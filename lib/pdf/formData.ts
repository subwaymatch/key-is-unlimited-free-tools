/**
 * What was typed into a PDF form, read out as a table.
 *
 * An ordinary form - AcroForm - keeps each field's value in the field, and
 * pdf-lib reads them. An XFA form, the kind Adobe LiveCycle made and many
 * government forms still are, keeps its data as an XML packet called
 * "datasets" inside the file, and a dynamic one has no AcroForm fields at
 * all; for those the packet is read and every leaf element becomes a field
 * named by its path.
 */
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

import { csvLine } from "../data/csv";
import { PlainError } from "../plainQueue";
import { childElements, parseXml, textContent, type XmlElement } from "../text/xml";

export interface FieldValue {
  name: string;
  /** "text", "check box", "radio", "choice", "signature", "xfa". */
  kind: string;
  value: string;
}

export interface FormValues {
  fields: FieldValue[];
  /** Where the values came from. */
  source: "acroform" | "xfa" | "none";
}

/** The leaf values of an XFA datasets packet, as dotted paths below the data element. */
export function xfaFields(xml: string): FieldValue[] {
  let root: XmlElement;
  try {
    root = parseXml(xml).root;
  } catch {
    return [];
  }
  const find = (element: XmlElement): XmlElement | null => {
    if (element.name.endsWith("data") && element.name !== "dataGroup") return element;
    for (const entry of childElements(element)) {
      const found = find(entry);
      if (found) return found;
    }
    return null;
  };
  const data = find(root) ?? root;
  const fields: FieldValue[] = [];
  const counts = new Map<string, number>();
  const walk = (element: XmlElement, path: string) => {
    const kids = childElements(element);
    if (kids.length === 0) {
      const seen = counts.get(path) ?? 0;
      counts.set(path, seen + 1);
      fields.push({ name: seen === 0 ? path : `${path}[${seen}]`, kind: "xfa", value: textContent(element).trim() });
      return;
    }
    for (const entry of kids) walk(entry, path ? `${path}.${entry.name}` : entry.name);
  };
  for (const entry of childElements(data)) walk(entry, entry.name);
  return fields;
}

/** The datasets packet of an XFA form, or null when there is none. */
async function xfaDatasets(document: PDFDocumentType): Promise<string | null> {
  const pdf = await import("pdf-lib");
  const acroForm = document.catalog.lookup(pdf.PDFName.of("AcroForm"));
  if (!(acroForm instanceof pdf.PDFDict)) return null;
  const xfa = acroForm.lookup(pdf.PDFName.of("XFA"));
  const streams: { name: string; stream: unknown }[] = [];
  if (xfa instanceof pdf.PDFArray) {
    for (let index = 0; index + 1 < xfa.size(); index += 2) {
      const name = xfa.lookup(index);
      streams.push({ name: name instanceof pdf.PDFString || name instanceof pdf.PDFHexString ? name.decodeText() : "", stream: xfa.lookup(index + 1) });
    }
  } else if (xfa) streams.push({ name: "", stream: xfa });
  const decode = (stream: unknown) => (stream instanceof pdf.PDFRawStream ? new TextDecoder().decode(pdf.decodePDFRawStream(stream).decode()) : "");
  const named = streams.find((entry) => entry.name === "datasets");
  if (named) return decode(named.stream);
  // A single stream holds the whole XDP; the datasets packet is inside it.
  for (const entry of streams) {
    const text = decode(entry.stream);
    const start = text.indexOf("<xfa:datasets");
    const end = text.indexOf("</xfa:datasets>");
    if (start >= 0 && end > start) return text.slice(start, end + "</xfa:datasets>".length);
  }
  return null;
}

/** Every field of a form and what it holds, the check boxes as Yes and No. */
export async function readFormValues(document: PDFDocumentType): Promise<FormValues> {
  const pdf = await import("pdf-lib");
  const fields: FieldValue[] = [];
  let formFields: ReturnType<ReturnType<PDFDocumentType["getForm"]>["getFields"]> = [];
  try {
    formFields = document.getForm().getFields();
  } catch {
    // A form dictionary pdf-lib cannot read; the XFA packet may still be there.
  }
  for (const field of formFields) {
    const name = field.getName();
    if (field instanceof pdf.PDFTextField) fields.push({ name, kind: "text", value: field.getText() ?? "" });
    else if (field instanceof pdf.PDFCheckBox) fields.push({ name, kind: "check box", value: field.isChecked() ? "Yes" : "No" });
    else if (field instanceof pdf.PDFRadioGroup) fields.push({ name, kind: "radio", value: field.getSelected() ?? "" });
    else if (field instanceof pdf.PDFDropdown || field instanceof pdf.PDFOptionList) fields.push({ name, kind: "choice", value: field.getSelected().join("; ") });
    else if (field instanceof pdf.PDFSignature) fields.push({ name, kind: "signature", value: field.acroField.dict.has(pdf.PDFName.of("V")) ? "signed" : "" });
  }
  if (fields.length > 0) return { fields, source: "acroform" };
  const datasets = await xfaDatasets(document);
  const xfa = datasets ? xfaFields(datasets) : [];
  return xfa.length > 0 ? { fields: xfa, source: "xfa" } : { fields: [], source: "none" };
}

export interface FormTable {
  columns: string[];
  rows: string[][];
}

/**
 * One row per document and one column per field, the columns in the order
 * they were first met, with the file's name first. A field a document does
 * not have is an empty cell.
 */
export function formTable(documents: readonly { file: string; fields: readonly FieldValue[] }[]): FormTable {
  const columns: string[] = [];
  const index = new Map<string, number>();
  for (const document of documents) {
    for (const field of document.fields) {
      if (index.has(field.name)) continue;
      index.set(field.name, columns.length);
      columns.push(field.name);
    }
  }
  const rows = documents.map((document) => {
    const row: string[] = new Array(columns.length + 1).fill("");
    row[0] = document.file;
    for (const field of document.fields) row[index.get(field.name)! + 1] = field.value;
    return row;
  });
  return { columns: ["file", ...columns], rows };
}

/** The table as CSV, with a byte-order mark so Excel reads the accents right. */
export function formCsv(table: FormTable): string {
  let out = "\ufeff" + csvLine(table.columns, ",") + "\r\n";
  for (const row of table.rows) out += csvLine(row, ",") + "\r\n";
  return out;
}

/** One document's fields as a two-column CSV: field and value. */
export function fieldListCsv(fields: readonly FieldValue[]): string {
  let out = "\ufeff" + csvLine(["field", "type", "value"], ",") + "\r\n";
  for (const field of fields) out += csvLine([field.name, field.kind, field.value], ",") + "\r\n";
  return out;
}

/** The table as JSON records, keyed by field name. */
export function formJson(table: FormTable): string {
  const records = table.rows.map((row) => Object.fromEntries(table.columns.map((column, position) => [column, row[position]])));
  return `${JSON.stringify(records, null, 2)}\n`;
}

/** "12 fields, 9 filled in". */
export function describeValues(values: FormValues): string {
  if (values.source === "none") return "no form fields";
  const filled = values.fields.filter((field) => field.value !== "" && field.value !== "No").length;
  return `${values.fields.length} ${values.fields.length === 1 ? "field" : "fields"}${values.source === "xfa" ? " (XFA)" : ""}, ${filled} filled in`;
}

export function noFormError(name: string): PlainError {
  return new PlainError(`${name} has no form fields.`, "Its text may look like a form, but nothing in it is a field that holds a value. A scanned form is a picture.");
}
