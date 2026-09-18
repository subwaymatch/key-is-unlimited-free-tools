/**
 * A file encrypted with a passphrase, and decrypted with it, on the
 * browser's own Web Crypto.
 *
 * Nothing here is invented: the key comes from the passphrase through
 * PBKDF2 with SHA-256 and a random salt, the bytes are sealed with
 * AES-256-GCM, and a long file is sealed a chunk at a time the way the
 * streaming constructions in Tink and age do it, so a multi-gigabyte file
 * is never decrypted into memory whole and a chunk cannot be dropped,
 * repeated or swapped without the check failing. Each chunk's nonce is a
 * random prefix, the chunk's number and a flag on the last one, and the
 * header is bound to every chunk as associated data, so the parameters
 * cannot be changed after the fact either.
 *
 * The format is this site's own, which is the honest limit: a file sealed
 * here is opened here, with the same passphrase, and nowhere else. Pure
 * apart from the Web Crypto calls, and tested at every chunk boundary.
 */
import { PlainError } from "../plainQueue";

/** "KEYISENC", the first eight bytes of a sealed file. */
const MAGIC = new Uint8Array([0x4b, 0x45, 0x59, 0x49, 0x53, 0x45, 0x4e, 0x43]);
const FORMAT_VERSION = 1;

export const SALT_BYTES = 16;
export const NONCE_PREFIX_BYTES = 7;
export const TAG_BYTES = 16;
/** Magic, version, salt, iterations, chunk size, nonce prefix. */
export const HEADER_BYTES = MAGIC.length + 1 + SALT_BYTES + 4 + 4 + NONCE_PREFIX_BYTES;

/** OWASP's 2023 figure for PBKDF2 with SHA-256; a second or so on a phone. */
export const DEFAULT_ITERATIONS = 600_000;
export const DEFAULT_CHUNK_BYTES = 1024 * 1024;

/** Fewer characters than this is a passphrase a laptop guesses in an afternoon. */
export const MIN_PASSPHRASE_LENGTH = 8;

export interface SealHeader {
  salt: Uint8Array;
  iterations: number;
  chunkBytes: number;
  noncePrefix: Uint8Array;
  /** The header's own bytes, bound to every chunk. */
  bytes: Uint8Array;
}

/** Whether a file starts the way a sealed one does. */
export function isSealed(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  return MAGIC.every((byte, index) => bytes[index] === byte);
}

export function writeHeader(salt: Uint8Array, iterations: number, chunkBytes: number, noncePrefix: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  bytes[MAGIC.length] = FORMAT_VERSION;
  bytes.set(salt, MAGIC.length + 1);
  view.setUint32(MAGIC.length + 1 + SALT_BYTES, iterations);
  view.setUint32(MAGIC.length + 1 + SALT_BYTES + 4, chunkBytes);
  bytes.set(noncePrefix, MAGIC.length + 1 + SALT_BYTES + 8);
  return bytes;
}

export function readHeader(bytes: Uint8Array): SealHeader {
  if (!isSealed(bytes) || bytes.length < HEADER_BYTES) {
    throw new PlainError("This file was not encrypted here.", "It does not start the way a file sealed on this page does. Drop a file to encrypt it, or one from this page to decrypt it.");
  }
  if (bytes[MAGIC.length] !== FORMAT_VERSION) {
    throw new PlainError("This file was sealed by a newer version of this page.", `It is format version ${bytes[MAGIC.length]}; this page reads version ${FORMAT_VERSION}.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const salt = bytes.slice(MAGIC.length + 1, MAGIC.length + 1 + SALT_BYTES);
  const iterations = view.getUint32(MAGIC.length + 1 + SALT_BYTES);
  const chunkBytes = view.getUint32(MAGIC.length + 1 + SALT_BYTES + 4);
  const noncePrefix = bytes.slice(MAGIC.length + 1 + SALT_BYTES + 8, HEADER_BYTES);
  if (iterations < 1000 || chunkBytes < 1 || chunkBytes > 64 * 1024 * 1024) {
    throw new PlainError("This file's header is damaged.", "The parameters in it are not ones this page writes.");
  }
  return { salt, iterations, chunkBytes, noncePrefix, bytes: bytes.slice(0, HEADER_BYTES) };
}

/** The twelve-byte nonce of one chunk: the prefix, the chunk's number, and whether it is the last. */
export function chunkNonce(prefix: Uint8Array, counter: number, last: boolean): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(prefix, 0);
  new DataView(nonce.buffer).setUint32(NONCE_PREFIX_BYTES, counter);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new PlainError("This browser has no Web Crypto.", "Encryption needs a browser from the last few years, over HTTPS.");
  return api;
}

/** The AES key for a passphrase and a salt. */
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const api = subtle();
  const material = await api.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return api.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** How many chunks a plaintext of this size seals into: at least one, so an empty file still has its check. */
export function chunkCount(plainBytes: number, chunkBytes: number): number {
  return Math.max(1, Math.ceil(plainBytes / chunkBytes));
}

/** The size of the sealed file, for the card. */
export function sealedSize(plainBytes: number, chunkBytes = DEFAULT_CHUNK_BYTES): number {
  return HEADER_BYTES + plainBytes + chunkCount(plainBytes, chunkBytes) * TAG_BYTES;
}

export interface SealOptions {
  iterations?: number;
  chunkBytes?: number;
}

export type SealReport = (phase: string, ratio: number | null) => void;

const CANCELLED = () => new PlainError("Cancelled.");

/** The file sealed under the passphrase. */
export async function encryptBlob(source: Blob, passphrase: string, options: SealOptions = {}, report?: SealReport, signal?: AbortSignal): Promise<Blob> {
  const api = subtle();
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const prefix = crypto.getRandomValues(new Uint8Array(NONCE_PREFIX_BYTES));
  const header = writeHeader(salt, iterations, chunkBytes, prefix);
  report?.("Deriving the key from the passphrase...", null);
  const key = await deriveKey(passphrase, salt, iterations);
  const parts: BlobPart[] = [header as BlobPart];
  const count = chunkCount(source.size, chunkBytes);
  for (let index = 0; index < count; index += 1) {
    if (signal?.aborted) throw CANCELLED();
    const plain = new Uint8Array(await source.slice(index * chunkBytes, (index + 1) * chunkBytes).arrayBuffer());
    const sealed = await api.encrypt({ name: "AES-GCM", iv: chunkNonce(prefix, index, index === count - 1) as BufferSource, additionalData: header as BufferSource }, key, plain as BufferSource);
    parts.push(sealed);
    report?.(`Encrypting... ${index + 1} of ${count}`, (index + 1) / count);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

/** The file opened with the passphrase, or the reason it could not be. */
export async function decryptBlob(source: Blob, passphrase: string, report?: SealReport, signal?: AbortSignal): Promise<Blob> {
  const api = subtle();
  const head = new Uint8Array(await source.slice(0, HEADER_BYTES).arrayBuffer());
  const header = readHeader(head);
  const body = source.size - HEADER_BYTES;
  const sealedChunk = header.chunkBytes + TAG_BYTES;
  const count = Math.ceil(body / sealedChunk);
  if (count < 1 || body - (count - 1) * sealedChunk < TAG_BYTES) {
    throw new PlainError("This file is damaged or cut short.", "It ends in the middle of a block. A copy that did not finish downloading looks like this.");
  }
  report?.("Deriving the key from the passphrase...", null);
  const key = await deriveKey(passphrase, header.salt, header.iterations);
  const parts: BlobPart[] = [];
  for (let index = 0; index < count; index += 1) {
    if (signal?.aborted) throw CANCELLED();
    const at = HEADER_BYTES + index * sealedChunk;
    const sealed = new Uint8Array(await source.slice(at, Math.min(source.size, at + sealedChunk)).arrayBuffer());
    const last = index === count - 1;
    let plain: ArrayBuffer;
    try {
      plain = await api.decrypt({ name: "AES-GCM", iv: chunkNonce(header.noncePrefix, index, last) as BufferSource, additionalData: header.bytes as BufferSource }, key, sealed as BufferSource);
    } catch (error) {
      if (index === 0) {
        throw new PlainError("Wrong passphrase, or the file has been changed.", "The first block did not check out. The passphrase is the likeliest reason; a damaged or edited file is the other.", { cause: error });
      }
      throw new PlainError("The file has been changed or cut short.", `Block ${index + 1} of ${count} did not check out. The passphrase is right, since the first block opened.`, { cause: error });
    }
    parts.push(plain);
    report?.(`Decrypting... ${index + 1} of ${count}`, (index + 1) / count);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

/** "photo.jpg" -> "photo.jpg.enc"; the reverse on the way back, or "-decrypted" when the name gives nothing away. */
export function sealedName(fileName: string): string {
  return `${fileName}.enc`;
}

export function unsealedName(fileName: string): string {
  if (/\.enc$/i.test(fileName)) return fileName.slice(0, -4);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? `${fileName.slice(0, dot)}-decrypted${fileName.slice(dot)}` : `${fileName}-decrypted`;
}
