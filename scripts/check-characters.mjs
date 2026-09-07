#!/usr/bin/env node
/*
 * Enforces the plain-ASCII punctuation policy in CONTRIBUTING.md.
 *
 * Typographic punctuation (em dashes, curly quotes, ellipsis glyphs) and
 * decorative symbols (check marks, emoji, arrows) are the house style of
 * generated text, and they arrive by the hundred when a change is drafted by a
 * model. They also break in places ASCII does not: terminal output, `grep`,
 * diffs, and anything that guesses the wrong encoding. So the repository sticks
 * to ASCII punctuation, and this check keeps it that way.
 *
 *   node scripts/check-characters.mjs          # report offenders, exit 1 if any
 *   node scripts/check-characters.mjs --fix    # rewrite the unambiguous ones
 *
 * `--fix` only touches characters with a single obvious ASCII equivalent (the
 * REPLACEMENTS table). Anything else is reported for a human to reword, because
 * the right replacement depends on the sentence.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname } from "node:path";

/** Characters with an unambiguous ASCII equivalent, safe to rewrite. */
const REPLACEMENTS = new Map([
  ["—", "-"], // em dash
  ["–", "-"], // en dash
  ["‑", "-"], // non-breaking hyphen
  ["−", "-"], // minus sign
  ["•", "-"], // bullet
  ["·", "-"], // middle dot
  ["…", "..."], // horizontal ellipsis
  ["‘", "'"], // left single quote
  ["’", "'"], // right single quote
  ["“", '"'], // left double quote
  ["”", '"'], // right double quote
  ["′", "'"], // prime
  ["″", '"'], // double prime
  ["→", "->"], // rightwards arrow
  ["←", "<-"], // leftwards arrow
  ["⇒", "=>"], // rightwards double arrow
  ["≈", "~"], // almost equal to
  ["≤", "<="], // less than or equal
  ["≥", ">="], // greater than or equal
  ["≠", "!="], // not equal
  ["×", "x"], // multiplication sign
  ["÷", "/"], // division sign
  ["±", "+/-"], // plus-minus
  ["µ", "u"], // micro sign
  ["§", "section "], // section sign
  [" ", " "], // non-breaking space
  [" ", " "], // narrow non-breaking space
  ["​", ""], // zero-width space
  ["‌", ""], // zero-width non-joiner
  ["‍", ""], // zero-width joiner
  ["﻿", ""], // byte-order mark
  ["️", ""], // emoji variation selector
]);

/*
 * Per-file allowances, with the reason.
 *
 * These name the exact characters a file may contain, not the whole file, so a
 * stray em dash in an allowed file is still reported. A file earns a place here
 * only when the non-ASCII characters are the subject of the code rather than
 * decoration.
 */
const ALLOWED = new Map([
  [
    "tests/naming.test.ts",
    {
      // Escaped so this file stays pure ASCII: the characters of the fixture
      // filename "Unicode <video>.webm", accented and in Chinese.
      chars: new Set("\u00DC\u00EF\u00F8\u00E9\u5F71\u7247"),
      reason:
        "asserts that non-ASCII filenames are replaced before they reach WORKERFS, so the fixture has to contain them",
    },
  ],
  [
    "scripts/check-characters.mjs",
    {
      // Spelling out the banned set is the one thing this file has to do, so it
      // necessarily contains every character in it. Without this, --fix would
      // rewrite the left-hand column of REPLACEMENTS into its own right-hand
      // column and quietly disarm the check.
      chars: new Set(REPLACEMENTS.keys()),
      reason: "defines the banned set, so it has to contain every character in it",
    },
  ],
]);

const BINARY = new Set([".ico", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".wasm"]);

const fix = process.argv.includes("--fix");

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && !BINARY.has(extname(f)));

let fixedFiles = 0;
let fixedChars = 0;
const offenders = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // unreadable or deleted between listing and reading
  }
  if (![...text].some((ch) => ch.codePointAt(0) > 0x7f)) continue;

  const allowed = ALLOWED.get(file)?.chars ?? new Set();

  if (fix) {
    let next = text;
    for (const [from, to] of REPLACEMENTS) {
      if (allowed.has(from)) continue;
      if (!next.includes(from)) continue;
      fixedChars += next.split(from).length - 1;
      next = next.split(from).join(to);
    }
    if (next !== text) {
      writeFileSync(file, next);
      fixedFiles += 1;
      text = next;
    }
  }

  text.split("\n").forEach((line, index) => {
    for (const ch of line) {
      if (ch.codePointAt(0) <= 0x7f || allowed.has(ch)) continue;
      offenders.push({
        file,
        line: index + 1,
        char: ch,
        code: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
        fixable: REPLACEMENTS.has(ch),
        text: line.trim().slice(0, 100),
      });
    }
  });
}

if (fix) {
  console.log(`Replaced ${fixedChars} character(s) across ${fixedFiles} file(s).`);
}

if (offenders.length === 0) {
  console.log(`No non-ASCII characters beyond the allowances in ${ALLOWED.size} file(s).`);
  process.exit(0);
}

console.error(`Found ${offenders.length} non-ASCII character(s):\n`);
for (const o of offenders) {
  const hint = o.fixable ? "run `npm run check:characters -- --fix`" : "reword by hand";
  console.error(`  ${o.file}:${o.line}  ${o.code} ${JSON.stringify(o.char)}  (${hint})`);
  console.error(`      ${o.text}`);
}
console.error(
  "\nSee the plain-ASCII punctuation policy in CONTRIBUTING.md." +
    "\nIf a file genuinely needs these characters, add it to ALLOWED in this script with a reason.",
);
process.exit(1);
