# Contributing

## Plain ASCII punctuation

**Write everything in this repository - code, comments, docs, commit messages,
UI strings - using ASCII punctuation only.**

Use `-` for dashes, `'` and `"` for quotes, `...` for an ellipsis, `->` for an
arrow, and words such as "yes", "no" and "warning" where a status glyph is
tempting. No em dashes, no curly quotes, no emoji, no box-drawing characters, no
check marks.

### Why

Typographic punctuation is the house style of generated text. Em dashes, curly
quotes, ellipsis glyphs and status emoji arrive by the hundred whenever a change
is drafted by a language model, and they make a codebase read as machine-written
even when a person wrote the logic. Keeping to ASCII is the simplest way to stop
that drift.

It also avoids problems that have nothing to do with style. ASCII survives
terminal output, `grep`, diffs, and any tool that guesses the wrong encoding.
A UI string containing an em dash renders as a mojibake box on a system that
misreads the charset; a hyphen never does.

### How it is enforced

`scripts/check-characters.mjs` scans every tracked, non-binary file and fails on
any character outside ASCII.

```bash
npm run check:characters          # report offenders
npm run check:characters -- --fix # rewrite the unambiguous ones
```

CI runs the check on every push and pull request, so a stray em dash fails the
build rather than reaching `main`.

`--fix` only rewrites characters with a single obvious ASCII equivalent, listed
in the script's `REPLACEMENTS` table. Anything else is reported for a human to
reword, because the right replacement depends on the sentence. A status emoji in
a table cell might become "yes", "supported" or "verified"; the script does not
guess.

### When a file genuinely needs non-ASCII

Some files need these characters as their subject rather than as decoration. The
one example today is `tests/naming.test.ts`, which asserts that a filename like
`Unicode <video>.webm` written with accents and Chinese characters is replaced
before it reaches WORKERFS. The fixture cannot make that assertion in ASCII.

Add such a file to the `ALLOWED` map in `scripts/check-characters.mjs`, naming
the exact characters it may contain and the reason:

```js
[
  "tests/naming.test.ts",
  {
    chars: new Set("\u00DC\u00EF\u00F8\u00E9\u5F71\u7247"),
    reason: "asserts that non-ASCII filenames are replaced before they reach WORKERFS",
  },
],
```

Allowances are per character, not per file, so a stray em dash in an allowed file
is still reported. Write the characters as `\u` escapes so the script itself
stays pure ASCII.

### What this policy is not

It is not a rule about the product's behaviour. The app handles files with any
name in any script, and `safeMountName` exists precisely so that a video called
`Unicode <video>.webm` converts correctly. The policy governs what contributors
type, not what users bring.
