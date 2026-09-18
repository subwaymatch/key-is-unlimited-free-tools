/**
 * What a file is, from its first bytes rather than its name.
 *
 * Most formats announce themselves in a signature at the start: PNG in its
 * first eight bytes, a ZIP in "PK", an MP4 in "ftyp" at the fourth byte.
 * A few need a look further in - a TAR says "ustar" at byte 257, an ISO
 * says "CD001" at 32769, an Office document is a ZIP whose entry names
 * say which kind - and text is text when it decodes and has no zero
 * bytes, with the first line saying what sort.
 *
 * Pure, on byte arrays; the table is the interesting part.
 */
import { CsvParser, type Delimiter } from "../data/csv";
import { detectEncoding, looksBinary } from "../text/encoding";

export type KindCategory = "image" | "video" | "audio" | "document" | "archive" | "font" | "program" | "data" | "text" | "other";

export interface FileKind {
  name: string;
  mime: string;
  extensions: readonly string[];
  category: KindCategory;
}

const kind = (name: string, mime: string, extensions: string[], category: KindCategory): FileKind => ({ name, mime, extensions, category });

/** Bytes as the table writes them: numbers, or the characters of an ASCII string. */
function bytesOf(pattern: string | readonly number[]): number[] {
  return typeof pattern === "string" ? Array.from(pattern, (ch) => ch.charCodeAt(0)) : [...pattern];
}

function matchesAt(bytes: Uint8Array, offset: number, pattern: string | readonly number[]): boolean {
  const wanted = bytesOf(pattern);
  if (bytes.length < offset + wanted.length) return false;
  return wanted.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let index = offset; index < Math.min(bytes.length, offset + length); index += 1) out += String.fromCharCode(bytes[index]);
  return out;
}

function contains(bytes: Uint8Array, text: string): boolean {
  return ascii(bytes, 0, bytes.length).includes(text);
}

interface Signature {
  offset: number;
  pattern: string | readonly number[];
  kind: FileKind;
  /** A closer look, for a signature several formats share. */
  refine?: (head: Uint8Array, tail: Uint8Array) => FileKind;
}

const ZIP = kind("ZIP archive", "application/zip", ["zip"], "archive");
const MP4 = kind("MP4 video", "video/mp4", ["mp4", "m4v"], "video");
const OGG = kind("Ogg container", "audio/ogg", ["ogg", "oga"], "audio");
const OLE = kind("Microsoft Office 97-2003 document, or an Outlook message", "application/x-ole-storage", ["doc", "xls", "ppt", "msg"], "document");

/** What a ZIP holds, from the entry names in its first and last kilobytes. */
function refineZip(head: Uint8Array, tail: Uint8Array): FileKind {
  const names = ascii(head, 0, head.length) + ascii(tail, 0, tail.length);
  if (names.includes("word/")) return kind("Word document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ["docx"], "document");
  if (names.includes("xl/")) return kind("Excel workbook", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["xlsx"], "document");
  if (names.includes("ppt/")) return kind("PowerPoint presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation", ["pptx"], "document");
  if (names.includes("application/epub+zip")) return kind("EPUB book", "application/epub+zip", ["epub"], "document");
  if (names.includes("AndroidManifest.xml") || names.includes("classes.dex")) return kind("Android app package", "application/vnd.android.package-archive", ["apk"], "program");
  if (names.includes("META-INF/MANIFEST.MF")) return kind("Java archive", "application/java-archive", ["jar"], "program");
  if (names.includes("content.xml") && names.includes("mimetype")) return kind("OpenDocument file", "application/vnd.oasis.opendocument", ["odt", "ods", "odp"], "document");
  if (names.includes("Payload/") && names.includes(".app/")) return kind("iOS app package", "application/octet-stream", ["ipa"], "program");
  return ZIP;
}

function refineFtyp(head: Uint8Array): FileKind {
  const brand = ascii(head, 8, 4);
  if (brand.startsWith("avi")) return kind("AVIF image", "image/avif", ["avif"], "image");
  if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) return kind("HEIC/HEIF image", "image/heic", ["heic", "heif"], "image");
  if (brand === "qt  ") return kind("QuickTime video", "video/quicktime", ["mov"], "video");
  if (brand === "M4A ") return kind("M4A audio", "audio/mp4", ["m4a"], "audio");
  if (brand === "M4B ") return kind("M4B audiobook", "audio/mp4", ["m4b"], "audio");
  if (brand.startsWith("3g")) return kind("3GP video", "video/3gpp", ["3gp"], "video");
  if (brand === "crx ") return kind("Canon raw image", "image/x-canon-cr3", ["cr3"], "image");
  return MP4;
}

function refineEbml(head: Uint8Array): FileKind {
  if (contains(head.subarray(0, 64), "webm")) return kind("WebM video", "video/webm", ["webm"], "video");
  return kind("Matroska video", "video/x-matroska", ["mkv", "mka"], "video");
}

function refineRiff(head: Uint8Array): FileKind {
  const form = ascii(head, 8, 4);
  if (form === "WEBP") return kind("WebP image", "image/webp", ["webp"], "image");
  if (form === "AVI ") return kind("AVI video", "video/x-msvideo", ["avi"], "video");
  if (form === "WAVE") return kind("WAV audio", "audio/wav", ["wav"], "audio");
  return kind("RIFF container", "application/octet-stream", ["riff"], "other");
}

function refineOgg(head: Uint8Array): FileKind {
  const text = ascii(head, 0, 256);
  if (text.includes("OpusHead")) return kind("Opus audio", "audio/ogg", ["opus", "ogg"], "audio");
  if (text.includes("vorbis")) return kind("Ogg Vorbis audio", "audio/ogg", ["ogg", "oga"], "audio");
  if (text.includes("theora")) return kind("Ogg Theora video", "video/ogg", ["ogv"], "video");
  if (text.includes("FLAC")) return kind("FLAC in Ogg", "audio/ogg", ["oga"], "audio");
  return OGG;
}

function refineCafeBabe(head: Uint8Array): FileKind {
  // A Java class carries a version at byte 6; a fat Mach-O carries a small architecture count there.
  const major = (head[6] << 8) | head[7];
  if (major >= 45 && major < 100) return kind("Java class", "application/java-vm", ["class"], "program");
  return kind("macOS universal binary", "application/x-mach-binary", [], "program");
}

const SIGNATURES: readonly Signature[] = [
  { offset: 0, pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], kind: kind("PNG image", "image/png", ["png"], "image") },
  { offset: 0, pattern: [0xff, 0xd8, 0xff], kind: kind("JPEG image", "image/jpeg", ["jpg", "jpeg", "jfif"], "image") },
  { offset: 0, pattern: "GIF87a", kind: kind("GIF image", "image/gif", ["gif"], "image") },
  { offset: 0, pattern: "GIF89a", kind: kind("GIF image", "image/gif", ["gif"], "image") },
  { offset: 0, pattern: "RIFF", kind: kind("RIFF container", "application/octet-stream", [], "other"), refine: refineRiff },
  { offset: 0, pattern: "BM", kind: kind("BMP image", "image/bmp", ["bmp"], "image") },
  { offset: 0, pattern: [0x49, 0x49, 0x2a, 0x00], kind: kind("TIFF image", "image/tiff", ["tif", "tiff"], "image") },
  { offset: 0, pattern: [0x4d, 0x4d, 0x00, 0x2a], kind: kind("TIFF image", "image/tiff", ["tif", "tiff"], "image") },
  { offset: 0, pattern: [0x00, 0x00, 0x01, 0x00], kind: kind("ICO icon", "image/x-icon", ["ico"], "image") },
  { offset: 0, pattern: [0x00, 0x00, 0x02, 0x00], kind: kind("Windows cursor", "image/x-icon", ["cur"], "image") },
  { offset: 0, pattern: "8BPS", kind: kind("Photoshop document", "image/vnd.adobe.photoshop", ["psd"], "image") },
  { offset: 0, pattern: [0xff, 0x0a], kind: kind("JPEG XL image", "image/jxl", ["jxl"], "image") },
  { offset: 0, pattern: [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20], kind: kind("JPEG XL image", "image/jxl", ["jxl"], "image") },
  { offset: 0, pattern: [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20], kind: kind("JPEG 2000 image", "image/jp2", ["jp2"], "image") },
  { offset: 0, pattern: "qoif", kind: kind("QOI image", "image/qoi", ["qoi"], "image") },
  { offset: 4, pattern: "ftyp", kind: MP4, refine: refineFtyp },
  { offset: 0, pattern: [0x1a, 0x45, 0xdf, 0xa3], kind: kind("Matroska video", "video/x-matroska", ["mkv"], "video"), refine: refineEbml },
  { offset: 0, pattern: "FLV", kind: kind("Flash video", "video/x-flv", ["flv"], "video") },
  { offset: 0, pattern: [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11], kind: kind("Windows Media (ASF)", "video/x-ms-asf", ["wmv", "wma", "asf"], "video") },
  { offset: 0, pattern: [0x00, 0x00, 0x01, 0xba], kind: kind("MPEG program stream", "video/mpeg", ["mpg", "mpeg", "vob"], "video") },
  { offset: 0, pattern: [0x00, 0x00, 0x01, 0xb3], kind: kind("MPEG video", "video/mpeg", ["mpg", "mpeg"], "video") },
  { offset: 0, pattern: "ID3", kind: kind("MP3 audio", "audio/mpeg", ["mp3"], "audio") },
  { offset: 0, pattern: [0xff, 0xfb], kind: kind("MP3 audio", "audio/mpeg", ["mp3"], "audio") },
  { offset: 0, pattern: [0xff, 0xf3], kind: kind("MP3 audio", "audio/mpeg", ["mp3"], "audio") },
  { offset: 0, pattern: [0xff, 0xf2], kind: kind("MP3 audio", "audio/mpeg", ["mp3"], "audio") },
  { offset: 0, pattern: [0xff, 0xf1], kind: kind("AAC audio (ADTS)", "audio/aac", ["aac"], "audio") },
  { offset: 0, pattern: [0xff, 0xf9], kind: kind("AAC audio (ADTS)", "audio/aac", ["aac"], "audio") },
  { offset: 0, pattern: "fLaC", kind: kind("FLAC audio", "audio/flac", ["flac"], "audio") },
  { offset: 0, pattern: "OggS", kind: OGG, refine: refineOgg },
  { offset: 0, pattern: "FORM", kind: kind("AIFF audio", "audio/aiff", ["aiff", "aif"], "audio") },
  { offset: 0, pattern: "MThd", kind: kind("MIDI music", "audio/midi", ["mid", "midi"], "audio") },
  { offset: 0, pattern: "#!AMR", kind: kind("AMR audio", "audio/amr", ["amr"], "audio") },
  { offset: 0, pattern: "wvpk", kind: kind("WavPack audio", "audio/wavpack", ["wv"], "audio") },
  { offset: 0, pattern: "MAC ", kind: kind("Monkey's Audio", "audio/ape", ["ape"], "audio") },
  { offset: 0, pattern: "%PDF", kind: kind("PDF document", "application/pdf", ["pdf"], "document") },
  { offset: 0, pattern: "%!PS", kind: kind("PostScript", "application/postscript", ["ps", "eps"], "document") },
  { offset: 0, pattern: "{\\rtf", kind: kind("Rich Text document", "application/rtf", ["rtf"], "document") },
  { offset: 0, pattern: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], kind: OLE },
  { offset: 0, pattern: [0x50, 0x4b, 0x03, 0x04], kind: ZIP, refine: refineZip },
  { offset: 0, pattern: [0x50, 0x4b, 0x05, 0x06], kind: kind("ZIP archive (empty)", "application/zip", ["zip"], "archive") },
  { offset: 0, pattern: [0x1f, 0x8b], kind: kind("gzip compressed file", "application/gzip", ["gz", "tgz"], "archive") },
  { offset: 0, pattern: "BZh", kind: kind("bzip2 compressed file", "application/x-bzip2", ["bz2"], "archive") },
  { offset: 0, pattern: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], kind: kind("xz compressed file", "application/x-xz", ["xz"], "archive") },
  { offset: 0, pattern: [0x28, 0xb5, 0x2f, 0xfd], kind: kind("Zstandard compressed file", "application/zstd", ["zst"], "archive") },
  { offset: 0, pattern: [0x04, 0x22, 0x4d, 0x18], kind: kind("LZ4 compressed file", "application/x-lz4", ["lz4"], "archive") },
  { offset: 0, pattern: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], kind: kind("7-Zip archive", "application/x-7z-compressed", ["7z"], "archive") },
  { offset: 0, pattern: "Rar!", kind: kind("RAR archive", "application/vnd.rar", ["rar"], "archive") },
  { offset: 257, pattern: "ustar", kind: kind("TAR archive", "application/x-tar", ["tar"], "archive") },
  { offset: 0, pattern: "MSCF", kind: kind("Windows cabinet", "application/vnd.ms-cab-compressed", ["cab"], "archive") },
  { offset: 32769, pattern: "CD001", kind: kind("ISO disc image", "application/x-iso9660-image", ["iso"], "archive") },
  { offset: 0, pattern: "!<arch>", kind: kind("Unix archive (ar, deb)", "application/x-archive", ["a", "deb"], "archive") },
  { offset: 0, pattern: [0xed, 0xab, 0xee, 0xdb], kind: kind("RPM package", "application/x-rpm", ["rpm"], "archive") },
  { offset: 0, pattern: "xar!", kind: kind("xar archive (pkg)", "application/x-xar", ["xar", "pkg"], "archive") },
  { offset: 0, pattern: "Cr24", kind: kind("Chrome extension", "application/x-chrome-extension", ["crx"], "program") },
  { offset: 0, pattern: "MZ", kind: kind("Windows executable or library", "application/vnd.microsoft.portable-executable", ["exe", "dll"], "program") },
  { offset: 0, pattern: [0x7f, 0x45, 0x4c, 0x46], kind: kind("ELF executable or library", "application/x-elf", ["", "so"], "program") },
  { offset: 0, pattern: [0xfe, 0xed, 0xfa, 0xce], kind: kind("Mach-O executable (32-bit)", "application/x-mach-binary", [], "program") },
  { offset: 0, pattern: [0xfe, 0xed, 0xfa, 0xcf], kind: kind("Mach-O executable (64-bit)", "application/x-mach-binary", [], "program") },
  { offset: 0, pattern: [0xcf, 0xfa, 0xed, 0xfe], kind: kind("Mach-O executable (64-bit)", "application/x-mach-binary", [], "program") },
  { offset: 0, pattern: [0xca, 0xfe, 0xba, 0xbe], kind: kind("Java class", "application/java-vm", ["class"], "program"), refine: refineCafeBabe },
  { offset: 0, pattern: [0x00, 0x61, 0x73, 0x6d], kind: kind("WebAssembly module", "application/wasm", ["wasm"], "program") },
  { offset: 0, pattern: "dex\n", kind: kind("Android Dalvik executable", "application/octet-stream", ["dex"], "program") },
  { offset: 0, pattern: "SQLite format 3", kind: kind("SQLite database", "application/vnd.sqlite3", ["sqlite", "db", "sqlite3"], "data") },
  { offset: 0, pattern: "PAR1", kind: kind("Parquet table", "application/vnd.apache.parquet", ["parquet"], "data") },
  { offset: 0, pattern: "Obj\x01", kind: kind("Avro data", "application/avro", ["avro"], "data") },
  { offset: 0, pattern: [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a], kind: kind("HDF5 data", "application/x-hdf5", ["h5", "hdf5"], "data") },
  { offset: 0, pattern: [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59], kind: kind("NumPy array", "application/octet-stream", ["npy"], "data") },
  { offset: 0, pattern: [0xd4, 0xc3, 0xb2, 0xa1], kind: kind("Packet capture (pcap)", "application/vnd.tcpdump.pcap", ["pcap"], "data") },
  { offset: 0, pattern: [0xa1, 0xb2, 0xc3, 0xd4], kind: kind("Packet capture (pcap)", "application/vnd.tcpdump.pcap", ["pcap"], "data") },
  { offset: 0, pattern: [0x0a, 0x0d, 0x0d, 0x0a], kind: kind("Packet capture (pcapng)", "application/x-pcapng", ["pcapng"], "data") },
  { offset: 128, pattern: "DICM", kind: kind("DICOM medical image", "application/dicom", ["dcm"], "image") },
  { offset: 0, pattern: [0x00, 0x01, 0x00, 0x00, 0x00], kind: kind("TrueType font", "font/ttf", ["ttf"], "font") },
  { offset: 0, pattern: "OTTO", kind: kind("OpenType font", "font/otf", ["otf"], "font") },
  { offset: 0, pattern: "wOFF", kind: kind("WOFF web font", "font/woff", ["woff"], "font") },
  { offset: 0, pattern: "wOF2", kind: kind("WOFF2 web font", "font/woff2", ["woff2"], "font") },
  { offset: 0, pattern: "ttcf", kind: kind("TrueType font collection", "font/collection", ["ttc"], "font") },
  { offset: 0, pattern: [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00], kind: kind("Windows shortcut", "application/x-ms-shortcut", ["lnk"], "other") },
  { offset: 0, pattern: "KEYISENC", kind: kind("File encrypted on key.is", "application/octet-stream", ["enc"], "other") },
];

/** The MPEG transport stream has no signature, only a sync byte every 188 bytes. */
function looksLikeTransportStream(head: Uint8Array): boolean {
  if (head.length < 188 * 3 + 1) return false;
  return [0, 188, 376, 564].every((offset) => head[offset] === 0x47);
}

/**
 * How many columns the sample has as a table in this delimiter, or null
 * when it is not one: at least three complete rows, every one the same
 * width above one, read by the CSV parser so quoted commas and line
 * breaks inside fields do not spoil the count.
 */
function tableWidth(sample: string, delimiter: Delimiter): number | null {
  const rows = new CsvParser(delimiter).push(sample).slice(0, 8);
  if (rows.length < 3) return null;
  const width = rows[0].length;
  return width > 1 && rows.every((row) => row.length === width) ? width : null;
}

/** The kind of a text file, from its first lines. */
export function identifyText(sample: string): FileKind {
  const start = sample.replace(/^\s+/, "").slice(0, 4096);
  const first = start.split(/\r?\n/)[0] ?? "";
  if (/^<\?xml/i.test(start) || /^<svg\b/i.test(start)) {
    if (/<svg\b/i.test(start)) return kind("SVG image", "image/svg+xml", ["svg"], "image");
    if (/<gpx\b/i.test(start)) return kind("GPX track", "application/gpx+xml", ["gpx"], "data");
    if (/<kml\b/i.test(start)) return kind("KML map", "application/vnd.google-earth.kml+xml", ["kml"], "data");
    if (/<rss\b|<feed\b/i.test(start)) return kind("RSS or Atom feed", "application/rss+xml", ["rss", "xml"], "text");
    return kind("XML document", "application/xml", ["xml"], "text");
  }
  if (/^<!doctype html/i.test(start) || /^<html\b/i.test(start) || /<html\b/i.test(start.slice(0, 512))) return kind("HTML page", "text/html", ["html", "htm"], "text");
  if (/^[{[]/.test(start)) {
    if (/^\{[\s\S]*"cells"\s*:/.test(start) && /"nbformat"/.test(start)) return kind("Jupyter notebook", "application/x-ipynb+json", ["ipynb"], "data");
    return kind("JSON data", "application/json", ["json"], "data");
  }
  if (/^#!/.test(start)) {
    if (/python/.test(first)) return kind("Python script", "text/x-python", ["py"], "text");
    if (/node/.test(first)) return kind("JavaScript program", "text/javascript", ["js", "mjs"], "text");
    return kind("Shell script", "text/x-shellscript", ["sh"], "text");
  }
  if (/^WEBVTT/.test(start)) return kind("WebVTT subtitles", "text/vtt", ["vtt"], "text");
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} -->/.test(start)) return kind("SubRip subtitles", "application/x-subrip", ["srt"], "text");
  if (/^\[Script Info\]/.test(start)) return kind("ASS subtitles", "text/x-ssa", ["ass", "ssa"], "text");
  if (/^BEGIN:VCALENDAR/.test(start)) return kind("iCalendar", "text/calendar", ["ics"], "data");
  if (/^BEGIN:VCARD/.test(start)) return kind("vCard contacts", "text/vcard", ["vcf"], "data");
  if (/^-----BEGIN [A-Z ]+-----/.test(start)) return kind("PEM certificate or key", "application/x-pem-file", ["pem", "crt", "key"], "data");
  if (/^(From|Received|Return-Path|Delivered-To|MIME-Version):/im.test(start.slice(0, 1024)) && /^(Subject|To|From):/im.test(start)) return kind("Email message", "message/rfc822", ["eml"], "text");
  if (/^%%|^\\documentclass|^\\begin\{document\}/m.test(start)) return kind("LaTeX source", "application/x-tex", ["tex"], "text");
  if (/^---\r?\n/.test(start) && /^[\w-]+:\s/m.test(start)) return kind("YAML data", "application/yaml", ["yaml", "yml"], "data");
  if (/^# |^## /m.test(start.slice(0, 512))) return kind("Markdown text", "text/markdown", ["md"], "text");
  for (const [delimiter, name, extension, mime] of [["\t", "Tab-separated table", "tsv", "text/tab-separated-values"], [",", "CSV table", "csv", "text/csv"], [";", "CSV table (semicolons)", "csv", "text/csv"]] as const) {
    if (tableWidth(start, delimiter) !== null) return kind(name, mime, [extension], "data");
  }
  return kind("Plain text", "text/plain", ["txt"], "text");
}

export interface Identification {
  kind: FileKind;
  /** How the kind was read: "signature", "text" or "guess". */
  how: "signature" | "text" | "guess";
  /** For text, what encoding it was read as. */
  encoding: string | null;
}

/**
 * What the file is, from up to 64 KB of its start and its end.
 *
 * Signatures first, then text, then a shrug: bytes that match no
 * signature and are not text are reported as unknown binary data.
 */
export function identify(head: Uint8Array, tail: Uint8Array = new Uint8Array(0)): Identification {
  if (head.length === 0) return { kind: kind("Empty file", "application/x-empty", [], "other"), how: "signature", encoding: null };
  for (const signature of SIGNATURES) {
    if (matchesAt(head, signature.offset, signature.pattern)) {
      return { kind: signature.refine ? signature.refine(head, tail) : signature.kind, how: "signature", encoding: null };
    }
  }
  if (looksLikeTransportStream(head)) return { kind: kind("MPEG transport stream", "video/mp2t", ["ts", "m2ts", "mts"], "video"), how: "signature", encoding: null };
  if (!looksBinary(head)) {
    const encoding = detectEncoding(head);
    const sample = new TextDecoder(encoding.encoding).decode(head);
    return { kind: identifyText(sample), how: "text", encoding: encoding.label };
  }
  return { kind: kind("Binary data of an unknown kind", "application/octet-stream", [], "other"), how: "guess", encoding: null };
}

/** Whether the file's extension is one the kind uses. */
export function extensionMatches(fileName: string, found: FileKind): boolean | null {
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (found.extensions.length === 0) return null;
  if (extension === "" && found.extensions.includes("")) return true;
  if (extension === "") return false;
  if (found.extensions.includes(extension)) return true;
  // A .tar.gz is a gzip file called .gz; a .jpeg is a .jpg.
  const aliases: Record<string, string> = { jpeg: "jpg", tif: "tiff", htm: "html", yml: "yaml", mpeg: "mpg", mid: "midi" };
  return found.extensions.includes(aliases[extension] ?? "") || Object.entries(aliases).some(([from, to]) => to === extension && found.extensions.includes(from));
}

/** The first bytes as a hex dump: offset, sixteen bytes in hex, and the printable ones as text. */
export function hexDump(bytes: Uint8Array, columns = 16): string {
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += columns) {
    const row = bytes.subarray(at, at + columns);
    const hex = Array.from(row, (byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(columns * 3 - 1, " ");
    const text = Array.from(row, (byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".")).join("");
    lines.push(`${at.toString(16).padStart(8, "0")}  ${hex}  ${text}`);
  }
  return lines.join("\n");
}
