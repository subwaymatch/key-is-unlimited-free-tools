/**
 * Whether the shipped font can draw a subtitle file.
 *
 * Burning needs a font, and this site ships exactly one: DejaVu Sans, which
 * covers the Latin, Greek and Cyrillic scripts, Armenian, Hebrew, Georgian
 * and Arabic, and none of the East Asian or Indic ones. A Japanese subtitle
 * file burned with it comes out as a row of empty boxes, after a full
 * re-encode of the video - so the card asks before, not after.
 *
 * Pure, so it is unit-tested without a browser.
 */

/** Scripts DejaVu Sans has no glyphs for, by the block a character falls in. */
const MISSING: readonly { name: string; from: number; to: number }[] = [
  { name: "Devanagari", from: 0x0900, to: 0x097f },
  { name: "Bengali", from: 0x0980, to: 0x09ff },
  { name: "Gurmukhi", from: 0x0a00, to: 0x0a7f },
  { name: "Gujarati", from: 0x0a80, to: 0x0aff },
  { name: "Tamil", from: 0x0b80, to: 0x0bff },
  { name: "Telugu", from: 0x0c00, to: 0x0c7f },
  { name: "Kannada", from: 0x0c80, to: 0x0cff },
  { name: "Malayalam", from: 0x0d00, to: 0x0d7f },
  { name: "Sinhala", from: 0x0d80, to: 0x0dff },
  { name: "Thai", from: 0x0e00, to: 0x0e7f },
  { name: "Lao", from: 0x0e80, to: 0x0eff },
  { name: "Tibetan", from: 0x0f00, to: 0x0fff },
  { name: "Burmese", from: 0x1000, to: 0x109f },
  { name: "Khmer", from: 0x1780, to: 0x17ff },
  { name: "Japanese", from: 0x3040, to: 0x30ff },
  { name: "Chinese", from: 0x3400, to: 0x4dbf },
  { name: "Chinese", from: 0x4e00, to: 0x9fff },
  { name: "Korean", from: 0x1100, to: 0x11ff },
  { name: "Korean", from: 0xac00, to: 0xd7af },
  { name: "Chinese", from: 0xf900, to: 0xfaff },
];

/**
 * The first script in this text the shipped font cannot draw, or null.
 *
 * Reads code points rather than code units, so a character outside the basic
 * plane - an emoji, a rare Chinese character - is counted once and read
 * correctly.
 */
export function unsupportedScript(text: string): string | null {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined || code < 0x0900) continue;
    // Anything above the basic plane is beyond this font too: emoji, the
    // CJK extensions, and the rest.
    if (code > 0xffff) return code >= 0x1f000 ? "emoji" : "characters";
    for (const block of MISSING) {
      if (code >= block.from && code <= block.to) return block.name;
    }
  }
  return null;
}

/** The line for a card when the font cannot draw what is in the file. */
export function coverageWarning(text: string, fontName: string): string | null {
  const script = unsupportedScript(text);
  if (script === null) return null;
  const what = script === "emoji" || script === "characters" ? script : `${script} text`;
  return `This file contains ${what}, and ${fontName} - the one font this site ships - has no glyphs for it, so it would be burned in as empty boxes. Add the subtitles as a track instead, which keeps the text and lets the player's own fonts draw it, or burn them in a video editor that can use a font from your computer.`;
}
