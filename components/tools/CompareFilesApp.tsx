"use client";

import { useMemo } from "react";

import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { diffStats, diffTexts, firstDifference, unifiedDiff } from "@/lib/text/diff";
import { detectEncoding, looksBinary } from "@/lib/text/encoding";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";

const tool = requireTool("compare-files");

/** Past this two texts cannot both be held and diffed in a tab. */
const MAX_BYTES = 256 * 1024 * 1024;

async function sampleOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
}

/** Two files, and what differs between them. */
export function CompareFilesApp() {
  const queue = useMemo<CombineOptions<Record<string, never>>>(
    () => ({
      key: "compare-files",
      settings: {},
      reject: (file) => (file.size > MAX_BYTES ? { message: "This file is too large to compare in a browser tab.", hint: `Both files are held as text; this reads files up to ${formatBytes(MAX_BYTES)}.` } : null),
      inspect: async (file) => {
        const sample = await sampleOf(file);
        return { facts: [file.size === 0 ? "empty" : looksBinary(sample) ? "binary" : `text, ${detectEncoding(sample).label.split(",")[0]}`] };
      },
      run: async (files, _settings, report) => {
        if (files.length !== 2) throw new PlainError("Drop exactly two files.", `There are ${files.length} in the list; remove the extra ones.`);
        const [a, b] = files;
        report("Reading...", null);
        const aBytes = new Uint8Array(await a.arrayBuffer());
        const bBytes = new Uint8Array(await b.arrayBuffer());
        if (aBytes.length === bBytes.length && firstDifference(aBytes, bBytes) === -1) {
          return { outputs: [], nothing: { message: "The two files are identical.", hint: `Byte for byte, all ${formatBytes(aBytes.length)}.` } };
        }
        const binary = looksBinary(aBytes.subarray(0, 64 * 1024)) || looksBinary(bBytes.subarray(0, 64 * 1024));
        const stems = `${fileStem(a.name, "a")}-vs-${fileStem(b.name, "b")}`;
        if (binary) {
          const at = firstDifference(aBytes, bBytes);
          const where = at === -1 ? `The shorter is the start of the longer; they differ from byte ${Math.min(aBytes.length, bBytes.length).toLocaleString("en")}.` : `They first differ at byte ${at.toLocaleString("en")}.`;
          const report_ = [`${a.name}: ${aBytes.length} bytes`, `${b.name}: ${bBytes.length} bytes`, where, ""].join("\n");
          return {
            notes: [`These are binary files, so there is no line-by-line difference to show. ${where}`],
            outputs: [{ label: "Comparison", fileName: `${stems}.txt`, blob: new Blob([report_], { type: "text/plain" }), kind: "file", note: `${formatBytes(aBytes.length)} against ${formatBytes(bBytes.length)}` }],
          };
        }
        report("Comparing...", null);
        const aText = new TextDecoder(detectEncoding(aBytes.subarray(0, 64 * 1024)).encoding).decode(aBytes);
        const bText = new TextDecoder(detectEncoding(bBytes.subarray(0, 64 * 1024)).encoding).decode(bBytes);
        const diff = diffTexts(aText, bText);
        const stats = diffStats(diff.edits);
        if (stats.inserted === 0 && stats.deleted === 0) {
          return { outputs: [], nothing: { message: "The two files hold the same text.", hint: "Only the encoding or a byte-order mark differs; every line reads the same." } };
        }
        const text = unifiedDiff(diff.edits, a.name, b.name, diff);
        const summary = `${stats.inserted} ${stats.inserted === 1 ? "line" : "lines"} added, ${stats.deleted} removed, ${stats.equal} unchanged`;
        return {
          notes: [`${summary}. The diff reads from ${a.name} to ${b.name}: lines with a minus are in the first file only, lines with a plus in the second only.`],
          outputs: [{ label: "Unified diff", fileName: `${stems}.diff`, blob: new Blob([text], { type: "text/x-diff;charset=utf-8" }), kind: "file", note: summary }],
        };
      },
    }),
    [],
  );

  return (
    <CombineApp
      tool={tool}
      lead="Drop two versions of a file and get the difference between them: a unified diff of the lines that changed, the form patch and every code host read, or for binary files whether they match and where they first differ. Nothing is uploaded."
      queue={queue}
      action="Compare the two files"
      minFiles={2}
      noun="files"
      busyLabel="Comparing"
      summary={(files) => (files.length === 2 ? `${files[0].file.name} against ${files[1].file.name}.` : files.length > 2 ? `${files.length} files: a comparison takes two. Remove the extra ones.` : null)}
      dropZone={{ accept: "*/*", inputLabel: "Choose two files", headline: "Drop two files here", subhead: "The first is the old version, the second the new" }}
      note="Lines are matched the way patience diff matches them: the lines that appear once in both files line the two up, and only the stretches between are searched, so a moved paragraph reads as a move rather than as a hundred scattered changes. Three lines of context surround each change. Text is read in whatever encoding each file turns out to be in; a file with bytes no text has is compared as bytes."
    />
  );
}
