"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { fileExtension, fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { countLineEndings, describeLineEndings, detectEncoding, encodeText, ensureFinalNewline, looksBinary, NEWLINE_OPTIONS, normalizeNewlines, OUTPUT_ENCODINGS, trimTrailingSpaces, type NewlineChoice, type OutputEncoding } from "@/lib/text/encoding";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("convert-text-file");

/** Past this the file is read as one string, which a tab cannot hold. */
const MAX_BYTES = 1024 * 1024 * 1024;

type Tidy = "trim" | "final";

interface TextSettings {
  encoding: OutputEncoding;
  newline: NewlineChoice;
  trim: boolean;
  finalNewline: boolean;
}

const TIDY_CHOICES: { value: Tidy; label: string; blurb: string }[] = [
  { value: "trim", label: "Strip trailing spaces", blurb: "Spaces and tabs at the end of every line" },
  { value: "final", label: "End with a line break", blurb: "One at the end of the file, as Unix tools expect" },
];

function isTextSettings(value: unknown): value is TextSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TextSettings>;
  return OUTPUT_ENCODINGS.some((entry) => entry.id === candidate.encoding) && NEWLINE_OPTIONS.some((entry) => entry.id === candidate.newline) && typeof candidate.trim === "boolean" && typeof candidate.finalNewline === "boolean";
}

/** A text file in another encoding, with other line endings. */
export function ConvertTextFileApp() {
  const [settings, setSettings] = useState<TextSettings>({ encoding: "utf-8", newline: "lf", trim: false, finalNewline: false });
  useStoredSettings(storageKey("settings", "convert-text-file"), settings, setSettings, isTextSettings);

  const tidy: Tidy[] = [...(settings.trim ? ["trim" as const] : []), ...(settings.finalNewline ? ["final" as const] : [])];

  const queue = useMemo<PlainQueueOptions<TextSettings>>(
    () => ({
      key: "convert-text-file",
      settings,
      reject: (file) =>
        file.size === 0
          ? { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to convert." }
          : file.size > MAX_BYTES
            ? { message: "This file is too large to hold as text in a browser tab.", hint: `This reads files up to ${formatBytes(MAX_BYTES)}.` }
            : null,
      run: async (file, current, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sample = bytes.subarray(0, 64 * 1024);
        if (looksBinary(sample)) throw new PlainError("This is not a text file.", "It has bytes no text file has: a picture, an archive or a document in a binary format.");
        const detected = detectEncoding(sample);
        report("Decoding...", null);
        const text = new TextDecoder(detected.encoding).decode(bytes);
        const endings = countLineEndings(text);
        const lines = endings.crlf + endings.lf + endings.cr + (text.length > 0 && !/[\r\n]$/.test(text) ? 1 : 0);
        const facts = [`Encoding: ${detected.label}`, `Line endings: ${describeLineEndings(endings)}`, `${lines.toLocaleString("en")} ${lines === 1 ? "line" : "lines"}`];
        report("Converting...", null);
        let output = text;
        if (current.newline !== "keep") output = normalizeNewlines(output, current.newline);
        if (current.trim) output = trimTrailingSpaces(output);
        if (current.finalNewline) output = ensureFinalNewline(output, current.newline === "crlf" || (current.newline === "keep" && endings.crlf > endings.lf) ? "\r\n" : "\n");
        const encoded = encodeText(output, current.encoding);
        if (encoded.length === bytes.length && encoded.every((byte, index) => byte === bytes[index])) {
          return { facts, outputs: [], nothing: { message: "This file is already written that way.", hint: `${detected.label}, ${describeLineEndings(endings)}.` } };
        }
        const target = OUTPUT_ENCODINGS.find((entry) => entry.id === current.encoding)!;
        const stem = fileStem(file.name, "text");
        const extension = fileExtension(file.name) ?? "txt";
        const suffix = current.encoding === "utf-16le" ? "-utf16" : current.newline === "crlf" ? "-crlf" : current.newline === "lf" ? "-lf" : "-utf8";
        const notes: string[] = [];
        if (!detected.sure) notes.push(`The file is not UTF-8 and carries no mark, so it was read as ${detected.label.split(",")[0]}; if accented letters look wrong in the result, that guess was.`);
        return {
          facts,
          notes,
          outputs: [{ label: target.label, fileName: `${stem}${suffix}.${extension}`, blob: new Blob([encoded as BlobPart], { type: "text/plain" }), kind: "file", note: `${target.label}, ${current.newline === "keep" ? describeLineEndings(countLineEndings(output)) : current.newline.toUpperCase()}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Encoding & line endings",
    defaultOpen: true,
    summary: () => `${OUTPUT_ENCODINGS.find((entry) => entry.id === settings.encoding)?.label}, ${NEWLINE_OPTIONS.find((entry) => entry.id === settings.newline)?.label.toLowerCase()}${tidy.length > 0 ? ", tidied" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Write as</legend>
          <RadioCards aria-label="Write as" value={settings.encoding} onValueChange={(encoding) => setSettings((previous) => ({ ...previous, encoding: encoding as OutputEncoding }))} options={OUTPUT_ENCODINGS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Line endings</legend>
          <RadioCards aria-label="Line endings" value={settings.newline} onValueChange={(newline) => setSettings((previous) => ({ ...previous, newline: newline as NewlineChoice }))} options={NEWLINE_OPTIONS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Tidy</legend>
          <CheckboxCards aria-label="Tidy" value={tidy} onValueChange={(next) => setSettings((previous) => ({ ...previous, trim: next.includes("trim"), finalNewline: next.includes("final") }))} options={TIDY_CHOICES} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a text file - a script, a CSV, a subtitle, a log - and see what encoding and line endings it has, then get it back as UTF-8 with or without a byte-order mark or as UTF-16, with LF or CRLF endings and its trailing spaces gone. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: "*/*", inputLabel: "Choose text files", headline: "Drop text files here", subhead: "Read as they land; the card says what they are" }}
      note="The encoding is worked out from the first 64 KB: a byte-order mark says UTF-8 or UTF-16 outright, a file that decodes as UTF-8 without a fault is UTF-8, zero bytes in every other position are UTF-16 without a mark, and anything else is read as Windows-1252, which most old files from Windows are; the card says when it guessed. A file that comes out byte for byte as it went in is reported rather than written."
    />
  );
}
