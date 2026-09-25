"use client";

import { useMemo } from "react";

import { csvLine } from "@/lib/data/csv";
import { scanText, summarizeFindings, type Finding } from "@/lib/files/secrets";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { detectEncoding, looksBinary } from "@/lib/text/encoding";
import { requireTool } from "@/lib/tools";
import { readZip } from "@/lib/zip/archive";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("find-secrets");

/** Past this a single text is not held to be scanned. */
const MAX_TEXT_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

/** The text of some bytes, or null when they are not text. */
function textOf(bytes: Uint8Array): string | null {
  const sample = bytes.subarray(0, 64 * 1024);
  if (looksBinary(sample)) return null;
  return new TextDecoder(detectEncoding(sample).encoding).decode(bytes);
}

/** Credentials left in code, config, logs and exports, found before they are shared. */
export function FindSecretsApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "find-secrets",
      settings: {},
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing to scan." };
        const zip = file.name.toLowerCase().endsWith(".zip");
        if (file.size > (zip ? MAX_ZIP_BYTES : MAX_TEXT_BYTES)) return { message: "This file is too large to scan in a browser tab.", hint: `This scans text files up to ${formatBytes(MAX_TEXT_BYTES)} and ZIPs up to ${formatBytes(MAX_ZIP_BYTES)}.` };
        return null;
      },
      run: async (file, _settings, report, signal) => {
        const found: { path: string; finding: Finding }[] = [];
        let scanned = 0;
        let skipped = 0;
        if (file.name.toLowerCase().endsWith(".zip")) {
          report("Unpacking...", null);
          const entries = await readZip(file, (done) => report(`Unpacking... ${formatBytes(done)} of ${formatBytes(file.size)}`, done / file.size), signal);
          for (const [index, entry] of entries.entries()) {
            if (signal.aborted) throw new PlainError("Cancelled.");
            if (index % 20 === 0) report(`Scanning ${entry.path}...`, index / entries.length);
            if (entry.size > MAX_TEXT_BYTES) {
              skipped += 1;
              continue;
            }
            const text = textOf(new Uint8Array(await entry.blob.arrayBuffer()));
            if (text === null) {
              skipped += 1;
              continue;
            }
            scanned += 1;
            for (const finding of scanText(text)) found.push({ path: entry.path, finding });
          }
        } else {
          report("Scanning...", null);
          const text = textOf(new Uint8Array(await file.arrayBuffer()));
          if (text === null) throw new PlainError("This is not a text file.", "Secrets are looked for in text: code, config, logs and exports. Drop a ZIP to scan the text files inside one.");
          scanned = 1;
          for (const finding of scanText(text)) found.push({ path: file.name, finding });
        }
        const facts = [scanned === 1 && skipped === 0 ? "1 text file scanned" : `${scanned.toLocaleString("en")} text ${scanned === 1 ? "file" : "files"} scanned${skipped > 0 ? `, ${skipped.toLocaleString("en")} binary or too large skipped` : ""}`];
        if (found.length === 0) return { facts, outputs: [], nothing: { message: "No secrets were found.", hint: "Nothing matched the shape of a known key, token or private key, a database URL with a password, or a secret assigned in code. A password with no recognisable shape can still be there." } };
        const table = [csvLine(["file", "line", "column", "kind", "certainty", "found"], ",")];
        for (const { path, finding } of found) table.push(csvLine([path, String(finding.line), String(finding.column), finding.label, finding.confidence, finding.preview], ","));
        const files = new Set(found.map((entry) => entry.path));
        const inside = files.size > 1 || !files.has(file.name);
        const where = found.slice(0, 5).map(({ path, finding }) => `${inside ? `${path} line ${finding.line}` : `line ${finding.line}`}, ${finding.label}`);
        return {
          facts: [...facts, `Found: ${summarizeFindings(found.map((entry) => entry.finding))}`],
          notes: [`${found.length} ${found.length === 1 ? "secret" : "secrets"} in ${files.size} ${files.size === 1 ? "file" : "files"}: ${where.join("; ")}${found.length > 5 ? `; and ${found.length - 5} more in the report` : ""}.`, "A secret that has been shared or committed should be treated as known: revoke it where it was issued and make a new one, as well as removing it from the file."],
          outputs: [{ label: "Report", fileName: `${fileStem(file.name, "scan")}-secrets.csv`, blob: new Blob([`${table.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }), kind: "file", note: "Where each was found, with its middle hidden so the report is safe to share" }],
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop source code, a config file, a log or a ZIP of a project before sharing or publishing it, and find the API keys, tokens, private keys and passwords left in it: AWS, GitHub, Stripe, Google, OpenAI, Slack and more than twenty others, with the line each is on. Nothing is uploaded."
      queue={queue}
      busyLabel="Scanning"
      dropZone={{ accept: "*/*", inputLabel: "Choose files or ZIPs", headline: "Drop files or a ZIP here", subhead: "Scanned as they land; a ZIP's text files are scanned inside it" }}
      note="Each provider's keys have a shape of their own - AKIA for AWS, ghp_ for GitHub, sk_live_ for Stripe - and those are matched exactly, so a match is almost always real. A private key block, a JSON Web Token, a database URL with a password in it, and a variable named like a secret given a literal value are found too, and marked less certain. The report hides the middle of each secret, so it can be passed on to whoever has to rotate them."
    />
  );
}
