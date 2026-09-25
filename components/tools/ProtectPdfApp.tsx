"use client";

import { useMemo, useState } from "react";

import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { PDF_ACCEPT, pdfBlob, pdfName, rejectNonPdf } from "@/lib/pdf/files";
import { describePermissions, permissionBits, protectPdf, type Permissions } from "@/lib/pdf/security";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { Button } from "../ui/Button";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("protect-pdf");

interface ProtectSettings {
  password: string;
  confirm: string;
  permissions: Permissions;
}

type Allowance = keyof Permissions;

const ALLOWANCES: { value: Allowance; label: string; blurb: string }[] = [
  { value: "print", label: "Printing", blurb: "At full quality" },
  { value: "copy", label: "Copying text and pictures", blurb: "Selecting and copying out; screen readers are allowed whatever" },
  { value: "edit", label: "Editing", blurb: "Changing pages, comments, form fields and page order" },
];

function isPermissions(value: unknown): value is Permissions {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Permissions>;
  return typeof candidate.print === "boolean" && typeof candidate.copy === "boolean" && typeof candidate.edit === "boolean";
}

/**
 * A PDF that opens only with a password, and optionally cannot be printed,
 * copied from or edited.
 *
 * Only the permissions are remembered between visits. The password lives in
 * this component's state and nowhere else.
 */
export function ProtectPdfApp() {
  const [settings, setSettings] = useState<ProtectSettings>({ password: "", confirm: "", permissions: { print: true, copy: true, edit: true } });
  const [shown, setShown] = useState(false);
  useStoredSettings(storageKey("settings", "protect-pdf", "permissions"), settings.permissions, (permissions) => setSettings((previous) => ({ ...previous, permissions })), isPermissions);

  const restricted = describePermissions(permissionBits(settings.permissions)).length > 0;
  const mismatch = settings.password !== "" && settings.confirm !== settings.password;
  const invalid =
    settings.password === "" && !restricted
      ? "Type a password, or untick something to forbid, before adding a file."
      : mismatch
        ? settings.confirm === ""
          ? "Type the password a second time, below the first."
          : "The two passwords are not the same."
        : null;
  const allowed = ALLOWANCES.map((entry) => entry.value).filter((value) => settings.permissions[value]);

  const queue = useMemo<PlainQueueOptions<ProtectSettings>>(
    () => ({
      key: "protect-pdf",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report) => {
        report("Reading...", null);
        const { bytes: out, description } = await protectPdf(new Uint8Array(await file.arrayBuffer()), { userPassword: current.password, permissions: current.permissions }, report);
        const denied = describePermissions(permissionBits(current.permissions));
        const opens = current.password === "" ? "opens without a password" : "opens with the password";
        return {
          facts: [description],
          notes: [
            current.password === ""
              ? "Anyone can open this copy. The restrictions are a request that Acrobat, Preview, Chrome and most readers honour, not a lock: a tool that ignores them can still print or copy."
              : "Keep the password somewhere safe. Without it the copy cannot be opened, here or anywhere; the original you dropped is unchanged.",
          ],
          outputs: [
            {
              label: current.password === "" ? "Restricted PDF" : "Password-protected PDF",
              fileName: pdfName(file, "-protected"),
              blob: pdfBlob(out),
              kind: "pdf",
              note: `AES-256, ${opens}${denied.length > 0 ? `; no ${denied.slice(0, 3).join(", ")}` : ""}`,
            },
          ],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Password & permissions",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () => `${settings.password === "" ? "no password to open" : `a password of ${settings.password.length} characters`}${restricted ? `, no ${describePermissions(permissionBits(settings.permissions)).slice(0, 2).join(" or ")}` : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Password to open it</legend>
          <p className={styles.intro}>Leave both empty for a PDF that opens freely and only carries the restrictions below. Nothing typed here is saved anywhere.</p>
          <div className={styles.fileRow}>
            <label>
              <span className={styles.fieldLabel}>Password</span>
              <input type={shown ? "text" : "password"} value={settings.password} autoComplete="new-password" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, password: event.target.value }))} className={styles.input} style={{ width: "16rem" }} />
            </label>
            <label>
              <span className={styles.fieldLabel}>The same again</span>
              <input type={shown ? "text" : "password"} value={settings.confirm} autoComplete="new-password" spellCheck={false} aria-invalid={mismatch && settings.confirm !== ""} onChange={(event) => setSettings((previous) => ({ ...previous, confirm: event.target.value }))} className={styles.input} style={{ width: "16rem" }} />
            </label>
            <Button onClick={() => setShown((previous) => !previous)} variant="ghost" aria-pressed={shown}>
              {shown ? "Hide" : "Show"}
            </Button>
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Allow</legend>
          <CheckboxCards
            aria-label="Allow"
            value={allowed}
            onValueChange={(next) => setSettings((previous) => ({ ...previous, permissions: { print: next.includes("print"), copy: next.includes("copy"), edit: next.includes("edit") } }))}
            options={ALLOWANCES}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type a password and drop a PDF: it comes back encrypted with AES-256, and every reader asks for the password before showing a page. Printing, copying and editing can be forbidden too. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Encrypting"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: invalid ? "Set the password above first" : "Protected as they land" }}
      note="Every string and stream in the file is encrypted with AES-256 under a random key, and that key is sealed by the password with the iterated hash PDF 2.0 defines, which makes each guess slow: the handler Acrobat X, Preview, Chrome, Firefox and every current reader open. The strength is the password's; a sentence of several words beats a short one with symbols in it. Restrictions are sealed under a second password made at random and thrown away, so nobody holds it. A digitally signed PDF loses its signature, since the file is rewritten."
    />
  );
}
