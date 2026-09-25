"use client";

/**
 * A CSV or TSV file read whole into rows: the encoding and delimiter
 * worked out from its first 64 KB, the bytes decoded and parsed a piece
 * at a time, and the rows kept.
 *
 * What the table tools share: merging, splitting, sorting and rewriting
 * a table all want every row in memory, and all want the same care over
 * quotes, delimiters and encodings on the way in.
 */
import { formatBytes } from "../format-utils";
import { fileChunks } from "../images/run";
import { PlainError, type FileRejection, type PlainReport } from "../plainQueue";
import { decodeChunks, detectEncoding, looksBinary, type DetectedEncoding } from "../text/encoding";
import { CsvParser, detectDelimiter, type Delimiter } from "./csv";

export const CSV_ACCEPT = ".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values,text/plain";

/** Past this the rows cannot be held in a tab. */
export const MAX_CSV_BYTES = 512 * 1024 * 1024;

export function rejectNonCsv(file: File): FileRejection | null {
  if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there are no rows in it." };
  if (file.size > MAX_CSV_BYTES) return { message: "This file is too large to hold in a browser tab.", hint: `Every row is kept in memory; this reads files up to ${formatBytes(MAX_CSV_BYTES)}.` };
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") return { message: "This is a workbook, not a CSV.", hint: "Run it through Excel to CSV first, or save a sheet as CSV from the spreadsheet." };
  return null;
}

export interface CsvSample {
  encoding: DetectedEncoding;
  delimiter: Delimiter;
}

/** The encoding and delimiter of a file, from its first 64 KB. */
export async function sampleCsv(file: File): Promise<CsvSample> {
  const sample = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  if (looksBinary(sample)) throw new PlainError("This is not a text file.", "It has bytes no text file has. A workbook wants Excel to CSV first.");
  const encoding = detectEncoding(sample);
  const delimiter = detectDelimiter(new TextDecoder(encoding.encoding).decode(sample));
  return { encoding, delimiter };
}

export interface ReadRows extends CsvSample {
  rows: string[][];
}

/** Every row of the file. */
export async function readCsvRows(file: File, report?: PlainReport, signal?: AbortSignal): Promise<ReadRows> {
  report?.("Looking at the first lines...", null);
  const { encoding, delimiter } = await sampleCsv(file);
  const parser = new CsvParser(delimiter);
  const rows: string[][] = [];
  let done = 0;
  async function* counted() {
    for await (const chunk of fileChunks(file, 4 * 1024 * 1024)) {
      done += chunk.length;
      report?.(`Reading ${file.name}... ${formatBytes(done)} of ${formatBytes(file.size)}, ${rows.length.toLocaleString("en")} rows`, done / file.size);
      yield chunk;
    }
  }
  // A loop rather than push(...rows): a 4 MB chunk of short rows is more
  // arguments than a call can take (DATA-1 in the audit).
  for await (const text of decodeChunks(counted(), encoding.encoding)) {
    if (signal?.aborted) throw new PlainError("Cancelled.");
    for (const row of parser.push(text)) rows.push(row);
  }
  for (const row of parser.end()) rows.push(row);
  return { rows, encoding, delimiter };
}

/** "table.csv" or "table.tsv" and its MIME type, by the delimiter. */
export function csvOutput(delimiter: Delimiter): { extension: string; mime: string } {
  return delimiter === "\t" ? { extension: "tsv", mime: "text/tab-separated-values" } : { extension: "csv", mime: "text/csv" };
}

/** "1,234 rows" */
export function countRows(count: number, noun = "row"): string {
  return `${count.toLocaleString("en")} ${count === 1 ? noun : `${noun}s`}`;
}

/** The first row of a file, from its first 64 KB: what a list shows so the columns can be named. */
export async function csvHeader(file: File): Promise<string[]> {
  const { encoding, delimiter } = await sampleCsv(file);
  const text = new TextDecoder(encoding.encoding).decode(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()));
  const parser = new CsvParser(delimiter);
  const rows = parser.push(text);
  return rows[0] ?? parser.end()[0] ?? [];
}

/** "3 columns: id, name, city", shortened past a handful. */
export function describeHeader(header: readonly string[]): string {
  const shown = header.slice(0, 6).map((name) => name.trim() || "(unnamed)").join(", ");
  return `${header.length} ${header.length === 1 ? "column" : "columns"}: ${shown}${header.length > 6 ? ` and ${header.length - 6} more` : ""}`;
}
