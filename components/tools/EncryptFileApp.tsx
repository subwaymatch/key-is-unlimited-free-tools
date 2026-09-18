"use client";

import { useMemo, useState } from "react";

import { decryptBlob, DEFAULT_CHUNK_BYTES, DEFAULT_ITERATIONS, encryptBlob, HEADER_BYTES, isSealed, MIN_PASSPHRASE_LENGTH, sealedName, sealedSize, unsealedName } from "@/lib/crypto/passphrase";
import { formatBytes } from "@/lib/format-utils";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { Button } from "../ui/Button";
import styles from "../Settings.module.css";

const tool = requireTool("encrypt-file");

interface PassphraseSettings {
  passphrase: string;
}

/**
 * A file sealed with a passphrase, or opened with one.
 *
 * Which of the two happens is read off the file: one that starts the way a
 * sealed file does is opened, anything else is sealed. The passphrase is
 * never stored anywhere, not even in the browser's own storage: it lives in
 * this component's state for as long as the page is open.
 */
export function EncryptFileApp() {
  const [settings, setSettings] = useState<PassphraseSettings>({ passphrase: "" });
  const [shown, setShown] = useState(false);

  const tooShort = settings.passphrase.length > 0 && settings.passphrase.length < MIN_PASSPHRASE_LENGTH;
  const invalid = settings.passphrase.length === 0 ? "Type a passphrase before adding a file." : tooShort ? `A passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters.` : null;

  const queue = useMemo<PlainQueueOptions<PassphraseSettings>>(
    () => ({
      key: "encrypt-file",
      settings,
      run: async (file, current, report, signal) => {
        const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
        if (isSealed(head)) {
          const blob = await decryptBlob(file, current.passphrase, report, signal);
          return {
            facts: ["sealed on this page, so decrypting"],
            outputs: [{ label: "Decrypted file", fileName: unsealedName(file.name), blob, kind: "file", note: `${formatBytes(blob.size)}, every block checked` }],
          };
        }
        const blob = await encryptBlob(file, current.passphrase, {}, report, signal);
        const blocks = Math.max(1, Math.ceil(file.size / DEFAULT_CHUNK_BYTES));
        return {
          facts: ["not yet sealed, so encrypting"],
          outputs: [{ label: "Encrypted file", fileName: sealedName(file.name), blob, kind: "file", note: `AES-256-GCM in ${blocks} ${blocks === 1 ? "block" : "blocks"}, ${formatBytes(sealedSize(file.size))}` }],
          notes: ["Keep the passphrase somewhere safe: without it there is no way back, here or anywhere."],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Passphrase",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () => (settings.passphrase.length === 0 ? "none yet" : `${settings.passphrase.length} characters`),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Passphrase</legend>
        <p className={styles.intro}>The same one seals a file and opens it again. It is not saved anywhere, so it has to be remembered or written down.</p>
        <div className={styles.fileRow}>
          <label>
            <span className={styles.fieldLabel}>Passphrase</span>
            <input
              type={shown ? "text" : "password"}
              value={settings.passphrase}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={tooShort}
              onChange={(event) => setSettings({ passphrase: event.target.value })}
              className={styles.input}
              style={{ width: "20rem", fontFamily: shown ? "var(--font-mono)" : undefined }}
            />
          </label>
          <Button onClick={() => setShown((previous) => !previous)} variant="ghost" aria-pressed={shown}>
            {shown ? "Hide" : "Show"}
          </Button>
        </div>
        <p className={styles.panelNote}>A sentence of several unrelated words is stronger than a short string with symbols in it, and easier to keep.</p>
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type a passphrase and drop a file: it comes back encrypted, and can only be opened here, with the same passphrase. Drop an encrypted file with its passphrase and the original comes back. Any size, checked block by block, and nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Working"
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop files here", subhead: invalid ? "Type the passphrase above first" : "Encrypted as they land; a file from this page is decrypted instead" }}
      note={`The key is derived from the passphrase with PBKDF2 (SHA-256, ${DEFAULT_ITERATIONS.toLocaleString("en")} rounds, a random salt) and the file is sealed with AES-256-GCM, both from the browser's own Web Crypto and nothing written here; a large file is sealed in ${formatBytes(DEFAULT_CHUNK_BYTES)} blocks, each with its own nonce and check, so a block that is changed, dropped or swapped is caught. The strength is the passphrase's: a short one is guessed. The file format is this page's own, so decrypt here.`}
    />
  );
}
