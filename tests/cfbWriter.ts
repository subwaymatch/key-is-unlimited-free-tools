/**
 * A compound file written for the tests, version 3 with 512-byte sectors,
 * so the .msg reader can be run on files whose contents are known.
 *
 * Streams under 4096 bytes go into the mini stream and larger ones into
 * ordinary sectors, as [MS-CFB] requires, so both of the reader's paths are
 * exercised; each storage's children are laid out as a balanced tree in the
 * order the format sorts names. Its output was checked against Python's
 * olefile when it was written.
 */

export interface CfbNode {
  name: string;
  /** A stream's bytes; a storage has children instead. */
  data?: Uint8Array;
  children?: CfbNode[];
}

const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;
const NONE = 0xffffffff;

interface Entry {
  node: CfbNode;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

function compareNames(a: string, b: string): number {
  return a.length - b.length || (a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0);
}

export function writeCfb(children: CfbNode[]): Uint8Array {
  const entries: Entry[] = [{ node: { name: "Root Entry", children }, type: 5, left: NONE, right: NONE, child: NONE, start: END, size: 0 }];
  const place = (list: CfbNode[]): number => {
    if (list.length === 0) return NONE;
    const sorted = [...list].sort((a, b) => compareNames(a.name, b.name));
    const build = (from: number, to: number): number => {
      if (from > to) return NONE;
      const middle = (from + to) >> 1;
      const node = sorted[middle];
      const index = entries.length;
      entries.push({ node, type: node.children ? 1 : 2, left: NONE, right: NONE, child: NONE, start: END, size: node.data?.length ?? 0 });
      entries[index].left = build(from, middle - 1);
      entries[index].right = build(middle + 1, to);
      if (node.children) entries[index].child = place(node.children);
      return index;
    };
    return build(0, sorted.length - 1);
  };
  entries[0].child = place(children);

  // The mini stream and its table.
  const mini: number[] = [];
  const miniData: Uint8Array[] = [];
  let miniSectors = 0;
  for (const entry of entries) {
    if (entry.type !== 2 || entry.size === 0 || entry.size >= CUTOFF) continue;
    const count = Math.ceil(entry.size / MINI);
    entry.start = miniSectors;
    for (let index = 0; index < count; index += 1) mini.push(index === count - 1 ? END : miniSectors + index + 1);
    const padded = new Uint8Array(count * MINI);
    padded.set(entry.node.data!);
    miniData.push(padded);
    miniSectors += count;
  }
  const miniStream = new Uint8Array(miniSectors * MINI);
  let at = 0;
  for (const part of miniData) {
    miniStream.set(part, at);
    at += part.length;
  }
  entries[0].size = miniStream.length;

  const sectorsFor = (bytes: number) => Math.ceil(bytes / SECTOR);
  const directorySectors = sectorsFor(entries.length * 128);
  const miniFatSectors = sectorsFor(mini.length * 4);
  const miniStreamSectors = sectorsFor(miniStream.length);
  const big = entries.filter((entry) => entry.type === 2 && entry.size >= CUTOFF);
  const bigSectors = big.reduce((sum, entry) => sum + sectorsFor(entry.size), 0);
  const content = directorySectors + miniFatSectors + miniStreamSectors + bigSectors;
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < content + fatSectors) fatSectors += 1;
  if (fatSectors > 109) throw new Error("Too large for the test writer.");

  const total = fatSectors + content;
  const fat = new Uint32Array(fatSectors * (SECTOR / 4)).fill(FREE);
  let next = 0;
  const chain = (count: number): number => {
    if (count === 0) return END;
    const start = next;
    for (let index = 0; index < count; index += 1) fat[next + index] = index === count - 1 ? END : next + index + 1;
    next += count;
    return start;
  };
  for (let index = 0; index < fatSectors; index += 1) fat[next++] = FATSECT;
  const directoryStart = chain(directorySectors);
  const miniFatStart = chain(miniFatSectors);
  entries[0].start = miniStreamSectors > 0 ? chain(miniStreamSectors) : END;
  for (const entry of big) entry.start = chain(sectorsFor(entry.size));

  const out = new Uint8Array((total + 1) * SECTOR);
  const view = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x18, 0x3e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, fatSectors, true);
  view.setUint32(0x30, directoryStart, true);
  view.setUint32(0x38, CUTOFF, true);
  view.setUint32(0x3c, miniFatSectors > 0 ? miniFatStart : END, true);
  view.setUint32(0x40, miniFatSectors, true);
  view.setUint32(0x44, END, true);
  for (let index = 0; index < 109; index += 1) view.setUint32(0x4c + index * 4, index < fatSectors ? index : FREE, true);

  const sectorOffset = (sector: number) => (sector + 1) * SECTOR;
  for (let index = 0; index < fat.length; index += 1) view.setUint32(sectorOffset(0) + index * 4, fat[index], true);
  const directory = sectorOffset(directoryStart);
  for (let index = 0; index < directorySectors * 4; index += 1) {
    const offset = directory + index * 128;
    const entry = entries[index];
    if (!entry) {
      view.setUint32(offset + 0x44, NONE, true);
      view.setUint32(offset + 0x48, NONE, true);
      view.setUint32(offset + 0x4c, NONE, true);
      continue;
    }
    for (let char = 0; char < entry.node.name.length; char += 1) view.setUint16(offset + char * 2, entry.node.name.charCodeAt(char), true);
    view.setUint16(offset + 0x40, (entry.node.name.length + 1) * 2, true);
    out[offset + 0x42] = entry.type;
    out[offset + 0x43] = 1;
    view.setUint32(offset + 0x44, entry.left, true);
    view.setUint32(offset + 0x48, entry.right, true);
    view.setUint32(offset + 0x4c, entry.child, true);
    view.setUint32(offset + 0x74, entry.start, true);
    view.setUint32(offset + 0x78, entry.size, true);
  }
  for (let index = 0; index < mini.length; index += 1) view.setUint32(sectorOffset(miniFatStart) + index * 4, mini[index], true);
  if (miniStreamSectors > 0) out.set(miniStream, sectorOffset(entries[0].start));
  for (const entry of big) out.set(entry.node.data!, sectorOffset(entry.start));
  return out;
}

/* ---- MSG pieces ---------------------------------------------------------- */

export function utf16(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    out[index * 2] = text.charCodeAt(index) & 0xff;
    out[index * 2 + 1] = text.charCodeAt(index) >> 8;
  }
  return out;
}

/** A variable-length property stream. */
export function prop(id: number, type: number, data: Uint8Array): CfbNode {
  return { name: `__substg1.0_${id.toString(16).padStart(4, "0").toUpperCase()}${type.toString(16).padStart(4, "0").toUpperCase()}`, data };
}

/** A fixed-length properties stream: a header of the given size, then 16 bytes per property. */
export function fixedProps(headerSize: number, values: { id: number; type: number; value: number | bigint }[]): CfbNode {
  const out = new Uint8Array(headerSize + values.length * 16);
  const view = new DataView(out.buffer);
  for (const [index, entry] of values.entries()) {
    const offset = headerSize + index * 16;
    view.setUint32(offset, ((entry.id << 16) | entry.type) >>> 0, true);
    view.setUint32(offset + 4, 6, true);
    if (typeof entry.value === "bigint") view.setBigUint64(offset + 8, entry.value, true);
    else view.setInt32(offset + 8, entry.value, true);
  }
  return { name: "__properties_version1.0", data: out };
}

/** A Date as a FILETIME. */
export function filetime(date: Date): bigint {
  return (BigInt(date.getTime()) + BigInt(11_644_473_600_000)) * BigInt(10_000);
}
