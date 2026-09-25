/**
 * A grid of modules, read off a picture, back to text: the format word
 * found, the mask taken off, the codewords collected in the order they
 * were written, each block's errors corrected by Reed-Solomon, and the
 * data segments - digits, alphanumerics, bytes, kanji, ECI charset
 * switches - turned into a string.
 */
import { correct, ReedSolomonError } from "./galois";
import { dataOrder, masked } from "./matrix";
import { ALPHANUMERIC, blockLayout, countBits, nearestFormat, nearestVersion, versionOfSize, type EccLevel } from "./tables";

export class QrReadError extends Error {}

/** The version block was read, and names a different size from the grid sampled. */
export class QrSizeMismatch extends QrReadError {
  constructor(readonly version: number) {
    super("The version information does not match the size of the grid.");
  }
}

export interface QrContent {
  text: string;
  version: number;
  level: EccLevel;
  mask: number;
  /** The segment modes used, in order: "byte", "numeric"... */
  modes: string[];
  /** Codewords Reed-Solomon had to repair. */
  corrected: number;
  /** The symbol was read as a mirror image. */
  mirrored: boolean;
  /** Part n of m, when the code is one of several joined by structured append. */
  part: { index: number; total: number } | null;
}

class BitReader {
  private at = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get available(): number {
    return this.bytes.length * 8 - this.at;
  }

  read(count: number): number {
    if (count > this.available) throw new QrReadError("The data ends in the middle of a segment.");
    let value = 0;
    for (let index = 0; index < count; index += 1, this.at += 1) value = (value << 1) | ((this.bytes[this.at >>> 3] >>> (7 - (this.at & 7))) & 1);
    return value;
  }
}

const ECI_CHARSETS: Record<number, string> = {
  0: "cp437",
  1: "iso-8859-1",
  2: "cp437",
  3: "iso-8859-1",
  4: "iso-8859-2",
  5: "iso-8859-3",
  6: "iso-8859-4",
  7: "iso-8859-5",
  8: "iso-8859-6",
  9: "iso-8859-7",
  10: "iso-8859-8",
  11: "windows-1254",
  12: "iso-8859-10",
  13: "windows-874",
  15: "iso-8859-13",
  16: "iso-8859-14",
  17: "iso-8859-15",
  18: "iso-8859-16",
  20: "shift_jis",
  21: "windows-1250",
  22: "windows-1251",
  23: "windows-1252",
  24: "windows-1256",
  25: "utf-16be",
  26: "utf-8",
  27: "utf-8",
  28: "big5",
  29: "gb18030",
  30: "euc-kr",
};

function decodeWith(charset: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Bytes with no ECI to say what they are: UTF-8 when they are, Shift JIS when they look it, else Latin-1. */
export function guessText(bytes: Uint8Array): string {
  const utf8 = decodeWith("utf-8", bytes);
  if (utf8 !== null) return utf8;
  let pairs = 0;
  let singles = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte < 0x80) continue;
    const next = bytes[index + 1] ?? 0;
    if (((byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xef)) && next >= 0x40 && next <= 0xfc && next !== 0x7f) {
      pairs += 1;
      index += 1;
    } else singles += 1;
  }
  if (pairs > 0 && singles === 0) {
    const shiftJis = decodeWith("shift_jis", bytes);
    if (shiftJis !== null) return shiftJis;
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

function parseSegments(data: Uint8Array, version: number): { text: string; modes: string[]; part: QrContent["part"] } {
  const reader = new BitReader(data);
  let text = "";
  const modes: string[] = [];
  let charset: string | null = null;
  let part: QrContent["part"] = null;
  // Byte segments are gathered and decoded together, since a character can straddle two.
  let pending: number[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const bytes = Uint8Array.from(pending);
    text += charset ? (decodeWith(charset, bytes) ?? new TextDecoder("windows-1252").decode(bytes)) : guessText(bytes);
    pending = [];
  };
  while (reader.available >= 4) {
    const mode = reader.read(4);
    if (mode === 0) break;
    if (mode === 0x3) {
      const sequence = reader.read(8);
      reader.read(8);
      part = { index: (sequence >>> 4) + 1, total: (sequence & 0xf) + 1 };
      continue;
    }
    if (mode === 0x5) continue;
    if (mode === 0x9) {
      reader.read(8);
      continue;
    }
    if (mode === 0x7) {
      flush();
      const first = reader.read(8);
      const value = (first & 0x80) === 0 ? first & 0x7f : (first & 0xc0) === 0x80 ? ((first & 0x3f) << 8) | reader.read(8) : (first & 0xe0) === 0xc0 ? ((first & 0x1f) << 16) | reader.read(16) : -1;
      charset = ECI_CHARSETS[value] ?? null;
      modes.push(`ECI ${value}`);
      continue;
    }
    if (mode === 0x1) {
      flush();
      modes.push("numeric");
      let count = reader.read(countBits("numeric", version));
      while (count >= 3) {
        const group = reader.read(10);
        if (group > 999) throw new QrReadError("A group of digits is out of range.");
        text += String(group).padStart(3, "0");
        count -= 3;
      }
      if (count === 2) {
        const group = reader.read(7);
        if (group > 99) throw new QrReadError("A pair of digits is out of range.");
        text += String(group).padStart(2, "0");
      } else if (count === 1) {
        const digit = reader.read(4);
        if (digit > 9) throw new QrReadError("A digit is out of range.");
        text += String(digit);
      }
    } else if (mode === 0x2) {
      flush();
      modes.push("alphanumeric");
      let count = reader.read(countBits("alphanumeric", version));
      while (count >= 2) {
        const pair = reader.read(11);
        if (pair >= 45 * 45) throw new QrReadError("A pair of characters is out of range.");
        text += ALPHANUMERIC[Math.floor(pair / 45)] + ALPHANUMERIC[pair % 45];
        count -= 2;
      }
      if (count === 1) {
        const single = reader.read(6);
        if (single >= 45) throw new QrReadError("A character is out of range.");
        text += ALPHANUMERIC[single];
      }
    } else if (mode === 0x4) {
      modes.push("byte");
      const count = reader.read(countBits("byte", version));
      for (let index = 0; index < count; index += 1) pending.push(reader.read(8));
    } else if (mode === 0x8) {
      flush();
      modes.push("kanji");
      const count = reader.read(countBits("kanji", version));
      const bytes = new Uint8Array(count * 2);
      for (let index = 0; index < count; index += 1) {
        const value = reader.read(13);
        let assembled = (Math.floor(value / 0xc0) << 8) | value % 0xc0;
        assembled += assembled < 0x1f00 ? 0x8140 : 0xc140;
        bytes[index * 2] = assembled >> 8;
        bytes[index * 2 + 1] = assembled & 0xff;
      }
      text += new TextDecoder("shift_jis").decode(bytes);
    } else {
      throw new QrReadError(`The code uses segment mode ${mode}, which this does not read.`);
    }
  }
  flush();
  return { text, modes, part };
}

function readFormat(get: (x: number, y: number) => number, size: number): number[] {
  let first = 0;
  const push = (value: number, x: number, y: number) => (value << 1) | get(x, y);
  for (let x = 0; x < 6; x += 1) first = push(first, x, 8);
  first = push(first, 7, 8);
  first = push(first, 8, 8);
  first = push(first, 8, 7);
  for (let y = 5; y >= 0; y -= 1) first = push(first, 8, y);
  let second = 0;
  for (let y = size - 1; y >= size - 7; y -= 1) second = push(second, 8, y);
  for (let x = size - 8; x < size; x += 1) second = push(second, x, 8);
  return [first, second];
}

function readVersion(get: (x: number, y: number) => number, size: number): number[] {
  let first = 0;
  for (let y = 5; y >= 0; y -= 1) for (let x = size - 9; x >= size - 11; x -= 1) first = (first << 1) | get(x, y);
  let second = 0;
  for (let x = 5; x >= 0; x -= 1) for (let y = size - 9; y >= size - 11; y -= 1) second = (second << 1) | get(x, y);
  return [first, second];
}

function decodeOnce(modules: Uint8Array, size: number, mirrored: boolean): QrContent {
  const get = mirrored ? (x: number, y: number) => modules[x * size + y] : (x: number, y: number) => modules[y * size + x];
  let version = versionOfSize(size);
  if (version === null) throw new QrReadError(`A grid ${size} modules across is not a QR code size.`);
  if (version >= 7) {
    const read = nearestVersion(...readVersion(get, size));
    if (read === null) throw new QrReadError("The version information cannot be read.");
    if (read !== version) throw new QrSizeMismatch(read);
    version = read;
  }
  const format = nearestFormat(...readFormat(get, size));
  if (!format) throw new QrReadError("The format information cannot be read.");
  const { level, mask } = format;
  const layout = blockLayout(version, level);
  const order = dataOrder(version);
  const raw = new Uint8Array(layout.total);
  for (let index = 0; index < layout.total * 8; index += 1) {
    const at = order[index];
    const x = at % size;
    const y = Math.floor(at / size);
    const bit = get(x, y) ^ (masked(mask, x, y) ? 1 : 0);
    raw[index >>> 3] |= bit << (7 - (index & 7));
  }

  // Undo the interleaving: the same walk the writer made, filling blocks instead of emptying them.
  const blocks: Uint8Array[] = [];
  for (let block = 0; block < layout.blocks; block += 1) blocks.push(new Uint8Array(layout.shortLength + 1));
  let at = 0;
  for (let index = 0; index <= layout.shortLength; index += 1) {
    for (let block = 0; block < layout.blocks; block += 1) {
      if (index !== layout.shortLength - layout.eccPerBlock || block >= layout.short) blocks[block][index] = raw[at++];
    }
  }
  let corrected = 0;
  const data: number[] = [];
  for (let block = 0; block < layout.blocks; block += 1) {
    const isShort = block < layout.short;
    const dataLength = layout.shortLength - layout.eccPerBlock + (isShort ? 0 : 1);
    const full = blocks[block];
    const codewords = isShort ? Uint8Array.from([...full.subarray(0, dataLength), ...full.subarray(dataLength + 1)]) : full;
    try {
      corrected += correct(codewords, layout.eccPerBlock);
    } catch (error) {
      if (error instanceof ReedSolomonError) throw new QrReadError("Too much of the code is damaged or hidden to correct.");
      throw error;
    }
    for (let index = 0; index < dataLength; index += 1) data.push(codewords[index]);
  }
  const { text, modes, part } = parseSegments(Uint8Array.from(data), version);
  return { text, version, level, mask, modes, corrected, mirrored, part };
}

/** The text in a grid of modules, read as printed or, failing that, as a mirror image. */
export function decodeModules(modules: Uint8Array, size: number): QrContent {
  try {
    return decodeOnce(modules, size, false);
  } catch (error) {
    try {
      return decodeOnce(modules, size, true);
    } catch {
      throw error;
    }
  }
}
