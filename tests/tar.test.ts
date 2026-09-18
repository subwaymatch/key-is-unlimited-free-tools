import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { BLOCK, isGzip, looksLikeTar, parsePaxRecords, parseTarHeader, readArchive, TarReader } from "@/lib/zip/tar";

const encoder = new TextEncoder();

/** A header block as tar writes one: ustar, an octal size, a checksum. */
function header(name: string, size: number, type = "0"): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const write = (offset: number, text: string) => block.set(encoder.encode(text), offset);
  write(0, name.slice(0, 100));
  write(100, "0000644\0");
  write(108, "0001750\0");
  write(116, "0001750\0");
  write(124, `${size.toString(8).padStart(11, "0")}\0`);
  write(136, "14000000000\0");
  write(148, "        ");
  block[156] = type.charCodeAt(0);
  write(257, "ustar\0");
  write(263, "00");
  let sum = 0;
  for (const byte of block) sum += byte;
  write(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

function padded(data: Uint8Array): Uint8Array {
  const length = Math.ceil(data.length / BLOCK) * BLOCK;
  const out = new Uint8Array(length);
  out.set(data);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((sum, part) => sum + part.length, 0)));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  for (let index = 0; index < length; index += 1) out[index] = (index * 7 + 3) & 0xff;
  return out;
}

const LONG_NAME = `${"deep/".repeat(20)}file-with-a-long-name.txt`;

/** A pax record: its own length in decimal, counted with the digits of the length. */
function paxLine(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length) length += 1;
  return `${length}${body}`;
}

/** An archive with a small file, a directory, a padded file, a GNU long name and a pax name. */
function archive(): Uint8Array<ArrayBuffer> {
  const big = bytesOf(1000);
  const longNameBytes = encoder.encode(`${LONG_NAME}\0`);
  const paxBytes = encoder.encode(paxLine("path", `${LONG_NAME}x`));
  return concat([
    header("a.txt", 2),
    padded(encoder.encode("hi")),
    header("dir/", 0, "5"),
    header("dir/b.bin", big.length),
    padded(big),
    header("././@LongLink", longNameBytes.length, "L"),
    padded(longNameBytes),
    header(LONG_NAME.slice(0, 100), 3),
    padded(encoder.encode("abc")),
    header("./PaxHeaders/x", paxBytes.length, "x"),
    padded(paxBytes),
    header("short", 1),
    padded(encoder.encode("z")),
    header("link", 0, "2"),
    new Uint8Array(BLOCK * 2),
  ]);
}

describe("TAR headers", () => {
  it("parses a block and rejects one whose checksum is wrong", () => {
    const block = header("a/b.txt", 1234);
    expect(parseTarHeader(block)).toEqual({ name: "a/b.txt", size: 1234, modified: 1_610_612_736, type: "0" });
    expect(looksLikeTar(block)).toBe(true);
    block[10] ^= 0xff;
    expect(parseTarHeader(block)).toBeNull();
    expect(looksLikeTar(new Uint8Array(BLOCK))).toBe(false);
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 8]))).toBe(true);
    expect(isGzip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });

  it("reads pax records", () => {
    const records = parsePaxRecords("11 path=ab\n14 size=12345\n");
    expect(records.get("path")).toBe("ab");
    expect(records.get("size")).toBe("12345");
  });
});

describe("reading a TAR", () => {
  it("finds every file however the bytes are chunked, skipping what is not a file", async () => {
    const bytes = archive();
    for (const size of [1, 7, 512, 1000, 5000, bytes.length]) {
      const reader = new TarReader();
      for (let at = 0; at < bytes.length; at += size) reader.push(bytes.subarray(at, at + size));
      const entries = reader.end();
      expect(entries.map((entry) => entry.path), `chunks of ${size}`).toEqual(["a.txt", "dir/b.bin", LONG_NAME, `${LONG_NAME}x`]);
      expect(entries.map((entry) => entry.size)).toEqual([2, 1000, 3, 1]);
      expect(entries[2].fileName).toBe("file-with-a-long-name.txt");
      expect(new Uint8Array(await entries[1].blob.arrayBuffer())).toEqual(bytesOf(1000));
      expect(await entries[3].blob.text()).toBe("z");
      expect(reader.skipped).toBe(2);
    }
  });

  it("reads plain, gzipped and gzipped-but-not-a-TAR files", async () => {
    const plain = await readArchive(new File([archive()], "x.tar"));
    expect(plain.kind).toBe("tar");
    expect(plain.entries).toHaveLength(4);
    const seen: number[] = [];
    const zipped = await readArchive(new File([gzipSync(archive())], "x.tar.gz"), (done) => seen.push(done));
    expect(zipped.kind).toBe("tar.gz");
    expect(zipped.entries.map((entry) => entry.path)[1]).toBe("dir/b.bin");
    expect(seen[seen.length - 1]).toBe(gzipSync(archive()).length);
    const single = await readArchive(new File([gzipSync(encoder.encode("just text\n".repeat(200)))], "notes.txt.gz"));
    expect(single.kind).toBe("gz");
    expect(single.entries[0].fileName).toBe("notes.txt");
    expect(await single.entries[0].blob.text()).toBe("just text\n".repeat(200));
    const tiny = await readArchive(new File([gzipSync(encoder.encode("hi"))], "hi.gz"));
    expect(tiny.kind).toBe("gz");
    expect(await tiny.entries[0].blob.text()).toBe("hi");
  });

  it("refuses what it cannot read, with the reason", async () => {
    await expect(readArchive(new File([bytesOf(2000)], "x.tar"))).rejects.toThrow(/could not be read as a TAR or gzip/);
    const cut = archive().subarray(0, BLOCK * 3 + 100);
    await expect(readArchive(new File([cut], "x.tar"))).rejects.toThrow(/cut short/);
    const reader = new TarReader();
    reader.push(bytesOf(600));
    expect(() => reader.end()).toThrow(/could not be read as a TAR/);
  });
});
