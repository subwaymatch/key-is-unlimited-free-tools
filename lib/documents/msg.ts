/**
 * An Outlook .msg file read: the message Outlook saves when a mail is
 * dragged to the desktop, which nothing but Outlook opens.
 *
 * A .msg is a compound file ([MS-OXMSG]) holding the message's MAPI
 * properties: each variable-length property is a stream named for its id
 * and type - "__substg1.0_0037001F" is the subject (0x0037) as UTF-16
 * (0x001F) - and the fixed-length ones sit together in a
 * "__properties_version1.0" stream. Recipients and attachments are
 * storages of their own with the same layout, and an attached message is a
 * whole message nested inside one.
 *
 * What comes out is the same shape the .eml reader gives, so the two tools
 * share their output, plus the message rewritten as an .eml that any mail
 * program opens.
 */
import { CompoundFile, type CfbEntry } from "./cfb";
import { safeFileName, type Attachment, type Email, type MimeHeader } from "./mime";

const STRING = 0x001f;
const STRING8 = 0x001e;
const BINARY = 0x0102;
const OBJECT = 0x000d;

const PR = {
  subject: 0x0037,
  senderName: 0x0c1a,
  senderEmail: 0x0c1f,
  senderAddressType: 0x0c1e,
  senderSmtp: 0x5d01,
  representingName: 0x0042,
  representingEmail: 0x0065,
  displayTo: 0x0e04,
  displayCc: 0x0e03,
  body: 0x1000,
  html: 0x1013,
  rtf: 0x1009,
  headers: 0x007d,
  submitTime: 0x0039,
  deliveryTime: 0x0e06,
  codepage: 0x3ffd,
  internetCodepage: 0x3fde,
  recipientName: 0x3001,
  recipientEmail: 0x3003,
  recipientSmtp: 0x39fe,
  recipientType: 0x0c15,
  attachLongName: 0x3707,
  attachName: 0x3704,
  attachData: 0x3701,
  attachMime: 0x370e,
  attachContentId: 0x3712,
  attachMethod: 0x3705,
  attachFlags: 0x3714,
} as const;

/** A Windows code page as a label `TextDecoder` knows. */
export function codepageLabel(codepage: number | undefined): string {
  if (codepage === undefined) return "windows-1252";
  const known: Record<number, string> = {
    65001: "utf-8",
    1200: "utf-16le",
    1201: "utf-16be",
    20127: "windows-1252",
    28591: "iso-8859-1",
    932: "shift_jis",
    936: "gbk",
    54936: "gb18030",
    949: "euc-kr",
    950: "big5",
    51932: "euc-jp",
    50220: "iso-2022-jp",
    20866: "koi8-r",
    21866: "koi8-u",
    874: "windows-874",
  };
  if (known[codepage]) return known[codepage];
  if (codepage >= 1250 && codepage <= 1258) return `windows-${codepage}`;
  if (codepage >= 28592 && codepage <= 28606) return `iso-8859-${codepage - 28590}`;
  return "windows-1252";
}

function decode(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

interface Properties {
  strings: Map<number, string>;
  binaries: Map<number, Uint8Array>;
  /** Fixed-length values: the 8 bytes of each, by id. */
  fixed: Map<number, { type: number; view: DataView }>;
  /** Storages named as object properties: an attached message. */
  objects: Map<number, CfbEntry>;
}

const SUBSTG = /^__substg1\.0_([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})$/;

function readProperties(file: CompoundFile, storage: CfbEntry, headerSize: number, codepage?: number): Properties {
  const properties: Properties = { strings: new Map(), binaries: new Map(), fixed: new Map(), objects: new Map() };
  const stream = file.find(storage, "__properties_version1.0");
  if (stream) {
    const bytes = file.read(stream);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = headerSize; offset + 16 <= bytes.length; offset += 16) {
      const tag = view.getUint32(offset, true);
      properties.fixed.set(tag >>> 16, { type: tag & 0xffff, view: new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 8) });
    }
  }
  const page = codepage ?? fixedNumber(properties, PR.codepage);
  for (const entry of storage.children) {
    const match = SUBSTG.exec(entry.name);
    if (!match) continue;
    const id = parseInt(match[1], 16);
    const type = parseInt(match[2], 16);
    if (entry.type === 1) {
      if (type === OBJECT) properties.objects.set(id, entry);
      continue;
    }
    const bytes = file.read(entry);
    if (type === STRING) properties.strings.set(id, decode(bytes, "utf-16le").replace(/\u0000+$/, ""));
    else if (type === STRING8) properties.strings.set(id, decode(bytes, codepageLabel(page)).replace(/\u0000+$/, ""));
    else if (type === BINARY) properties.binaries.set(id, bytes);
  }
  return properties;
}

function fixedNumber(properties: Properties, id: number): number | undefined {
  const entry = properties.fixed.get(id);
  return entry && (entry.type === 0x0003 || entry.type === 0x0002) ? entry.view.getInt32(0, true) : undefined;
}

/** A FILETIME - 100-nanosecond ticks since 1601 - as a Date. */
function fixedDate(properties: Properties, id: number): Date | null {
  const entry = properties.fixed.get(id);
  if (!entry || entry.type !== 0x0040) return null;
  const ticks = entry.view.getUint32(4, true) * 2 ** 32 + entry.view.getUint32(0, true);
  if (ticks === 0) return null;
  return new Date(ticks / 10_000 - 11_644_473_600_000);
}

/* ---- Compressed RTF ------------------------------------------------------ */

const RTF_PREFIX =
  "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

/**
 * Outlook's compressed RTF ([MS-OXRTFCP]) expanded: LZ77 over a 4 KB
 * dictionary that starts out holding a stock RTF preamble, so the first
 * references can point into it.
 */
export function decompressRtf(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 16) throw new Error("The compressed RTF is shorter than its header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawSize = view.getUint32(4, true);
  const kind = view.getUint32(8, true);
  if (kind === 0x414c454d) return bytes.subarray(16, 16 + rawSize);
  if (kind !== 0x75465a4c) throw new Error("The RTF is compressed in a way this does not read.");
  const dictionary = new Uint8Array(4096);
  for (let index = 0; index < RTF_PREFIX.length; index += 1) dictionary[index] = RTF_PREFIX.charCodeAt(index);
  let write = RTF_PREFIX.length;
  const out = new Uint8Array(rawSize);
  let length = 0;
  let at = 16;
  const end = Math.min(bytes.length, view.getUint32(0, true) + 4);
  while (at < end && length < rawSize) {
    const control = bytes[at++];
    for (let bit = 0; bit < 8 && at < end && length < rawSize; bit += 1) {
      if (!(control & (1 << bit))) {
        const byte = bytes[at++];
        out[length++] = byte;
        dictionary[write] = byte;
        write = (write + 1) % 4096;
        continue;
      }
      if (at + 1 >= end + 1) return out.subarray(0, length);
      const reference = (bytes[at] << 8) | bytes[at + 1];
      at += 2;
      let offset = reference >> 4;
      const count = (reference & 0x0f) + 2;
      if (offset === write) return out.subarray(0, length);
      for (let step = 0; step < count && length < rawSize; step += 1) {
        const byte = dictionary[offset];
        out[length++] = byte;
        dictionary[write] = byte;
        write = (write + 1) % 4096;
        offset = (offset + 1) % 4096;
      }
    }
  }
  return out.subarray(0, length);
}

/* ---- The message --------------------------------------------------------- */

export interface Recipient {
  name: string;
  address: string | null;
  kind: "to" | "cc" | "bcc";
}

export interface OutlookMessage extends Email {
  recipients: Recipient[];
  /** The body as RTF, when that is all the message has. */
  rtf: Uint8Array | null;
  sent: Date | null;
  /** Attachments Outlook stores as embedded objects, which cannot be taken out as files. */
  skipped: string[];
}

function mailbox(name: string | undefined, address: string | null | undefined): string | null {
  const cleanAddress = address && address.includes("@") ? address : null;
  if (name && cleanAddress && name !== cleanAddress) return `${name} <${cleanAddress}>`;
  return cleanAddress ?? name ?? null;
}

function readMessage(file: CompoundFile, storage: CfbEntry, headerSize: number, depth: number): OutlookMessage {
  const properties = readProperties(file, storage, headerSize);
  const codepage = fixedNumber(properties, PR.codepage);
  const text = (id: number) => properties.strings.get(id);

  const recipients: Recipient[] = [];
  const attachments: Attachment[] = [];
  const skipped: string[] = [];
  for (const entry of storage.children) {
    if (entry.type !== 1) continue;
    if (entry.name.startsWith("__recip_version1.0_")) {
      const recipient = readProperties(file, entry, 8, codepage);
      const type = fixedNumber(recipient, PR.recipientType) ?? 1;
      const address = recipient.strings.get(PR.recipientSmtp) ?? recipient.strings.get(PR.recipientEmail) ?? null;
      recipients.push({ name: recipient.strings.get(PR.recipientName) ?? address ?? "", address, kind: type === 2 ? "cc" : type === 3 ? "bcc" : "to" });
    } else if (entry.name.startsWith("__attach_version1.0_")) {
      const attachment = readProperties(file, entry, 8, codepage);
      const name = attachment.strings.get(PR.attachLongName) ?? attachment.strings.get(PR.attachName) ?? attachment.strings.get(PR.recipientName) ?? `attachment-${attachments.length + 1}`;
      const contentId = attachment.strings.get(PR.attachContentId) ?? null;
      const data = attachment.binaries.get(PR.attachData);
      const embedded = attachment.objects.get(PR.attachData);
      if (data) {
        const flags = fixedNumber(attachment, PR.attachFlags) ?? 0;
        attachments.push({ name: safeFileName(name, `attachment-${attachments.length + 1}`), type: attachment.strings.get(PR.attachMime) ?? "application/octet-stream", bytes: data, contentId, inline: contentId !== null && (flags & 4) !== 0 });
      } else if (embedded && depth < 10 && fixedNumber(attachment, PR.attachMethod) === 5) {
        const inner = readMessage(file, embedded, 24, depth + 1);
        attachments.push({ name: safeFileName(`${inner.subject ?? name}.eml`, `message-${attachments.length + 1}.eml`), type: "message/rfc822", bytes: new TextEncoder().encode(messageToEml(inner)), contentId: null, inline: false });
      } else skipped.push(name);
    }
  }

  const transport = text(PR.headers) ?? "";
  const headers: MimeHeader[] = [];
  for (const line of transport.split(/\r?\n(?![ \t])/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).replace(/\r?\n[ \t]+/g, " ").trim() });
  }
  const sent = fixedDate(properties, PR.submitTime) ?? fixedDate(properties, PR.deliveryTime);
  const headerValue = (name: string) => headers.find((entry) => entry.name.toLowerCase() === name)?.value ?? null;

  let html: string | null = text(PR.html) ?? null;
  const htmlBytes = properties.binaries.get(PR.html);
  if (html === null && htmlBytes) html = decode(htmlBytes, codepageLabel(fixedNumber(properties, PR.internetCodepage) ?? 65001));
  const rtfBytes = properties.binaries.get(PR.rtf);
  let rtf: Uint8Array | null = null;
  if (rtfBytes && text(PR.body) === undefined && html === null) {
    try {
      rtf = decompressRtf(rtfBytes);
    } catch {
      rtf = null;
    }
  }

  const senderAddress = text(PR.senderSmtp) ?? (text(PR.senderAddressType) === "EX" ? null : text(PR.senderEmail)) ?? text(PR.representingEmail) ?? null;
  const to = recipients.filter((recipient) => recipient.kind === "to").map((recipient) => mailbox(recipient.name, recipient.address)).filter(Boolean).join(", ");
  const cc = recipients.filter((recipient) => recipient.kind === "cc").map((recipient) => mailbox(recipient.name, recipient.address)).filter(Boolean).join(", ");
  return {
    headers,
    subject: text(PR.subject) ?? null,
    from: mailbox(text(PR.senderName) ?? text(PR.representingName), senderAddress) ?? headerValue("from"),
    to: to || text(PR.displayTo) || null,
    cc: cc || text(PR.displayCc) || null,
    date: sent ? sent.toUTCString() : headerValue("date"),
    text: text(PR.body) ?? null,
    html,
    attachments,
    recipients,
    rtf,
    sent,
    skipped,
  };
}

/** Everything in an Outlook message. */
export function readMsg(bytes: Uint8Array): OutlookMessage {
  const file = new CompoundFile(bytes);
  return readMessage(file, file.root, 32, 0);
}

/* ---- Writing it as an .eml ----------------------------------------------- */

function encodedWord(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function base64Lines(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return (btoa(binary).match(/.{1,76}/g) ?? []).join("\r\n");
}

/** An address list with any non-ASCII display names encoded, the addresses left alone. */
function addressHeader(value: string): string {
  return value
    .split(/,\s*/)
    .map((entry) => {
      const match = /^(.*?)\s*<([^>]+)>$/.exec(entry);
      return match ? `${/^[\x20-\x7e]*$/.test(match[1]) ? `"${match[1].replace(/"/g, "")}"` : encodedWord(match[1])} <${match[2]}>` : encodedWord(entry);
    })
    .join(", ");
}

function boundary(): string {
  const random = new Uint8Array(12);
  globalThis.crypto.getRandomValues(random);
  return `----=_keyis_${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The message as a standard MIME message: the text and HTML bodies as
 * alternatives, the attachments after them in base64, the pictures the
 * HTML shows kept inline under their Content-IDs.
 */
export function messageToEml(message: OutlookMessage): string {
  const lines: string[] = [];
  if (message.from) lines.push(`From: ${addressHeader(message.from)}`);
  if (message.to) lines.push(`To: ${addressHeader(message.to)}`);
  if (message.cc) lines.push(`Cc: ${addressHeader(message.cc)}`);
  lines.push(`Subject: ${encodedWord(message.subject ?? "")}`);
  if (message.date) lines.push(`Date: ${message.date.replace(/GMT$/, "+0000")}`);
  for (const name of ["Message-ID", "In-Reply-To", "References", "Reply-To"]) {
    const value = message.headers.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;
    if (value) lines.push(`${name}: ${value}`);
  }
  lines.push("MIME-Version: 1.0");

  const bodies: { type: string; bytes: Uint8Array }[] = [];
  if (message.text !== null) bodies.push({ type: "text/plain", bytes: new TextEncoder().encode(message.text) });
  if (message.html !== null) bodies.push({ type: "text/html", bytes: new TextEncoder().encode(message.html) });
  if (bodies.length === 0 && message.rtf) bodies.push({ type: "text/rtf", bytes: message.rtf });
  if (bodies.length === 0) bodies.push({ type: "text/plain", bytes: new Uint8Array(0) });

  const leaf = (type: string, bytes: Uint8Array) => [`Content-Type: ${type}; charset="utf-8"`, "Content-Transfer-Encoding: base64", "", base64Lines(bytes)];
  const alternative = (): string[] => {
    if (bodies.length === 1) return leaf(bodies[0].type, bodies[0].bytes);
    const mark = boundary();
    const out = [`Content-Type: multipart/alternative; boundary="${mark}"`, ""];
    for (const body of bodies) out.push(`--${mark}`, ...leaf(body.type, body.bytes));
    out.push(`--${mark}--`);
    return out;
  };

  if (message.attachments.length === 0) return [...lines, ...alternative(), ""].join("\r\n");
  const mark = boundary();
  const out = [...lines, `Content-Type: multipart/mixed; boundary="${mark}"`, "", "This is a multi-part message in MIME format.", `--${mark}`, ...alternative()];
  for (const attachment of message.attachments) {
    const name = encodeURIComponent(attachment.name).replace(/'/g, "%27");
    out.push(
      `--${mark}`,
      `Content-Type: ${attachment.type}; name="${attachment.name.replace(/[^\x20-\x7e]|"/g, "_")}"`,
      `Content-Disposition: ${attachment.inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      ...(attachment.contentId ? [`Content-ID: <${attachment.contentId}>`] : []),
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(attachment.bytes),
    );
  }
  out.push(`--${mark}--`, "");
  return out.join("\r\n");
}
