import { describe, expect, it } from "vitest";

import {
  crc32,
  gpsToDecimal,
  imageContainer,
  orientationOnlyExif,
  readExif,
  stripImageMetadata,
} from "@/lib/images/metadata";

/* ---- A TIFF builder, so the fixtures carry real Exif ---------------------- */

type Entry = { tag: number; type: number; values: (number | string | [number, number])[] };

function tiffOf(ifd0: Entry[], exif: Entry[] = [], gps: Entry[] = []): Uint8Array {
  // Big-endian. Layout: header, IFD0, Exif IFD, GPS IFD, then every value block.
  const chunks: number[] = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8];
  const blobs: { at: number; bytes: number[] }[] = [];
  const sizeOf = (type: number) => ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 })[type] ?? 1;
  const encode = (entry: Entry): number[] => {
    const out: number[] = [];
    for (const value of entry.values) {
      if (entry.type === 2) {
        for (const ch of value as string) out.push(ch.charCodeAt(0));
        out.push(0);
      } else if (entry.type === 3) out.push(((value as number) >> 8) & 0xff, (value as number) & 0xff);
      else if (entry.type === 4) out.push(((value as number) >>> 24) & 0xff, ((value as number) >>> 16) & 0xff, ((value as number) >>> 8) & 0xff, (value as number) & 0xff);
      else if (entry.type === 5) {
        const [n, d] = value as [number, number];
        for (const v of [n, d]) out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      } else out.push(value as number);
    }
    return out;
  };
  const ifdSize = (entries: Entry[]) => 2 + entries.length * 12 + 4;
  const ifd0At = 8;
  // IFD0 also carries a pointer entry for each sub-IFD present.
  const exifAt = ifd0At + ifdSize(ifd0) + (exif.length ? 12 : 0) + (gps.length ? 12 : 0);
  const gpsAt = exifAt + (exif.length ? ifdSize(exif) : 0);
  let valuesAt = gpsAt + (gps.length ? ifdSize(gps) : 0);
  const writeIfd = (entries: Entry[]) => {
    chunks.push((entries.length >> 8) & 0xff, entries.length & 0xff);
    for (const entry of entries) {
      const bytes = encode(entry);
      const count = entry.type === 2 ? bytes.length : entry.values.length;
      chunks.push((entry.tag >> 8) & 0xff, entry.tag & 0xff, 0, entry.type, (count >>> 24) & 0xff, (count >>> 16) & 0xff, (count >>> 8) & 0xff, count & 0xff);
      if (bytes.length <= 4) chunks.push(...bytes, ...new Array(4 - bytes.length).fill(0));
      else {
        chunks.push((valuesAt >>> 24) & 0xff, (valuesAt >>> 16) & 0xff, (valuesAt >>> 8) & 0xff, valuesAt & 0xff);
        blobs.push({ at: valuesAt, bytes });
        valuesAt += bytes.length + (bytes.length % 2);
      }
    }
    chunks.push(0, 0, 0, 0);
  };
  const pointers: Entry[] = [...ifd0];
  if (exif.length) pointers.push({ tag: 0x8769, type: 4, values: [exifAt] });
  if (gps.length) pointers.push({ tag: 0x8825, type: 4, values: [gpsAt] });
  pointers.sort((a, b) => a.tag - b.tag);
  writeIfd(pointers);
  if (exif.length) writeIfd(exif);
  if (gps.length) writeIfd(gps);
  for (const blob of blobs) {
    while (chunks.length < blob.at) chunks.push(0);
    chunks.push(...blob.bytes);
  }
  void sizeOf;
  return new Uint8Array(chunks);
}

const CAMERA_EXIF = tiffOf(
  [
    { tag: 0x010f, type: 2, values: ["Apple"] },
    { tag: 0x0110, type: 2, values: ["iPhone 15 Pro"] },
    { tag: 0x0112, type: 3, values: [6] },
    { tag: 0x0131, type: 2, values: ["17.2"] },
  ],
  [
    { tag: 0x829a, type: 5, values: [[1, 120]] },
    { tag: 0x829d, type: 5, values: [[18, 10]] },
    { tag: 0x8827, type: 3, values: [64] },
    { tag: 0x9003, type: 2, values: ["2024:06:01 14:22:10"] },
    { tag: 0x920a, type: 5, values: [[68, 10]] },
    { tag: 0x927c, type: 7, values: [1, 2, 3, 4, 5, 6] },
    { tag: 0xa431, type: 2, values: ["SN12345"] },
    { tag: 0xa434, type: 2, values: ["iPhone 15 Pro back camera"] },
  ],
  [
    { tag: 0x0001, type: 2, values: ["N"] },
    { tag: 0x0002, type: 5, values: [[51, 1], [30, 1], [1500, 100]] },
    { tag: 0x0003, type: 2, values: ["W"] },
    { tag: 0x0004, type: 5, values: [[0, 1], [7, 1], [3000, 100]] },
    { tag: 0x0006, type: 5, values: [[3500, 100]] },
  ],
);

/* ---- Containers ---------------------------------------------------------- */

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];

function jpegOf(segments: number[][], scan = [0x01, 0x02, 0x03]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, ...be16(8), 1, 1, 0, 0, 63, 0, ...scan, 0xff, 0xd9]);
}
const app = (marker: number, payload: number[]) => [0xff, marker, ...be16(payload.length + 2), ...payload];
const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));
const JFIF = app(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = app(0xe2, [...ascii("ICC_PROFILE\0"), 1, 1, 9, 9, 9]);
const EXIF = app(0xe1, [...ascii("Exif\0\0"), ...CAMERA_EXIF]);
const XMP = app(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/\0"), ...ascii("<x:xmpmeta/>")]);
const COMMENT = app(0xfe, ascii("made with love"));
const DQT = app(0xdb, [0, ...new Array(64).fill(1)]);

function pngChunk(type: string, data: number[]): number[] {
  const body = [...ascii(type), ...data];
  const crc = crc32(new Uint8Array(body));
  return [...[0, 0, 0, 0].map((_, i) => (data.length >>> (24 - i * 8)) & 0xff), ...body, (crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff];
}
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
const IDAT = pngChunk("IDAT", [1, 2, 3]);
const IEND = pngChunk("IEND", []);

function webpChunk(fourcc: string, data: number[]): number[] {
  const size = data.length;
  return [...ascii(fourcc), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff, ...data, ...(size % 2 ? [0] : [])];
}
function webpOf(chunks: number[][]): Uint8Array {
  const body = chunks.flat();
  const size = body.length + 4;
  return new Uint8Array([...ascii("RIFF"), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff, ...ascii("WEBP"), ...body]);
}

describe("reading Exif", () => {
  it("lists the camera, the exposure, the place and the serial number", () => {
    const exif = readExif(CAMERA_EXIF);
    expect(exif.orientation).toBe(6);
    expect(exif.hasLocation).toBe(true);
    expect(exif.hasMakerNote).toBe(true);
    const facts = Object.fromEntries(exif.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.Camera).toBe("Apple iPhone 15 Pro");
    expect(facts.Orientation).toMatch(/^rotated 90 degrees clockwise/);
    expect(facts.Software).toBe("17.2");
    expect(facts.Taken).toBe("2024:06:01 14:22:10");
    expect(facts.Lens).toBe("iPhone 15 Pro back camera");
    expect(facts.Exposure).toBe("1/120 s, f/1.8, ISO 64, 6.8 mm");
    expect(facts["Camera serial number"]).toBe("SN12345");
    expect(facts.Location).toBe("51.50417, -0.12500, 35 m");
    expect(gpsToDecimal([51, 30, 15], "S")).toBeCloseTo(-51.50417, 4);
  });

  it("shrugs at bytes that are not a TIFF", () => {
    expect(readExif(new Uint8Array([1, 2, 3]))).toEqual({ facts: [], orientation: null, hasLocation: false, hasMakerNote: false });
  });

  it("writes an orientation-only block that reads back", () => {
    expect(readExif(orientationOnlyExif(8)).orientation).toBe(8);
    expect(readExif(orientationOnlyExif(8)).facts).toHaveLength(1);
  });
});

describe("stripping a JPEG", () => {
  it("drops Exif, XMP and the comment, keeps JFIF and the colour profile, and keeps the orientation", () => {
    const source = jpegOf([JFIF, EXIF, ICC, XMP, COMMENT, DQT]);
    const { metadata, bytes } = stripImageMetadata(source);
    expect(metadata.container).toBe("jpeg");
    expect(metadata.blocks.sort()).toEqual(["Exif", "XMP", "comment", "maker notes"]);
    expect(metadata.hasLocation).toBe(true);
    expect(bytes).not.toBeNull();
    const clean = bytes!;
    expect(clean.length).toBeLessThan(source.length);
    // The clean file is JFIF, then an Exif block with only the orientation, then the profile and the tables.
    const again = stripImageMetadata(clean);
    expect(again.metadata.orientation).toBe(6);
    expect(again.metadata.hasLocation).toBe(false);
    expect(again.metadata.facts.map((fact) => fact.label)).toEqual(["Orientation"]);
    expect(Array.from(clean.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(Array.from(clean.subarray(clean.length - 2))).toEqual([0xff, 0xd9]);
    const text = Array.from(clean, (byte) => String.fromCharCode(byte)).join("");
    expect(text).toContain("ICC_PROFILE");
    expect(text).not.toContain("xmpmeta");
    expect(text).not.toContain("made with love");
    expect(text).not.toContain("SN12345");
  });

  it("writes no Exif at all for an upright photo, and leaves a clean file alone", () => {
    const upright = tiffOf([{ tag: 0x0112, type: 3, values: [1] }, { tag: 0x010f, type: 2, values: ["Canon"] }]);
    const source = jpegOf([JFIF, app(0xe1, [...ascii("Exif\0\0"), ...upright]), DQT]);
    const clean = stripImageMetadata(source).bytes!;
    expect(Array.from(clean, (byte) => String.fromCharCode(byte)).join("")).not.toContain("Exif");
    expect(stripImageMetadata(clean).bytes).toBeNull();
    expect(stripImageMetadata(jpegOf([JFIF, DQT])).metadata.blocks).toEqual([]);
  });

  it("keeps restart markers and fill bytes in the scan, and the Adobe segment", () => {
    const adobe = app(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 1]);
    const source = jpegOf([JFIF, COMMENT, adobe], [0x01, 0xff, 0xd0, 0x02, 0xff, 0x00, 0x03]);
    const clean = stripImageMetadata(source).bytes!;
    const text = Array.from(clean, (byte) => String.fromCharCode(byte)).join("");
    expect(text).toContain("Adobe");
    expect(Array.from(clean.subarray(clean.length - 9))).toEqual([0x01, 0xff, 0xd0, 0x02, 0xff, 0x00, 0x03, 0xff, 0xd9]);
  });
});

describe("stripping a PNG", () => {
  it("drops text, time and Exif chunks and keeps the rest byte for byte", () => {
    const text = pngChunk("tEXt", [...ascii("Author"), 0, ...ascii("Someone")]);
    const xmp = pngChunk("iTXt", [...ascii("XML:com.adobe.xmp"), 0, 0, 0, 0, 0, ...ascii("<x/>")]);
    const time = pngChunk("tIME", [7, 232, 6, 1, 14, 22, 10]);
    const exif = pngChunk("eXIf", Array.from(CAMERA_EXIF));
    const source = new Uint8Array([...PNG_SIG, ...IHDR, ...text, ...xmp, ...time, ...exif, ...IDAT, ...IEND]);
    const { metadata, bytes } = stripImageMetadata(source);
    expect(metadata.container).toBe("png");
    expect(metadata.blocks.sort()).toEqual(["Exif", "XMP", "modification time", "text"]);
    const facts = Object.fromEntries(metadata.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.Author).toBe("Someone");
    expect(facts.Modified).toBe("2024-06-01 14:22");
    expect(facts.Camera).toBe("Apple iPhone 15 Pro");
    const clean = bytes!;
    // Signature, IHDR, an orientation-only eXIf, IDAT, IEND.
    const again = stripImageMetadata(clean);
    expect(again.metadata.blocks).toEqual(["Exif"]);
    expect(again.metadata.orientation).toBe(6);
    expect(again.metadata.facts).toHaveLength(1);
    expect(Array.from(clean.subarray(clean.length - IEND.length))).toEqual(IEND);
    expect(stripImageMetadata(new Uint8Array([...PNG_SIG, ...IHDR, ...IDAT, ...IEND])).bytes).toBeNull();
  });
});

describe("stripping a WebP", () => {
  it("drops the Exif and XMP chunks, clears their flags and fixes the size", () => {
    const vp8x = webpChunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const exif = webpChunk("EXIF", Array.from(CAMERA_EXIF));
    const xmp = webpChunk("XMP ", ascii("<x/>"));
    const vp8 = webpChunk("VP8 ", [1, 2, 3, 4, 5]);
    const source = webpOf([vp8x, exif, xmp, vp8]);
    const { metadata, bytes } = stripImageMetadata(source);
    expect(metadata.container).toBe("webp");
    expect(metadata.blocks.sort()).toEqual(["Exif", "XMP"]);
    expect(metadata.hasLocation).toBe(true);
    const clean = bytes!;
    expect(clean.length).toBe(12 + vp8x.length + vp8.length);
    expect(new DataView(clean.buffer).getUint32(4, true)).toBe(clean.length - 8);
    expect(clean[12 + 8]).toBe(0);
    expect(stripImageMetadata(clean).bytes).toBeNull();
  });
});

describe("imageContainer", () => {
  it("names the three containers and nothing else", () => {
    expect(imageContainer(jpegOf([JFIF]))).toBe("jpeg");
    expect(imageContainer(new Uint8Array([...PNG_SIG, ...IHDR]))).toBe("png");
    expect(imageContainer(webpOf([]))).toBe("webp");
    expect(imageContainer(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
    expect(() => stripImageMetadata(new Uint8Array([1, 2, 3]))).toThrow(/Not a JPEG/);
  });
});
