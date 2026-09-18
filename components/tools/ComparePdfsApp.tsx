"use client";

import { useMemo } from "react";

import { fileStem } from "@/lib/mediaTypes";
import { inspectPdf, PDF_ACCEPT, rejectNonPdf } from "@/lib/pdf/files";
import { closePdf, openPdf, pageText } from "@/lib/pdf/render";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { diffStats, diffTexts, unifiedDiff } from "@/lib/text/diff";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";

const tool = requireTool("compare-pdfs");

/** The text of every page, with a marker line between pages so a diff says where it is. */
async function textOf(file: File, report: (page: number, count: number) => void, signal: AbortSignal): Promise<{ text: string; pages: number; empty: number }> {
  const document = await openPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    const count = document.numPages;
    const pages: string[] = [];
    let empty = 0;
    for (let index = 0; index < count; index += 1) {
      if (signal.aborted) throw new PlainError("Cancelled.");
      report(index, count);
      const text = await pageText(document, index);
      if (text.trim() === "") empty += 1;
      pages.push(`----- Page ${index + 1} -----\n${text}`);
    }
    return { text: pages.join("\n\n"), pages: count, empty };
  } finally {
    await closePdf(document);
  }
}

/** Two PDFs, and the lines of text that changed between them. */
export function ComparePdfsApp() {
  const queue = useMemo<CombineOptions<Record<string, never>>>(
    () => ({
      key: "compare-pdfs",
      settings: {},
      reject: rejectNonPdf,
      inspect: inspectPdf,
      run: async (files, _settings, report, signal) => {
        if (files.length !== 2) throw new PlainError("Drop exactly two PDFs.", `There are ${files.length} in the list; remove the extra ones.`);
        const [a, b] = files;
        const first = await textOf(a, (page, count) => report(`Reading ${a.name}, page ${page + 1} of ${count}...`, (page / count) * 0.5), signal);
        const second = await textOf(b, (page, count) => report(`Reading ${b.name}, page ${page + 1} of ${count}...`, 0.5 + (page / count) * 0.5), signal);
        if (first.empty === first.pages && second.empty === second.pages) {
          throw new PlainError("Neither PDF has any text in it.", "Their pages are pictures, as a scan's are, and there are no words to compare. Compare two pictures can show where two pages differ once they are images.");
        }
        report("Comparing...", null);
        const diff = diffTexts(first.text, second.text);
        const stats = diffStats(diff.edits);
        const notes: string[] = [];
        if (first.pages !== second.pages) notes.push(`${a.name} has ${first.pages} ${first.pages === 1 ? "page" : "pages"} and ${b.name} has ${second.pages}.`);
        if (first.empty > 0 || second.empty > 0) notes.push("Some pages carry no text and compare as empty; they may be pictures.");
        if (stats.inserted === 0 && stats.deleted === 0) {
          return { outputs: [], notes, nothing: { message: "The two PDFs hold the same text.", hint: "Every line of text on every page reads the same. Pictures, fonts and layout are not compared." } };
        }
        const text = unifiedDiff(diff.edits, a.name, b.name, diff);
        const summary = `${stats.inserted} ${stats.inserted === 1 ? "line" : "lines"} added, ${stats.deleted} removed, ${stats.equal} unchanged`;
        return {
          notes: [...notes, `${summary}. The diff reads from ${a.name} to ${b.name}: lines with a minus are in the first only, lines with a plus in the second only, and a page marker line says which page each change is on.`],
          outputs: [{ label: "Unified diff of the text", fileName: `${fileStem(a.name, "a")}-vs-${fileStem(b.name, "b")}.diff`, blob: new Blob([text], { type: "text/x-diff;charset=utf-8" }), kind: "file", note: summary }],
        };
      },
    }),
    [],
  );

  return (
    <CombineApp
      tool={tool}
      lead="Drop two versions of a PDF - a contract before and after a redline, a paper and its revision, a form and a filled copy - and get the lines of text that changed between them, page by page, as a unified diff. Nothing is uploaded."
      queue={queue}
      action="Compare the two PDFs"
      minFiles={2}
      noun="PDFs"
      busyLabel="Reading"
      summary={(files) => (files.length === 2 ? `${files[0].file.name} against ${files[1].file.name}.` : files.length > 2 ? `${files.length} files: a comparison takes two. Remove the extra ones.` : null)}
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose two PDFs", headline: "Drop two PDFs here", subhead: "The first is the old version, the second the new" }}
      note="The text is read off each page by PDF.js in the order the document gives it, the same way PDF to text reads it, and the two texts are compared line by line with a page marker between pages. What is compared is the words: a change of font, colour or position that leaves the words the same is not a change here, and a scan with no text layer has nothing to compare. A paragraph reflowed across lines reads as changed lines, since the lines are what differ."
    />
  );
}
