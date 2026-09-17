"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";
import { createZip, shouldStore } from "@/lib/zip/archive";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import styles from "../Settings.module.css";

const tool = requireTool("create-zip");

interface ZipSettings {
  name: string;
}

function isZipSettings(value: unknown): value is ZipSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<ZipSettings>).name === "string";
}

/** Files into one archive. */
export function CreateZipApp() {
  const [settings, setSettings] = useState<ZipSettings>({ name: "archive" });
  useStoredSettings(storageKey("settings", "create-zip"), settings, setSettings, isZipSettings);

  const queue = useMemo<CombineOptions<ZipSettings>>(
    () => ({
      key: "create-zip",
      settings,
      reject: (file) => (file.size === 0 ? null : null),
      inspect: async (file) => ({ facts: [shouldStore(file.name) ? "stored as it is" : "compressed"] }),
      run: async (files, current, report, signal) => {
        const total = files.reduce((sum, file) => sum + file.size, 0);
        const blob = await createZip(files, (done) => report(`Packing... ${formatBytes(done)} of ${formatBytes(total)}`, total > 0 ? done / total : null), signal);
        const name = current.name.trim().replace(/\.zip$/i, "").replace(/[\\/:*?"<>|]+/g, "-") || "archive";
        return {
          outputs: [{ label: `ZIP, ${files.length} ${files.length === 1 ? "file" : "files"}`, fileName: `${name}.zip`, blob, kind: "file", note: `${formatBytes(blob.size)} from ${formatBytes(total)}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Archive name",
    summary: () => `${settings.name.trim() || "archive"}.zip`,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Name</legend>
        <label>
          <span className={styles.fieldLabel}>The archive is saved as</span>
          <input type="text" value={settings.name} placeholder="archive" onChange={(event) => setSettings({ name: event.target.value })} className={styles.input} style={{ width: "16rem" }} />
        </label>
      </fieldset>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop the files to pack, name the archive, and get one ZIP back. Each file is read in pieces and compressed as it goes; pictures, videos and other formats that are already compressed are stored as they are, which is faster and no larger. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Create the ZIP"
      noun="files"
      busyLabel="Packing"
      summary={(files) => (files.length > 0 ? `${files.length} ${files.length === 1 ? "file" : "files"}, ${formatBytes(files.reduce((sum, entry) => sum + entry.file.size, 0))} in all.` : null)}
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop files here", subhead: "Folders are not taken by a drop zone; drop the files inside them" }}
      note="This writes a classic ZIP, which every operating system opens without installing anything, and which holds up to 4 GB per file and in all; larger archives need ZIP64, which is not written here, so make more than one. The archive is built in memory, so a multi-gigabyte one needs that much room in the browser. Folders cannot be dropped as folders: drop the files in them, and they land at the top of the archive."
    />
  );
}
