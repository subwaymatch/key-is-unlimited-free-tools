/**
 * Text to a QR code, following ISO/IEC 18004: the text is written in the
 * densest mode it allows (digits, the 45-character alphanumeric set, or
 * UTF-8 bytes), the smallest version that holds it at the chosen error
 * correction level is picked, correction codewords are added block by
 * block and interleaved, and of the eight masks the one scoring the lowest
 * penalty - the fewest long runs, blocks and finder look-alikes - is kept.
 */
import { generator, remainder } from "./galois";
import { dataOrder, functionModules, masked } from "./matrix";
import { ALPHANUMERIC, alignmentPositions, blockLayout, countBits, ECC_LEVELS, formatWord, MAX_VERSION, MIN_VERSION, MODE_BITS, sizeOf, versionWord, type EccLevel, type Mode } from "./tables";

export interface QrCode {
  version: number;
  level: EccLevel;
  mask: number;
  mode: Mode;
  size: number;
  /** size * size, row by row, 1 for dark. */
  modules: Uint8Array;
}

export class QrTooLongError extends Error {}

class Bits {
  readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let index = length - 1; index >= 0; index -= 1) this.bits.push((value >>> index) & 1);
  }
}

/** The densest mode the whole text can be written in. */
export function modeFor(text: string): Mode {
  if (/^[0-9]*$/.test(text)) return "numeric";
  if ([...text].every((character) => ALPHANUMERIC.includes(character))) return "alphanumeric";
  return "byte";
}

function payloadBits(text: string, mode: Mode, version: number): Bits {
  const bits = new Bits();
  bits.push(MODE_BITS[mode], 4);
  if (mode === "numeric") {
    bits.push(text.length, countBits(mode, version));
    for (let index = 0; index < text.length; index += 3) {
      const group = text.slice(index, index + 3);
      bits.push(Number(group), group.length * 3 + 1);
    }
  } else if (mode === "alphanumeric") {
    bits.push(text.length, countBits(mode, version));
    for (let index = 0; index < text.length; index += 2) {
      if (index + 1 < text.length) bits.push(ALPHANUMERIC.indexOf(text[index]) * 45 + ALPHANUMERIC.indexOf(text[index + 1]), 11);
      else bits.push(ALPHANUMERIC.indexOf(text[index]), 6);
    }
  } else {
    const bytes = new TextEncoder().encode(text);
    bits.push(bytes.length, countBits(mode, version));
    for (const byte of bytes) bits.push(byte, 8);
  }
  return bits;
}

/** Bits the payload needs, without terminator or padding. */
function payloadLength(text: string, mode: Mode, version: number): number {
  const count = countBits(mode, version);
  if (count < 32 && (mode === "byte" ? new TextEncoder().encode(text).length : text.length) >= 2 ** count) return Infinity;
  return payloadBits(text, mode, version).bits.length;
}

/** The largest number of UTF-8 bytes a code can hold at a level: 2,953 at L. */
export function capacityBytes(level: EccLevel, version = MAX_VERSION): number {
  return Math.floor((blockLayout(version, level).dataCodewords * 8 - 4 - countBits("byte", version)) / 8);
}

function codewords(text: string, mode: Mode, version: number, level: EccLevel): Uint8Array {
  const layout = blockLayout(version, level);
  const capacity = layout.dataCodewords * 8;
  const bits = payloadBits(text, mode, version);
  bits.push(0, Math.min(4, capacity - bits.bits.length));
  bits.push(0, (8 - (bits.bits.length % 8)) % 8);
  const data = new Uint8Array(layout.dataCodewords);
  for (let index = 0; index < bits.bits.length; index += 1) data[index >>> 3] |= bits.bits[index] << (7 - (index & 7));
  for (let index = bits.bits.length / 8, pad = 0xec; index < data.length; index += 1, pad ^= 0xec ^ 0x11) data[index] = pad;

  // Split into blocks, add each block's correction codewords, and interleave.
  const divisor = generator(layout.eccPerBlock);
  const blocks: number[][] = [];
  for (let block = 0, at = 0; block < layout.blocks; block += 1) {
    const length = layout.shortLength - layout.eccPerBlock + (block < layout.short ? 0 : 1);
    const chunk = Array.from(data.subarray(at, at + length));
    at += length;
    const ecc = remainder(chunk, divisor);
    if (block < layout.short) chunk.push(0);
    blocks.push([...chunk, ...ecc]);
  }
  const out: number[] = [];
  for (let index = 0; index < blocks[0].length; index += 1) {
    for (const [block, values] of blocks.entries()) {
      if (index !== layout.shortLength - layout.eccPerBlock || block >= layout.short) out.push(values[index]);
    }
  }
  return Uint8Array.from(out);
}

function drawFunctionPatterns(modules: Uint8Array, version: number): void {
  const size = sizeOf(version);
  const set = (x: number, y: number, dark: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) modules[y * size + x] = dark ? 1 : 0;
  };
  for (let index = 0; index < size; index += 1) {
    set(6, index, index % 2 === 0);
    set(index, 6, index % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = alignmentPositions(version);
  for (const [a, ay] of positions.entries()) {
    for (const [b, bx] of positions.entries()) {
      if ((a === 0 && b === 0) || (a === 0 && b === positions.length - 1) || (a === positions.length - 1 && b === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(bx + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  if (version >= 7) {
    const word = versionWord(version);
    for (let index = 0; index < 18; index += 1) {
      const dark = ((word >>> index) & 1) === 1;
      const a = size - 11 + (index % 3);
      const b = Math.floor(index / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
}

function drawFormat(modules: Uint8Array, size: number, level: EccLevel, mask: number): void {
  const word = formatWord(level, mask);
  const bit = (index: number) => ((word >>> index) & 1) as 0 | 1;
  const set = (x: number, y: number, value: number) => {
    modules[y * size + x] = value;
  };
  for (let index = 0; index <= 5; index += 1) set(8, index, bit(index));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let index = 9; index < 15; index += 1) set(14 - index, 8, bit(index));
  for (let index = 0; index < 8; index += 1) set(size - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index += 1) set(8, size - 15 + index, bit(index));
  set(8, size - 8, 1);
}

/** The penalty the standard scores a masked symbol by; lower reads better. */
export function penalty(modules: Uint8Array, size: number): number {
  let score = 0;
  const finderLike = (history: number[]) => {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
  };
  const addHistory = (run: number, history: number[]) => {
    history.pop();
    history.unshift(history[0] === 0 ? run + size : run);
  };
  for (const vertical of [false, true]) {
    for (let line = 0; line < size; line += 1) {
      let color = 0;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let step = 0; step < size; step += 1) {
        const value = vertical ? modules[step * size + line] : modules[line * size + step];
        if (value === color) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          addHistory(run, history);
          if (color === 0) score += finderLike(history) * 40;
          color = value;
          run = 1;
        }
      }
      if (color === 1) {
        addHistory(run, history);
        run = 0;
      }
      addHistory(run + size, history);
      score += finderLike(history) * 40;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = modules[y * size + x];
      dark += value;
      if (x < size - 1 && y < size - 1 && value === modules[y * size + x + 1] && value === modules[(y + 1) * size + x] && value === modules[(y + 1) * size + x + 1]) score += 3;
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export interface EncodeOptions {
  level: EccLevel;
  /** Raise the level when the text fits the same version at a higher one. */
  boost?: boolean;
  minVersion?: number;
  /** A fixed mask, or the best-scoring one when left out. */
  mask?: number;
}

/** The QR code for a text. Throws QrTooLongError when no version holds it. */
export function encodeQr(text: string, options: EncodeOptions): QrCode {
  const mode = modeFor(text);
  let version = Math.max(MIN_VERSION, options.minVersion ?? MIN_VERSION);
  let level = options.level;
  for (; ; version += 1) {
    if (version > MAX_VERSION) throw new QrTooLongError(`This is too long for one QR code at level ${level}: the largest holds ${capacityBytes(level).toLocaleString("en")} bytes.`);
    if (payloadLength(text, mode, version) <= blockLayout(version, level).dataCodewords * 8) break;
  }
  if (options.boost) {
    for (const higher of ECC_LEVELS.slice(ECC_LEVELS.indexOf(level) + 1)) {
      if (payloadLength(text, mode, version) <= blockLayout(version, higher).dataCodewords * 8) level = higher;
    }
  }
  const size = sizeOf(version);
  const data = codewords(text, mode, version, level);
  const base = new Uint8Array(size * size);
  drawFunctionPatterns(base, version);
  const order = dataOrder(version);
  for (let index = 0; index < data.length * 8; index += 1) base[order[index]] = (data[index >>> 3] >>> (7 - (index & 7))) & 1;
  const reserved = functionModules(version);

  let best: { mask: number; modules: Uint8Array; score: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    if (options.mask !== undefined && mask !== options.mask) continue;
    const modules = base.slice();
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!reserved[y * size + x] && masked(mask, x, y)) modules[y * size + x] ^= 1;
    drawFormat(modules, size, level, mask);
    const score = options.mask !== undefined ? 0 : penalty(modules, size);
    if (!best || score < best.score) best = { mask, modules, score };
  }
  return { version, level, mask: best!.mask, mode, size, modules: best!.modules };
}

export interface RenderOptions {
  /** Light modules around the code; the standard asks for 4. */
  margin: number;
  dark: string;
  light: string;
}

/** The code as an SVG: one path, one module to a unit, scaled by whoever shows it. */
export function qrSvg(code: QrCode, options: RenderOptions, pixels?: number): string {
  const extent = code.size + options.margin * 2;
  let path = "";
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (!code.modules[y * code.size + x]) continue;
      let run = 1;
      while (x + run < code.size && code.modules[y * code.size + x + run]) run += 1;
      path += `M${x + options.margin} ${y + options.margin}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const dimensions = pixels ? ` width="${pixels}" height="${pixels}"` : "";
  const background = options.light === "transparent" ? "" : `<rect width="${extent}" height="${extent}" fill="${options.light}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"${dimensions} shape-rendering="crispEdges">${background}<path fill="${options.dark}" d="${path}"/></svg>\n`;
}

/** Wi-Fi network details as the text phones join from when they scan it. */
export function wifiText(network: { ssid: string; password: string; security: "WPA" | "WEP" | "nopass"; hidden: boolean }): string {
  const escape = (value: string) => value.replace(/([\\;,":])/g, "\\$1");
  return `WIFI:T:${network.security};S:${escape(network.ssid)};${network.security === "nopass" ? "" : `P:${escape(network.password)};`}${network.hidden ? "H:true;" : ""};`;
}
