/**
 * Personal data found in a CSV and replaced: the columns that hold names,
 * e-mail addresses, phone numbers, street addresses, IP addresses, card
 * numbers, national ID numbers and birth dates, found by their header and
 * by what their cells look like, then pseudonymised, hashed, masked or
 * removed.
 *
 * Pseudonyms are consistent within the file - the same address becomes the
 * same user12@example.com wherever it appears, in any column of that kind -
 * so a pseudonymised table can still be joined and counted. Hashes are
 * salted with a random value made for each run and then forgotten, so a
 * hash cannot be looked up in a table of hashed addresses.
 */
import { createDigest } from "../hash/digest";
import { findColumn } from "./tables";

export type PiiKind = "email" | "phone" | "name" | "address" | "ip" | "card" | "national-id" | "birth" | "other";

export const PII_LABELS: Record<PiiKind, string> = {
  email: "e-mail",
  phone: "phone",
  name: "name",
  address: "address",
  ip: "IP address",
  card: "card number",
  "national-id": "ID number",
  birth: "birth date",
  other: "chosen",
};

export type AnonymizeAction = "pseudonym" | "hash" | "mask" | "remove";

export const ANONYMIZE_ACTIONS: readonly { id: AnonymizeAction; label: string; blurb: string }[] = [
  { id: "pseudonym", label: "Replace with stand-ins", blurb: "Person 12, user12@example.com: the same value always gets the same one" },
  { id: "mask", label: "Mask", blurb: "J*** S***, j***@e***.com, ***-**-1234: enough to recognise, not to read" },
  { id: "hash", label: "Hash", blurb: "A salted SHA-256: rows still match each other, nothing can be read back" },
  { id: "remove", label: "Remove the columns", blurb: "The columns are taken out of the file" },
];

export interface Detected {
  index: number;
  kind: PiiKind;
  how: "header" | "content" | "chosen";
}

const HEADER_HINTS: [PiiKind, RegExp][] = [
  ["email", /\be ?mail/],
  ["ip", /\bip\b|ip ?addr/],
  ["card", /card ?(number|num|no)\b|credit ?card|\bpan\b|\bccn?\b/],
  ["national-id", /\bssn\b|social ?security|national ?(insurance|id)|\bnin\b|tax ?id|\btin\b|passport|\bsin\b|driver'?s? ?licen[cs]e/],
  ["birth", /birth|\bdob\b|\bd\.o\.b\b/],
  ["phone", /phone|mobile|\btel\b|telephone|\bcell\b|\bfax\b/],
  ["address", /address|street|\baddr\b|post ?code|zip ?code|\bzip\b|postal/],
  ["name", /^(full |first |last |middle |given |family |sur|maiden |customer |contact |patient |employee |client |person )?name$|^(forename|surname|first|last)$/],
];

/** A header as the hints read it: lower case, underscores and dashes as spaces. */
function headerWords(name: string): string {
  return name.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
}

export function headerKind(name: string): PiiKind | null {
  const words = headerWords(name);
  if (words === "") return null;
  for (const [kind, pattern] of HEADER_HINTS) if (pattern.test(words)) return kind;
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SSN = /^\d{3}-\d{2}-\d{4}$/;

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function isIp(value: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) return v4.slice(1).every((part) => Number(part) <= 255);
  return /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i.test(value) && value.includes("::") !== value.startsWith(":::");
}

/** What a single cell looks like, when it looks like personal data. */
export function valueKind(raw: string): PiiKind | null {
  const value = raw.trim();
  if (value === "") return null;
  if (EMAIL.test(value)) return "email";
  if (SSN.test(value)) return "national-id";
  if (isIp(value)) return "ip";
  const digits = digitsOf(value);
  if (/^[\d\s-]+$/.test(value) && digits.length >= 13 && digits.length <= 19 && luhn(digits)) return "card";
  if (/^\+?[\d\s().-]+$/.test(value) && /[\s().+-]/.test(value) && digits.length >= 7 && digits.length <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "phone";
  return null;
}

/**
 * The columns that hold personal data: named for it in the header, or
 * with most of their filled cells looking like it. `extra` names more
 * columns to treat, and `keep` columns to leave alone whatever they hold.
 */
export function detectColumns(rows: readonly (readonly string[])[], extra: string, keep: string): Detected[] {
  const header = rows[0] ?? [];
  const width = header.length;
  const kept = new Set(keep.split(",").map((spec) => findColumn(header, spec, width)).filter((index): index is number => index !== null));
  const found = new Map<number, Detected>();
  for (const [index, name] of header.entries()) {
    const kind = headerKind(name);
    if (kind) found.set(index, { index, kind, how: "header" });
  }
  const sample = Math.min(rows.length, 2001);
  for (let index = 0; index < width; index += 1) {
    if (found.has(index)) continue;
    const counts = new Map<PiiKind, number>();
    let filled = 0;
    for (let row = 1; row < sample; row += 1) {
      const value = rows[row][index] ?? "";
      if (value.trim() === "") continue;
      filled += 1;
      const kind = valueKind(value);
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    for (const [kind, count] of counts) {
      if (filled > 0 && count / filled >= 0.6) {
        found.set(index, { index, kind, how: "content" });
        break;
      }
    }
  }
  for (const spec of extra.split(",")) {
    const index = findColumn(header, spec, width);
    if (index !== null && !found.has(index)) found.set(index, { index, kind: headerKind(header[index]) ?? "other", how: "chosen" });
  }
  return [...found.values()].filter((entry) => !kept.has(entry.index)).sort((a, b) => a.index - b.index);
}

/* ---- Replacing ----------------------------------------------------------- */

function maskDigits(value: string): string {
  const total = digitsOf(value).length;
  let seen = 0;
  return value.replace(/\d/g, (digit) => {
    seen += 1;
    return seen > total - 4 ? digit : "*";
  });
}

export function maskValue(value: string, kind: PiiKind): string {
  const text = value.trim();
  if (text === "") return value;
  switch (kind) {
    case "email": {
      const [local, domain = ""] = text.split("@");
      const dot = domain.lastIndexOf(".");
      const host = dot > 0 ? domain.slice(0, dot) : domain;
      const tld = dot > 0 ? domain.slice(dot) : "";
      return `${local[0] ?? ""}***@${host[0] ?? ""}***${tld}`;
    }
    case "name":
      return text.split(/\s+/).map((word) => `${word[0]}***`).join(" ");
    case "ip":
      return text.includes(".") ? text.split(".").slice(0, 2).concat("*", "*").join(".") : `${text.split(":").slice(0, 2).join(":")}:*`;
    case "birth":
      return /\b(1[89]|20)\d{2}\b/.exec(text)?.[0] ?? "****";
    case "phone":
    case "card":
    case "national-id":
      return digitsOf(text).length >= 6 ? maskDigits(text) : "***";
    case "address":
      return "***";
    default:
      return text.length <= 2 ? "***" : `${text[0]}***`;
  }
}

export interface Anonymizer {
  apply(value: string, kind: PiiKind, column: string): string;
}

/** Stand-ins that stay the same for the same value throughout the file. */
export function pseudonymizer(): Anonymizer {
  const maps = new Map<string, Map<string, string>>();
  return {
    apply(value, kind, column) {
      const text = value.trim();
      if (text === "") return value;
      if (kind === "birth") return maskValue(text, "birth");
      const family = kind === "other" ? `other:${column}` : kind;
      let map = maps.get(family);
      if (!map) {
        map = new Map();
        maps.set(family, map);
      }
      const key = text.toLowerCase();
      let out = map.get(key);
      if (out === undefined) {
        const n = map.size + 1;
        out =
          kind === "email" ? `user${n}@example.com`
          : kind === "name" ? `Person ${n}`
          : kind === "phone" ? `555-${String(n).padStart(4, "0")}`
          : kind === "ip" ? `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`
          : kind === "address" ? `Address ${n}`
          : kind === "card" ? `Card ${n}`
          : kind === "national-id" ? `ID ${n}`
          : `${column.trim() || "Value"} ${n}`;
        map.set(key, out);
      }
      return out;
    },
  };
}

/** A salted SHA-256, cut to 16 hex characters, of the value as it reads without case or spaces around it. */
export function hasher(salt: string): Anonymizer {
  const cache = new Map<string, string>();
  return {
    apply(value) {
      const key = value.trim().toLowerCase();
      if (key === "") return value;
      let out = cache.get(key);
      if (out === undefined) {
        const digest = createDigest("sha256");
        digest.update(new TextEncoder().encode(`${salt}\u0000${key}`));
        out = digest.hex().slice(0, 16);
        cache.set(key, out);
      }
      return out;
    },
  };
}

export function masker(): Anonymizer {
  return { apply: (value, kind) => maskValue(value, kind) };
}

const TEXT_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// International with a +, North American 3-3-4, and national numbers with a trunk 0 such as 020 7946 0000.
const TEXT_PHONE = /\+\d[\d\s().-]{6,}\d|\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;

export interface AnonymizeResult {
  rows: string[][];
  /** Cells replaced in the chosen columns. */
  replaced: number;
  /** Addresses and numbers replaced inside the text of other columns. */
  scrubbed: number;
}

/**
 * The rows with the detected columns replaced or removed, and, when asked,
 * e-mail addresses and phone numbers replaced wherever else they are
 * written, such as inside a notes column.
 */
export function anonymizeRows(rows: readonly (readonly string[])[], targets: readonly Detected[], action: AnonymizeAction, anonymizer: Anonymizer, scrubText: boolean): AnonymizeResult {
  const header = rows[0] ?? [];
  const byIndex = new Map(targets.map((target) => [target.index, target]));
  const removed = action === "remove" ? new Set(targets.map((target) => target.index)) : new Set<number>();
  let replaced = 0;
  let scrubbed = 0;
  const out: string[][] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const next: string[] = [];
    for (let index = 0; index < row.length; index += 1) {
      if (removed.has(index)) continue;
      const cell = row[index];
      const target = byIndex.get(index);
      if (rowIndex === 0) next.push(cell);
      else if (target && action !== "remove") {
        const value = anonymizer.apply(cell, target.kind, header[index] ?? "");
        if (value !== cell) replaced += 1;
        next.push(value);
      } else if (scrubText && cell.length > 5) {
        const value = cell
          .replace(TEXT_EMAIL, (match) => {
            scrubbed += 1;
            return anonymizer.apply(match, "email", "");
          })
          .replace(TEXT_PHONE, (match) => {
            scrubbed += 1;
            return anonymizer.apply(match, "phone", "");
          });
        next.push(value);
      } else next.push(cell);
    }
    out.push(next);
  }
  if (action === "remove") for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) for (const index of removed) if ((rows[rowIndex][index] ?? "").trim() !== "") replaced += 1;
  return { rows: out, replaced, scrubbed };
}

/** A salt for one run, from the browser's random source. */
export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
