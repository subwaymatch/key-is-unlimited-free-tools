"use client";

import { useMemo } from "react";

import { formatBytes } from "@/lib/format-utils";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";
import { readArchive } from "@/lib/zip/tar";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("extract-tar");

const ACCEPT = ".tar,.tgz,.gz,.tar.gz,.gzip,application/x-tar,application/gzip,application/x-gzip";

/** More entries than this is not a page that renders; the rest are counted. */
const MAX_SHOWN = 500;

const KIND_LABELS = { tar: "TAR archive", "tar.gz": "gzipped TAR archive", gz: "gzip file" };

/** Every file in a TAR, a .tar.gz or a .gz. */
export function ExtractTarApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "extract-tar",
      settings: {},
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to unpack." } : null),
      run: async (file, _settings, report, signal) => {
        const archive = await readArchive(file, (done) => report(`Unpacking... ${formatBytes(done)} of ${formatBytes(file.size)}`, done / file.size), signal);
        const total = archive.entries.reduce((sum, entry) => sum + entry.size, 0);
        const facts = [KIND_LABELS[archive.kind], `${archive.entries.length} ${archive.entries.length === 1 ? "file" : "files"}, ${formatBytes(total)} unpacked`];
        if (archive.entries.length === 0) {
          return { facts, outputs: [], nothing: { message: "There are no files in this archive.", hint: archive.skipped > 0 ? "It holds only directories or links." : "It is empty." } };
        }
        const shown = archive.entries.slice(0, MAX_SHOWN);
        const notes: string[] = [];
        if (archive.skipped > 0) notes.push(`${archive.skipped} ${archive.skipped === 1 ? "entry" : "entries"} that ${archive.skipped === 1 ? "was" : "were"} a directory, a link or a device ${archive.skipped === 1 ? "was" : "were"} skipped.`);
        if (archive.entries.length > MAX_SHOWN) notes.push(`The first ${MAX_SHOWN} files are here; the archive holds ${archive.entries.length}.`);
        return {
          facts,
          notes,
          outputs: shown.map((entry) => ({ label: entry.path, fileName: entry.fileName, blob: entry.blob, kind: "file" as const })),
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a .tar, a .tar.gz, a .tgz or a plain .gz and get every file inside, each a click away or all at once as a ZIP: the archive is read a piece at a time, inflated as it goes, so its size is no object. Nothing is uploaded, and nothing is installed."
      queue={queue}
      busyLabel="Unpacking"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose archives", headline: "Drop .tar, .tar.gz or .gz files here", subhead: "Unpacked as they land" }}
      note="A TAR is headers and files end to end, read here block by block, long names and pax headers included; a gzip stream is inflated by fflate as it arrives, and a .gz that turns out to hold one plain file rather than a TAR gives that file back. Directories, links and devices have nowhere to go in a browser and are skipped with a count; the files inside directories come out under their own names. Download all as a ZIP repacks everything into one archive every operating system opens. bzip2, xz and zstd archives are not read."
    />
  );
}
