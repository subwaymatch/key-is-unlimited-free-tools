/**
 * A TAR written by hand, plain or gzipped, from files read a piece at a
 * time.
 *
 * The mirror of the reader: a 512-byte ustar header before each file,
 * the file's bytes padded to a block, two zero blocks at the end. A name
 * too long for the header's 100 bytes goes in the ustar prefix when a
 * slash lets it split, and otherwise in a GNU long-name entry ahead of
 * the file, which every tar of the last thirty years reads.
 */
import { Gzip } from "fflate";

import { PlainError } from "../plainQueue";
import { BLOCK } from "./tar";

const encoder = new TextEncoder();

/** An octal field can count to 8 GB; larger wants base-256, which this does not write. */
export const MAX_TAR_ENTRY = 8 * 1024 ** 3 - 1;

function octal(value: number, length: number): Uint8Array {
  return encoder.encode(`${value.toString(8).padStart(length - 1, "0")}\0`);
}

/** The part of a name the header's 100-byte field takes and the part its 155-byte prefix takes. */
export function splitTarName(name: string): { prefix: string; name: string } | null {
  if (encoder.encode(name).length <= 100) return { prefix: "", name };
  const parts = name.split("/");
  for (let cut = parts.length - 1; cut >= 1; cut -= 1) {
    const prefix = parts.slice(0, cut).join("/");
    const rest = parts.slice(cut).join("/");
    if (encoder.encode(prefix).length <= 155 && encoder.encode(rest).length <= 100 && rest.length > 0) return { prefix, name: rest };
  }
  return null;
}

/** One header block: ustar, mode 644, the size and time in octal, the checksum filled in. */
export function tarHeader(name: string, size: number, modifiedSeconds: number, type = "0", prefix = ""): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const nameBytes = encoder.encode(name);
  block.set(nameBytes.subarray(0, 100), 0);
  block.set(encoder.encode("0000644\0"), 100);
  block.set(encoder.encode("0000000\0"), 108);
  block.set(encoder.encode("0000000\0"), 116);
  block.set(octal(size, 12), 124);
  block.set(octal(Math.max(0, Math.floor(modifiedSeconds)), 12), 136);
  block.set(encoder.encode("        "), 148);
  block[156] = type.charCodeAt(0);
  block.set(encoder.encode("ustar\0"), 257);
  block.set(encoder.encode("00"), 263);
  if (prefix) block.set(encoder.encode(prefix).subarray(0, 155), 345);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.set(encoder.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
  return block;
}

/** The zero bytes that bring a file's data up to a whole block. */
export function tarPadding(size: number): Uint8Array {
  const remainder = size % BLOCK;
  return new Uint8Array(remainder === 0 ? 0 : BLOCK - remainder);
}

/**
 * The header blocks for one entry: a GNU long-name entry first when the
 * name fits neither the field nor the prefix.
 */
export function entryHeaders(name: string, size: number, modifiedSeconds: number): Uint8Array[] {
  const split = splitTarName(name);
  if (split) return [tarHeader(split.name, size, modifiedSeconds, "0", split.prefix)];
  const longName = encoder.encode(`${name}\0`);
  return [tarHeader("././@LongLink", longName.length, modifiedSeconds, "L"), longName, tarPadding(longName.length), tarHeader(name.slice(0, 100), size, modifiedSeconds)];
}

/** The two zero blocks that end an archive. */
export function tarEnd(): Uint8Array {
  return new Uint8Array(BLOCK * 2);
}

/** A whole archive in memory from entries already in memory: for tests and small things. */
export function tarBytes(entries: readonly { name: string; data: Uint8Array; modifiedSeconds?: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    parts.push(...entryHeaders(entry.name, entry.data.length, entry.modifiedSeconds ?? 0), entry.data, tarPadding(entry.data.length));
  }
  parts.push(tarEnd());
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

/** Names inside the archive: a folder path kept, a repeated name told apart by a number. */
export function archivePaths(files: readonly { name: string }[]): string[] {
  const seen = new Map<string, number>();
  return files.map((file) => {
    const clean = file.name.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/") || "file";
    const times = seen.get(clean) ?? 0;
    seen.set(clean, times + 1);
    if (times === 0) return clean;
    const dot = clean.lastIndexOf(".");
    const slash = clean.lastIndexOf("/");
    return dot > slash + 1 ? `${clean.slice(0, dot)} (${times + 1})${clean.slice(dot)}` : `${clean} (${times + 1})`;
  });
}

/**
 * One archive of these files, read a piece at a time, gzipped on the way
 * out when asked. The output is held in memory, compressed if it is
 * compressed, which is the archive being made and not the files going in.
 */
export async function createTar(files: readonly File[], gzip: boolean, report?: (bytesDone: number) => void, signal?: AbortSignal): Promise<Blob> {
  const large = files.find((file) => file.size > MAX_TAR_ENTRY);
  if (large) throw new PlainError(`${large.name} is too large for a TAR entry.`, "A header's size field counts to 8 GB. Split the file first.");
  const parts: Uint8Array[] = [];
  let failure: Error | null = null;
  const compressor = gzip ? new Gzip({ level: 6 }) : null;
  if (compressor) {
    compressor.ondata = (chunk) => {
      parts.push(chunk);
    };
  }
  const emit = (bytes: Uint8Array, final = false) => {
    if (bytes.length === 0 && !final) return;
    if (compressor) compressor.push(bytes, final);
    else if (bytes.length > 0) parts.push(bytes);
  };
  const names = archivePaths(files);
  let done = 0;
  try {
    for (const [index, file] of files.entries()) {
      for (const header of entryHeaders(names[index], file.size, file.lastModified / 1000)) emit(header);
      for await (const chunk of chunksOf(file)) {
        if (signal?.aborted) throw new PlainError("Cancelled.");
        emit(chunk);
        done += chunk.length;
        report?.(done);
      }
      emit(tarPadding(file.size));
    }
    emit(tarEnd(), true);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  if (failure) throw failure;
  return new Blob(parts as BlobPart[], { type: gzip ? "application/gzip" : "application/x-tar" });
}
