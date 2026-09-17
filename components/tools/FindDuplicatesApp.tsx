"use client";

import { useMemo } from "react";

import { formatBytes } from "@/lib/format-utils";
import { digestStream } from "@/lib/hash/digest";
import { candidatesBySize, duplicatesReport, groupDuplicates, wastedBytes, type Hashed } from "@/lib/hash/duplicates";
import { fileChunks } from "@/lib/images/run";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";

const tool = requireTool("find-duplicates");

/** Files that are the same file twice. */
export function FindDuplicatesApp() {
  const queue = useMemo<CombineOptions<Record<string, never>>>(
    () => ({
      key: "find-duplicates",
      settings: {},
      run: async (files, _settings, report, signal) => {
        const candidates = candidatesBySize(files);
        const total = candidates.reduce((sum, file) => sum + file.size, 0);
        let done = 0;
        const hashed: Hashed[] = [];
        for (const file of candidates) {
          if (signal.aborted) break;
          const start = done;
          const digests = await digestStream(fileChunks(file, 8 * 1024 * 1024), ["sha256"], (bytes) => report(`Hashing ${file.name}...`, total > 0 ? (start + bytes) / total : null), signal);
          done += file.size;
          hashed.push({ name: file.name, size: file.size, hash: digests.sha256 });
        }
        const groups = groupDuplicates(hashed);
        const report_ = duplicatesReport(groups, files.length);
        const wasted = wastedBytes(groups);
        return {
          outputs: [{ label: "Report", fileName: "duplicates.txt", blob: new Blob([report_], { type: "text/plain" }), kind: "file", note: groups.length === 0 ? `No duplicates among ${files.length} files` : `${groups.length} ${groups.length === 1 ? "group" : "groups"}; ${formatBytes(wasted)} in extra copies` }],
          notes: groups.length === 0 ? [`No two of these ${files.length} files are the same. ${candidates.length} shared a size and were hashed; the rest could not match.`] : groups.map((group) => `${group.names.length} copies of ${formatBytes(group.size)}: ${group.names.join(", ")}`),
        };
      },
    }),
    [],
  );

  return (
    <CombineApp
      tool={tool}
      lead="Drop a folder's worth of files - photos, downloads, documents - and see which are the same file twice: byte for byte, whatever they are called. Only files that share a size are hashed, so a thousand photos cost a moment. Nothing is uploaded."
      queue={queue}
      action="Find duplicates"
      minFiles={2}
      noun="files"
      busyLabel="Hashing"
      summary={(files) => (files.length >= 2 ? `${files.length} files, ${formatBytes(files.reduce((sum, entry) => sum + entry.file.size, 0))} in all; ${candidatesBySize(files.map((entry) => entry.file)).length} share a size with another and will be hashed.` : null)}
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop files here", subhead: "Folders cannot be dropped as folders: select the files inside them" }}
      note="Two files are duplicates here when their bytes are identical, so a photo and a resized copy of it are not, and neither are two exports of one document with different dates inside. Groups are listed with their names; the files themselves are untouched, since a browser cannot delete anything on your disk. The report is a text file to keep."
    />
  );
}
