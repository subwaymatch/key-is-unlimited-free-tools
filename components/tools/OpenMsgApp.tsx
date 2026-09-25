"use client";

import { useMemo } from "react";

import { CfbError, isCompoundFile } from "@/lib/documents/cfb";
import { messageToEml, readMsg } from "@/lib/documents/msg";
import { emailResult } from "@/lib/documents/output";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("open-msg");

/** Past this a message is not a message. */
const MAX_BYTES = 512 * 1024 * 1024;

/** An Outlook .msg opened without Outlook, and turned into an .eml that anything opens. */
export function OpenMsgApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "open-msg",
      settings: {},
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is no message in it." };
        if (file.size > MAX_BYTES) return { message: "This file is too large for one message.", hint: `This reads messages up to ${formatBytes(MAX_BYTES)}.` };
        if (file.name.toLowerCase().endsWith(".eml")) return { message: "This is an .eml, not an Outlook .msg.", hint: "Open it with Open .eml e-mail, which reads the standard format." };
        return null;
      },
      run: async (file, _settings, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isCompoundFile(bytes)) throw new PlainError("This is not an Outlook message.", "A .msg file starts the way every Office compound file does, and this one does not. It may be an .eml or a text file renamed.");
        let message;
        try {
          message = readMsg(bytes);
        } catch (error) {
          throw new PlainError(error instanceof CfbError ? "This Outlook file is damaged." : "This Outlook file could not be read.", error instanceof Error ? error.message : String(error), { cause: error });
        }
        if (!message.subject && !message.from && message.text === null && message.html === null && message.attachments.length === 0) {
          throw new PlainError("This compound file is not an Outlook message.", "It has none of a message's properties. It may be an old Word, Excel or PowerPoint file, which use the same container.");
        }
        const stem = fileStem(file.name, "message");
        const eml = messageToEml(message);
        const notes: string[] = [];
        if (message.rtf) notes.push("This message has only a rich-text body, which comes out as an .rtf file that Word and TextEdit open.");
        if (message.skipped.length > 0) notes.push(`Left out, being Outlook embedded objects rather than files: ${message.skipped.join(", ")}.`);
        return emailResult(message, stem, {
          notes,
          outputs: [
            { label: "Message as .eml", fileName: `${stem}.eml`, blob: new Blob([eml], { type: "message/rfc822" }), kind: "file", note: "Opens in Apple Mail, Thunderbird, Gmail and any mail program" },
            ...(message.rtf ? [{ label: "Rich-text body", fileName: `${stem}.rtf`, blob: new Blob([message.rtf as BlobPart], { type: "application/rtf" }), kind: "file" as const }] : []),
          ],
        });
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an Outlook .msg file - what Outlook saves when a mail is dragged out of it - and read it without Outlook: its attachments as files, its text, its HTML as a page, and the whole message as an .eml that any mail program opens. Nothing is uploaded."
      queue={queue}
      busyLabel="Opening"
      dropZone={{ accept: ".msg,application/vnd.ms-outlook", inputLabel: "Choose .msg files", headline: "Drop Outlook .msg files here", subhead: "Opened as they land" }}
      note="A .msg is Outlook's own format: a compound file of the message's properties, read here without a library. Sender, recipients, date, the plain and HTML bodies and every attachment come out; a message attached to the message becomes an .eml of its own. Appointments, contacts and tasks saved as .msg carry fields a mail program has nowhere to show, so only their text and attachments come out."
    />
  );
}
