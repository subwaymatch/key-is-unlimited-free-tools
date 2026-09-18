/**
 * TAR archives, plain or gzipped, unpacked a chunk at a time.
 *
 * A TAR is a sequence of 512-byte headers each followed by a file's bytes
 * padded to 512, ending in two blocks of zeros: simple enough to read by
 * hand, and read here as the bytes arrive so a large archive never has to
 * be in memory whole. GNU's long-name entries and POSIX pax headers, which
 * carry a name too long for the 100 bytes the header has, are honoured;
 * links, devices and directories are skipped, since a browser has
 * nowhere to put them. A .tar.gz goes through fflate's streaming gunzip
 * first, and a .gz that turns out not to hold a TAR is one file.
 *
 * Pure apart from the file reads; tested on archives built in Node.
 */
import { Gunzip } from "fflate";

import { PlainError } from "../plainQueue";

export interface TarEntry {
  /** The path inside the archive. */
  path: string;
  /** The last part of it, for the download. */
  fileName: string;
  blob: Blob;
  size: number;
  /** Seconds since the epoch, when the header carried one. */
  modified: number | null;
}

export const BLOCK = 512;

export function isGzip(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

function fieldText(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && block[end] !== 0) end += 1;
  return new TextDecoder().decode(block.subarray(offset, end));
}

/** An octal field, or a base-256 one as GNU writes for sizes past 8 GB. */
function fieldNumber(block: Uint8Array, offset: number, length: number): number {
  if (block[offset] & 0x80) {
    let value = 0;
    for (let index = 1; index < length; index += 1) value = value * 256 + block[offset + index];
    return value;
  }
  const text = fieldText(block, offset, length).trim();
  return text === "" ? 0 : parseInt(text, 8);
}

export interface TarHeader {
  name: string;
  size: number;
  modified: number | null;
  /** The type flag: "0" or "" for a file, "5" a directory, "L" a GNU long name, "x" a pax header, and so on. */
  type: string;
}

/** Whether every byte of the block is zero: the end-of-archive marker. */
export function isZeroBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

/** The header a block holds, or null when its checksum says it is not one. */
export function parseTarHeader(block: Uint8Array): TarHeader | null {
  if (block.length < BLOCK) return null;
  const stored = fieldNumber(block, 148, 8);
  let unsigned = 0;
  let signed = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    const byte = index >= 148 && index < 156 ? 0x20 : block[index];
    unsigned += byte;
    signed += byte < 128 ? byte : byte - 256;
  }
  if (stored !== unsigned && stored !== signed) return null;
  const magic = fieldText(block, 257, 6);
  const prefix = magic.startsWith("ustar") ? fieldText(block, 345, 155) : "";
  const name = fieldText(block, 0, 100);
  const mtime = fieldNumber(block, 136, 12);
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size: fieldNumber(block, 124, 12),
    modified: Number.isFinite(mtime) && mtime > 0 ? mtime : null,
    type: String.fromCharCode(block[156] || 0x30).replace("\0", ""),
  };
}

/** Whether these first bytes are a TAR archive's. */
export function looksLikeTar(head: Uint8Array): boolean {
  return head.length >= BLOCK && parseTarHeader(head.subarray(0, BLOCK)) !== null;
}

/** The pax records of an extended header: "path", "size" and the rest. */
export function parsePaxRecords(text: string): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < text.length) {
    const space = text.indexOf(" ", at);
    if (space === -1) break;
    const length = Number(text.slice(at, space));
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, at + length - 1);
    const equals = record.indexOf("=");
    if (equals !== -1) records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return records;
}

/**
 * Reads entries out of TAR bytes that arrive in pieces.
 *
 * Holds at most one file's bytes at a time, plus whatever part of a block
 * the last piece cut short.
 */
export class TarReader {
  readonly entries: TarEntry[] = [];
  /** Entries skipped: directories, links, and things a browser cannot hold. */
  skipped = 0;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private header: TarHeader | null = null;
  private remaining = 0;
  private padding = 0;
  private parts: Uint8Array[] = [];
  private nextName: string | null = null;
  private paxName: string | null = null;
  private paxSize: number | null = null;
  private zeroBlocks = 0;
  private done = false;
  private sawHeader = false;

  push(chunk: Uint8Array): void {
    if (this.done || chunk.length === 0) return;
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    this.drain();
  }

  /** Whether the bytes seen so far read as a TAR at all. */
  get recognised(): boolean {
    return this.sawHeader;
  }

  end(): TarEntry[] {
    if (!this.sawHeader && this.pendingBytes > 0) {
      throw new PlainError("This file could not be read as a TAR archive.", "It does not start with a TAR header. It may be another kind of archive, such as 7z or RAR, which this does not open.");
    }
    if (this.header && this.remaining > 0) {
      throw new PlainError("The archive is cut short.", `It ends in the middle of "${this.header.name}"; the download may not have finished.`);
    }
    if (!this.done && this.pendingBytes > 0) {
      throw new PlainError("The archive is cut short.", "It ends in the middle of a header; the download may not have finished.");
    }
    return this.entries;
  }

  private take(length: number): Uint8Array | null {
    if (this.pendingBytes < length) return null;
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const first = this.pending[0];
      const need = length - filled;
      if (first.length <= need) {
        out.set(first, filled);
        filled += first.length;
        this.pending.shift();
      } else {
        out.set(first.subarray(0, need), filled);
        this.pending[0] = first.subarray(need);
        filled += need;
      }
    }
    this.pendingBytes -= length;
    return out;
  }

  private drain(): void {
    for (;;) {
      if (this.done) return;
      if (this.header) {
        if (this.remaining > 0) {
          const first = this.pending[0];
          if (!first) return;
          const piece = first.length <= this.remaining ? first : first.subarray(0, this.remaining);
          this.pending[0] = first.subarray(piece.length);
          if (this.pending[0].length === 0) this.pending.shift();
          this.pendingBytes -= piece.length;
          this.remaining -= piece.length;
          if (this.header.type === "L" || this.header.type === "x") this.parts.push(piece);
          else if (this.isFile(this.header)) this.parts.push(piece);
          continue;
        }
        if (this.padding > 0) {
          const skipped = this.take(this.padding);
          if (!skipped) return;
          this.padding = 0;
        }
        this.finishEntry();
        continue;
      }
      const block = this.take(BLOCK);
      if (!block) return;
      if (isZeroBlock(block)) {
        this.zeroBlocks += 1;
        if (this.zeroBlocks >= 2) this.done = true;
        continue;
      }
      this.zeroBlocks = 0;
      const header = parseTarHeader(block);
      if (!header) {
        if (!this.sawHeader) {
          this.done = true;
          return;
        }
        throw new PlainError("The archive is damaged.", "A block where a file header should be does not check out.");
      }
      this.sawHeader = true;
      this.header = header;
      this.remaining = header.size;
      this.padding = header.size % BLOCK === 0 ? 0 : BLOCK - (header.size % BLOCK);
      this.parts = [];
    }
  }

  private isFile(header: TarHeader): boolean {
    return header.type === "0" || header.type === "" || header.type === "7";
  }

  private finishEntry(): void {
    const header = this.header!;
    this.header = null;
    if (header.type === "L") {
      this.nextName = new TextDecoder().decode(concat(this.parts)).replace(/\0+$/, "");
      return;
    }
    if (header.type === "x") {
      const records = parsePaxRecords(new TextDecoder().decode(concat(this.parts)));
      this.paxName = records.get("path") ?? null;
      const size = records.get("size");
      this.paxSize = size !== undefined ? Number(size) : null;
      return;
    }
    if (header.type === "g") return;
    const name = this.paxName ?? this.nextName ?? header.name;
    this.nextName = null;
    this.paxName = null;
    this.paxSize = null;
    if (!this.isFile(header) || name.endsWith("/")) {
      this.skipped += 1;
      return;
    }
    const blob = new Blob(this.parts as BlobPart[]);
    this.parts = [];
    this.entries.push({ path: name, fileName: name.split("/").filter(Boolean).pop() || name, blob, size: blob.size, modified: header.modified });
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function* chunksOf(file: Blob, size = 4 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < file.size; at += size) yield new Uint8Array(await file.slice(at, at + size).arrayBuffer());
}

export interface ReadArchive {
  /** "tar", "tar.gz" or "gz" for a gzip that held one plain file. */
  kind: "tar" | "tar.gz" | "gz";
  entries: TarEntry[];
  skipped: number;
}

/**
 * The files in a TAR, a .tar.gz or a plain .gz, unpacked.
 *
 * A gzip stream is inflated as it arrives and the TAR read from the
 * inflated bytes; if the inflated bytes do not start with a header the
 * gzip held one file, and that is the entry.
 */
export async function readArchive(file: File, report?: (bytesDone: number) => void, signal?: AbortSignal): Promise<ReadArchive> {
  const head = new Uint8Array(await file.slice(0, BLOCK).arrayBuffer());
  const gzipped = isGzip(head);
  if (!gzipped && !looksLikeTar(head)) {
    throw new PlainError("This file could not be read as a TAR or gzip archive.", "It starts with neither a TAR header nor gzip's two bytes. It may be another kind of archive, such as 7z or RAR, which this does not open.");
  }
  const reader = new TarReader();
  // What the inflated bytes are is decided once the first block is in hand:
  // a TAR header, or the start of one plain file the gzip held.
  const state: { decided: "tar" | "plain" | null } = { decided: gzipped ? null : "tar" };
  const probe: Uint8Array[] = [];
  let probeBytes = 0;
  const plain: Uint8Array[] = [];
  let failure: Error | null = null;
  const feed = (chunk: Uint8Array) => {
    if (state.decided === "tar") reader.push(chunk);
    else plain.push(chunk);
  };
  const decide = () => {
    state.decided = probeBytes >= BLOCK && looksLikeTar(concat(probe)) ? "tar" : "plain";
    for (const chunk of probe) feed(chunk);
    probe.length = 0;
  };
  const onInflated = (chunk: Uint8Array) => {
    try {
      if (state.decided) {
        feed(chunk);
        return;
      }
      probe.push(chunk);
      probeBytes += chunk.length;
      if (probeBytes >= BLOCK) decide();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  };
  const gunzip = gzipped ? new Gunzip(onInflated) : null;
  let done = 0;
  for await (const chunk of chunksOf(file)) {
    if (signal?.aborted) throw new PlainError("Cancelled.");
    if (gunzip) {
      try {
        gunzip.push(chunk, false);
      } catch (error) {
        throw new PlainError("This gzip file could not be inflated.", error instanceof Error ? error.message : undefined, { cause: error });
      }
    } else {
      reader.push(chunk);
    }
    if (failure) throw failure;
    done += chunk.length;
    report?.(done);
  }
  if (gunzip) {
    try {
      gunzip.push(new Uint8Array(0), true);
    } catch (error) {
      throw new PlainError("This gzip file could not be inflated.", error instanceof Error ? error.message : undefined, { cause: error });
    }
    if (!state.decided) decide();
  }
  if (failure) throw failure;
  if (state.decided === "plain") {
    const blob = new Blob(plain as BlobPart[]);
    const fileName = file.name.replace(/\.(gz|gzip)$/i, "") || "file";
    return { kind: "gz", entries: [{ path: fileName, fileName, blob, size: blob.size, modified: null }], skipped: 0 };
  }
  const entries = reader.end();
  return { kind: gzipped ? "tar.gz" : "tar", entries, skipped: reader.skipped };
}
