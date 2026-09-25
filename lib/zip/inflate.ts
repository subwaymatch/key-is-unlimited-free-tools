/**
 * DEFLATE (RFC 1951) and zlib (RFC 1950) decompression that says where
 * the compressed data ended.
 *
 * fflate inflates faster, but a git packfile is compressed objects laid
 * end to end with nothing between them to say where one stops, so reading
 * one means knowing how many bytes its stream used. This decoder reports
 * that. Huffman codes are decoded through lookup tables indexed by the
 * next bits of input, fifteen at most.
 */

export class InflateError extends Error {}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Table {
  /** symbol << 4 | length, indexed by the next `bits` bits of input, least significant first. */
  entries: Int32Array;
  bits: number;
}

function buildTable(lengths: ArrayLike<number>, count: number): Table {
  let bits = 0;
  for (let index = 0; index < count; index += 1) if (lengths[index] > bits) bits = lengths[index];
  if (bits === 0) return { entries: new Int32Array(1).fill(-1), bits: 0 };
  const counts = new Uint16Array(16);
  for (let index = 0; index < count; index += 1) counts[lengths[index]] += 1;
  counts[0] = 0;
  const next = new Uint16Array(16);
  for (let length = 1, code = 0; length <= 15; length += 1) {
    code = (code + counts[length - 1]) << 1;
    next[length] = code;
  }
  const entries = new Int32Array(1 << bits).fill(-1);
  for (let symbol = 0; symbol < count; symbol += 1) {
    const length = lengths[symbol];
    if (length === 0) continue;
    const code = next[length]++;
    let reversed = 0;
    for (let bit = 0; bit < length; bit += 1) reversed |= ((code >> bit) & 1) << (length - 1 - bit);
    for (let slot = reversed; slot < entries.length; slot += 1 << length) entries[slot] = (symbol << 4) | length;
  }
  return { entries, bits };
}

const FIXED_LITERALS = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return buildTable(lengths, 288);
})();
const FIXED_DISTANCES = buildTable(new Uint8Array(30).fill(5), 30);

export interface Inflated {
  data: Uint8Array;
  /** Bytes of input the stream used. */
  consumed: number;
}

/** A raw DEFLATE stream from `start`. `sizeHint` sizes the first output buffer. */
export function inflateRaw(input: Uint8Array, start = 0, sizeHint = 0): Inflated {
  let position = start;
  let buffer = 0;
  let count = 0;
  let out = new Uint8Array(Math.max(1024, sizeHint));
  let length = 0;

  const need = (bits: number) => {
    while (count < bits) {
      if (position >= input.length) {
        // Past the end the stream is padded with zero bits; running out mid-code is caught below.
        if (position >= input.length + 4) throw new InflateError("The compressed data ends before its last block.");
        position += 1;
        count += 8;
        continue;
      }
      buffer |= input[position++] << count;
      count += 8;
    }
  };
  const take = (bits: number) => {
    need(bits);
    const value = buffer & ((1 << bits) - 1);
    buffer >>>= bits;
    count -= bits;
    return value;
  };
  const decode = (table: Table) => {
    need(table.bits);
    const entry = table.entries[buffer & ((1 << table.bits) - 1)];
    if (entry < 0) throw new InflateError("The compressed data uses a code its table does not define.");
    const bits = entry & 15;
    buffer >>>= bits;
    count -= bits;
    return entry >> 4;
  };
  const grow = (extra: number) => {
    if (length + extra <= out.length) return;
    let size = out.length * 2;
    while (size < length + extra) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out.subarray(0, length));
    out = bigger;
  };

  for (let last = 0; !last; ) {
    last = take(1);
    const type = take(2);
    if (type === 0) {
      // Stored: skip to a byte boundary, then LEN and its complement.
      buffer = 0;
      position -= count >> 3;
      count = 0;
      if (position + 4 > input.length) throw new InflateError("A stored block is cut short.");
      const size = input[position] | (input[position + 1] << 8);
      const check = input[position + 2] | (input[position + 3] << 8);
      if ((size ^ 0xffff) !== check) throw new InflateError("A stored block's length does not match its check.");
      position += 4;
      if (position + size > input.length) throw new InflateError("A stored block runs past the end of the data.");
      grow(size);
      out.set(input.subarray(position, position + size), length);
      length += size;
      position += size;
      continue;
    }
    let literals = FIXED_LITERALS;
    let distances = FIXED_DISTANCES;
    if (type === 2) {
      const literalCount = take(5) + 257;
      const distanceCount = take(5) + 1;
      const codeCount = take(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let index = 0; index < codeCount; index += 1) codeLengths[CODE_LENGTH_ORDER[index]] = take(3);
      const codeTable = buildTable(codeLengths, 19);
      const lengths = new Uint8Array(literalCount + distanceCount);
      for (let index = 0; index < lengths.length; ) {
        const symbol = decode(codeTable);
        if (symbol < 16) lengths[index++] = symbol;
        else {
          let repeat: number;
          let value = 0;
          if (symbol === 16) {
            if (index === 0) throw new InflateError("A code length repeats before there is one to repeat.");
            value = lengths[index - 1];
            repeat = 3 + take(2);
          } else repeat = symbol === 17 ? 3 + take(3) : 11 + take(7);
          if (index + repeat > lengths.length) throw new InflateError("Code lengths run past the end of the table.");
          lengths.fill(value, index, index + repeat);
          index += repeat;
        }
      }
      literals = buildTable(lengths.subarray(0, literalCount), literalCount);
      distances = buildTable(lengths.subarray(literalCount), distanceCount);
    } else if (type !== 1) throw new InflateError("The compressed data has a block of a type that does not exist.");

    for (;;) {
      const symbol = decode(literals);
      if (symbol < 256) {
        grow(1);
        out[length++] = symbol;
      } else if (symbol === 256) break;
      else {
        const lengthIndex = symbol - 257;
        if (lengthIndex >= 29) throw new InflateError("The compressed data has a length code that does not exist.");
        const copy = LENGTH_BASE[lengthIndex] + take(LENGTH_EXTRA[lengthIndex]);
        const distanceIndex = decode(distances);
        if (distanceIndex >= 30) throw new InflateError("The compressed data has a distance code that does not exist.");
        const distance = DISTANCE_BASE[distanceIndex] + take(DISTANCE_EXTRA[distanceIndex]);
        if (distance > length) throw new InflateError("The compressed data refers back before its own start.");
        grow(copy);
        for (let index = 0; index < copy; index += 1, length += 1) out[length] = out[length - distance];
      }
    }
  }
  const unused = count >> 3;
  const consumed = position - unused - start;
  if (start + consumed > input.length) throw new InflateError("The compressed data ends before its last block.");
  return { data: out.subarray(0, length), consumed };
}

/** A zlib stream (header, DEFLATE data, Adler-32) from `start`. */
export function inflateZlib(input: Uint8Array, start = 0, sizeHint = 0): Inflated {
  const cmf = input[start];
  const flags = input[start + 1];
  if (cmf === undefined || flags === undefined || (cmf & 0x0f) !== 8 || ((cmf << 8) | flags) % 31 !== 0) throw new InflateError("This is not a zlib stream.");
  if (flags & 0x20) throw new InflateError("The zlib stream needs a preset dictionary.");
  const raw = inflateRaw(input, start + 2, sizeHint);
  const end = start + 2 + raw.consumed;
  if (end + 4 > input.length) throw new InflateError("The zlib stream is missing its checksum.");
  let a = 1;
  let b = 0;
  // 5552 bytes is the most that can be summed before the sums could pass 2^32.
  for (let index = 0; index < raw.data.length; ) {
    const end = Math.min(index + 5552, raw.data.length);
    for (; index < end; index += 1) {
      a += raw.data[index];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  const expected = ((input[end] << 24) | (input[end + 1] << 16) | (input[end + 2] << 8) | input[end + 3]) >>> 0;
  if ((((b << 16) | a) >>> 0) !== expected) throw new InflateError("The zlib stream's checksum does not match; the data is damaged.");
  return { data: raw.data, consumed: raw.consumed + 6 };
}
