"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { digestStream, HASH_ALGORITHMS, matchDigest, type HashAlgorithm } from "@/lib/hash/digest";
import { fileChunks } from "@/lib/images/run";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("checksum");

interface ChecksumSettings {
  algorithms: HashAlgorithm[];
  expected: string;
}

const DEFAULT_SETTINGS: ChecksumSettings = { algorithms: ["sha256"], expected: "" };

function isChecksumSettings(value: unknown): value is ChecksumSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ChecksumSettings>;
  return Array.isArray(candidate.algorithms) && candidate.algorithms.every((id) => HASH_ALGORITHMS.some((entry) => entry.id === id)) && typeof candidate.expected === "string";
}

/** The checksum tool: streamed, so the file's size is no object. */
export function ChecksumApp() {
  const [settings, setSettings] = useState<ChecksumSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "checksum"), settings, setSettings, isChecksumSettings);

  const queue = useMemo<PlainQueueOptions<ChecksumSettings>>(
    () => ({
      key: "checksum",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes. Its hashes are the well-known ones for nothing." } : null),
      run: async (file, current, report, signal) => {
        const algorithms = current.algorithms.length > 0 ? current.algorithms : ["sha256" as const];
        const started = performance.now();
        const digests = await digestStream(
          fileChunks(file, 8 * 1024 * 1024),
          algorithms,
          (done) => report(`Hashing... ${formatBytes(done)} of ${formatBytes(file.size)}`, file.size > 0 ? done / file.size : null),
          signal,
        );
        const seconds = (performance.now() - started) / 1000;
        const matched = current.expected.trim() ? matchDigest(current.expected, digests) : null;
        const outputs = algorithms.map((id) => {
          const entry = HASH_ALGORITHMS.find((candidate) => candidate.id === id)!;
          const note = current.expected.trim()
            ? matched === id
              ? `Matches the ${entry.label} you pasted.`
              : matched === null && current.expected.trim().toLowerCase().replace(/^[a-z0-9-]+[:=\s]+/, "").length === digests[id].length
                ? "Does not match the hash you pasted."
                : undefined
            : undefined;
          return {
            label: entry.label,
            fileName: `${file.name}.${id}`,
            blob: new Blob([`${digests[id]}  ${file.name}\n`], { type: "text/plain" }),
            kind: "text" as const,
            text: digests[id],
            note,
          };
        });
        return {
          outputs,
          facts: [`hashed in ${seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`}`],
          notes: current.expected.trim() && matched === null ? ["The hash you pasted matches none of these. If it was made with another algorithm, tick that one above and run again."] : [],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Algorithms & the hash to check",
    defaultOpen: true,
    invalid: () => (settings.algorithms.length === 0 ? "Tick at least one algorithm before adding a file." : null),
    summary: () => `${settings.algorithms.map((id) => HASH_ALGORITHMS.find((entry) => entry.id === id)?.label ?? id).join(", ") || "none"}${settings.expected.trim() ? ", compared" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Algorithms</legend>
          <p className={styles.intro}>All of the ticked ones are computed in one pass over the file.</p>
          <CheckboxCards
            aria-label="Algorithms"
            value={settings.algorithms}
            onValueChange={(algorithms) => setSettings((previous) => ({ ...previous, algorithms }))}
            options={HASH_ALGORITHMS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Compare with</legend>
          <p className={styles.intro}>Paste the checksum a download page printed, and each file says whether it matches.</p>
          <input
            type="text"
            value={settings.expected}
            placeholder="e.g. ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            spellCheck={false}
            onChange={(event) => setSettings((previous) => ({ ...previous, expected: event.target.value }))}
            className={styles.input}
            style={{ width: "100%", maxWidth: "40rem", fontFamily: "var(--font-mono)" }}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop any file - an installer, a disk image, a backup - and get its SHA-256, SHA-1, MD5 or CRC-32, then check it against the one the download page printed. The file is read from disk in pieces, so a 40 GB image is hashed with the memory flat. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Hashing"
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop any files here", subhead: "Hashed as they land, at a few hundred megabytes a second" }}
      note="A matching checksum says the copy is the one the page described; a mismatch says it is not, whether by a broken download or by something else. MD5 and SHA-1 tell a corrupt copy from a good one and nothing more: both can be forged by anyone determined to, so a page that only prints those cannot vouch for the file against an attacker, and SHA-256 is the one to prefer. The download button saves the checksum in the form sha256sum and its relatives write."
    />
  );
}
