"use client";

import { useMemo, useState } from "react";

import type { PlainQueueOptions } from "@/lib/plainQueue";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { unlockPdf } from "@/lib/pdf/security";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { Button } from "../ui/Button";
import styles from "../Settings.module.css";

const tool = requireTool("unlock-pdf");

interface UnlockSettings {
  password: string;
}

/**
 * A copy of a password-protected PDF with the protection taken off, for
 * someone who has the password and is tired of typing it, or who has a
 * file that opens freely but will not print.
 *
 * The password is never stored; it lives in this component's state.
 */
export function UnlockPdfApp() {
  const [settings, setSettings] = useState<UnlockSettings>({ password: "" });
  const [shown, setShown] = useState(false);

  const queue = useMemo<PlainQueueOptions<UnlockSettings>>(
    () => ({
      key: "unlock-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const result = await unlockPdf(new Uint8Array(await file.arrayBuffer()), current.password, report);
        if (!result) return { outputs: [], nothing: { message: "This PDF has no password or restrictions on it.", hint: "It opens, prints and copies freely already, so there is nothing to take off." } };
        const facts = [result.description, `Encryption: ${result.encryption}`, `Restrictions: ${result.restrictions.length > 0 ? `no ${result.restrictions.join(", ")}` : "none"}`, `Opened with: ${result.openedWithoutPassword && !result.owner ? "no password needed" : result.owner ? "the owner password" : "the password"}`];
        return {
          facts,
          notes: [result.restrictions.length > 0 ? `The copy opens without a password and allows ${result.restrictions.join(", ")} again.` : "The copy opens without a password."],
          outputs: [{ label: "Unlocked PDF", fileName: pdfName(file, "-unlocked"), blob: pdfBlob(result.bytes), kind: "pdf", note: "No password, no restrictions" }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Password",
    defaultOpen: true,
    summary: () => (settings.password === "" ? "none typed: for a PDF that opens without one" : `${settings.password.length} characters`),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>The PDF&apos;s password</legend>
        <p className={styles.intro}>Either the one that opens it or the owner password works. A PDF that opens without asking but will not print or copy needs nothing here. Nothing typed is saved anywhere.</p>
        <div className={styles.fileRow}>
          <label>
            <span className={styles.fieldLabel}>Password</span>
            <input type={shown ? "text" : "password"} value={settings.password} autoComplete="off" spellCheck={false} onChange={(event) => setSettings({ password: event.target.value })} className={styles.input} style={{ width: "16rem" }} />
          </label>
          <Button onClick={() => setShown((previous) => !previous)} variant="ghost" aria-pressed={shown}>
            {shown ? "Hide" : "Show"}
          </Button>
        </div>
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a password-protected PDF with its password and get a copy that opens without one, or drop a PDF that will not let you print or copy and get one that does. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Unlocking"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Unlocked as they land, with the password above if there is one" }}
      note="Every standard PDF encryption is read: RC4 at 40 and 128 bits, AES-128 and AES-256. This removes a password you know; it does not guess one, and a PDF locked to a digital certificate rather than a password can only be opened by its recipient. Only unlock documents you have the right to."
    />
  );
}
