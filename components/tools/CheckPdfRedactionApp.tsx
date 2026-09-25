"use client";

import { useMemo } from "react";

import type { PlainQueueOptions } from "@/lib/plainQueue";
import { PDF_ACCEPT, rejectNonPdf } from "@/lib/pdf/files";
import { findHiddenText } from "@/lib/pdf/redact";
import { closePdf, openPdf, pdfOps } from "@/lib/pdf/render";
import { fileStem } from "@/lib/mediaTypes";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("check-pdf-redaction");

/** Whether a "redacted" PDF still holds the text under its black boxes. */
export function CheckPdfRedactionApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "check-pdf-redaction",
      settings: {},
      reject: rejectNonPdf,
      run: async (file, _settings, report) => {
        report("Reading...", null);
        const document = await openPdf(new Uint8Array(await file.arrayBuffer()));
        try {
          const ops = await pdfOps();
          const result = await findHiddenText(document, ops, (page, total) => report(`Checking page ${page} of ${total}...`, page / total));
          const facts = [`Pages: ${document.numPages}`, `Black boxes and redaction marks: ${result.boxes}`];
          if (result.textless.length > 0) facts.push(`Pages with no text at all: ${result.textless.length === document.numPages ? "all" : result.textless.join(", ")}`);
          if (result.hidden.length === 0) {
            const notes =
              result.boxes === 0
                ? ["There are no black boxes or redaction marks in this PDF to check."]
                : ["Every black box checked has no text underneath: the redaction took the text out, or the boxes cover pictures or blank space."];
            if (result.textless.length > 0) notes.push("Pages with no text were scanned or flattened to pictures: text cannot hide under a box there, though anything written in the picture itself can still be read by eye.");
            return { facts, notes, outputs: [] };
          }
          const pages = [...new Set(result.hidden.map((entry) => entry.page))];
          const lines = [`Text still present under redaction in ${file.name}`, "", ...result.hidden.map((entry) => `Page ${entry.page}, under a ${entry.how}: ${entry.text}    (the line reads: ${entry.line})`), ""];
          return {
            facts: [...facts, `Failed: ${result.hidden.length} ${result.hidden.length === 1 ? "piece" : "pieces"} of hidden text on ${pages.length === 1 ? "page" : "pages"} ${pages.join(", ")}`],
            notes: [
              `The redaction does not work: the text under the boxes is still in the file and can be copied out. First: "${result.hidden[0].text}" on page ${result.hidden[0].page}.`,
              "To fix it, redact the original with the PDF redaction tool, which removes the text rather than covering it.",
            ],
            outputs: [{ label: "The hidden text", fileName: `${fileStem(file.name, "document")}-hidden-text.txt`, blob: new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }), kind: "text", text: result.hidden.map((entry) => entry.text).join(" | ") }],
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
      lead="Drop a redacted PDF - one you are about to send, or one you received - and find out whether its black boxes actually removed anything, or whether the text is still underneath, one copy and paste away. Nothing is uploaded."
      queue={queue}
      busyLabel="Checking"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop redacted PDFs here", subhead: "Checked as they land" }}
      note="Every page's drawing instructions are read for dark filled rectangles, and its annotations for redaction marks that were never applied and dark boxes laid on top; the page's text is then compared with them, character by character. Text found underneath means the redaction failed. A clean result means no text sits under a box; it cannot see a name written inside a picture, or text hidden in white on white."
    />
  );
}
