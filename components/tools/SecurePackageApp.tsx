"use client";

import { unzipSync, zipSync } from "fflate";
import { useMemo, useState } from "react";

import { lockedPageBlob, readLockedPage } from "@/lib/crypto/lockedPage";
import { decryptBlob, encryptBlob, MIN_PASSPHRASE_LENGTH } from "@/lib/crypto/passphrase";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type CombineOptions, type PlainOutputSpec } from "@/lib/plainQueue";
import { cryptoIndex, generatePassphrase } from "@/lib/security/generate";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { Button } from "../ui/Button";
import styles from "../Settings.module.css";

const tool = requireTool("secure-package");

/** A page this large takes a browser a while to open; beyond it, Encrypt a file is the better tool. */
const MAX_BYTES = 200 * 1024 * 1024;

const PACKAGE_FACT = "A locked package";

interface PackageSettings {
  passphrase: string;
  confirm: string;
  message: string;
}

async function isPackage(file: File): Promise<boolean> {
  if (!/\.html?$/i.test(file.name) || file.size < 200) return false;
  const head = await file.slice(0, 8192).text();
  return head.includes('id="payload" data-kind="') || (await file.text()).includes('<script type="application/x-keyis-sealed"');
}

/** Names made unique inside the package: a second report.pdf becomes report (2).pdf. */
function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let count = 2; used.has(candidate.toLowerCase()); count += 1) {
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Files locked into one HTML page that opens with a passphrase in any browser, and such pages opened again. */
export function SecurePackageApp() {
  const [settings, setSettings] = useState<PackageSettings>({ passphrase: "", confirm: "", message: "" });
  const [suggested, setSuggested] = useState<string | null>(null);

  const suggest = async () => {
    const { EFF_WORDS } = await import("@/lib/security/effWords");
    const phrase = generatePassphrase({ words: 5, separator: "-", capitalize: false, digit: false }, EFF_WORDS.split(" "), cryptoIndex).text;
    setSuggested(phrase);
    setSettings((previous) => ({ ...previous, passphrase: phrase, confirm: phrase }));
  };

  const queue = useMemo<CombineOptions<PackageSettings>>(
    () => ({
      key: "secure-package",
      settings,
      inspect: async (file) => ({ facts: (await isPackage(file)) ? [PACKAGE_FACT] : [] }),
      run: async (files, current, report, signal) => {
        if (current.passphrase === "") throw new PlainError("Type a passphrase first.", "It is what the files will be locked with, or what opens the package.");
        // One package dropped on its own is opened rather than locked again.
        if (files.length === 1 && (await isPackage(files[0]))) {
          const page = readLockedPage(await files[0].text());
          if (!page) throw new PlainError("This page is not a package made here.", "Only pages made by this tool can be opened with it.");
          const plain = new Uint8Array(await (await decryptBlob(new Blob([page.sealed as BlobPart]), current.passphrase, report, signal)).arrayBuffer());
          if (page.kind === "note") {
            const text = new TextDecoder().decode(plain);
            return { notes: ["The package held a note."], outputs: [{ label: "The note", fileName: `${fileStem(files[0].name, "note")}.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }), kind: "text", text }] };
          }
          const entries = Object.entries(unzipSync(plain)).filter(([name]) => !name.endsWith("/"));
          const outputs: PlainOutputSpec[] = entries.map(([name, data]) => ({ label: name, fileName: name.split("/").pop() || "file", blob: new Blob([data as BlobPart]), kind: "file", note: formatBytes(data.length) }));
          if (entries.length > 1) outputs.push({ label: "Everything as a ZIP", fileName: `${fileStem(files[0].name, "package")}.zip`, blob: new Blob([plain as BlobPart], { type: "application/zip" }), kind: "file", note: `${entries.length} files` });
          return { notes: [`Opened: ${entries.length} ${entries.length === 1 ? "file" : "files"}, ${formatBytes(entries.reduce((sum, [, data]) => sum + data.length, 0))}.`], outputs };
        }
        if (current.passphrase.length < MIN_PASSPHRASE_LENGTH) throw new PlainError(`The passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters.`, "A short one is guessed in minutes by anyone who has the file. Make a passphrase gives five random words.");
        if (current.passphrase !== current.confirm) throw new PlainError("The two passphrases do not match.", "Type it again in the second box; a typing mistake here would lock the files for good.");
        const total = files.reduce((sum, file) => sum + file.size, 0);
        if (total > MAX_BYTES) throw new PlainError(`${formatBytes(total)} is more than a page can carry well.`, `Keep a package under ${formatBytes(MAX_BYTES)}; for larger files, Encrypt a file seals them without the page around them.`);
        const names = uniqueNames(files.map((file) => file.name));
        const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
        for (const [index, file] of files.entries()) {
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          report(`Reading ${file.name}...`, (index / files.length) * 0.2);
          entries[names[index]] = [new Uint8Array(await file.arrayBuffer()), { level: 0 }];
        }
        report("Packing...", 0.2);
        const zip = zipSync(entries);
        const sealed = new Uint8Array(await (await encryptBlob(new Blob([zip as BlobPart]), current.passphrase, {}, (phase, ratio) => report(phase, ratio === null ? null : 0.2 + ratio * 0.7), signal)).arrayBuffer());
        report("Writing the page...", 0.95);
        const summary = `${files.length} ${files.length === 1 ? "file" : "files"}, ${formatBytes(total)}.`;
        const page = lockedPageBlob({ sealed, kind: "files", message: current.message, summary });
        const name = files.length === 1 ? `${fileStem(files[0].name, "file")}-locked.html` : "files-locked.html";
        return {
          notes: [
            `${summary.slice(0, -1)} locked into one page, ${formatBytes(page.size)}. It opens in any browser, offline, with the passphrase.`,
            "Send the passphrase a different way from the file - a text message or a call rather than the same e-mail - so whoever gets one does not get both.",
          ],
          outputs: [{ label: "The locked page", fileName: name, blob: page, kind: "file", note: "Open it in a browser and type the passphrase" }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Passphrase",
    defaultOpen: true,
    summary: () => (settings.passphrase ? `${settings.passphrase.length} characters${settings.message.trim() ? ", with a message" : ""}` : "not set"),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Passphrase</legend>
          <div className={styles.fileRow} style={{ marginTop: 0 }}>
            <label>
              <span className={styles.fieldLabel}>Passphrase</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={settings.passphrase}
                onChange={(event) => {
                  setSuggested(null);
                  setSettings((previous) => ({ ...previous, passphrase: event.target.value }));
                }}
              />
            </label>
            <label>
              <span className={styles.fieldLabel}>Again, to lock files</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={settings.confirm}
                onChange={(event) => {
                  setSuggested(null);
                  setSettings((previous) => ({ ...previous, confirm: event.target.value }));
                }}
              />
            </label>
          </div>
          <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <Button onClick={() => void suggest()}>Make a passphrase</Button>
            {suggested && (
              <span className={styles.panelNote} style={{ margin: 0 }}>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", color: "var(--foreground)" }}>{suggested}</code> - five random words, about 64 bits. Copy it before you go on.
              </span>
            )}
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Message on the page</legend>
          <p className={styles.intro}>Shown above the passphrase box, before the page is opened, so anyone who has the file can read it. Optional.</p>
          <textarea className={styles.textarea} rows={2} value={settings.message} onChange={(event) => setSettings((previous) => ({ ...previous, message: event.target.value }))} placeholder="The contract we talked about. I'll text you the passphrase." />
        </fieldset>
      </>
    ),
  };

  const opening = (files: { facts: string[] }[]) => files.length === 1 && files[0].facts.includes(PACKAGE_FACT);

  return (
    <CombineApp
      tool={tool}
      lead="Drop the files to send - contracts, tax papers, ID scans, photos - and get one HTML page that holds them locked with a passphrase. The recipient opens it in any browser, types the passphrase and saves the files: no app, no account, no upload anywhere. Nothing is uploaded here either."
      queue={queue}
      settings={toolSettings}
      action={(files) => (opening(files) ? "Open the package" : "Lock into one page")}
      minFiles={1}
      noun="files"
      busyLabel="Locking"
      summary={(files) => (files.length === 0 ? null : opening(files) ? "A locked package: type its passphrase above to open it." : `${files.length} ${files.length === 1 ? "file" : "files"}, ${formatBytes(files.reduce((sum, entry) => sum + entry.file.size, 0))}, to lock into one page.`)}
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop files to lock, or a package to open", subhead: "Anything, up to 200 MB in all" }}
      note="The files are packed into a ZIP and sealed with AES-256-GCM under a key made from the passphrase by PBKDF2 with SHA-256 and 600,000 rounds, a megabyte at a time, so any change to the page is caught. The page carries its own few lines of script to open it with the browser's Web Crypto, loads nothing and sends nothing, and works offline. Nobody can open it without the passphrase - not this site, and not you, if you forget it. Mail previews that block scripts will not open it; saved and opened in a browser it will, and dropped here it opens too."
    />
  );
}
