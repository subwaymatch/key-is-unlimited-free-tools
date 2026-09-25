/**
 * The numbers ISO/IEC 18004 fixes for each QR code version and error
 * correction level: how many blocks the codewords are split into, how many
 * correction codewords each block carries, where the alignment patterns go,
 * and the BCH-protected format and version words.
 */

export type EccLevel = "L" | "M" | "Q" | "H";

export const ECC_LEVELS: readonly EccLevel[] = ["L", "M", "Q", "H"];

/** The two bits each level is written as in the format word. */
export const ECC_FORMAT_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Roughly how much of the code can be damaged and still read. */
export const ECC_RECOVERY: Record<EccLevel, string> = { L: "7%", M: "15%", Q: "25%", H: "30%" };

// Index 0 is unused so a version indexes its own entry.
const ECC_PER_BLOCK: Record<EccLevel, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

const BLOCKS: Record<EccLevel, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** Modules on a side. */
export function sizeOf(version: number): number {
  return version * 4 + 17;
}

/** The version a side length belongs to, or null when no version has it. */
export function versionOfSize(size: number): number | null {
  const version = (size - 17) / 4;
  return Number.isInteger(version) && version >= MIN_VERSION && version <= MAX_VERSION ? version : null;
}

/** Modules left for data and correction once the function patterns are drawn. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    result -= (25 * count - 10) * count - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export interface BlockLayout {
  blocks: number;
  eccPerBlock: number;
  /** Codewords in all, data and correction. */
  total: number;
  /** Blocks one data codeword shorter than the rest, which come first. */
  short: number;
  /** Codewords in a short block, correction included. */
  shortLength: number;
  dataCodewords: number;
}

export function blockLayout(version: number, level: EccLevel): BlockLayout {
  const blocks = BLOCKS[level][version];
  const eccPerBlock = ECC_PER_BLOCK[level][version];
  const total = Math.floor(rawDataModules(version) / 8);
  return { blocks, eccPerBlock, total, short: blocks - (total % blocks), shortLength: Math.floor(total / blocks), dataCodewords: total - eccPerBlock * blocks };
}

/** Centres of the alignment patterns along each axis. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let position = sizeOf(version) - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

export type Mode = "numeric" | "alphanumeric" | "byte" | "kanji";

export const MODE_BITS: Record<Mode, number> = { numeric: 0x1, alphanumeric: 0x2, byte: 0x4, kanji: 0x8 };

/** Width of the character count field. */
export function countBits(mode: Mode, version: number): number {
  const band = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const widths: Record<Mode, [number, number, number]> = { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16], kanji: [8, 10, 12] };
  return widths[mode][band];
}

export const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** The 15-bit format word: level and mask, BCH-protected and masked. */
export function formatWord(level: EccLevel, mask: number): number {
  const data = (ECC_FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/** The 18-bit version word, for versions 7 and up. */
export function versionWord(version: number): number {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

function bitCount(value: number): number {
  let count = 0;
  for (let rest = value; rest !== 0; rest &= rest - 1) count += 1;
  return count;
}

/** The format word nearest to what was read, if it is near enough to trust. */
export function nearestFormat(...reads: number[]): { level: EccLevel; mask: number; distance: number } | null {
  let best: { level: EccLevel; mask: number; distance: number } | null = null;
  for (const level of ECC_LEVELS) {
    for (let mask = 0; mask < 8; mask += 1) {
      const word = formatWord(level, mask);
      for (const read of reads) {
        const distance = bitCount(word ^ read);
        if (!best || distance < best.distance) best = { level, mask, distance };
      }
    }
  }
  return best && best.distance <= 3 ? best : null;
}

/** The version word nearest to what was read, if it is near enough to trust. */
export function nearestVersion(...reads: number[]): number | null {
  let best: { version: number; distance: number } | null = null;
  for (let version = 7; version <= MAX_VERSION; version += 1) {
    const word = versionWord(version);
    for (const read of reads) {
      const distance = bitCount(word ^ read);
      if (!best || distance < best.distance) best = { version, distance };
    }
  }
  return best && best.distance <= 3 ? best.version : null;
}
