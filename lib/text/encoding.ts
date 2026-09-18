/**
 * What encoding a text file is in, what line endings it uses, and the same
 * text written another way.
 *
 * The browser decodes anything with a name, but it has to be told the name,
 * and a file does not carry one: a byte-order mark says UTF-8 or UTF-16
 * outright, a file that decodes as UTF-8 without a fault almost certainly
 * is, a run of zero bytes in every other position is UTF-16 without a mark,
 * and what is left is read as Windows-1252, which is what most old text
 * files from Windows are. Line endings are counted rather than guessed.
 *
 * Pure, and tested on byte arrays.
 */

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface DetectedEncoding {
  encoding: TextEncoding;
  /** The file starts with a byte-order mark. */
  bom: boolean;
  /** Worded for a card: "UTF-8 with a byte-order mark". */
  label: string;
  /** False when the encoding was assumed rather than shown by the bytes. */
  sure: boolean;
}

const UTF8_LABEL = "UTF-8";

/** Whether the bytes are valid UTF-8, allowing for a sequence cut short at the end of a sample. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let end = bytes.length;
  // Walk back over a multi-byte sequence the sample may have cut in half.
  for (let back = 1; back <= 3 && end - back >= 0; back += 1) {
    const byte = bytes[end - back];
    if ((byte & 0xc0) === 0x80) continue;
    if (byte >= 0xc0) end -= back;
    break;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/** Whether a sample has the zero bytes of a text file that is not text at all. */
export function looksBinary(sample: Uint8Array): boolean {
  let zeros = 0;
  for (const byte of sample) if (byte === 0) zeros += 1;
  return zeros > 0 && !looksUtf16(sample);
}

/** UTF-16 without a mark: zero bytes in most of the odd positions (little-endian) or the even ones (big-endian). */
function looksUtf16(sample: Uint8Array): "utf-16le" | "utf-16be" | null {
  if (sample.length < 4) return null;
  let even = 0;
  let odd = 0;
  const pairs = Math.floor(sample.length / 2);
  for (let index = 0; index < pairs * 2; index += 2) {
    if (sample[index] === 0) even += 1;
    if (sample[index + 1] === 0) odd += 1;
  }
  if (odd > pairs * 0.3 && even < pairs * 0.05) return "utf-16le";
  if (even > pairs * 0.3 && odd < pairs * 0.05) return "utf-16be";
  return null;
}

export function detectEncoding(sample: Uint8Array): DetectedEncoding {
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return { encoding: "utf-8", bom: true, label: `${UTF8_LABEL} with a byte-order mark`, sure: true };
  }
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    return { encoding: "utf-16le", bom: true, label: "UTF-16 little-endian with a byte-order mark", sure: true };
  }
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) {
    return { encoding: "utf-16be", bom: true, label: "UTF-16 big-endian with a byte-order mark", sure: true };
  }
  const utf16 = looksUtf16(sample);
  if (utf16) {
    return { encoding: utf16, bom: false, label: `UTF-16 ${utf16 === "utf-16le" ? "little" : "big"}-endian without a byte-order mark`, sure: false };
  }
  if (isValidUtf8(sample)) {
    const ascii = sample.every((byte) => byte < 0x80);
    return { encoding: "utf-8", bom: false, label: ascii ? "ASCII, which is also UTF-8" : UTF8_LABEL, sure: true };
  }
  return { encoding: "windows-1252", bom: false, label: "Windows-1252, probably: not UTF-8, so read as the Windows default", sure: false };
}

/** Text out of bytes in pieces, in the encoding named, with a byte-order mark dropped. */
export async function* decodeChunks(chunks: AsyncIterable<Uint8Array>, encoding: TextEncoding): AsyncGenerator<string> {
  const decoder = new TextDecoder(encoding);
  for await (const chunk of chunks) {
    const text = decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

export type OutputEncoding = "utf-8" | "utf-8-bom" | "utf-16le";

export const OUTPUT_ENCODINGS: readonly { id: OutputEncoding; label: string; blurb: string }[] = [
  { id: "utf-8", label: "UTF-8", blurb: "What everything reads and writes today; no byte-order mark" },
  { id: "utf-8-bom", label: "UTF-8 with a byte-order mark", blurb: "What Excel needs to read accents in a CSV" },
  { id: "utf-16le", label: "UTF-16 (Windows)", blurb: "Little-endian with a byte-order mark, as Notepad's Unicode" },
];

/** The text as bytes in an output encoding. */
export function encodeText(text: string, encoding: OutputEncoding): Uint8Array {
  if (encoding === "utf-16le") {
    const out = new Uint8Array(2 + text.length * 2);
    out[0] = 0xff;
    out[1] = 0xfe;
    for (let index = 0; index < text.length; index += 1) {
      const unit = text.charCodeAt(index);
      out[2 + index * 2] = unit & 0xff;
      out[3 + index * 2] = unit >> 8;
    }
    return out;
  }
  const body = new TextEncoder().encode(text);
  if (encoding === "utf-8") return body;
  const out = new Uint8Array(3 + body.length);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

export interface LineEndingCounts {
  crlf: number;
  lf: number;
  cr: number;
}

export function countLineEndings(text: string): LineEndingCounts {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charCodeAt(index);
    if (ch === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        crlf += 1;
        index += 1;
      } else {
        cr += 1;
      }
    } else if (ch === 10) {
      lf += 1;
    }
  }
  return { crlf, lf, cr };
}

/** "CRLF (Windows)", "LF (Unix)", "mixed: 12 CRLF and 3 LF", or "one line". */
export function describeLineEndings(counts: LineEndingCounts): string {
  const kinds = [
    { name: "CRLF", count: counts.crlf, note: "Windows" },
    { name: "LF", count: counts.lf, note: "Unix, macOS and the web" },
    { name: "CR", count: counts.cr, note: "classic Mac OS" },
  ].filter((kind) => kind.count > 0);
  if (kinds.length === 0) return "no line breaks";
  if (kinds.length === 1) return `${kinds[0].name} (${kinds[0].note})`;
  return `mixed: ${kinds.map((kind) => `${kind.count} ${kind.name}`).join(" and ")}`;
}

export type NewlineChoice = "keep" | "lf" | "crlf";

export const NEWLINE_OPTIONS: readonly { id: NewlineChoice; label: string; blurb: string }[] = [
  { id: "keep", label: "Keep them", blurb: "Only the encoding changes" },
  { id: "lf", label: "LF", blurb: "Unix, macOS, Git and the web" },
  { id: "crlf", label: "CRLF", blurb: "Windows, and what Notepad expects" },
];

/** Every line break made the same. */
export function normalizeNewlines(text: string, newline: Exclude<NewlineChoice, "keep">): string {
  return text.replace(/\r\n|\r|\n/g, newline === "lf" ? "\n" : "\r\n");
}

/** Spaces and tabs at the end of every line gone. */
export function trimTrailingSpaces(text: string): string {
  return text.replace(/[ \t]+(?=\r\n|\r|\n|$)/g, "");
}

/** A line break at the end of the file, if it lacked one. */
export function ensureFinalNewline(text: string, newline: "\n" | "\r\n"): string {
  if (text === "" || /[\r\n]$/.test(text)) return text;
  return `${text}${newline}`;
}
