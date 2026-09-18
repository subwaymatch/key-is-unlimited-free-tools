"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";
import { createTar, MAX_TAR_ENTRY } from "@/lib/zip/tarWrite";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("create-tar");

interface TarSettings {
  gzip: boolean;
}

function isTarSettings(value: unknown): value is TarSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<TarSettings>).gzip === "boolean";
}

/** Files packed into a TAR, gzipped or not. */
export function CreateTarApp() {
  const [settings, setSettings] = useState<TarSettings>({ gzip: true });
  useStoredSettings(storageKey("settings", "create-tar"), settings, setSettings, isTarSettings);

  const queue = useMemo<CombineOptions<TarSettings>>(
    () => ({
      key: "create-tar",
      settings,
      reject: (file) => (file.size > MAX_TAR_ENTRY ? { message: "This file is too large for a TAR entry.", hint: "A header's size field counts to 8 GB. Split the file first." } : null),
      run: async (files, current, report, signal) => {
        const total = files.reduce((sum, file) => sum + file.size, 0);
        report("Packing...", 0);
        const blob = await createTar(files, current.gzip, (done) => report(`Packing... ${formatBytes(done)} of ${formatBytes(total)}`, total > 0 ? done / total : null), signal);
        const stem = files.length === 1 ? fileStem(files[0].name, "archive") : "archive";
        const extension = current.gzip ? "tar.gz" : "tar";
        const ratio = total > 0 ? Math.round((1 - blob.size / total) * 100) : 0;
        return {
          outputs: [{ label: current.gzip ? "Gzipped TAR" : "TAR", fileName: `${stem}.${extension}`, blob, kind: "file", note: `${files.length} ${files.length === 1 ? "file" : "files"}, ${formatBytes(total)} in${current.gzip ? `, ${ratio > 0 ? `${ratio}% smaller` : "no smaller"} gzipped` : ""}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Compression",
    summary: () => (settings.gzip ? ".tar.gz, gzipped" : ".tar, uncompressed"),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Write</legend>
        <RadioCards
          aria-label="Write"
          value={settings.gzip ? "gzip" : "plain"}
          onValueChange={(value) => setSettings({ gzip: value === "gzip" })}
          options={[
            { value: "gzip", label: ".tar.gz", blurb: "Gzipped: what a Unix machine, a server or a package expects" },
            { value: "plain", label: ".tar", blurb: "Uncompressed: fastest, and no smaller than the files" },
          ]}
          columns={2}
        />
      </fieldset>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop files and get them back as one .tar.gz or .tar, the archive a Linux server, a Docker build, a Python package or a Unix colleague expects, written the way tar writes it. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Create the archive"
      minFiles={1}
      noun="files"
      busyLabel="Packing"
      summary={(files) => (files.length > 0 ? `${files.length} ${files.length === 1 ? "file" : "files"}, ${formatBytes(files.reduce((sum, entry) => sum + entry.file.size, 0))}, in the order above.` : null)}
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop any files here", subhead: "Packed in the order below" }}
      note="Each file gets a ustar header with its name, size and date, and a name too long for the header goes in a GNU long-name entry ahead of it, which every tar of the last thirty years reads. Files are read a piece at a time and gzipped on the way through, so what is held in memory is the archive being written, not the files going in. Folders cannot be dropped as folders in most browsers; the files inside one arrive as a flat list."
    />
  );
}
