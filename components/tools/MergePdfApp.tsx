"use client";

import { useMemo } from "react";

import { fileStem } from "@/lib/mediaTypes";
import { inspectPdf, PDF_ACCEPT, pdfBlob, rejectNonPdf } from "@/lib/pdf/files";
import { mergePdfs } from "@/lib/pdf/pages";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";

const tool = requireTool("merge-pdf");

/** Several PDFs, one document. */
export function MergePdfApp() {
  const queue = useMemo<CombineOptions<Record<string, never>>>(
    () => ({
      key: "merge-pdf",
      settings: {},
      reject: rejectNonPdf,
      inspect: inspectPdf,
      run: async (files, _settings, report) => {
        const sources: Uint8Array[] = [];
        for (const file of files) sources.push(new Uint8Array(await file.arrayBuffer()));
        const bytes = await mergePdfs(sources, (index) => report(`Adding ${files[index].name}...`, index / files.length));
        return { outputs: [{ label: "Merged PDF", fileName: `${fileStem(files[0].name, "document")}-merged.pdf`, blob: pdfBlob(bytes), kind: "pdf" }] };
      },
    }),
    [],
  );

  return (
    <CombineApp
      tool={tool}
      lead="Drop two or more PDFs, put them in order, and get one document with every page of each: nothing is re-drawn, so a scan stays a scan and a form stays a form. Nothing is uploaded."
      queue={queue}
      action="Merge the PDFs"
      minFiles={2}
      noun="PDFs"
      busyLabel="Merging"
      summary={(files) => {
        const pages = files.reduce((sum, entry) => sum + Number(entry.facts[0]?.match(/^(\d+) page/)?.[1] ?? 0), 0);
        return files.length >= 2 ? `${files.length} documents, ${pages} pages in all, in the order above.` : null;
      }}
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files to join", headline: "Drop PDF files here", subhead: "Joined in the order below; add them all, then arrange them" }}
      note="Pages are copied as they are, with their fonts, images and links; bookmarks and form fields do not carry over, since they belong to a document rather than a page. A password-protected PDF cannot be read and says so."
    />
  );
}
