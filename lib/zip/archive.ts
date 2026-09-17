/**
 * ZIP archives through fflate: several files packed into one, and one
 * unpacked into its files.
 *
 * fflate is plain JavaScript under the MIT licence, and streams: a file
 * is read in pieces and each piece deflated as it arrives, so the heap
 * holds the archive being written and not the files going in. It does not
 * write or read ZIP64, so an archive or an entry past 4 GB is refused with
 * a reason rather than corrupted.
 */
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";

import { PlainError } from "../plainQueue";

/**
 * Formats that are already compressed, which deflate would only make slower.
 *
 * PDF is not one of them, whatever its reputation: a PDF's images are
 * already compressed but its page content, fonts and cross-reference tables
 * are usually not, and a text document typically deflates by 10 to 30 per
 * cent. The archives - zip, docx, apk and the rest - are containers whose
 * entries are deflated inside, so a second pass gains nothing.
 */
const STORED_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif",
  "mp3", "m4a", "aac", "ogg", "opus", "flac", "wma",
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "apk", "docx", "xlsx", "pptx", "epub", "odt", "woff", "woff2",
]);

/** The most a ZIP without ZIP64 can hold, per entry and in all. */
export const MAX_ZIP_BYTES = 4 * 1024 ** 3 - 1;

export function shouldStore(name: string): boolean {
  return STORED_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? "");
}

/** Names inside the archive, with a repeated one told apart by a number. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const times = seen.get(name) ?? 0;
    seen.set(name, times + 1);
    if (times === 0) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${times + 1})${name.slice(dot)}` : `${name} (${times + 1})`;
  });
}

async function* chunksOf(file: File, size = 4 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < file.size; at += size) {
    yield new Uint8Array(await file.slice(at, at + size).arrayBuffer());
  }
}

/** One archive from these files, in order, deflated where that helps. */
export async function createZip(files: readonly File[], report?: (bytesDone: number) => void, signal?: AbortSignal): Promise<Blob> {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ZIP_BYTES || files.some((file) => file.size > MAX_ZIP_BYTES)) {
    throw new PlainError("These files are too large for a ZIP without ZIP64.", "This writes classic ZIP, which holds up to 4 GB per file and in all. Make more than one archive.");
  }
  const parts: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else parts.push(chunk);
  });
  const names = uniqueNames(files.map((file) => file.name));
  let done = 0;
  for (const [index, file] of files.entries()) {
    const name = names[index];
    const entry = shouldStore(name) ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    entry.mtime = new Date(file.lastModified);
    zip.add(entry);
    for await (const chunk of chunksOf(file)) {
      if (signal?.aborted) throw new PlainError("Cancelled.");
      entry.push(chunk, false);
      done += chunk.length;
      report?.(done);
      if (failure) throw failure;
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}

export interface ZipEntry {
  /** The path inside the archive. */
  path: string;
  /** The last part of it, for the download. */
  fileName: string;
  blob: Blob;
  size: number;
}

/** Every file in the archive, unpacked, in archive order. Folders themselves are skipped. */
export async function readZip(file: File, report?: (bytesDone: number) => void, signal?: AbortSignal): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const pending: Promise<void>[] = [];
  let failure: Error | null = null;
  const unzip = new Unzip((entry) => {
    if (entry.name.endsWith("/")) return;
    const parts: Uint8Array[] = [];
    pending.push(
      new Promise<void>((resolve, reject) => {
        entry.ondata = (error, chunk, final) => {
          if (error) {
            reject(error);
            return;
          }
          parts.push(chunk);
          if (final) {
            const blob = new Blob(parts as BlobPart[]);
            entries.push({ path: entry.name, fileName: entry.name.split("/").pop() || entry.name, blob, size: blob.size });
            resolve();
          }
        };
        try {
          entry.start();
        } catch (error) {
          reject(error);
        }
      }),
    );
  });
  unzip.register(UnzipInflate);
  let done = 0;
  try {
    for await (const chunk of chunksOf(file)) {
      if (signal?.aborted) throw new PlainError("Cancelled.");
      // fflate skips quietly past bytes it does not recognise; a file that
      // does not even start with the local header signature is not a ZIP.
      if (done === 0 && !(chunk[0] === 0x50 && chunk[1] === 0x4b)) {
        throw new PlainError("This file could not be read as a ZIP.", "It does not start the way a ZIP archive does. It may be another kind of archive, such as 7z or RAR, which this does not open.");
      }
      unzip.push(chunk, false);
      done += chunk.length;
      report?.(done);
    }
    unzip.push(new Uint8Array(0), true);
    await Promise.all(pending);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  if (failure) {
    if (failure instanceof PlainError) throw failure;
    const message = failure.message;
    if (/encrypt/i.test(message)) {
      throw new PlainError("This archive is password-protected.", "Encrypted ZIPs cannot be opened here. Unpack it with the password on your computer first.", { cause: failure });
    }
    if (/zip64|unsupported/i.test(message)) {
      throw new PlainError("This archive uses ZIP64, which this cannot read.", "Archives and entries past 4 GB are written as ZIP64. Unpack it on your computer.", { cause: failure });
    }
    if (/invalid zip|zip data/i.test(message) && entries.length === 0) {
      throw new PlainError("This file could not be read as a ZIP.", message, { cause: failure });
    }
    throw new PlainError("The archive could not be unpacked completely.", message, { cause: failure });
  }
  return entries;
}
