"use client";

import { useMemo } from "react";

import { extensionMatches, hexDump, identify } from "@/lib/files/identify";
import { formatBytes } from "@/lib/format-utils";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("identify-file");

/** How much of each end of the file is looked at. */
const SAMPLE_BYTES = 64 * 1024;

/** What a file is, whatever it is called. */
export function IdentifyFileApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "identify-file",
      settings: {},
      run: async (file, _settings, report) => {
        report("Reading the first and last bytes...", null);
        const head = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
        const tail = file.size > SAMPLE_BYTES ? new Uint8Array(await file.slice(Math.max(SAMPLE_BYTES, file.size - SAMPLE_BYTES)).arrayBuffer()) : new Uint8Array(0);
        const found = identify(head, tail);
        const dot = file.name.lastIndexOf(".");
        const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
        const matches = extensionMatches(file.name, found.kind);
        const suggested = found.kind.extensions.find((entry) => entry !== "") ?? null;
        const facts = [
          `Detected: ${found.kind.name}`,
          `Media type: ${found.kind.mime}`,
          `Named as: ${extension ? `.${extension}` : "no extension"}`,
          `Read from: ${found.how === "signature" ? "the bytes' signature" : found.how === "text" ? `the text${found.encoding ? `, ${found.encoding}` : ""}` : "nothing recognisable"}`,
        ];
        const notes: string[] = [];
        if (matches === false && suggested) {
          notes.push(`The name says ${extension ? `.${extension}` : "nothing"} but the bytes say ${found.kind.name}. Renaming it to end in .${suggested} will let programs open it as what it is.`);
        } else if (matches === true) {
          notes.push("The extension matches what is inside.");
        } else if (found.how === "guess") {
          notes.push("No known signature and not text: the first bytes are below for anyone who recognises them.");
        }
        const dump = hexDump(head.subarray(0, 256));
        const reportText = [
          `File: ${file.name}`,
          `Size: ${file.size} bytes (${formatBytes(file.size)})`,
          `Detected: ${found.kind.name}`,
          `Media type: ${found.kind.mime}`,
          `Usual extensions: ${found.kind.extensions.filter(Boolean).map((entry) => `.${entry}`).join(", ") || "none"}`,
          `Category: ${found.kind.category}`,
          "",
          "First 256 bytes:",
          dump,
          "",
        ].join("\n");
        return {
          facts,
          notes,
          outputs: [
            { label: "Kind", fileName: `${file.name}.identity.txt`, blob: new Blob([reportText], { type: "text/plain;charset=utf-8" }), kind: "text", text: `${found.kind.name} (${found.kind.mime})` },
            { label: "First bytes", fileName: `${file.name}.hex.txt`, blob: new Blob([`${dump}\n`], { type: "text/plain;charset=utf-8" }), kind: "text", text: dump.split("\n").slice(0, 4).join("\n") },
          ],
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop any file and see what it really is, from its first bytes rather than its name: the PNG called .jpg, the ZIP called .docx that is really an EPUB, the file with no extension at all, the download that was an HTML error page. With the first bytes as a hex dump for anything it does not know. Nothing is uploaded."
      queue={queue}
      busyLabel="Reading"
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop any files here", subhead: "Read as they land: the first and last 64 KB of each" }}
      note="Most formats announce themselves in a signature at the start, and this knows about a hundred of them: pictures, video and audio, documents, archives, fonts, programs, databases. An Office document or an EPUB is a ZIP whose entry names say which, so the end of the file is read too. Text is text when it decodes and has no zero bytes, and its first lines say what sort: JSON, CSV, subtitles, a script, a certificate. What it does not recognise, it says it does not."
    />
  );
}
