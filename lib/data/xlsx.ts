/**
 * Excel workbooks read and written without Excel: an .xlsx is a ZIP of XML
 * files, and the handful this needs are small enough to write and read
 * by hand.
 *
 * Writing puts every cell inline rather than in a shared-strings table,
 * which every reader takes and which keeps the writer to one pass.
 * Reading takes the shared-strings table, inline strings, numbers,
 * booleans and errors, and turns a number that Excel formats as a date
 * back into one, since a serial like 45292 is no use in a CSV.
 *
 * Pure, on byte arrays; the ZIP goes through fflate.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { typedValue } from "./csv";

/* ---- Cells and columns -------------------------------------------------- */

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index: number): string {
  let letters = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** "A" -> 0, "AA" -> 26. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** "B3" -> column 1, row 2, both 0-based. */
export function parseCellRef(ref: string): { column: number; row: number } | null {
  const match = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return { column: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

export function escapeXml(text: string): string {
  // Excel refuses control characters other than tab, line feed and return.
  let clean = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) continue;
    clean += ch;
  }
  return clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (entity, name: string) => {
    switch (name) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(name.startsWith("#x") ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    }
  });
}

/* ---- Writing ------------------------------------------------------------ */

/** Excel's own limits; a sheet past them will not open. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
export const MAX_CELL_CHARACTERS = 32_767;

export interface SheetToWrite {
  name: string;
  rows: readonly (readonly string[])[];
}

export interface WriteOptions {
  /** Numbers and booleans written as such, so Excel can sum them. */
  typed: boolean;
  boldHeader: boolean;
}

/** A sheet name Excel accepts: 31 characters, none of the forbidden ones, never empty. */
export function sheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim();
  return clean || "Sheet1";
}

/** Names told apart by a number when two files share one. */
export function uniqueSheetNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const base = sheetName(raw);
    const key = base.toLowerCase();
    const times = seen.get(key) ?? 0;
    seen.set(key, times + 1);
    if (times === 0) return base;
    const suffix = ` (${times + 1})`;
    return `${base.slice(0, 31 - suffix.length)}${suffix}`;
  });
}

function cellXml(ref: string, raw: string, typed: boolean, style: number): string {
  if (raw === "") return "";
  const styleAttribute = style ? ` s="${style}"` : "";
  if (typed) {
    const value = typedValue(raw);
    if (typeof value === "number") return `<c r="${ref}"${styleAttribute}><v>${value}</v></c>`;
    if (typeof value === "boolean") return `<c r="${ref}"${styleAttribute} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = raw.length > MAX_CELL_CHARACTERS ? raw.slice(0, MAX_CELL_CHARACTERS) : raw;
  return `<c r="${ref}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/** The worksheet XML for a sheet's rows. */
export function sheetXml(rows: readonly (readonly string[])[], options: WriteOptions): string {
  const parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  rows.forEach((row, rowIndex) => {
    const cells = row.map((raw, columnIndex_) => cellXml(`${columnLetter(columnIndex_)}${rowIndex + 1}`, raw, options.typed, options.boldHeader && rowIndex === 0 ? 1 : 0)).join("");
    parts.push(`<row r="${rowIndex + 1}">${cells}</row>`);
  });
  parts.push("</sheetData></worksheet>");
  return parts.join("");
}

const CONTENT_TYPES = (count: number) =>
  [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...Array.from({ length: count }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    "</Types>",
  ].join("");

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
  "</Relationships>",
].join("");

const STYLES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>',
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>',
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>',
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
  "</styleSheet>",
].join("");

/** One workbook, as the bytes of an .xlsx. */
export function buildXlsx(sheets: readonly SheetToWrite[], options: WriteOptions): Uint8Array {
  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));
  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(CONTENT_TYPES(sheets.length));
  files["_rels/.rels"] = strToU8(ROOT_RELS);
  files["xl/workbook.xml"] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
      ...names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`),
      "</sheets></workbook>",
    ].join(""),
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ...names.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`),
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
      "</Relationships>",
    ].join(""),
  );
  files["xl/styles.xml"] = strToU8(STYLES);
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet.rows, options));
  });
  return zipSync(files, { level: 6 });
}

/* ---- Reading ------------------------------------------------------------ */

export interface ReadSheet {
  name: string;
  rows: string[][];
}

export interface ReadWorkbook {
  sheets: ReadSheet[];
  /** True when the workbook counts dates from 1904, as old Mac Excel did. */
  date1904: boolean;
}

export class XlsxError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "XlsxError";
    this.hint = hint;
  }
}

/** Every attribute of a tag's attribute text, by name. */
function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of text.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out.set(match[1], unescapeXml(match[2]));
  return out;
}

/** The text of every `<t>` inside an element, joined: a rich-text string is several runs. */
function textOf(inner: string): string {
  let text = "";
  for (const match of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += unescapeXml(match[1]);
  // Excel writes a return as this escape inside a string.
  return text.replace(/_x000D_/g, "\r");
}

/** The shared-strings table, in order. */
export function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) strings.push(textOf(match[1]));
  return strings;
}

/** Built-in number formats that show a date or a time. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Whether a number format shows a date or a time: a built-in one that does, or a custom code with day, month, year, hour or second in it. */
export function isDateFormat(numFmtId: number, code: string | undefined): boolean {
  if (DATE_FORMAT_IDS.has(numFmtId)) return true;
  if (!code) return false;
  // Quoted text and colour or condition blocks are not format letters.
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  if (/General/i.test(bare)) return false;
  return /[dmyhs]/i.test(bare);
}

/** Which cell styles show a date, by style index. */
export function readDateStyles(stylesXml: string): Set<number> {
  const formats = new Map<number, string>();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const attrs = attributes(match[1]);
    const id = Number(attrs.get("numFmtId"));
    const code = attrs.get("formatCode");
    if (Number.isFinite(id) && code !== undefined) formats.set(id, code);
  }
  const dates = new Set<number>();
  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return dates;
  let index = 0;
  for (const match of cellXfs[1].matchAll(/<xf\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1]);
    const id = Number(attrs.get("numFmtId") ?? 0);
    if (isDateFormat(id, formats.get(id))) dates.add(index);
    index += 1;
  }
  return dates;
}

const DAY = 86_400_000;

/**
 * An Excel serial as text: a date, a date and time, or a time alone.
 *
 * Excel's 1900 system counts from a 1900 that had a 29th of February, a
 * bug kept for Lotus 1-2-3's sake, so serials from 61 on are one day off
 * from a true count and 60 is a day that never was. The 1904 system has
 * no such thing.
 */
export function serialToText(serial: number, date1904: boolean): string {
  let days = Math.floor(serial);
  const fraction = serial - days;
  let epoch: number;
  if (date1904) {
    epoch = Date.UTC(1904, 0, 1);
  } else {
    if (days === 60) return "1900-02-29";
    if (days > 60) days -= 1;
    epoch = Date.UTC(1899, 11, 31);
  }
  const millis = epoch + days * DAY + Math.round(fraction * DAY);
  const date = new Date(millis);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  if (serial < 1 && !date1904) return time;
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return fraction === 0 ? day : `${day} ${time}`;
}

/** A number as Excel stored it, written the short way JavaScript writes it. */
function numberText(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : value;
}

/** A worksheet's cells as rows of text, gaps filled with empty strings. */
export function readSheetXml(xml: string, shared: readonly string[], dateStyles: ReadonlySet<number>, date1904: boolean): string[][] {
  const rows = new Map<number, Map<number, string>>();
  let maxColumn = -1;
  let maxRow = -1;
  let fallbackRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = attributes(rowMatch[1]);
    const rowIndex = rowAttrs.has("r") ? Number(rowAttrs.get("r")) - 1 : fallbackRow;
    fallbackRow = rowIndex + 1;
    let fallbackColumn = 0;
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = attributes(cellMatch[1]);
      const ref = attrs.get("r");
      const parsed = ref ? parseCellRef(ref) : null;
      const column = parsed ? parsed.column : fallbackColumn;
      fallbackColumn = column + 1;
      const inner = cellMatch[2] ?? "";
      const type = attrs.get("t") ?? "n";
      const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = "";
      if (type === "s") text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = textOf(inner);
      else if (type === "str" || type === "e") text = value === undefined ? "" : unescapeXml(value);
      else if (type === "b") text = value === "1" ? "TRUE" : value === "0" ? "FALSE" : "";
      else if (type === "d") text = value === undefined ? "" : unescapeXml(value);
      else if (value !== undefined) {
        const style = Number(attrs.get("s") ?? -1);
        const number = Number(value);
        text = dateStyles.has(style) && Number.isFinite(number) ? serialToText(number, date1904) : numberText(value);
      }
      if (text === "") continue;
      let row = rows.get(rowIndex);
      if (!row) {
        row = new Map();
        rows.set(rowIndex, row);
      }
      row.set(column, text);
      if (column > maxColumn) maxColumn = column;
      if (rowIndex > maxRow) maxRow = rowIndex;
    }
  }
  const out: string[][] = [];
  for (let rowIndex = 0; rowIndex <= maxRow; rowIndex += 1) {
    const row = rows.get(rowIndex);
    const cells: string[] = [];
    for (let column = 0; column <= maxColumn; column += 1) cells.push(row?.get(column) ?? "");
    out.push(cells);
  }
  return out;
}

/** The workbook out of the ZIP's files. */
export function readWorkbook(files: Readonly<Record<string, Uint8Array>>): ReadWorkbook {
  const text = (path: string): string | null => {
    const entry = files[path] ?? files[path.replace(/^\//, "")];
    return entry ? strFromU8(entry) : null;
  };
  const workbookXml = text("xl/workbook.xml");
  if (!workbookXml) throw new XlsxError("This file is not an Excel workbook.", "It is a ZIP, but it has no xl/workbook.xml inside. An .xls from Excel 2003 or earlier is a different format; save it as .xlsx first.");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbookXml);
  const relsXml = text("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = attributes(match[1]);
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared = readSharedStrings(text("xl/sharedStrings.xml") ?? "");
  const dateStyles = readDateStyles(text("xl/styles.xml") ?? "");
  const sheets: ReadSheet[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = attributes(match[1]);
    const name = attrs.get("name") ?? `Sheet${sheets.length + 1}`;
    const id = attrs.get("r:id") ?? attrs.get("id");
    const path = (id && targets.get(id)) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const sheetText = text(path);
    if (sheetText === null) continue;
    sheets.push({ name, rows: readSheetXml(sheetText, shared, dateStyles, date1904) });
  }
  if (sheets.length === 0) throw new XlsxError("This workbook has no sheets that could be read.", "Every sheet named in xl/workbook.xml is missing from the file.");
  return { sheets, date1904 };
}

/** The workbook out of the .xlsx bytes. */
export function readXlsx(bytes: Uint8Array): ReadWorkbook {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new XlsxError("This file is not an .xlsx workbook.", "An .xlsx is a ZIP archive and this does not start like one. An .xls from Excel 2003 or earlier is a different format; save it as .xlsx first.");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new XlsxError("This file could not be unpacked.", error instanceof Error ? error.message : undefined);
  }
  return readWorkbook(files);
}
