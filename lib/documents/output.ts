/**
 * What an e-mail becomes on a card, whichever format it came in: the
 * message as text, the HTML body as a page to open, and every attachment
 * as a file of its own.
 */
import { formatBytes } from "../format-utils";
import type { PlainOutputSpec, PlainResult } from "../plainQueue";
import { uniqueNames } from "../zip/archive";
import { messageText, viewableHtml, type Email } from "./mime";

export function emailFacts(email: Email): string[] {
  // Every fact is labelled: a subject such as "Re: lunch" would otherwise be split at its own colon.
  const facts: string[] = [];
  if (email.subject) facts.push(`Subject: ${email.subject}`);
  if (email.from) facts.push(`From: ${email.from}`);
  if (email.date) facts.push(`Sent: ${email.date}`);
  if (email.to) facts.push(`To: ${email.to}`);
  if (email.cc) facts.push(`Cc: ${email.cc}`);
  const attached = email.attachments.filter((attachment) => !attachment.inline);
  facts.push(`Attachments: ${attached.length === 0 ? "none" : attached.map((attachment) => `${attachment.name} (${formatBytes(attachment.bytes.length)})`).join(", ")}`);
  return facts;
}

/** The outputs for a message: text, HTML when it has one, then the attachments. */
export function emailOutputs(email: Email, stem: string): PlainOutputSpec[] {
  const outputs: PlainOutputSpec[] = [];
  const text = messageText(email);
  outputs.push({ label: "Message as text", fileName: `${stem}.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }), kind: "file", note: email.text === null && email.html !== null ? "The words of the HTML body" : "Headers and the plain body" });
  const html = viewableHtml(email);
  if (html) outputs.push({ label: "Message as a web page", fileName: `${stem}.html`, blob: new Blob([html], { type: "text/html;charset=utf-8" }), kind: "file", note: "Opens in a browser, pictures included; scripts taken out" });
  const attached = email.attachments.filter((attachment) => !attachment.inline || html === null);
  const names = uniqueNames(attached.map((attachment) => attachment.name));
  for (const [index, attachment] of attached.entries()) {
    const image = attachment.type.startsWith("image/") && /^image\/(png|jpeg|gif|webp)$/.test(attachment.type);
    outputs.push({ label: attachment.inline ? "Picture in the message" : "Attachment", fileName: names[index], blob: new Blob([attachment.bytes as BlobPart], { type: attachment.type }), kind: image ? "image" : "file", note: attachment.type });
  }
  return outputs;
}

/** The notes worth saying about a message. */
export function emailNotes(email: Email): string[] {
  const notes: string[] = [];
  if (email.html && /<img[^>]+src=["']?https?:/i.test(email.html)) notes.push("The web page loads the sender's remote pictures when it is opened, as a mail program does when you allow it; those can tell the sender it was read.");
  return notes;
}

export function emailResult(email: Email, stem: string, extra: { facts?: string[]; notes?: string[]; outputs?: PlainOutputSpec[] } = {}): PlainResult {
  return {
    facts: [...emailFacts(email), ...(extra.facts ?? [])],
    notes: [...emailNotes(email), ...(extra.notes ?? [])],
    outputs: [...emailOutputs(email, stem), ...(extra.outputs ?? [])],
  };
}
