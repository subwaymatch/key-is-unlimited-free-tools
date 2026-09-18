import { describe, expect, it } from "vitest";

import {
  countLineEndings,
  decodeChunks,
  describeLineEndings,
  detectEncoding,
  encodeText,
  ensureFinalNewline,
  isValidUtf8,
  looksBinary,
  normalizeNewlines,
  trimTrailingSpaces,
} from "@/lib/text/encoding";

const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16le(text: string, bom = true): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  let at = 0;
  if (bom) {
    out[0] = 0xff;
    out[1] = 0xfe;
    at = 2;
  }
  for (let index = 0; index < text.length; index += 1) {
    out[at + index * 2] = text.charCodeAt(index) & 0xff;
    out[at + index * 2 + 1] = text.charCodeAt(index) >> 8;
  }
  return out;
}

describe("detecting an encoding", () => {
  it("reads the byte-order marks", () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toMatchObject({ encoding: "utf-8", bom: true, sure: true });
    expect(detectEncoding(utf16le("hi"))).toMatchObject({ encoding: "utf-16le", bom: true });
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toMatchObject({ encoding: "utf-16be", bom: true });
  });

  it("tells ASCII, UTF-8, UTF-16 without a mark and Windows-1252 apart", () => {
    expect(detectEncoding(utf8("plain text\n"))).toMatchObject({ encoding: "utf-8", bom: false, label: "ASCII, which is also UTF-8" });
    expect(detectEncoding(utf8("café\n"))).toMatchObject({ encoding: "utf-8", label: "UTF-8" });
    expect(detectEncoding(utf16le("hello there", false))).toMatchObject({ encoding: "utf-16le", bom: false, sure: false });
    expect(detectEncoding(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]))).toMatchObject({ encoding: "windows-1252", sure: false });
  });

  it("forgives a multi-byte sequence the sample cut in half", () => {
    const bytes = utf8("café 影");
    expect(isValidUtf8(bytes.subarray(0, bytes.length - 1))).toBe(true);
    expect(isValidUtf8(bytes.subarray(0, bytes.length - 2))).toBe(true);
    expect(isValidUtf8(new Uint8Array([0x41, 0xff, 0x42]))).toBe(false);
  });

  it("spots a binary file by its zero bytes, but not UTF-16", () => {
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x0d]))).toBe(true);
    expect(looksBinary(utf16le("hello", false))).toBe(false);
    expect(looksBinary(utf8("text"))).toBe(false);
  });
});

describe("decoding and encoding", () => {
  it("decodes chunks split inside a character", async () => {
    const bytes = utf8("aéb影c");
    async function* chunks() {
      yield bytes.subarray(0, 2);
      yield bytes.subarray(2, 5);
      yield bytes.subarray(5);
    }
    const parts: string[] = [];
    for await (const part of decodeChunks(chunks(), "utf-8")) parts.push(part);
    expect(parts.join("")).toBe("aéb影c");
  });

  it("drops a byte-order mark on the way in and writes one on the way out when asked", async () => {
    async function* chunks() {
      yield utf16le("hi");
    }
    const parts: string[] = [];
    for await (const part of decodeChunks(chunks(), "utf-16le")) parts.push(part);
    expect(parts.join("")).toBe("hi");
    expect(Array.from(encodeText("A", "utf-8"))).toEqual([0x41]);
    expect(Array.from(encodeText("A", "utf-8-bom"))).toEqual([0xef, 0xbb, 0xbf, 0x41]);
    expect(Array.from(encodeText("Aé", "utf-16le"))).toEqual([0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00]);
  });
});

describe("line endings", () => {
  it("counts and describes them", () => {
    expect(countLineEndings("a\r\nb\nc\rd")).toEqual({ crlf: 1, lf: 1, cr: 1 });
    expect(describeLineEndings({ crlf: 3, lf: 0, cr: 0 })).toBe("CRLF (Windows)");
    expect(describeLineEndings({ crlf: 0, lf: 3, cr: 0 })).toBe("LF (Unix, macOS and the web)");
    expect(describeLineEndings({ crlf: 2, lf: 1, cr: 0 })).toBe("mixed: 2 CRLF and 1 LF");
    expect(describeLineEndings({ crlf: 0, lf: 0, cr: 0 })).toBe("no line breaks");
  });

  it("rewrites, trims and finishes lines", () => {
    expect(normalizeNewlines("a\r\nb\rc\nd", "lf")).toBe("a\nb\nc\nd");
    expect(normalizeNewlines("a\r\nb\nc", "crlf")).toBe("a\r\nb\r\nc");
    expect(trimTrailingSpaces("a  \r\nb\t\nc ")).toBe("a\r\nb\nc");
    expect(ensureFinalNewline("a\nb", "\n")).toBe("a\nb\n");
    expect(ensureFinalNewline("a\nb\n", "\n")).toBe("a\nb\n");
    expect(ensureFinalNewline("", "\r\n")).toBe("");
  });
});
