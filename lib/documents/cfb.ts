/**
 * The Compound File Binary format read: the "file system in a file" that
 * Outlook's .msg, the old Office .doc, .xls and .ppt, and Windows thumbnail
 * caches are all stored in.
 *
 * A compound file is a run of fixed-size sectors. A table of sector chains,
 * the FAT, says which sector follows which; a directory of 128-byte entries,
 * itself a chain, names the storages and streams, with each storage's
 * children held as a red-black tree through left, right and child links.
 * Streams shorter than a cutoff, 4096 bytes, live instead in 64-byte
 * sectors of a "mini stream" with a table of its own. Specified in
 * [MS-CFB]; read here without a library.
 */

export class CfbError extends Error {}

export interface CfbEntry {
  name: string;
  /** 1 storage, 2 stream, 5 the root. */
  type: number;
  children: CfbEntry[];
  start: number;
  size: number;
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const NO_STREAM = 0xffffffff;

export function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((value, index) => bytes[index] === value);
}

export class CompoundFile {
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: Uint32Array;
  private readonly miniFat: Uint32Array;
  private readonly miniStream: Uint8Array;
  readonly root: CfbEntry;

  constructor(private readonly bytes: Uint8Array) {
    if (!isCompoundFile(bytes)) throw new CfbError("This is not a compound file: it does not start with the signature every one does.");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorShift = this.view.getUint16(0x1e, true);
    const miniShift = this.view.getUint16(0x20, true);
    if (sectorShift !== 9 && sectorShift !== 12) throw new CfbError(`The sector size is 2^${sectorShift}, which no compound file uses.`);
    this.sectorSize = 1 << sectorShift;
    this.miniSectorSize = 1 << miniShift;
    this.miniCutoff = this.view.getUint32(0x38, true);

    // The FAT's own sectors: 109 listed in the header, the rest in a chain of DIFAT sectors.
    const fatSectors: number[] = [];
    for (let index = 0; index < 109; index += 1) {
      const sector = this.view.getUint32(0x4c + index * 4, true);
      if (sector !== FREE && sector !== END_OF_CHAIN) fatSectors.push(sector);
    }
    let difat = this.view.getUint32(0x44, true);
    const perDifat = this.sectorSize / 4 - 1;
    for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE && guard < 1_000_000; guard += 1) {
      const offset = this.offsetOf(difat);
      for (let index = 0; index < perDifat; index += 1) {
        const sector = this.view.getUint32(offset + index * 4, true);
        if (sector !== FREE && sector !== END_OF_CHAIN) fatSectors.push(sector);
      }
      difat = this.view.getUint32(offset + perDifat * 4, true);
    }
    const perSector = this.sectorSize / 4;
    this.fat = new Uint32Array(fatSectors.length * perSector);
    for (const [position, sector] of fatSectors.entries()) {
      const offset = this.offsetOf(sector);
      for (let index = 0; index < perSector; index += 1) this.fat[position * perSector + index] = this.view.getUint32(offset + index * 4, true);
    }

    const directory = this.readChain(this.view.getUint32(0x30, true));
    const entries: (CfbEntry & { left: number; right: number; child: number })[] = [];
    const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const nameLength = dirView.getUint16(offset + 0x40, true);
      let name = "";
      for (let index = 0; index + 2 < nameLength && index < 64; index += 2) name += String.fromCharCode(dirView.getUint16(offset + index, true));
      entries.push({
        name,
        type: directory[offset + 0x42],
        left: dirView.getUint32(offset + 0x44, true),
        right: dirView.getUint32(offset + 0x48, true),
        child: dirView.getUint32(offset + 0x4c, true),
        start: dirView.getUint32(offset + 0x74, true),
        // The high half is only meaningful in version 4 files, and a version 3 writer may leave junk there.
        size: dirView.getUint32(offset + 0x78, true) + (this.sectorSize === 4096 ? dirView.getUint32(offset + 0x7c, true) * 2 ** 32 : 0),
        children: [],
      });
    }
    if (entries.length === 0 || entries[0].type !== 5) throw new CfbError("The directory has no root entry.");
    const visited = new Set<number>();
    const collect = (index: number, into: CfbEntry[]) => {
      if (index === NO_STREAM || index >= entries.length || visited.has(index)) return;
      visited.add(index);
      const entry = entries[index];
      collect(entry.left, into);
      into.push(entry);
      collect(entry.right, into);
      if (entry.type === 1 || entry.type === 5) collect(entry.child, entry.children);
    };
    const root = entries[0];
    visited.add(0);
    collect(root.child, root.children);
    this.root = root;

    this.miniStream = root.start === END_OF_CHAIN ? new Uint8Array(0) : this.readChain(root.start).subarray(0, root.size);
    const miniFatBytes = this.view.getUint32(0x40, true) > 0 ? this.readChain(this.view.getUint32(0x3c, true)) : new Uint8Array(0);
    this.miniFat = new Uint32Array(miniFatBytes.length / 4);
    const miniView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    for (let index = 0; index < this.miniFat.length; index += 1) this.miniFat[index] = miniView.getUint32(index * 4, true);
  }

  private offsetOf(sector: number): number {
    const offset = (sector + 1) * this.sectorSize;
    if (offset + this.sectorSize > this.bytes.length + this.sectorSize) throw new CfbError("A sector points past the end of the file; it is cut short or damaged.");
    return offset;
  }

  private readChain(start: number): Uint8Array {
    const sectors: number[] = [];
    for (let sector = start; sector !== END_OF_CHAIN && sector !== FREE; sector = this.fat[sector]) {
      if (sector >= this.fat.length || sectors.length > this.fat.length) throw new CfbError("A chain of sectors loops or runs off the table; the file is damaged.");
      sectors.push(sector);
    }
    const out = new Uint8Array(sectors.length * this.sectorSize);
    for (const [index, sector] of sectors.entries()) {
      const offset = this.offsetOf(sector);
      out.set(this.bytes.subarray(offset, Math.min(offset + this.sectorSize, this.bytes.length)), index * this.sectorSize);
    }
    return out;
  }

  /** A stream's bytes, from the mini stream when it is short. */
  read(entry: CfbEntry): Uint8Array {
    if (entry.type !== 2) throw new CfbError(`${entry.name} is a storage, not a stream.`);
    if (entry.size === 0) return new Uint8Array(0);
    if (entry.size >= this.miniCutoff) return this.readChain(entry.start).subarray(0, entry.size);
    const out = new Uint8Array(Math.ceil(entry.size / this.miniSectorSize) * this.miniSectorSize);
    let at = 0;
    for (let sector = entry.start; sector !== END_OF_CHAIN && sector !== FREE && at < out.length; sector = this.miniFat[sector]) {
      if (sector >= this.miniFat.length) throw new CfbError("A short stream's chain runs off its table; the file is damaged.");
      out.set(this.miniStream.subarray(sector * this.miniSectorSize, (sector + 1) * this.miniSectorSize), at);
      at += this.miniSectorSize;
    }
    return out.subarray(0, entry.size);
  }

  /** The child of a storage by name, ignoring case as the format does. */
  find(parent: CfbEntry, name: string): CfbEntry | null {
    const lower = name.toLowerCase();
    return parent.children.find((entry) => entry.name.toLowerCase() === lower) ?? null;
  }
}
