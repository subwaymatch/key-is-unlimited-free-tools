"use client";

import { useMemo } from "react";

import { readEmail } from "@/lib/documents/mime";
import { emailResult } from "@/lib/documents/output";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("extract-email");

/** Past this an e-mail is not an e-mail. */
const MAX_BYTES = 512 * 1024 * 1024;

/** An .eml file opened: its words, its HTML as a page, and its attachments as files. */
export function ExtractEmailApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "extract-email",
      settings: {},
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is no message in it." };
        if (file.size > MAX_BYTES) return { message: "This file is too large for one e-mail.", hint: `This reads messages up to ${formatBytes(MAX_BYTES)}. A mailbox export holding many messages is a different format.` };
        if (file.name.toLowerCase().endsWith(".msg")) return { message: "This is an Outlook .msg file, not an .eml.", hint: "Open it with Open Outlook .msg, which reads Outlook's own format." };
        return null;
      },
      run: async (file, _settings, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
        if (!/^[A-Za-z][A-Za-z0-9-]*:/m.test(head)) throw new PlainError("This does not look like an e-mail.", "An .eml starts with header lines such as From: and Subject:, and this file does not.");
        const email = readEmail(bytes);
        if (!email.from && !email.subject && !email.to && email.attachments.length === 0) throw new PlainError("This does not look like an e-mail.", "It has none of the headers every message has: no From, no To, no Subject.");
        return emailResult(email, fileStem(file.name, "message"));
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an .eml file - a message saved from Gmail, Apple Mail, Thunderbird or Outlook on the web - and get its attachments as files, its text, and its HTML as a page that opens in any browser. Nothing is uploaded."
      queue={queue}
      busyLabel="Opening"
      dropZone={{ accept: ".eml,message/rfc822,.mht,.txt", inputLabel: "Choose .eml files", headline: "Drop .eml files here", subhead: "Opened as they land" }}
      note="Every encoding a message can arrive in is read: base64 and quoted-printable bodies, headers and file names in any character set, and the long file names RFC 2231 splits across several lines. Pictures shown inside the message are written into the web page so it is complete on its own; scripts are taken out of it. A message attached to the message comes out as an .eml of its own."
    />
  );
}
