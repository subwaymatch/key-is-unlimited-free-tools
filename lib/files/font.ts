/**
 * A font file read for what it says about itself: its names, its licence
 * and embedding permission, its weight and width, how many glyphs it has,
 * which characters it covers and so which languages it can set, its
 * OpenType features and scripts, and its variation axes if it is variable.
 *
 * TrueType and OpenType (.ttf, .otf), collections (.ttc, the first font)
 * and WOFF are read here; WOFF's tables are zlib streams, inflated one by
 * one. WOFF2 compresses the whole font with Brotli and transforms its
 * tables, and is recognised but not read.
 */
import { inflateZlib } from "../zip/inflate";

export class FontError extends Error {}

export interface FontTable {
  tag: string;
  data: Uint8Array;
}

function tagOf(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}

export interface FontContainer {
  flavor: string;
  tables: Map<string, Uint8Array>;
  /** Fonts in a collection; 1 otherwise. */
  fonts: number;
}

function sfntTables(bytes: Uint8Array, offset: number): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(offset + 4);
  const tables = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    const record = offset + 12 + index * 16;
    if (record + 16 > bytes.length) throw new FontError("The font's table directory is cut short.");
    const tag = tagOf(view, record);
    const start = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (start + length > bytes.length) throw new FontError(`The font's ${tag.trim()} table runs past the end of the file.`);
    tables.set(tag, bytes.subarray(start, start + length));
  }
  return tables;
}

/** The font's tables, whatever wrapping it came in. Throws FontError for what is not a font. */
export function readFontContainer(bytes: Uint8Array): FontContainer {
  if (bytes.length < 12) throw new FontError("This file is too short to be a font.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = tagOf(view, 0);
  if (signature === "wOF2") throw new FontError("This is WOFF2, which is compressed with Brotli in a way this cannot unpack yet. Convert it to TTF or WOFF first, or use the TTF the font's makers publish.");
  if (signature === "wOFF") {
    const flavor = tagOf(view, 4) === "OTTO" ? "OpenType (CFF)" : "TrueType";
    const count = view.getUint16(12);
    const tables = new Map<string, Uint8Array>();
    for (let index = 0; index < count; index += 1) {
      const record = 44 + index * 20;
      const tag = tagOf(view, record);
      const start = view.getUint32(record + 4);
      const compressed = view.getUint32(record + 8);
      const original = view.getUint32(record + 12);
      if (start + compressed > bytes.length) throw new FontError(`The font's ${tag.trim()} table runs past the end of the file.`);
      const data = bytes.subarray(start, start + compressed);
      tables.set(tag, compressed < original ? inflateZlib(data, 0, original).data : data);
    }
    return { flavor: `WOFF (${flavor})`, tables, fonts: 1 };
  }
  if (signature === "ttcf") {
    const fonts = view.getUint32(8);
    return { flavor: "TrueType collection", tables: sfntTables(bytes, view.getUint32(12)), fonts };
  }
  if (signature === "OTTO") return { flavor: "OpenType (CFF)", tables: sfntTables(bytes, 0), fonts: 1 };
  if (view.getUint32(0) === 0x00010000 || signature === "true") return { flavor: "TrueType", tables: sfntTables(bytes, 0), fonts: 1 };
  throw new FontError("This is not a font file: it is not TrueType, OpenType, a collection or WOFF.");
}

/* ---- Tables -------------------------------------------------------------- */

const NAME_IDS: Record<number, string> = { 0: "copyright", 1: "family", 2: "subfamily", 3: "uniqueId", 4: "fullName", 5: "version", 6: "postScriptName", 7: "trademark", 8: "manufacturer", 9: "designer", 10: "description", 11: "vendorUrl", 12: "designerUrl", 13: "license", 14: "licenseUrl", 16: "typographicFamily", 17: "typographicSubfamily" };

const MAC_ROMAN_HIGH = "\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211\u220f\u03c0\u222b\u00aa\u00ba\u03a9\u00e6\u00f8\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab\u00bb\u2026\u00a0\u00c0\u00c3\u00d5\u0152\u0153\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca\u00ff\u0178\u2044\u20ac\u2039\u203a\ufb01\ufb02\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4\uf8ff\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7";

/** The name table's strings, preferring Windows English, then any Windows record, then Mac Roman. */
export function readNames(table: Uint8Array | undefined): Record<string, string> {
  const names: Record<string, string> = {};
  if (!table || table.length < 6) return names;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  const rank: Record<string, number> = {};
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12;
    if (record + 12 > table.length) break;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const language = view.getUint16(record + 4);
    const id = view.getUint16(record + 6);
    const length = view.getUint16(record + 8);
    const offset = view.getUint16(record + 10);
    const key = NAME_IDS[id];
    if (!key) continue;
    const bytes = table.subarray(storage + offset, storage + offset + length);
    let score = 0;
    let text = "";
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      score = language === 0x409 ? 3 : 2;
      for (let at = 0; at + 1 < bytes.length; at += 2) text += String.fromCharCode((bytes[at] << 8) | bytes[at + 1]);
    } else if (platform === 0) {
      score = 2;
      for (let at = 0; at + 1 < bytes.length; at += 2) text += String.fromCharCode((bytes[at] << 8) | bytes[at + 1]);
    } else if (platform === 1 && encoding === 0) {
      score = language === 0 ? 1 : 0.5;
      for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte) : MAC_ROMAN_HIGH[byte - 0x80];
    } else continue;
    if ((rank[key] ?? -1) < score && text.trim() !== "") {
      rank[key] = score;
      names[key] = text.trim();
    }
  }
  return names;
}

/** Every code point the font maps to a glyph, from its best cmap subtable. */
export function readCmap(table: Uint8Array | undefined): Set<number> {
  const points = new Set<number>();
  if (!table || table.length < 4) return points;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  let best: { offset: number; score: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const platform = view.getUint16(4 + index * 8);
    const encoding = view.getUint16(6 + index * 8);
    const offset = view.getUint32(8 + index * 8);
    if (offset + 2 > table.length) continue;
    const format = view.getUint16(offset);
    // A full-Unicode subtable beats a BMP one; a symbol font's (3,0) is taken only when nothing else is there.
    const score = (platform === 3 && encoding === 10) || (platform === 0 && (encoding === 4 || encoding === 6)) ? 4 : (platform === 3 && encoding === 1) || platform === 0 ? 3 : platform === 3 && encoding === 0 ? 2 : platform === 1 ? 1 : 0;
    if ([0, 4, 6, 10, 12, 13].includes(format) && (!best || score > best.score)) best = { offset, score };
  }
  if (!best) return points;
  const at = best.offset;
  const format = view.getUint16(at);
  if (format === 0) {
    for (let code = 0; code < 256; code += 1) if (table[at + 6 + code]) points.add(code);
  } else if (format === 4) {
    const segments = view.getUint16(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const end = view.getUint16(ends + segment * 2);
      const start = view.getUint16(starts + segment * 2);
      const delta = view.getInt16(deltas + segment * 2);
      const rangeOffset = view.getUint16(ranges + segment * 2);
      for (let code = start; code <= end && code !== 0xffff; code += 1) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
        else {
          const address = ranges + segment * 2 + rangeOffset + (code - start) * 2;
          if (address + 2 > table.length) continue;
          glyph = view.getUint16(address);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) points.add(code);
      }
    }
  } else if (format === 6) {
    const first = view.getUint16(at + 6);
    const entries = view.getUint16(at + 8);
    for (let index = 0; index < entries; index += 1) if (view.getUint16(at + 10 + index * 2)) points.add(first + index);
  } else if (format === 12 || format === 13) {
    const groups = view.getUint32(at + 12);
    for (let group = 0; group < groups; group += 1) {
      const record = at + 16 + group * 12;
      const start = view.getUint32(record);
      const end = Math.min(view.getUint32(record + 4), 0x10ffff);
      const glyph = view.getUint32(record + 8);
      for (let code = start; code <= end; code += 1) if (format === 13 ? glyph !== 0 : glyph + (code - start) !== 0) points.add(code);
    }
  }
  return points;
}

/** The feature tags and script tags of a GSUB or GPOS table. */
export function readLayout(table: Uint8Array | undefined): { scripts: string[]; features: string[] } {
  if (!table || table.length < 10) return { scripts: [], features: [] };
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const scriptList = view.getUint16(4);
  const featureList = view.getUint16(6);
  const scripts: string[] = [];
  const features = new Set<string>();
  if (scriptList && scriptList + 2 <= table.length) {
    const count = view.getUint16(scriptList);
    for (let index = 0; index < count; index += 1) scripts.push(tagOf(view, scriptList + 2 + index * 6));
  }
  if (featureList && featureList + 2 <= table.length) {
    const count = view.getUint16(featureList);
    for (let index = 0; index < count; index += 1) features.add(tagOf(view, featureList + 2 + index * 6));
  }
  return { scripts, features: [...features].sort() };
}

export interface Axis {
  tag: string;
  min: number;
  default: number;
  max: number;
}

export function readAxes(table: Uint8Array | undefined): { axes: Axis[]; instances: number } {
  if (!table || table.length < 16) return { axes: [], instances: 0 };
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const offset = view.getUint16(4);
  const count = view.getUint16(8);
  const size = view.getUint16(10);
  const fixed = (at: number) => Math.round((view.getInt32(at) / 65536) * 1000) / 1000;
  const axes: Axis[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = offset + index * size;
    axes.push({ tag: tagOf(view, at), min: fixed(at + 4), default: fixed(at + 8), max: fixed(at + 12) });
  }
  return { axes, instances: view.getUint16(12) };
}

export interface FontInfo {
  flavor: FontContainer["flavor"];
  fonts: number;
  names: Record<string, string>;
  glyphs: number;
  unitsPerEm: number;
  created: Date | null;
  modified: Date | null;
  weight: number | null;
  width: number | null;
  italic: boolean;
  monospaced: boolean;
  vendor: string | null;
  embedding: string | null;
  codePoints: Set<number>;
  scripts: string[];
  features: string[];
  axes: Axis[];
  instances: number;
  color: string[];
  tables: { tag: string; size: number }[];
}

const EMBEDDING: Record<number, string> = {
  0: "installable: may be embedded, and installed by whoever receives a document with it",
  2: "restricted: may not be embedded at all without the owner's permission",
  4: "preview and print: may be embedded in documents that are only viewed and printed",
  8: "editable: may be embedded in documents that are edited",
};

function longDate(view: DataView, at: number): Date | null {
  const seconds = Number(view.getBigUint64(at));
  if (!seconds) return null;
  const date = new Date(Date.UTC(1904, 0, 1) + seconds * 1000);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() > 1970 && date.getUTCFullYear() < 2100 ? date : null;
}

/** Everything the font says about itself. */
export function readFont(bytes: Uint8Array): FontInfo {
  const container = readFontContainer(bytes);
  const { tables } = container;
  const info: FontInfo = { flavor: container.flavor, fonts: container.fonts, names: readNames(tables.get("name")), glyphs: 0, unitsPerEm: 0, created: null, modified: null, weight: null, width: null, italic: false, monospaced: false, vendor: null, embedding: null, codePoints: readCmap(tables.get("cmap")), scripts: [], features: [], axes: [], instances: 0, color: [], tables: [...tables].map(([tag, data]) => ({ tag: tag.trim(), size: data.length })) };
  const head = tables.get("head");
  if (head && head.length >= 54) {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    info.unitsPerEm = view.getUint16(18);
    info.created = longDate(view, 20);
    info.modified = longDate(view, 28);
    info.italic = (view.getUint16(44) & 2) !== 0;
  }
  const maxp = tables.get("maxp");
  if (maxp && maxp.length >= 6) info.glyphs = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4);
  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 68) {
    const view = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
    info.weight = view.getUint16(4);
    info.width = view.getUint16(6);
    const fsType = view.getUint16(8);
    const kind = fsType & 0x0f;
    info.embedding = `${EMBEDDING[kind & 2 ? 2 : kind & 4 ? 4 : kind & 8 ? 8 : 0]}${fsType & 0x100 ? "; the font may not be subset" : ""}${fsType & 0x200 ? "; only its bitmaps may be embedded" : ""}`;
    info.vendor = tagOf(view, 58).replace(/[\0\s]+$/, "") || null;
    if ((view.getUint16(62) & 1) !== 0) info.italic = true;
  }
  const post = tables.get("post");
  if (post && post.length >= 16) info.monospaced = new DataView(post.buffer, post.byteOffset, post.byteLength).getUint32(12) !== 0;
  const gsub = readLayout(tables.get("GSUB"));
  const gpos = readLayout(tables.get("GPOS"));
  info.scripts = [...new Set([...gsub.scripts, ...gpos.scripts])].sort();
  info.features = [...new Set([...gsub.features, ...gpos.features])].sort();
  const variation = readAxes(tables.get("fvar"));
  info.axes = variation.axes;
  info.instances = variation.instances;
  for (const [tag, label] of [
    ["COLR", "COLR layers"],
    ["SVG ", "SVG glyphs"],
    ["sbix", "Apple bitmaps"],
    ["CBDT", "Google bitmaps"],
  ]) {
    if (tables.has(tag)) info.color.push(label);
  }
  return info;
}

/* ---- Coverage ------------------------------------------------------------ */

export const WEIGHTS: Record<number, string> = { 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black" };

/** Unicode blocks people set text in, with their ranges. */
export const BLOCKS: readonly [string, number, number][] = [
  ["Basic Latin", 0x20, 0x7e],
  ["Latin-1 Supplement", 0xa0, 0xff],
  ["Latin Extended-A", 0x100, 0x17f],
  ["Latin Extended-B", 0x180, 0x24f],
  ["IPA Extensions", 0x250, 0x2af],
  ["Spacing Modifier Letters", 0x2b0, 0x2ff],
  ["Combining Diacritical Marks", 0x300, 0x36f],
  ["Greek and Coptic", 0x370, 0x3ff],
  ["Cyrillic", 0x400, 0x4ff],
  ["Cyrillic Supplement", 0x500, 0x52f],
  ["Armenian", 0x530, 0x58f],
  ["Hebrew", 0x590, 0x5ff],
  ["Arabic", 0x600, 0x6ff],
  ["Devanagari", 0x900, 0x97f],
  ["Bengali", 0x980, 0x9ff],
  ["Tamil", 0xb80, 0xbff],
  ["Thai", 0xe00, 0xe7f],
  ["Georgian", 0x10a0, 0x10ff],
  ["Hangul Jamo", 0x1100, 0x11ff],
  ["Latin Extended Additional", 0x1e00, 0x1eff],
  ["Greek Extended", 0x1f00, 0x1fff],
  ["General Punctuation", 0x2000, 0x206f],
  ["Superscripts and Subscripts", 0x2070, 0x209f],
  ["Currency Symbols", 0x20a0, 0x20c0],
  ["Letterlike Symbols", 0x2100, 0x214f],
  ["Number Forms", 0x2150, 0x218f],
  ["Arrows", 0x2190, 0x21ff],
  ["Mathematical Operators", 0x2200, 0x22ff],
  ["Miscellaneous Technical", 0x2300, 0x23ff],
  ["Box Drawing", 0x2500, 0x257f],
  ["Block Elements", 0x2580, 0x259f],
  ["Geometric Shapes", 0x25a0, 0x25ff],
  ["Miscellaneous Symbols", 0x2600, 0x26ff],
  ["Dingbats", 0x2700, 0x27bf],
  ["CJK Symbols and Punctuation", 0x3000, 0x303f],
  ["Hiragana", 0x3041, 0x309f],
  ["Katakana", 0x30a0, 0x30ff],
  ["CJK Unified Ideographs", 0x4e00, 0x9fff],
  ["Hangul Syllables", 0xac00, 0xd7a3],
  ["Private Use Area", 0xe000, 0xf8ff],
  ["Alphabetic Presentation Forms", 0xfb00, 0xfb4f],
  ["Halfwidth and Fullwidth Forms", 0xff00, 0xffef],
  ["Emoticons", 0x1f600, 0x1f64f],
  ["Miscellaneous Symbols and Pictographs", 0x1f300, 0x1f5ff],
];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const chars = (text: string) => [...text].map((character) => character.codePointAt(0)!);

/** The letters each language needs beyond punctuation, as a check of what a font can set. */
export const LANGUAGES: readonly { name: string; needs: number[] }[] = [
  { name: "English", needs: [...range(0x41, 0x5a), ...range(0x61, 0x7a)] },
  { name: "Western European (French, German, Spanish, Portuguese, Italian, Nordic)", needs: chars("\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d8\u00d9\u00da\u00db\u00dc\u00df\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u00f9\u00fa\u00fb\u00fc\u00ff\u0152\u0153\u20ac") },
  { name: "Central European (Polish, Czech, Slovak, Hungarian, Croatian)", needs: chars("\u0104\u0105\u0106\u0107\u010c\u010d\u010e\u010f\u0118\u0119\u011a\u011b\u0141\u0142\u0143\u0144\u0147\u0148\u0150\u0151\u0158\u0159\u015a\u015b\u0160\u0161\u0164\u0165\u016e\u016f\u0170\u0171\u0179\u017a\u017b\u017c\u017d\u017e\u0110\u0111") },
  { name: "Turkish", needs: chars("\u011e\u011f\u0130\u0131\u015e\u015f\u00c7\u00e7\u00d6\u00f6\u00dc\u00fc") },
  { name: "Baltic (Latvian, Lithuanian)", needs: chars("\u0100\u0101\u010c\u010d\u0112\u0113\u0122\u0123\u012a\u012b\u0136\u0137\u013b\u013c\u0145\u0146\u0160\u0161\u016a\u016b\u017d\u017e\u0116\u0117\u012e\u012f\u0172\u0173") },
  { name: "Romanian", needs: chars("\u0102\u0103\u00c2\u00e2\u00ce\u00ee\u0218\u0219\u021a\u021b") },
  { name: "Vietnamese", needs: chars("\u0102\u0103\u00c2\u00e2\u0110\u0111\u00ca\u00ea\u00d4\u00f4\u01a0\u01a1\u01af\u01b0\u1ea0\u1ea1\u1ea2\u1ea3\u1ea4\u1ea5\u1ea6\u1ea7\u1ebb\u1ebd\u1ec7\u1ecb\u1ecd\u1ee5\u1ef3") },
  { name: "Greek", needs: [...range(0x391, 0x3a1), ...range(0x3a3, 0x3a9), ...range(0x3b1, 0x3c9), ...chars("\u03ac\u03ad\u03ae\u03af\u03cc\u03cd\u03ce")] },
  { name: "Russian", needs: [...range(0x410, 0x44f), 0x401, 0x451] },
  { name: "Ukrainian", needs: [...range(0x410, 0x44f), ...chars("\u0404\u0454\u0406\u0456\u0407\u0457\u0490\u0491")] },
  { name: "Serbian and Macedonian Cyrillic", needs: chars("\u0402\u0452\u0408\u0458\u0409\u0459\u040a\u045a\u040b\u045b\u040f\u045f\u0403\u0453\u040c\u045c\u0405\u0455") },
  { name: "Hebrew", needs: range(0x5d0, 0x5ea) },
  { name: "Arabic", needs: range(0x627, 0x64a) },
  { name: "Hindi (Devanagari)", needs: range(0x905, 0x939) },
  { name: "Thai", needs: range(0xe01, 0xe2e) },
  { name: "Japanese kana", needs: [...range(0x3041, 0x3093), ...range(0x30a1, 0x30f3)] },
  { name: "Korean (Hangul)", needs: range(0xac00, 0xac00 + 200) },
  { name: "Chinese (common ideographs)", needs: chars("\u7684\u4e00\u662f\u4e0d\u4e86\u4eba\u6211\u5728\u6709\u4ed6\u8fd9\u4e2d\u5927\u6765\u4e0a\u56fd\u4e2a\u5230\u8bf4\u4eec\u4e3a\u5b50\u548c\u4f60\u5730\u51fa\u9053\u4e5f\u65f6\u5e74") },
];

export interface Coverage {
  blocks: { name: string; covered: number; total: number }[];
  languages: { name: string; missing: number[]; total: number }[];
}

export function coverage(points: Set<number>): Coverage {
  const blocks = BLOCKS.map(([name, from, to]) => {
    let covered = 0;
    for (let code = from; code <= to; code += 1) if (points.has(code)) covered += 1;
    return { name, covered, total: to - from + 1 };
  }).filter((block) => block.covered > 0);
  const languages = LANGUAGES.map((language) => ({ name: language.name, missing: language.needs.filter((code) => !points.has(code)), total: language.needs.length }));
  return { blocks, languages };
}
