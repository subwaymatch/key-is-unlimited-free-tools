/**
 * What a picture says about where it came from, and taking it out.
 *
 * A phone writes the time, the model, the lens, often a serial number and
 * the GPS fix of where you were standing into every photo, in an Exif block
 * inside the file. This reads that block well enough to show it, and
 * removes it - along with XMP, IPTC, comments and the rest - without
 * touching the picture: a JPEG, a PNG and a WebP are all containers of
 * chunks, and the chunks that carry metadata are simply left out of the
 * copy. Nothing is re-encoded, so nothing is lost.
 *
 * One tag is kept: orientation. Cameras store a rotated photo as it came off
 * the sensor with a note saying which way is up, and dropping the note turns
 * every portrait photo on its side. A minimal Exif block carrying only that
 * tag is written in its place.
 *
 * Everything here is pure byte handling, so it is unit-tested without a
 * browser.
 */

export type ImageContainer = "jpeg" | "png" | "webp";

/** One thing the metadata says, worded for a list. */
export interface MetadataFact {
  label: string;
  value: string;
}

export interface ImageMetadata {
  container: ImageContainer;
  /** Facts worth listing: camera, date, place, software. */
  facts: MetadataFact[];
  /** The blocks the file carries, by name, for the "removed" line. */
  blocks: string[];
  /** Exif orientation, 1 to 8, or null when the file carries none. */
  orientation: number | null;
  /** True when a GPS position was found. */
  hasLocation: boolean;
}

export interface StrippedImage {
  metadata: ImageMetadata;
  /** The file without its metadata, or null when there was none to remove. */
  bytes: Uint8Array | null;
}

/* ---- Exif --------------------------------------------------------------- */

const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Where the value lives in the TIFF block. */
  valueOffset: number;
}

class TiffReader {
  readonly view: DataView;
  readonly little: boolean;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.little = bytes[0] === 0x49 && bytes[1] === 0x49;
  }

  static isTiff(bytes: Uint8Array): boolean {
    if (bytes.length < 8) return false;
    const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
    const big = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
    return little || big;
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, this.little);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, this.little);
  }

  /** The entries of the IFD at `offset`, and where the next IFD starts. */
  ifd(offset: number): TiffEntry[] {
    if (offset + 2 > this.bytes.length) return [];
    const count = this.u16(offset);
    const entries: TiffEntry[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      if (at + 12 > this.bytes.length) break;
      const type = this.u16(at + 2);
      const n = this.u32(at + 4);
      const size = (TIFF_TYPE_SIZES[type] ?? 1) * n;
      entries.push({ tag: this.u16(at), type, count: n, valueOffset: size <= 4 ? at + 8 : this.u32(at + 8) });
    }
    return entries;
  }

  ascii(entry: TiffEntry): string | null {
    if (entry.type !== 2 || entry.valueOffset + entry.count > this.bytes.length) return null;
    let text = "";
    for (let i = 0; i < entry.count; i += 1) {
      const code = this.bytes[entry.valueOffset + i];
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text.trim() || null;
  }

  number(entry: TiffEntry, index = 0): number | null {
    const size = TIFF_TYPE_SIZES[entry.type] ?? 0;
    const at = entry.valueOffset + index * size;
    if (index >= entry.count || at + size > this.bytes.length) return null;
    switch (entry.type) {
      case 1:
      case 7:
        return this.bytes[at];
      case 3:
        return this.u16(at);
      case 4:
        return this.u32(at);
      case 9:
        return this.view.getInt32(at, this.little);
      case 5: {
        const denominator = this.u32(at + 4);
        return denominator === 0 ? null : this.u32(at) / denominator;
      }
      case 10: {
        const denominator = this.view.getInt32(at + 4, this.little);
        return denominator === 0 ? null : this.view.getInt32(at, this.little) / denominator;
      }
      default:
        return null;
    }
  }
}

/** Degrees, minutes and seconds as one signed decimal. */
export function gpsToDecimal(parts: (number | null)[], ref: string | null): number | null {
  const [degrees, minutes, seconds] = parts;
  if (degrees === null || degrees === undefined) return null;
  const value = degrees + (minutes ?? 0) / 60 + (seconds ?? 0) / 3600;
  return ref === "S" || ref === "W" ? -value : value;
}

const ORIENTATION_WORDS: Record<number, string> = {
  1: "upright",
  2: "mirrored",
  3: "upside down",
  4: "flipped",
  5: "on its side, mirrored",
  6: "rotated 90 degrees clockwise",
  7: "on its side, mirrored",
  8: "rotated 90 degrees anticlockwise",
};

/** The facts an Exif block carries, from its TIFF structure. */
export function readExif(tiff: Uint8Array): { facts: MetadataFact[]; orientation: number | null; hasLocation: boolean; hasMakerNote: boolean } {
  const empty = { facts: [] as MetadataFact[], orientation: null as number | null, hasLocation: false, hasMakerNote: false };
  if (!TiffReader.isTiff(tiff)) return empty;
  const reader = new TiffReader(tiff);
  const facts: MetadataFact[] = [];
  let orientation: number | null = null;
  let hasLocation = false;
  let hasMakerNote = false;

  const ifd0 = reader.ifd(reader.u32(4));
  const find = (entries: TiffEntry[], tag: number) => entries.find((entry) => entry.tag === tag);
  const text = (entries: TiffEntry[], tag: number, label: string) => {
    const entry = find(entries, tag);
    const value = entry ? reader.ascii(entry) : null;
    if (value) facts.push({ label, value });
  };

  const make = find(ifd0, 0x010f) ? reader.ascii(find(ifd0, 0x010f)!) : null;
  const model = find(ifd0, 0x0110) ? reader.ascii(find(ifd0, 0x0110)!) : null;
  if (make || model) {
    facts.push({ label: "Camera", value: [make, model].filter((part): part is string => Boolean(part)).join(" ") });
  }
  const orientationEntry = find(ifd0, 0x0112);
  if (orientationEntry) {
    const value = reader.number(orientationEntry);
    if (value !== null && value >= 1 && value <= 8) {
      orientation = value;
      if (value !== 1) facts.push({ label: "Orientation", value: `${ORIENTATION_WORDS[value]} (kept, so the picture stays the right way up)` });
    }
  }
  text(ifd0, 0x0132, "Modified");
  text(ifd0, 0x0131, "Software");
  text(ifd0, 0x010e, "Description");
  text(ifd0, 0x013b, "Artist");
  text(ifd0, 0x8298, "Copyright");

  const exifPointer = find(ifd0, 0x8769);
  if (exifPointer) {
    const exif = reader.ifd(reader.u32(exifPointer.valueOffset));
    text(exif, 0x9003, "Taken");
    const lensMake = find(exif, 0xa433) ? reader.ascii(find(exif, 0xa433)!) : null;
    const lensModel = find(exif, 0xa434) ? reader.ascii(find(exif, 0xa434)!) : null;
    if (lensMake || lensModel) {
      facts.push({ label: "Lens", value: [lensMake, lensModel].filter((part): part is string => Boolean(part)).join(" ") });
    }
    const exposure: string[] = [];
    const time = find(exif, 0x829a) ? reader.number(find(exif, 0x829a)!) : null;
    if (time !== null && time > 0) exposure.push(time >= 1 ? `${Number(time.toFixed(1))} s` : `1/${Math.round(1 / time)} s`);
    const fNumber = find(exif, 0x829d) ? reader.number(find(exif, 0x829d)!) : null;
    if (fNumber !== null && fNumber > 0) exposure.push(`f/${Number(fNumber.toFixed(1))}`);
    const iso = find(exif, 0x8827) ? reader.number(find(exif, 0x8827)!) : null;
    if (iso !== null && iso > 0) exposure.push(`ISO ${iso}`);
    const focal = find(exif, 0x920a) ? reader.number(find(exif, 0x920a)!) : null;
    if (focal !== null && focal > 0) exposure.push(`${Number(focal.toFixed(1))} mm`);
    if (exposure.length > 0) facts.push({ label: "Exposure", value: exposure.join(", ") });
    text(exif, 0xa431, "Camera serial number");
    text(exif, 0xa420, "Image ID");
    text(exif, 0x9286, "User comment");
    hasMakerNote = find(exif, 0x927c) !== undefined;
  }

  const gpsPointer = find(ifd0, 0x8825);
  if (gpsPointer) {
    const gps = reader.ifd(reader.u32(gpsPointer.valueOffset));
    const latitude = find(gps, 0x0002);
    const longitude = find(gps, 0x0004);
    if (latitude && longitude) {
      const lat = gpsToDecimal([0, 1, 2].map((i) => reader.number(latitude, i)), find(gps, 0x0001) ? reader.ascii(find(gps, 0x0001)!) : null);
      const lon = gpsToDecimal([0, 1, 2].map((i) => reader.number(longitude, i)), find(gps, 0x0003) ? reader.ascii(find(gps, 0x0003)!) : null);
      if (lat !== null && lon !== null) {
        hasLocation = true;
        const altitude = find(gps, 0x0006) ? reader.number(find(gps, 0x0006)!) : null;
        facts.push({
          label: "Location",
          value: `${lat.toFixed(5)}, ${lon.toFixed(5)}${altitude !== null ? `, ${Math.round(altitude)} m` : ""}`,
        });
      }
    }
    text(gps, 0x001d, "GPS date");
  }

  return { facts, orientation, hasLocation, hasMakerNote };
}

/**
 * A minimal Exif block carrying only the orientation, as a TIFF structure:
 * an IFD0 with one SHORT entry and no next IFD.
 */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const view = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d, 0x00, 0x2a]); // big-endian TIFF
  view.setUint32(4, 8);
  view.setUint16(8, 1);
  view.setUint16(10, 0x0112);
  view.setUint16(12, 3);
  view.setUint32(14, 1);
  view.setUint16(18, orientation);
  view.setUint32(22, 0);
  return tiff;
}

/* ---- JPEG --------------------------------------------------------------- */

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function startsWith(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** What a JPEG segment is, for keeping or dropping. */
function jpegSegmentName(marker: number, bytes: Uint8Array, dataOffset: number): { name: string; keep: boolean } {
  if (marker === 0xe0) return { name: "JFIF", keep: true };
  if (marker === 0xe1) {
    if (startsWith(bytes, dataOffset, "Exif\0")) return { name: "Exif", keep: false };
    if (startsWith(bytes, dataOffset, "http://ns.adobe.com/xap/1.0/")) return { name: "XMP", keep: false };
    if (startsWith(bytes, dataOffset, "http://ns.adobe.com/xmp/extension/")) return { name: "XMP", keep: false };
    return { name: "APP1", keep: false };
  }
  if (marker === 0xe2) {
    if (startsWith(bytes, dataOffset, "ICC_PROFILE\0")) return { name: "ICC colour profile", keep: true };
    if (startsWith(bytes, dataOffset, "MPF\0")) return { name: "multi-picture extension", keep: false };
    return { name: "APP2", keep: false };
  }
  if (marker === 0xed) return { name: startsWith(bytes, dataOffset, "Photoshop 3.0\0") ? "IPTC" : "APP13", keep: false };
  if (marker === 0xee) return { name: "Adobe", keep: true };
  if (marker === 0xfe) return { name: "comment", keep: false };
  if (marker >= 0xe3 && marker <= 0xef) return { name: `APP${marker - 0xe0}`, keep: false };
  return { name: "", keep: true };
}

function stripJpeg(bytes: Uint8Array): StrippedImage {
  const metadata: ImageMetadata = { container: "jpeg", facts: [], blocks: [], orientation: null, hasLocation: false };
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  const dropped = new Set<string>();
  let at = 2;
  let insertAt = 1; // where an orientation block goes: after JFIF when there is one
  let exifSeen = false;

  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    // Fill bytes: a run of 0xFF before a marker.
    if (bytes[at + 1] === 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    // The scan: everything from here to the end is picture, copied as it is.
    if (marker === 0xda || marker === 0xd9) {
      kept.push(bytes.subarray(at));
      break;
    }
    // Markers with no length: restart markers and TEM.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = Math.min(bytes.length, at + 2 + length);
    const dataOffset = at + 4;
    const { name, keep } = jpegSegmentName(marker, bytes, dataOffset);
    if (name === "Exif" && !exifSeen) {
      exifSeen = true;
      const tiff = bytes.subarray(dataOffset + EXIF_HEADER.length, end);
      const exif = readExif(tiff);
      metadata.facts.push(...exif.facts);
      metadata.orientation = exif.orientation;
      metadata.hasLocation = exif.hasLocation;
      if (exif.hasMakerNote) dropped.add("maker notes");
    }
    if (keep) {
      kept.push(bytes.subarray(at, end));
      if (marker === 0xe0) insertAt = kept.length;
    } else if (name) {
      dropped.add(name);
    }
    at = end;
  }

  metadata.blocks = [...dropped];
  if (dropped.size === 0) return { metadata, bytes: null };

  if (metadata.orientation !== null && metadata.orientation !== 1) {
    const tiff = orientationOnlyExif(metadata.orientation);
    const segment = new Uint8Array(4 + EXIF_HEADER.length + tiff.length);
    segment.set([0xff, 0xe1, (segment.length - 2) >> 8, (segment.length - 2) & 0xff]);
    segment.set(EXIF_HEADER, 4);
    segment.set(tiff, 4 + EXIF_HEADER.length);
    kept.splice(insertAt, 0, segment);
  }
  return { metadata, bytes: concat(kept) };
}

/* ---- PNG ---------------------------------------------------------------- */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const PNG_METADATA_CHUNKS: Record<string, string> = {
  tEXt: "text",
  zTXt: "text",
  iTXt: "text",
  eXIf: "Exif",
  tIME: "modification time",
};

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function stripPng(bytes: Uint8Array): StrippedImage {
  const metadata: ImageMetadata = { container: "png", facts: [], blocks: [], orientation: null, hasLocation: false };
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  const dropped = new Set<string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;

  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = latin1(bytes.subarray(at + 4, at + 8));
    const end = Math.min(bytes.length, at + 12 + length);
    const name = PNG_METADATA_CHUNKS[type];
    if (name === undefined) {
      kept.push(bytes.subarray(at, end));
    } else {
      const data = bytes.subarray(at + 8, at + 8 + length);
      if (type === "eXIf") {
        const exif = readExif(data);
        metadata.facts.push(...exif.facts);
        metadata.orientation = exif.orientation;
        metadata.hasLocation = exif.hasLocation;
        dropped.add("Exif");
      } else if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
        const zero = data.indexOf(0);
        const key = zero > 0 ? latin1(data.subarray(0, zero)) : "";
        if (key === "XML:com.adobe.xmp") dropped.add("XMP");
        else {
          dropped.add("text");
          // Plain text is readable as it is; compressed and international text only by name.
          if (type === "tEXt" && key && zero + 1 < data.length) {
            metadata.facts.push({ label: key, value: latin1(data.subarray(zero + 1)).slice(0, 200) });
          } else if (key) {
            metadata.facts.push({ label: key, value: type === "zTXt" ? "(compressed text)" : "(text)" });
          }
        }
      } else if (type === "tIME" && length >= 7) {
        dropped.add("modification time");
        const year = view.getUint16(at + 8);
        metadata.facts.push({
          label: "Modified",
          value: `${year}-${String(data[2]).padStart(2, "0")}-${String(data[3]).padStart(2, "0")} ${String(data[4]).padStart(2, "0")}:${String(data[5]).padStart(2, "0")}`,
        });
      }
    }
    at = end;
    if (type === "IEND") break;
  }

  metadata.blocks = [...dropped];
  if (dropped.size === 0) return { metadata, bytes: null };
  // A PNG with a rotation in its Exif is rare, and a browser applies it too;
  // keep the tag the way a JPEG does, in an eXIf chunk after the header.
  if (metadata.orientation !== null && metadata.orientation !== 1) {
    const tiff = orientationOnlyExif(metadata.orientation);
    const chunk = new Uint8Array(12 + tiff.length);
    const chunkView = new DataView(chunk.buffer);
    chunkView.setUint32(0, tiff.length);
    chunk.set([0x65, 0x58, 0x49, 0x66], 4); // "eXIf"
    chunk.set(tiff, 8);
    chunkView.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)));
    // After IHDR, which is always the first chunk.
    kept.splice(2, 0, chunk);
  }
  return { metadata, bytes: concat(kept) };
}

/** CRC-32 as PNG defines it, for a chunk this writes. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---- WebP --------------------------------------------------------------- */

function stripWebp(bytes: Uint8Array): StrippedImage {
  const metadata: ImageMetadata = { container: "webp", facts: [], blocks: [], orientation: null, hasLocation: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  const dropped = new Set<string>();
  let vp8x: Uint8Array | null = null;
  let at = 12;

  while (at + 8 <= bytes.length) {
    const fourcc = latin1(bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const end = Math.min(bytes.length, at + 8 + size + (size % 2));
    if (fourcc === "EXIF") {
      dropped.add("Exif");
      const data = bytes.subarray(at + 8, at + 8 + size);
      // Some writers put the JPEG-style "Exif\0\0" prefix in front of the TIFF.
      const tiff = startsWith(data, 0, "Exif\0\0") ? data.subarray(6) : data;
      const exif = readExif(tiff);
      metadata.facts.push(...exif.facts);
      metadata.orientation = exif.orientation;
      metadata.hasLocation = exif.hasLocation;
    } else if (fourcc === "XMP ") {
      dropped.add("XMP");
    } else {
      const chunk = new Uint8Array(bytes.subarray(at, end));
      if (fourcc === "VP8X") vp8x = chunk;
      chunks.push(chunk);
    }
    at = end;
  }

  metadata.blocks = [...dropped];
  if (dropped.size === 0) return { metadata, bytes: null };
  // The extended header says which chunks are present; say they are gone.
  if (vp8x && vp8x.length >= 9) vp8x[8] &= ~0x0c;
  const body = concat(chunks);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return { metadata, bytes: out };
}

/* ---- Entry -------------------------------------------------------------- */

/** Which container the bytes are, from their signature, or null for anything else. */
export function imageContainer(bytes: Uint8Array): ImageContainer | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return "png";
  if (bytes.length >= 12 && startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) return "webp";
  return null;
}

/**
 * Reads what the file says about itself and produces a copy without it.
 *
 * Throws for anything that is not a JPEG, PNG or WebP: the formats that
 * cannot be stripped without decoding are the converter's job.
 */
export function stripImageMetadata(bytes: Uint8Array): StrippedImage {
  const container = imageContainer(bytes);
  if (container === "jpeg") return stripJpeg(bytes);
  if (container === "png") return stripPng(bytes);
  if (container === "webp") return stripWebp(bytes);
  throw new Error("Not a JPEG, PNG or WebP file.");
}
