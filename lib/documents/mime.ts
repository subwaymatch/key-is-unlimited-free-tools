/**
 * An e-mail message - an .eml file - taken apart: its headers, its text and
 * HTML bodies, and its attachments.
 *
 * An .eml is the message exactly as it travelled, in the MIME format every
 * mail program writes: headers, a blank line, and a body that may be split
 * into parts by a boundary line, each part with headers of its own and
 * possibly split again. Everything that was not plain ASCII has been
 * encoded to travel - base64 or quoted-printable bodies, `=?UTF-8?B?...?=`
 * words in the headers, `filename*=UTF-8''...` for an attachment's name -
 * and all of it is decoded here.
 *
 * The file is read as Latin-1, one character per byte, so the structure can
 * be found with string methods while every byte of an 8-bit body survives
 * to be decoded in whatever character set its part names.
 */
import { htmlToText } from "../text/html";

export interface MimeHeader {
  name: string;
  /** Unfolded, not yet decoded. */
  value: string;
}

export interface MimePart {
  headers: MimeHeader[];
  /** "text/plain", lower case. */
  type: string;
  params: Record<string, string>;
  disposition: string | null;
  dispositionParams: Record<string, string>;
  /** The body with its transfer encoding undone; empty for a multipart. */
  body: Uint8Array;
  parts: MimePart[];
}

/** A byte string - one character per byte - as bytes. */
export function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

/** Bytes in a named character set, falling back to Windows-1252 when the browser does not know it. */
export function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const label = (charset ?? "utf-8").trim().replace(/^"|"$/g, "").toLowerCase();
  try {
    return new TextDecoder(label === "us-ascii" || label === "ascii" ? "windows-1252" : label).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const table = new Int16Array(128).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < 64; index += 1) table[alphabet.charCodeAt(index)] = index;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let length = 0;
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < clean.length; index += 1) {
    buffer = (buffer << 6) | table[clean.charCodeAt(index)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, length);
}

/** Quoted-printable undone: soft line breaks joined, =XX escapes turned back into bytes. */
export function decodeQuotedPrintable(text: string, header = false): Uint8Array {
  const source = header ? text.replace(/_/g, " ") : text.replace(/=\r?\n/g, "");
  const out = new Uint8Array(source.length);
  let length = 0;
  for (let index = 0; index < source.length; index += 1) {
    const ch = source.charCodeAt(index);
    if (ch === 0x3d && /^[0-9A-Fa-f]{2}$/.test(source.slice(index + 1, index + 3))) {
      out[length++] = parseInt(source.slice(index + 1, index + 3), 16);
      index += 2;
    } else out[length++] = ch & 0xff;
  }
  return out.subarray(0, length);
}

/**
 * A header value with its encoded words decoded: `=?UTF-8?B?w6k=?=` is
 * "e" with an acute accent. Whitespace between two encoded words is
 * dropped, as RFC 2047 says, so a subject split across several comes back
 * whole.
 */
export function decodeWords(value: string): string {
  const pattern = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g;
  let out = "";
  let at = 0;
  let previousWasWord = false;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const between = value.slice(at, match.index);
    if (!(previousWasWord && /^\s*$/.test(between))) out += decodeCharset(latin1Bytes(between), "utf-8");
    const charset = match[1].split("*")[0];
    const bytes = match[2].toUpperCase() === "B" ? decodeBase64(match[3]) : decodeQuotedPrintable(match[3], true);
    out += decodeCharset(bytes, charset);
    at = match.index + match[0].length;
    previousWasWord = true;
  }
  const rest = value.slice(at);
  // Raw 8-bit headers, which RFC 2047 forbids and plenty of senders write, are usually UTF-8.
  return out + (/[\u0080-\u00ff]/.test(rest) ? decodeCharset(latin1Bytes(rest), "utf-8") : rest);
}

/** The headers of a block of header lines, continuation lines joined to the line they continue. */
export function parseHeaders(block: string): MimeHeader[] {
  const headers: MimeHeader[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length > 0) {
      headers[headers.length - 1].value += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0) headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  return headers;
}

export function header(headers: readonly MimeHeader[], name: string): string | null {
  const lower = name.toLowerCase();
  for (const entry of headers) if (entry.name.toLowerCase() === lower) return entry.value;
  return null;
}

/**
 * A structured header's value and parameters: `text/plain; charset="utf-8"`.
 * RFC 2231's extended parameters are joined and decoded -
 * `filename*0*=UTF-8''%E6%97%A5; filename*1*=%E6%9C%AC` - and a parameter
 * written with encoded words, which RFC 2231 was meant to replace and
 * Outlook still writes, is decoded too.
 */
export function parseParams(value: string): { value: string; params: Record<string, string> } {
  const pieces: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (ch === '"' && value[index - 1] !== "\\") quoted = !quoted;
    if (ch === ";" && !quoted) {
      pieces.push(current);
      current = "";
    } else current += ch;
  }
  pieces.push(current);
  const main = pieces.shift()?.trim().toLowerCase() ?? "";
  const extended = new Map<string, { index: number; text: string; encoded: boolean }[]>();
  const params: Record<string, string> = {};
  for (const piece of pieces) {
    const equals = piece.indexOf("=");
    if (equals < 0) continue;
    const rawKey = piece.slice(0, equals).trim().toLowerCase();
    let text = piece.slice(equals + 1).trim();
    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) text = text.slice(1, -1).replace(/\\(.)/g, "$1");
    const star = /^([^*]+)\*(?:(\d+)\*?)?$/.exec(rawKey);
    const continued = /^([^*]+)\*(\d+)(\*)?$/.exec(rawKey);
    if (continued) {
      const list = extended.get(continued[1]) ?? [];
      list.push({ index: Number(continued[2]), text, encoded: Boolean(continued[3]) });
      extended.set(continued[1], list);
    } else if (star) {
      extended.set(star[1], [{ index: 0, text, encoded: true }]);
    } else params[rawKey] = decodeWords(text);
  }
  for (const [key, list] of extended) {
    list.sort((a, b) => a.index - b.index);
    let charset = "utf-8";
    const bytes: number[] = [];
    for (const [position, entry] of list.entries()) {
      let text = entry.text;
      if (entry.encoded && position === 0) {
        const parts = /^([^']*)'[^']*'(.*)$/.exec(text);
        if (parts) {
          charset = parts[1] || charset;
          text = parts[2];
        }
      }
      if (entry.encoded) {
        for (let index = 0; index < text.length; index += 1) {
          if (text[index] === "%" && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
            bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
            index += 2;
          } else bytes.push(text.charCodeAt(index) & 0xff);
        }
      } else for (let index = 0; index < text.length; index += 1) bytes.push(text.charCodeAt(index) & 0xff);
    }
    params[key] = decodeCharset(Uint8Array.from(bytes), charset);
  }
  return { value: main, params };
}

function transferDecode(body: string, encoding: string): Uint8Array {
  const kind = encoding.trim().toLowerCase();
  if (kind === "base64") return decodeBase64(body);
  if (kind === "quoted-printable") return decodeQuotedPrintable(body);
  return latin1Bytes(body);
}

/** Where the headers end: the first empty line. */
function splitHead(text: string): { head: string; body: string } {
  const match = /\r?\n\r?\n/.exec(text);
  if (!match) return { head: text, body: "" };
  return { head: text.slice(0, match.index), body: text.slice(match.index + match[0].length) };
}

/** One part, and every part inside it, from its text as Latin-1. */
export function parsePart(text: string, depth = 0): MimePart {
  const { head, body } = splitHead(text);
  const headers = parseHeaders(head);
  const contentType = parseParams(header(headers, "Content-Type") ?? "text/plain; charset=us-ascii");
  const disposition = header(headers, "Content-Disposition");
  const parsedDisposition = disposition ? parseParams(disposition) : null;
  const part: MimePart = {
    headers,
    type: contentType.value || "text/plain",
    params: contentType.params,
    disposition: parsedDisposition?.value ?? null,
    dispositionParams: parsedDisposition?.params ?? {},
    body: new Uint8Array(0),
    parts: [],
  };
  const boundary = contentType.params.boundary;
  if (part.type.startsWith("multipart/") && boundary && depth < 30) {
    const delimiter = `--${boundary}`;
    const lines = body.split(/\r?\n/);
    let current: string[] | null = null;
    for (const line of lines) {
      if (line.startsWith(delimiter)) {
        const closing = line.slice(delimiter.length).startsWith("--");
        if (current) part.parts.push(parsePart(current.join("\r\n"), depth + 1));
        current = closing ? null : [];
        if (closing) break;
        continue;
      }
      if (current) current.push(line);
    }
    if (current && current.length > 0) part.parts.push(parsePart(current.join("\r\n"), depth + 1));
    return part;
  }
  part.body = transferDecode(body, header(headers, "Content-Transfer-Encoding") ?? "7bit");
  return part;
}

export interface Attachment {
  name: string;
  type: string;
  bytes: Uint8Array;
  /** The Content-ID an HTML body refers to it by, without the angle brackets. */
  contentId: string | null;
  /** Shown in the body rather than attached to it. */
  inline: boolean;
}

export interface Email {
  headers: MimeHeader[];
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string | null;
  text: string | null;
  html: string | null;
  attachments: Attachment[];
}

const EXTENSIONS: Record<string, string> = {
  "text/plain": "txt",
  "text/html": "html",
  "text/calendar": "ics",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "message/rfc822": "eml",
  "application/zip": "zip",
};

/** A name safe to save under: no folders, no characters a file system refuses. */
export function safeFileName(name: string, fallback: string): string {
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 180);
  return clean || fallback;
}

function partName(part: MimePart, index: number): string {
  const named = part.dispositionParams.filename ?? part.params.name;
  if (named) return safeFileName(named, `attachment-${index}`);
  if (part.type === "message/rfc822") {
    const inner = splitHead(new TextDecoder("latin1").decode(part.body)).head;
    const subject = header(parseHeaders(inner), "Subject");
    return safeFileName(subject ? `${decodeWords(subject)}.eml` : "", `message-${index}.eml`);
  }
  return `attachment-${index}.${EXTENSIONS[part.type] ?? "bin"}`;
}

/** The message's headers, bodies and attachments. */
export function readEmail(bytes: Uint8Array): Email {
  const root = parsePart(new TextDecoder("latin1").decode(bytes));
  const email: Email = {
    headers: root.headers,
    subject: null,
    from: null,
    to: null,
    cc: null,
    date: null,
    text: null,
    html: null,
    attachments: [],
  };
  for (const key of ["subject", "from", "to", "cc", "date"] as const) {
    const value = header(root.headers, key);
    email[key] = value === null ? null : decodeWords(value);
  }
  let count = 0;
  const walk = (part: MimePart) => {
    if (part.parts.length > 0) {
      for (const entry of part.parts) walk(entry);
      return;
    }
    const named = Boolean(part.dispositionParams.filename ?? part.params.name);
    const attached = part.disposition === "attachment" || (named && part.disposition !== "inline" && !part.type.startsWith("text/"));
    if (!attached && !named && part.type === "text/plain" && email.text === null) {
      email.text = decodeCharset(part.body, part.params.charset);
      return;
    }
    if (!attached && !named && part.type === "text/html" && email.html === null) {
      email.html = decodeCharset(part.body, part.params.charset);
      return;
    }
    if (part.body.length === 0 && !named) return;
    count += 1;
    const contentId = header(part.headers, "Content-ID")?.replace(/^<|>$/g, "").trim() || null;
    email.attachments.push({ name: partName(part, count), type: part.type, bytes: part.body, contentId, inline: !attached && part.disposition !== "attachment" && contentId !== null });
  };
  walk(root);
  return email;
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The HTML body as a page to open: the pictures it shows by Content-ID
 * written into it as data URLs so it is complete on its own, scripts and
 * event handlers taken out, and the message's headers above it.
 */
export function viewableHtml(email: Email): string | null {
  if (email.html === null) return null;
  let html = email.html;
  for (const attachment of email.attachments) {
    if (!attachment.contentId) continue;
    const url = `data:${attachment.type};base64,${base64Of(attachment.bytes)}`;
    html = html.split(`cid:${attachment.contentId}`).join(url);
  }
  html = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  const rows = (["from", "to", "cc", "date", "subject"] as const)
    .filter((key) => email[key])
    .map((key) => `<tr><th style="text-align:left;padding-right:1em;vertical-align:top">${key[0].toUpperCase()}${key.slice(1)}</th><td>${escapeHtml(email[key]!)}</td></tr>`)
    .join("");
  const banner = `<table style="font:14px system-ui,sans-serif;border-bottom:1px solid #ccc;margin:0 0 1em;padding:0 0 0.5em">${rows}</table>`;
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, `<body$1>${banner}`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(email.subject ?? "Message")}</title></head><body>${banner}${html}</body></html>`;
}

/** The message as a text file: its headers, then its words, from the HTML body when there is no plain one. */
export function messageText(email: Email): string {
  const lines: string[] = [];
  for (const key of ["from", "to", "cc", "date", "subject"] as const) if (email[key]) lines.push(`${key[0].toUpperCase()}${key.slice(1)}: ${email[key]}`);
  const attachments = email.attachments.filter((attachment) => !attachment.inline);
  if (attachments.length > 0) lines.push(`Attachments: ${attachments.map((attachment) => attachment.name).join(", ")}`);
  const body = email.text ?? (email.html ? htmlToText(email.html) : "");
  return `${lines.join("\n")}\n\n${body.replace(/\r\n/g, "\n").trim()}\n`;
}
