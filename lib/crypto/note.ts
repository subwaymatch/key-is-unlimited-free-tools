/**
 * An encrypted note as text that travels anywhere: a link whose fragment
 * carries the sealed bytes, or an armoured block to paste into a message.
 *
 * The fragment - everything after # - is never sent to a server by a
 * browser, and it holds only the sealed note; the passphrase is never part
 * of it. The sealed bytes are the site's passphrase format, so the same
 * note can also be written out as a self-opening page.
 */

export const ARMOR_BEGIN = "-----BEGIN KEY.IS ENCRYPTED NOTE-----";
export const ARMOR_END = "-----END KEY.IS ENCRYPTED NOTE-----";

/** The fragment's key: https://key.is/encrypt-note#note=... */
export const FRAGMENT_KEY = "note=";

export class NoteFormatError extends Error {}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1024) binary += String.fromCharCode(...bytes.subarray(index, index + 1024));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normal + "=".repeat((4 - (normal.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new NoteFormatError("This is not an encrypted note: it has characters a note never has.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function noteLink(origin: string, sealed: Uint8Array): string {
  return `${origin}/encrypt-note#${FRAGMENT_KEY}${toBase64(sealed).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function noteArmor(sealed: Uint8Array): string {
  const body = toBase64(sealed).match(/.{1,64}/g) ?? [];
  return [ARMOR_BEGIN, ...body, ARMOR_END].join("\n");
}

/** The sealed bytes from a link, an armoured block, or bare base64, whichever was pasted. */
export function parseNote(input: string): Uint8Array {
  const text = input.trim();
  if (text === "") throw new NoteFormatError("Paste the link or the encrypted text first.");
  const fragment = text.indexOf(`#${FRAGMENT_KEY}`);
  let body: string;
  if (fragment >= 0) body = text.slice(fragment + 1 + FRAGMENT_KEY.length).split(/[&\s]/)[0];
  else if (text.includes(ARMOR_BEGIN)) {
    const end = text.indexOf(ARMOR_END);
    if (end < 0) throw new NoteFormatError("The encrypted text is cut off: its END line is missing.");
    body = text.slice(text.indexOf(ARMOR_BEGIN) + ARMOR_BEGIN.length, end);
  } else body = text;
  const compact = body.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]+=*$/.test(compact)) throw new NoteFormatError("This is not an encrypted note: it has characters a note never has.");
  const sealed = fromBase64(compact);
  if (sealed.length < 56 || String.fromCharCode(...sealed.subarray(0, 8)) !== "KEYISENC") throw new NoteFormatError("This is not an encrypted note, or part of it is missing.");
  return sealed;
}
