"use client";

import { Copy, Download, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { saveBlob } from "@/lib/download";
import { lockedPageBlob, readLockedPage } from "@/lib/crypto/lockedPage";
import { NoteFormatError, noteArmor, noteLink, parseNote } from "@/lib/crypto/note";
import { decryptBlob, encryptBlob, MIN_PASSPHRASE_LENGTH } from "@/lib/crypto/passphrase";
import { PlainError } from "@/lib/plainQueue";
import { cryptoIndex, generatePassphrase } from "@/lib/security/generate";
import { requireTool } from "@/lib/tools";

import { PlainFootnote } from "../PlainToolApp";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { FileField } from "../ui/FileField";
import { RadioCards } from "../ui/RadioCards";
import jwt from "./DecodeJwtApp.module.css";

const tool = requireTool("encrypt-note");

/** Past this, some chat apps and mail clients cut a link short. */
const LONG_LINK = 8000;

type Mode = "write" | "read";

interface Sealed {
  bytes: Uint8Array;
  link: string;
  armor: string;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

function problemOf(error: unknown): string {
  if (error instanceof PlainError) return `${error.message}${error.hint ? ` ${error.hint}` : ""}`;
  if (error instanceof NoteFormatError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** A note sealed with a passphrase, as a link, a block of text or a page, and opened again. */
export function EncryptNoteApp() {
  const [mode, setMode] = useState<Mode>("write");
  const [note, setNote] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [suggested, setSuggested] = useState<string | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [pasted, setPasted] = useState("");
  const [openPassphrase, setOpenPassphrase] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A link opened here brings its note with it, after the #, whether it loads the page or only changes the #.
  useEffect(() => {
    const read = () => {
      if (!window.location.hash.startsWith("#note=")) return;
      setMode("read");
      setPasted(window.location.href);
      setOpened(null);
      setProblem(null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const suggest = async () => {
    const { EFF_WORDS } = await import("@/lib/security/effWords");
    const phrase = generatePassphrase({ words: 5, separator: "-", capitalize: false, digit: false }, EFF_WORDS.split(" "), cryptoIndex).text;
    setSuggested(phrase);
    setPassphrase(phrase);
    setConfirm(phrase);
  };

  const writeProblem = note.trim() === "" ? "Write the note first." : passphrase.length < MIN_PASSPHRASE_LENGTH ? `The passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters.` : passphrase !== confirm ? "The two passphrases do not match." : null;

  const encrypt = async () => {
    if (writeProblem) return;
    setBusy(true);
    setProblem(null);
    try {
      const bytes = new Uint8Array(await (await encryptBlob(new Blob([note]), passphrase)).arrayBuffer());
      setSealed({ bytes, link: noteLink(window.location.origin, bytes), armor: noteArmor(bytes) });
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  const open = async (source: Uint8Array | string) => {
    setBusy(true);
    setProblem(null);
    setOpened(null);
    try {
      const bytes = typeof source === "string" ? parseNote(source) : source;
      setOpened(await (await decryptBlob(new Blob([bytes as BlobPart]), openPassphrase)).text());
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  const openPage = async (file: File) => {
    const page = readLockedPage(await file.text());
    if (!page) {
      setProblem("That page does not hold a note made here.");
      return;
    }
    if (!openPassphrase) {
      setProblem("Type the passphrase, then choose the page again.");
      return;
    }
    await open(page.sealed);
  };

  return (
    <ToolFrame
      tool={tool}
      lead="Write a note - a password, an address, a door code, something private - and lock it with a passphrase, then send it as a link, as text to paste into any message, or as a page that opens itself. Only someone with the passphrase can read it. Nothing is uploaded, and nothing is stored anywhere."
      footer={
        <PlainFootnote note="The note is sealed with AES-256-GCM under a key made from the passphrase by PBKDF2 with SHA-256 and 600,000 rounds, all in this page. A link keeps the sealed note after the #, the part of an address a browser never sends to a server, so the note is not stored or seen anywhere, here included; the passphrase is never in the link. Send the passphrase another way - a call or a different app - so whoever sees one does not see both. There is no way to recover a note whose passphrase is lost." />
      }
    >
      <RadioCards
        aria-label="Mode"
        value={mode}
        onValueChange={(next) => {
          setMode(next);
          setProblem(null);
        }}
        options={[
          { value: "write" as const, label: "Lock a note", blurb: "Write it and choose a passphrase" },
          { value: "read" as const, label: "Open a note", blurb: "A link, a block of text or a page you were sent" },
        ]}
        columns={2}
      />

      {mode === "write" ? (
        <section className={jwt.card} style={{ marginTop: "1rem" }}>
          <label htmlFor="note" className={jwt.label}>
            Note
          </label>
          <textarea id="note" className={jwt.token} style={{ fontFamily: "var(--font-sans)", wordBreak: "normal" }} value={note} onChange={(event) => {
                setNote(event.target.value);
                setSealed(null);
              }} placeholder="The Wi-Fi password is ..." />
          <div className={jwt.row} style={{ marginTop: "0.875rem", alignItems: "flex-end" }}>
            <label style={{ flex: "1 1 14rem" }}>
              <span className={jwt.label}>Passphrase</span>
              <input className={jwt.keyInput} type="password" autoComplete="new-password" value={passphrase} onChange={(event) => {
                setPassphrase(event.target.value);
                setSuggested(null);
                setSealed(null);
              }} />
            </label>
            <label style={{ flex: "1 1 14rem" }}>
              <span className={jwt.label}>Again</span>
              <input className={jwt.keyInput} type="password" autoComplete="new-password" value={confirm} onChange={(event) => {
                setConfirm(event.target.value);
                setSuggested(null);
                setSealed(null);
              }} />
            </label>
            <Button onClick={() => void suggest()}>Make a passphrase</Button>
          </div>
          {suggested && (
            <p className={jwt.hint} style={{ marginTop: "0.5rem" }}>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", color: "var(--foreground)" }}>{suggested}</code> - five random words. Copy it and send it separately.
            </p>
          )}
          <div className={jwt.row} style={{ marginTop: "0.875rem" }}>
            <Button variant="primary" onClick={() => void encrypt()} disabled={writeProblem !== null || busy}>
              <LockKeyhole aria-hidden="true" size={16} /> {busy ? "Locking..." : "Lock the note"}
            </Button>
            {writeProblem && note.trim() !== "" && <span className={jwt.hint}>{writeProblem}</span>}
          </div>
          {sealed && (
            <div style={{ marginTop: "1rem" }}>
              <h2 className={jwt.sectionTitle}>Send it as</h2>
              <p className={jwt.label} style={{ marginTop: "0.75rem" }}>
                A link
              </p>
              <div className={jwt.row} style={{ marginTop: 0 }}>
                <input className={jwt.keyInput} style={{ maxWidth: "none", flex: 1 }} readOnly value={sealed.link} aria-label="Link to the note" onFocus={(event) => event.target.select()} />
                <Button onClick={() => copyText(sealed.link)}>
                  <Copy aria-hidden="true" size={15} /> Copy link
                </Button>
              </div>
              {sealed.link.length > LONG_LINK && <p className={jwt.hint}>This link is {sealed.link.length.toLocaleString("en")} characters long; some apps cut links that long. The text or the page below travel better.</p>}
              <p className={jwt.label} style={{ marginTop: "0.875rem" }}>
                Text to paste into any message
              </p>
              <textarea className={jwt.raw} style={{ width: "100%", minHeight: "8rem", marginTop: 0, border: 0 }} readOnly value={sealed.armor} aria-label="Encrypted text" />
              <div className={jwt.row}>
                <Button onClick={() => copyText(sealed.armor)}>
                  <Copy aria-hidden="true" size={15} /> Copy text
                </Button>
                <Button onClick={() => saveBlob("note-locked.html", lockedPageBlob({ sealed: sealed.bytes, kind: "note", message: "", summary: "A note." }))}>
                  <Download aria-hidden="true" size={15} /> Save as a page that opens itself
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className={jwt.card} style={{ marginTop: "1rem" }}>
          <label htmlFor="sealed" className={jwt.label}>
            Link or encrypted text
          </label>
          <textarea id="sealed" className={jwt.token} value={pasted} onChange={(event) => {
                setPasted(event.target.value);
                setOpened(null);
              }} spellCheck={false} placeholder={"https://key.is/encrypt-note#note=...\n\nor\n\n-----BEGIN KEY.IS ENCRYPTED NOTE-----"} />
          <div className={jwt.row} style={{ marginTop: "0.875rem", alignItems: "flex-end" }}>
            <label style={{ flex: "1 1 14rem" }}>
              <span className={jwt.label}>Passphrase</span>
              <input
                className={jwt.keyInput}
                type="password"
                autoComplete="off"
                value={openPassphrase}
                onChange={(event) => setOpenPassphrase(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && pasted && openPassphrase) void open(pasted);
                }}
              />
            </label>
            <Button variant="primary" onClick={() => void open(pasted)} disabled={!pasted.trim() || !openPassphrase || busy}>
              <LockKeyholeOpen aria-hidden="true" size={16} /> {busy ? "Opening..." : "Open the note"}
            </Button>
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <FileField id="note-page" accept=".html,.htm,text/html" chosen={null} onChoose={(file) => void openPage(file)} onClear={() => {}} note="Or open a note saved as a page (.html) here, with its passphrase typed above." />
          </div>
          {opened !== null && (
            <div style={{ marginTop: "1rem" }}>
              <h2 className={jwt.sectionTitle}>The note</h2>
              <textarea className={jwt.raw} style={{ width: "100%", minHeight: "8rem", border: 0, fontFamily: "var(--font-sans)", fontSize: "var(--text-base)" }} readOnly value={opened} aria-label="The note" />
              <div className={jwt.row}>
                <Button onClick={() => copyText(opened)}>
                  <Copy aria-hidden="true" size={15} /> Copy the note
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
      {problem && (
        <div className={jwt.alert} role="alert" style={{ marginTop: "1rem" }}>
          <p className={jwt.alertTitle}>{problem}</p>
        </div>
      )}
    </ToolFrame>
  );
}
