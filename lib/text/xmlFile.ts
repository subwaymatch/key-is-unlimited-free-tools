/**
 * An XML file taken off disk: its text in the right encoding, and a broken
 * one's position in words a card can show.
 */
import { PlainError } from "../plainQueue";
import { detectEncoding } from "./encoding";
import { XmlError } from "./xml";

export const XML_ACCEPT = ".xml,.svg,.xsd,.xsl,.xslt,.rss,.atom,.plist,.kml,.gpx,.xhtml,.config,.csproj,.resx,.xaml,.wsdl,application/xml,text/xml";

/**
 * The text, decoded the way XML says to: a byte-order mark first, then
 * UTF-16's zero bytes, then the encoding the declaration names, and UTF-8
 * when it names none (or Windows-1252 when the bytes are not UTF-8).
 */
export async function readXmlText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectEncoding(bytes.subarray(0, 64 * 1024));
  const utf16 = detected.encoding === "utf-16le" || detected.encoding === "utf-16be";
  const declared = detected.bom || utf16 ? null : new TextDecoder("latin1").decode(bytes.subarray(0, 200)).match(/^\s*<\?xml[^>]*encoding=["']([A-Za-z0-9._-]+)["']/)?.[1];
  try {
    return new TextDecoder(declared ?? detected.encoding).decode(bytes);
  } catch {
    return new TextDecoder(detected.encoding).decode(bytes);
  }
}

/** A parse failure as a card's error: the line, the column and the text around it. */
export function xmlProblem(error: unknown): PlainError {
  if (error instanceof XmlError) return new PlainError("This file is not well-formed XML.", `Line ${error.line}, column ${error.column}: ${error.message}${error.near ? ` Near: ${error.near}` : ""}`);
  return new PlainError("This file could not be read as XML.", error instanceof Error ? error.message : String(error));
}
