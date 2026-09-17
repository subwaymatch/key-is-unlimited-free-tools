"use client";

import { useMemo } from "react";

import { formatBytes } from "@/lib/format-utils";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";
import { readZip } from "@/lib/zip/archive";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("extract-zip");

const PREVIEWABLE = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

const MIME_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain" };

/** An archive opened, each file inside a click away. */
export function ExtractZipApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "extract-zip",
      settings: {},
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to unpack." };
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (extension === "zip" || file.type === "application/zip" || file.type === "application/x-zip-compressed") return null;
        if (["7z", "rar", "gz", "tgz", "tar", "bz2", "xz"].includes(extension)) {
          return { message: `This is a .${extension} archive, not a ZIP.`, hint: "Only ZIP archives are opened here." };
        }
        return null;
      },
      run: async (file, _settings, report, signal) => {
        const entries = await readZip(file, (done) => report(`Unpacking... ${formatBytes(done)} of ${formatBytes(file.size)}`, file.size > 0 ? done / file.size : null), signal);
        if (entries.length === 0) {
          return { outputs: [], nothing: { message: "This archive has no files in it.", hint: "It may hold only empty folders." } };
        }
        const total = entries.reduce((sum, entry) => sum + entry.size, 0);
        return {
          facts: [`${entries.length} ${entries.length === 1 ? "file" : "files"} inside, ${formatBytes(total)} unpacked`],
          outputs: entries.map((entry) => {
            const extension = entry.fileName.split(".").pop()?.toLowerCase() ?? "";
            const type = MIME_BY_EXTENSION[extension];
            return {
              label: entry.path,
              fileName: entry.fileName,
              blob: type ? new Blob([entry.blob], { type }) : entry.blob,
              kind: PREVIEWABLE.has(extension) ? ("image" as const) : ("file" as const),
            };
          }),
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a ZIP archive and see every file inside with its size, each one a click away, or all of them at once - on a phone, a locked-down laptop or anywhere else with nothing installed. Nothing is uploaded."
      queue={queue}
      busyLabel="Unpacking"
      dropZone={{ accept: ".zip,application/zip,application/x-zip-compressed", inputLabel: "Choose ZIP files", headline: "Drop ZIP files here", subhead: "Unpacked as they land; every file inside is listed" }}
      note="The archive is unpacked in memory, so one that holds several gigabytes needs that much room in the browser. Password-protected archives and ZIP64 archives - the kind past 4 GB - are not opened, and say so. Folder structure is shown in each file's name; the files themselves save flat, since a browser download is one file at a time."
    />
  );
}
