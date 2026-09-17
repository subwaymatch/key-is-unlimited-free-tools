/**
 * What the PDF tools share above the page operations: taking a file, reading
 * it, naming the result.
 */
import { fileStem } from "../mediaTypes";
import type { FileRejection } from "../plainQueue";
import { describePdf, loadPdf } from "./pages";

export const PDF_ACCEPT = ".pdf,application/pdf";

/** Why a file will not be opened as a PDF, or null when it is worth trying. */
export function rejectNonPdf(file: File): FileRejection | null {
  if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to read." };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf" || file.type === "application/pdf") return null;
  return { message: "This is not a PDF.", hint: `Nothing here reads .${extension || "this"} files. Drop a PDF instead.` };
}

/** The file's pages and size, for a card's line. */
export async function inspectPdf(file: File): Promise<{ facts: string[] }> {
  const document = await loadPdf(new Uint8Array(await file.arrayBuffer()));
  return { facts: [describePdf(document)] };
}

/** "report-pages-1-3.pdf": the source's stem, a suffix, and the extension. */
export function pdfName(file: File, suffix: string): string {
  return `${fileStem(file.name, "document")}${suffix}.pdf`;
}

export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
