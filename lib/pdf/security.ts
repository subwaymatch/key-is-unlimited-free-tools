/**
 * PDF passwords, set and taken off, by the standard security handler.
 *
 * pdf-lib neither writes nor reads an encrypted PDF, so this does the
 * encryption itself on pdf-lib's objects: every string and every stream of
 * every object, each with its own random IV, and an /Encrypt dictionary
 * that says how to get the key back from a password.
 *
 * Protecting writes AES-256, revision 6, the handler PDF 2.0 defines and
 * Acrobat X onwards reads: a random 32-byte file key, sealed twice in the
 * dictionary - once under the password that opens the document and once
 * under the owner password that lifts its restrictions - by the iterated
 * SHA-256/384/512 hash of ISO 32000-2's algorithm 2.B. The ciphers are the
 * Web Crypto API's; the only ones written here are RC4, which no browser
 * offers and which reading an older file needs, and the MD5 the checksum
 * tool already has.
 *
 * Unlocking reads every revision in use: RC4 at 40 and 128 bits (1996 to
 * 2004), AES-128 (Acrobat 7) and AES-256 (revisions 5 and 6). It needs the
 * password - either one - and a file whose only lock is on printing or
 * copying has an empty password to open, so that one unlocks with nothing
 * typed at all. An object stream, which packs many objects into one
 * encrypted stream, is the awkward case: pdf-lib cannot read one it cannot
 * inflate and keeps it as an invalid object, so the stream is taken back
 * out of that, decrypted, and handed to pdf-lib's own object-stream parser.
 */
import type { PDFContext as PDFContextType, PDFDict as PDFDictType, PDFObject as PDFObjectType, PDFRef as PDFRefType } from "pdf-lib";

import { createDigest } from "../hash/digest";
import { PlainError, type PlainReport } from "../plainQueue";
import { describePdf } from "./pages";

type PdfLib = typeof import("pdf-lib");

/* ---- The primitives ------------------------------------------------------ */

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export function hexOf(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function bytesOfHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let index = 0; index < out.length; index += 1) out[index] = parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return out;
}

/** RC4, which the PDF handlers before AES used and no browser API offers. */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) state[index] = index;
  for (let index = 0, j = 0; index < 256; index += 1) {
    j = (j + state[index] + key[index % key.length]) & 0xff;
    [state[index], state[j]] = [state[j], state[index]];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    out[n] = data[n] ^ state[(state[i] + state[j]) & 0xff];
  }
  return out;
}

export function md5(...parts: readonly Uint8Array[]): Uint8Array {
  const digest = createDigest("md5");
  for (const part of parts) digest.update(part);
  return bytesOfHex(digest.hex());
}

function subtle(): SubtleCrypto {
  const crypto = globalThis.crypto?.subtle;
  if (!crypto) throw new PlainError("This browser cannot encrypt here.", "The Web Crypto API is missing, which happens on a page not served over HTTPS.");
  return crypto;
}

async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(`SHA-${bits}`, data as BufferSource));
}

function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", raw as BufferSource, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
}

const ZERO_IV = new Uint8Array(16);

/** AES-CBC. Without padding, `data` must be whole blocks, and the block Web Crypto always adds is dropped. */
async function cbcEncrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array, pad = true): Promise<Uint8Array> {
  const out = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, data as BufferSource));
  return pad ? out : out.subarray(0, data.length);
}

/**
 * AES-CBC decryption of whole blocks with no padding to remove.
 *
 * Web Crypto insists on PKCS#7 padding and fails without it. One more
 * block, made to decrypt to a whole block of padding, satisfies it: in CBC
 * a block decrypts to D(C) xor the block before, so the block wanted is
 * E(padding xor last block), which is what encrypting the padding with the
 * last block as the IV writes first.
 */
async function cbcDecryptRaw(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const whole = data.subarray(0, data.length - (data.length % 16));
  if (whole.length === 0) return new Uint8Array(0);
  const last = whole.subarray(whole.length - 16);
  const filler = (await cbcEncrypt(key, last, new Uint8Array(16).fill(16))).subarray(0, 16);
  return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, concatBytes(whole, filler) as BufferSource));
}

/** AES-CBC decryption of padded data, falling back to whole blocks when the padding is not what it should be. */
async function cbcDecrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length > 0 && data.length % 16 === 0) {
    try {
      return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, data as BufferSource));
    } catch {
      // A writer that padded wrongly; keep what the blocks hold.
    }
  }
  return cbcDecryptRaw(key, iv, data);
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/* ---- Keys from passwords ------------------------------------------------- */

/** The 32 bytes a short password is padded with, from the PDF specification. */
const PAD = bytesOfHex("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a");

function padded(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(password.subarray(0, 32));
  out.set(PAD.subarray(0, Math.max(0, 32 - password.length)), Math.min(32, password.length));
  return out;
}

/** A password as the older handlers take it: a byte per character, in PDFDocEncoding, which is Latin-1 for everything typeable. */
export function latin1Password(password: string): Uint8Array {
  return Uint8Array.from(Array.from(password), (ch) => {
    const code = ch.codePointAt(0) ?? 63;
    return code < 256 ? code : 63;
  });
}

/** A password as AES-256 takes it: UTF-8, normalized the way SASLprep would, at most 127 bytes. */
export function utf8Password(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize("NFKC")).subarray(0, 127);
}

function le32(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function xorKey(key: Uint8Array, value: number): Uint8Array {
  return key.map((byte) => byte ^ value);
}

export type CryptMethod = "none" | "rc4" | "aes128" | "aes256";

export interface SecurityHandler {
  v: number;
  r: number;
  /** In bytes. */
  keyLength: number;
  o: Uint8Array;
  u: Uint8Array;
  oe: Uint8Array | null;
  ue: Uint8Array | null;
  p: number;
  /** The first half of the trailer's /ID, which the older key derivation mixes in. */
  id: Uint8Array;
  encryptMetadata: boolean;
  strings: CryptMethod;
  streams: CryptMethod;
}

/** Algorithm 2: the file key of revisions 2 to 4, from a padded user password. */
export function legacyKey(password: Uint8Array, handler: SecurityHandler): Uint8Array {
  const n = handler.keyLength;
  let hash = md5(padded(password), handler.o.subarray(0, 32), le32(handler.p), handler.id, handler.r >= 4 && !handler.encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0));
  if (handler.r >= 3) for (let round = 0; round < 50; round += 1) hash = md5(hash.subarray(0, n));
  return hash.subarray(0, n);
}

/** Algorithms 4 and 5: the /U entry a key produces, compared as far as the revision defines it. */
function legacyUserMatches(key: Uint8Array, handler: SecurityHandler): boolean {
  if (handler.r === 2) return equalBytes(rc4(key, PAD), handler.u.subarray(0, 32));
  let x = rc4(key, md5(PAD, handler.id));
  for (let round = 1; round <= 19; round += 1) x = rc4(xorKey(key, round), x);
  return equalBytes(x.subarray(0, 16), handler.u.subarray(0, 16));
}

/** Algorithm 3 run backwards: the owner password decrypts /O to the padded user password. */
function legacyOwnerToUser(owner: Uint8Array, handler: SecurityHandler): Uint8Array {
  let hash = md5(padded(owner));
  if (handler.r >= 3) for (let round = 0; round < 50; round += 1) hash = md5(hash);
  const key = hash.subarray(0, handler.keyLength);
  let x = handler.o.subarray(0, 32);
  if (handler.r === 2) return rc4(key, x);
  for (let round = 19; round >= 0; round -= 1) x = rc4(xorKey(key, round), x);
  return x;
}

/** The O value of revisions 2 to 4 (algorithm 3), for writing an older-style file in the tests. */
export function legacyOwnerValue(owner: Uint8Array, user: Uint8Array, r: number, keyLength: number): Uint8Array {
  let hash = md5(padded(owner));
  if (r >= 3) for (let round = 0; round < 50; round += 1) hash = md5(hash);
  const key = hash.subarray(0, keyLength);
  let x = rc4(key, padded(user));
  if (r >= 3) for (let round = 1; round <= 19; round += 1) x = rc4(xorKey(key, round), x);
  return x;
}

/**
 * Algorithm 2.B: the hash revision 6 keys everything with. SHA-256 of the
 * password and a salt, then at least 64 rounds in which the password and
 * the previous hash, repeated 64 times, are encrypted with AES-128 keyed by
 * that hash, and the result hashed with SHA-256, -384 or -512 as the first
 * sixteen bytes of it say; revision 5 is the first SHA-256 alone.
 */
export async function hardenedHash(password: Uint8Array, salt: Uint8Array, userData: Uint8Array, r: number): Promise<Uint8Array> {
  let k = await sha(256, concatBytes(password, salt, userData));
  if (r === 5) return k;
  let last = 0;
  for (let round = 0; round < 64 || last > round - 32; round += 1) {
    const block = concatBytes(password, k.subarray(0, k.length), userData);
    const repeated = new Uint8Array(block.length * 64);
    for (let copy = 0; copy < 64; copy += 1) repeated.set(block, copy * block.length);
    const e = await cbcEncrypt(await aesKey(k.subarray(0, 16)), k.subarray(16, 32), repeated, false);
    let sum = 0;
    for (let index = 0; index < 16; index += 1) sum += e[index];
    const choice = sum % 3;
    k = await sha(choice === 0 ? 256 : choice === 1 ? 384 : 512, e);
    last = e[e.length - 1];
  }
  return k.subarray(0, 32);
}

/** Algorithm 2.A: the file key of revisions 5 and 6, from either password, or null when neither matches. */
async function modernKey(password: Uint8Array, handler: SecurityHandler): Promise<{ key: Uint8Array; owner: boolean } | null> {
  const { u, o, r } = handler;
  const u48 = u.subarray(0, 48);
  if (handler.oe && equalBytes(await hardenedHash(password, o.subarray(32, 40), u48, r), o.subarray(0, 32))) {
    const unwrap = await aesKey(await hardenedHash(password, o.subarray(40, 48), u48, r));
    return { key: await cbcDecryptRaw(unwrap, ZERO_IV, handler.oe.subarray(0, 32)), owner: true };
  }
  if (handler.ue && equalBytes(await hardenedHash(password, u.subarray(32, 40), new Uint8Array(0), r), u.subarray(0, 32))) {
    const unwrap = await aesKey(await hardenedHash(password, u.subarray(40, 48), new Uint8Array(0), r));
    return { key: await cbcDecryptRaw(unwrap, ZERO_IV, handler.ue.subarray(0, 32)), owner: false };
  }
  return null;
}

/** The file key for a typed password, tried as the user password and then as the owner's. */
export async function fileKey(password: string, handler: SecurityHandler): Promise<{ key: Uint8Array; owner: boolean } | null> {
  if (handler.r >= 5) return modernKey(utf8Password(password), handler);
  const typed = latin1Password(password);
  const asUser = legacyKey(typed, handler);
  if (legacyUserMatches(asUser, handler)) return { key: asUser, owner: false };
  const asOwner = legacyKey(legacyOwnerToUser(typed, handler), handler);
  if (legacyUserMatches(asOwner, handler)) return { key: asOwner, owner: true };
  return null;
}

/* ---- The /Encrypt dictionary --------------------------------------------- */

function bytesOf(pdf: PdfLib, value: PDFObjectType | undefined): Uint8Array | null {
  if (value instanceof pdf.PDFString || value instanceof pdf.PDFHexString) return value.asBytes();
  return null;
}

function numberOf(pdf: PdfLib, value: PDFObjectType | undefined, fallback: number): number {
  return value instanceof pdf.PDFNumber ? value.asNumber() : fallback;
}

/** How a crypt filter named in /StmF or /StrF encrypts, from the /CF dictionary. */
function cryptMethod(pdf: PdfLib, dict: PDFDictType, key: "StmF" | "StrF", v: number): CryptMethod {
  if (v < 4) return "rc4";
  const name = dict.lookup(pdf.PDFName.of(key));
  const filter = name instanceof pdf.PDFName ? name.decodeText() : "Identity";
  if (filter === "Identity") return "none";
  const filters = dict.lookup(pdf.PDFName.of("CF"));
  const entry = filters instanceof pdf.PDFDict ? filters.lookup(pdf.PDFName.of(filter)) : undefined;
  const method = entry instanceof pdf.PDFDict ? entry.lookup(pdf.PDFName.of("CFM")) : undefined;
  const cfm = method instanceof pdf.PDFName ? method.decodeText() : "None";
  if (cfm === "V2") return "rc4";
  if (cfm === "AESV2") return "aes128";
  if (cfm === "AESV3") return "aes256";
  if (cfm === "None") return "none";
  throw new PlainError(`This PDF uses a crypt filter this does not read (${cfm}).`, "Only the standard RC4 and AES filters are understood here.");
}

/** What the /Encrypt dictionary says, or a reason it cannot be opened with a password. */
export function readHandler(pdf: PdfLib, dict: PDFDictType, id: Uint8Array): SecurityHandler {
  const filter = dict.lookup(pdf.PDFName.of("Filter"));
  const filterName = filter instanceof pdf.PDFName ? filter.decodeText() : "";
  if (filterName !== "Standard") {
    throw new PlainError(
      "This PDF is locked to certificates, not a password.",
      filterName ? `Its security handler is ${filterName}, which opens with a digital ID installed on the recipient's computer. Only the recipient's own software can open it.` : "Its /Encrypt dictionary names no security handler.",
    );
  }
  const v = numberOf(pdf, dict.lookup(pdf.PDFName.of("V")), 0);
  const r = numberOf(pdf, dict.lookup(pdf.PDFName.of("R")), 2);
  const o = bytesOf(pdf, dict.lookup(pdf.PDFName.of("O")));
  const u = bytesOf(pdf, dict.lookup(pdf.PDFName.of("U")));
  if (!o || !u || ![1, 2, 4, 5].includes(v) || r < 2 || r > 6) {
    throw new PlainError("This PDF's encryption is not one this reads.", `It says version ${v}, revision ${r}. Every standard version from 1 to 5 is read here; this file's entries are missing or unusual.`);
  }
  const bits = numberOf(pdf, dict.lookup(pdf.PDFName.of("Length")), 40);
  const keyLength = v >= 5 ? 32 : v === 1 ? 5 : Math.max(5, Math.min(16, Math.floor(bits / 8)));
  const metadata = dict.lookup(pdf.PDFName.of("EncryptMetadata"));
  return {
    v,
    r,
    keyLength: v === 4 && keyLength < 16 ? 16 : keyLength,
    o,
    u,
    oe: bytesOf(pdf, dict.lookup(pdf.PDFName.of("OE"))),
    ue: bytesOf(pdf, dict.lookup(pdf.PDFName.of("UE"))),
    p: numberOf(pdf, dict.lookup(pdf.PDFName.of("P")), -4) | 0,
    id,
    encryptMetadata: !(metadata instanceof pdf.PDFBool) || metadata.asBoolean(),
    strings: cryptMethod(pdf, dict, "StrF", v),
    streams: cryptMethod(pdf, dict, "StmF", v),
  };
}

/** "AES-256", "RC4 128-bit": the encryption in words, for the card. */
export function describeHandler(handler: SecurityHandler): string {
  const method = handler.streams === "none" ? handler.strings : handler.streams;
  if (method === "aes256") return "AES-256";
  if (method === "aes128") return "AES-128";
  if (method === "rc4") return `RC4 ${handler.keyLength * 8}-bit`;
  return "no encryption on its content";
}

/** What an owner password on the file forbids, in words, from /P. */
export function describePermissions(p: number): string[] {
  const denied: string[] = [];
  if (!(p & 4)) denied.push("printing");
  if (!(p & 16)) denied.push("copying text");
  if (!(p & 8)) denied.push("editing");
  if (!(p & 32)) denied.push("comments");
  if (!(p & 256)) denied.push("filling forms");
  if (!(p & 1024)) denied.push("assembling pages");
  return denied;
}

/* ---- Walking the objects ------------------------------------------------- */

type Transform = (bytes: Uint8Array) => Promise<Uint8Array>;

/**
 * Every string inside an object replaced by `transform` of it. Dictionaries
 * and arrays are visited once, so one shared between two objects is not
 * transformed twice; a signature's /Contents is left alone, as the
 * specification says it is never encrypted.
 */
async function transformStrings(pdf: PdfLib, object: PDFObjectType, transform: Transform, seen: Set<PDFObjectType>): Promise<void> {
  if (seen.has(object)) return;
  if (object instanceof pdf.PDFDict) {
    seen.add(object);
    const signature = object.has(pdf.PDFName.of("ByteRange"));
    for (const [key, value] of object.entries()) {
      if (signature && key.decodeText() === "Contents") continue;
      if (value instanceof pdf.PDFString || value instanceof pdf.PDFHexString) object.set(key, pdf.PDFHexString.of(hexOf(await transform(value.asBytes()))));
      else await transformStrings(pdf, value, transform, seen);
    }
  } else if (object instanceof pdf.PDFArray) {
    seen.add(object);
    for (let index = 0; index < object.size(); index += 1) {
      const value = object.get(index);
      if (value instanceof pdf.PDFString || value instanceof pdf.PDFHexString) object.set(index, pdf.PDFHexString.of(hexOf(await transform(value.asBytes()))));
      else await transformStrings(pdf, value, transform, seen);
    }
  } else if (object instanceof pdf.PDFStream) {
    await transformStrings(pdf, object.dict, transform, seen);
  }
}

function typeOf(pdf: PdfLib, dict: PDFDictType): string | null {
  const type = dict.get(pdf.PDFName.of("Type"));
  return type instanceof pdf.PDFName ? type.decodeText() : null;
}

/** The object key of revisions 2 to 4 (algorithm 1): the file key salted with the object's number. */
function objectKey(key: Uint8Array, ref: PDFRefType, aes: boolean): Uint8Array {
  const n = ref.objectNumber;
  const g = ref.generationNumber;
  const salted = md5(key, Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, g & 0xff, (g >>> 8) & 0xff), aes ? Uint8Array.of(0x73, 0x41, 0x6c, 0x54) : new Uint8Array(0));
  return salted.subarray(0, Math.min(key.length + 5, 16));
}

/** The function that decrypts one object's strings or streams. */
function decrypter(method: CryptMethod, key: Uint8Array, ref: PDFRefType, fileKeyPromise: Promise<CryptoKey> | null): Transform {
  if (method === "none") return async (bytes) => bytes;
  if (method === "rc4") {
    const k = objectKey(key, ref, false);
    return async (bytes) => rc4(k, bytes);
  }
  const cryptoKey = method === "aes256" && fileKeyPromise ? fileKeyPromise : aesKey(objectKey(key, ref, true));
  return async (bytes) => (bytes.length < 32 ? new Uint8Array(0) : cbcDecrypt(await cryptoKey, bytes.subarray(0, 16), bytes.subarray(16)));
}

/* ---- Unlocking ----------------------------------------------------------- */

export interface UnlockResult {
  bytes: Uint8Array;
  /** "3 pages, A4". */
  description: string;
  /** "AES-256", "RC4 40-bit". */
  encryption: string;
  /** Opened with the owner password rather than the user's. */
  owner: boolean;
  /** What the file forbade, which the copy no longer does. */
  restrictions: string[];
  /** Whether the file opened with no password at all. */
  openedWithoutPassword: boolean;
}

async function loadEncrypted(bytes: Uint8Array) {
  const pdf = await import("pdf-lib");
  let document;
  try {
    document = await pdf.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (error) {
    throw new PlainError("This file could not be read as a PDF.", error instanceof Error ? error.message : String(error), { cause: error });
  }
  return { pdf, document, context: document.context };
}

function trailerId(pdf: PdfLib, context: PDFContextType): Uint8Array {
  const id = context.lookup(context.trailerInfo.ID);
  const first = id instanceof pdf.PDFArray ? id.lookup(0) : undefined;
  return bytesOf(pdf, first) ?? new Uint8Array(0);
}

/**
 * Object streams pdf-lib could not read because they were encrypted, read
 * now: each decrypted and parsed into the context, and the numbers of the
 * objects that came out of them returned, since those are already plain.
 */
async function recoverObjectStreams(pdf: PdfLib, context: PDFContextType, decrypt: (ref: PDFRefType) => Transform): Promise<Set<string>> {
  const plain = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof pdf.PDFInvalidObject)) continue;
    const data = (object as unknown as { data?: Uint8Array }).data;
    if (!data) continue;
    let parsed: PDFObjectType;
    try {
      parsed = pdf.PDFObjectParser.forBytes(data, context).parseObject();
    } catch {
      continue;
    }
    if (!(parsed instanceof pdf.PDFRawStream) || typeOf(pdf, parsed.dict) !== "ObjStm") continue;
    const stream = pdf.PDFRawStream.of(parsed.dict, await decrypt(ref)(parsed.contents));
    const decoded = pdf.decodePDFRawStream(stream).decode();
    const first = numberOf(pdf, parsed.dict.get(pdf.PDFName.of("First")), 0);
    const count = numberOf(pdf, parsed.dict.get(pdf.PDFName.of("N")), 0);
    const header = new TextDecoder("latin1").decode(decoded.subarray(0, first)).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count; index += 1) if (Number.isFinite(header[index * 2])) plain.add(`${header[index * 2]} 0`);
    try {
      await pdf.PDFObjectStreamParser.forStream(stream).parseIntoContext();
    } catch (error) {
      throw new PlainError("Part of this PDF could not be read after decrypting it.", error instanceof Error ? error.message : String(error), { cause: error });
    }
    context.delete(ref);
  }
  return plain;
}

/** A copy of an encrypted PDF with the encryption taken off, given either password. */
export async function unlockPdf(bytes: Uint8Array, password: string, report?: PlainReport): Promise<UnlockResult | null> {
  const { pdf, document, context } = await loadEncrypted(bytes);
  const encryptRef = context.trailerInfo.Encrypt;
  const encrypt = context.lookup(encryptRef);
  if (!(encrypt instanceof pdf.PDFDict)) return null;
  const handler = readHandler(pdf, encrypt, trailerId(pdf, context));

  report?.("Checking the password...", null);
  let opened = await fileKey("", handler);
  const openedWithoutPassword = opened !== null && !opened.owner;
  if (password !== "") opened = (await fileKey(password, handler)) ?? (openedWithoutPassword ? opened : null);
  if (!opened) {
    throw new PlainError(
      password === "" ? "This PDF needs its password to open." : "That password does not open this PDF.",
      password === "" ? "Type it in the settings above and drop the file again. Either password works: the one that opens it, or the owner's." : "Check the case and the keyboard layout. Either password works: the one that opens it, or the owner's.",
    );
  }
  const key = opened.key;
  const fileCryptoKey = handler.r >= 5 ? aesKey(key) : null;

  report?.("Decrypting...", 0);
  const plain = await recoverObjectStreams(pdf, context, (ref) => decrypter(handler.streams, key, ref, fileCryptoKey));
  const seen = new Set<PDFObjectType>();
  const objects = context.enumerateIndirectObjects();
  for (const [index, [ref, object]] of objects.entries()) {
    if (index % 50 === 0) report?.(`Decrypting object ${index + 1} of ${objects.length}...`, index / objects.length);
    if (ref === encryptRef || plain.has(`${ref.objectNumber} ${ref.generationNumber}`)) continue;
    await transformStrings(pdf, object, decrypter(handler.strings, key, ref, fileCryptoKey), seen);
    if (!(object instanceof pdf.PDFRawStream)) continue;
    const type = typeOf(pdf, object.dict);
    if (type === "XRef" || (type === "Metadata" && !handler.encryptMetadata)) continue;
    context.assign(ref, pdf.PDFRawStream.of(object.dict, await decrypter(handler.streams, key, ref, fileCryptoKey)(object.contents)));
  }

  context.trailerInfo.Encrypt = undefined;
  if (encryptRef instanceof pdf.PDFRef) context.delete(encryptRef);
  report?.("Saving...", null);
  return {
    bytes: await document.save({ addDefaultPage: false, updateFieldAppearances: false }),
    description: describePdf(document),
    encryption: describeHandler(handler),
    owner: opened.owner,
    restrictions: describePermissions(handler.p),
    openedWithoutPassword,
  };
}

/* ---- Protecting ---------------------------------------------------------- */

export interface Permissions {
  print: boolean;
  copy: boolean;
  edit: boolean;
}

/**
 * The /P value for what is allowed: every reserved bit set as revision 3
 * onwards requires, and the bits for what is not allowed cleared. Copying
 * for accessibility, bit 10, stays allowed whatever: current readers ignore
 * it, and a screen reader should not be the one thing locked out.
 */
export function permissionBits(allowed: Permissions): number {
  let p = ~3;
  if (!allowed.print) p &= ~(4 | 2048);
  if (!allowed.copy) p &= ~16;
  if (!allowed.edit) p &= ~(8 | 32 | 256 | 1024);
  return p | 0;
}

export interface ProtectOptions {
  /** The password that opens the file; empty for one that opens freely and only restricts. */
  userPassword: string;
  /** The password that lifts restrictions; random when not given, so nobody holds it. */
  ownerPassword?: string;
  permissions: Permissions;
}

/** The entries of an AES-256 /Encrypt dictionary for a file key (algorithms 8, 9 and 10). */
export async function aes256Entries(key: Uint8Array, user: Uint8Array, owner: Uint8Array, p: number): Promise<{ u: Uint8Array; ue: Uint8Array; o: Uint8Array; oe: Uint8Array; perms: Uint8Array }> {
  const userSalts = randomBytes(16);
  const u = concatBytes(await hardenedHash(user, userSalts.subarray(0, 8), new Uint8Array(0), 6), userSalts);
  const ue = await cbcEncrypt(await aesKey(await hardenedHash(user, userSalts.subarray(8, 16), new Uint8Array(0), 6)), ZERO_IV, key, false);
  const ownerSalts = randomBytes(16);
  const o = concatBytes(await hardenedHash(owner, ownerSalts.subarray(0, 8), u, 6), ownerSalts);
  const oe = await cbcEncrypt(await aesKey(await hardenedHash(owner, ownerSalts.subarray(8, 16), u, 6)), ZERO_IV, key, false);
  const block = concatBytes(le32(p), Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x54, 0x61, 0x64, 0x62), randomBytes(4));
  const perms = await cbcEncrypt(await aesKey(key), ZERO_IV, block, false);
  return { u, ue, o, oe, perms };
}

/** A copy of a PDF encrypted with AES-256, opening with the password given, and the document described. */
export async function protectPdf(bytes: Uint8Array, options: ProtectOptions, report?: PlainReport): Promise<{ bytes: Uint8Array; description: string }> {
  const { pdf, document, context } = await loadEncrypted(bytes);
  if (context.lookup(context.trailerInfo.Encrypt)) {
    throw new PlainError("This PDF already has a password.", "Take it off with Unlock PDF first, then protect the copy with the new one.");
  }
  const description = describePdf(document);
  const key = randomBytes(32);
  const cryptoKey = await aesKey(key);
  const encrypt: Transform = async (plain) => {
    const iv = randomBytes(16);
    return concatBytes(iv, await cbcEncrypt(cryptoKey, iv, plain));
  };

  const seen = new Set<PDFObjectType>();
  const objects = context.enumerateIndirectObjects();
  for (const [index, [ref, object]] of objects.entries()) {
    if (index % 50 === 0) report?.(`Encrypting object ${index + 1} of ${objects.length}...`, index / objects.length);
    if (object instanceof pdf.PDFInvalidObject) {
      throw new PlainError("Part of this PDF could not be read, so it cannot be encrypted safely.", "An object in it is damaged. Open it in a viewer, print it to a new PDF, and protect that.");
    }
    await transformStrings(pdf, object, encrypt, seen);
    if (object instanceof pdf.PDFStream && typeOf(pdf, object.dict) !== "XRef") {
      object.updateDict();
      context.assign(ref, pdf.PDFRawStream.of(object.dict, await encrypt(object.getContents())));
    }
  }

  report?.("Sealing the key...", null);
  const p = permissionBits(options.permissions);
  const owner = options.ownerPassword ? utf8Password(options.ownerPassword) : randomBytes(32);
  const entries = await aes256Entries(key, utf8Password(options.userPassword), owner, p);
  const hex = (value: Uint8Array) => pdf.PDFHexString.of(hexOf(value));
  const dict = context.obj({
    Filter: "Standard",
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { AuthEvent: "DocOpen", CFM: "AESV3", Length: 32 } },
    StmF: "StdCF",
    StrF: "StdCF",
    P: p,
    EncryptMetadata: true,
  });
  dict.set(pdf.PDFName.of("O"), hex(entries.o));
  dict.set(pdf.PDFName.of("U"), hex(entries.u));
  dict.set(pdf.PDFName.of("OE"), hex(entries.oe));
  dict.set(pdf.PDFName.of("UE"), hex(entries.ue));
  dict.set(pdf.PDFName.of("Perms"), hex(entries.perms));
  context.trailerInfo.Encrypt = context.register(dict);
  if (!context.lookup(context.trailerInfo.ID)) {
    const id = hexOf(randomBytes(16));
    context.trailerInfo.ID = context.obj([pdf.PDFHexString.of(id), pdf.PDFHexString.of(id)]);
  }
  // AES-256 arrived as an extension to PDF 1.7 before PDF 2.0 made it standard; say so, as Acrobat does.
  document.catalog.set(pdf.PDFName.of("Extensions"), context.obj({ ADBE: { BaseVersion: pdf.PDFName.of("1.7"), ExtensionLevel: 8 } }));

  report?.("Saving...", null);
  return { bytes: await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }), description };
}
