"use client";

import { useMemo } from "react";

import { fileStem } from "@/lib/mediaTypes";
import { PDF_ACCEPT, rejectNonPdf } from "@/lib/pdf/files";
import { closePdf, openPdf, pageText } from "@/lib/pdf/render";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("pdf-to-text");

/** The text off every page. */
export function PdfToTextApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "pdf-to-text",
      settings: {},
      reject: rejectNonPdf,
      run: async (file, _settings, report, signal) => {
        report("Opening...", null);
        const document = await openPdf(new Uint8Array(await file.arrayBuffer()));
        try {
          const count = document.numPages;
          const pages: string[] = [];
          for (let index = 0; index < count; index += 1) {
            if (signal.aborted) break;
            report(`Reading page ${index + 1} of ${count}...`, index / count);
            pages.push(await pageText(document, index));
          }
          const text = pages.map((page, index) => (count > 1 ? `----- Page ${index + 1} -----\n\n${page}` : page)).join("\n\n");
          const words = text.split(/\s+/).filter(Boolean).length;
          const facts = [`${count} ${count === 1 ? "page" : "pages"}`];
          if (pages.every((page) => page.trim() === "")) {
            return { facts, outputs: [], nothing: { message: "This PDF has no text in it.", hint: "Its pages are pictures, as a scan's are. Reading the words off a picture is OCR, which this does not do." } };
          }
          return {
            facts: [...facts, `${words} words`],
            outputs: [{ label: "Text", fileName: `${fileStem(file.name, "document")}.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }), kind: "file", note: `${words} words on ${count} ${count === 1 ? "page" : "pages"}` }],
            notes: pages.some((page) => page.trim() === "") ? ["Some pages carry no text and are empty in the file; they may be pictures."] : [],
          };
        } finally {
          await closePdf(document);
        }
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get its text back as a plain text file, page by page, in reading order as far as the document allows: for quoting, searching, or feeding to something that wants words rather than pages. Nothing is uploaded."
      queue={queue}
      busyLabel="Reading"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Read as they land; the text file is a click away" }}
      note="A PDF stores text as runs placed on a page, not as paragraphs, so the order comes from the document: a clean report reads cleanly, a two-column layout or a table can come out interleaved. A scan has no text at all, only pictures of it, and says so; turning pictures into words is OCR, which is a different tool."
    />
  );
}
