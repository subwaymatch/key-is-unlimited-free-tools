import { deflateSync } from "node:zlib";

import { PDFDocument, PDFName, rgb, StandardFonts } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { assembleRedacted, darkRectangles, findHiddenText, findOnPage, PATTERNS, termsPattern, type TextItemLike } from "@/lib/pdf/redact";

const open = (bytes: Uint8Array) => getDocument({ data: bytes.slice(), useWorkerFetch: false, disableFontFace: true, verbosity: 0 }).promise;
const ops = OPS as unknown as Record<string, number>;

/** Two pages of personal details; the ID number on the first is "redacted" the wrong way, with a box over it. */
async function sample(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle("Customer record");
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([400, 300]);
  first.drawText("Name: Ada Lovelace", { x: 30, y: 250, size: 12, font });
  first.drawText("Email: ada@example.com", { x: 30, y: 230, size: 12, font });
  first.drawText("Card: 4111 1111 1111 1111 or order 1234 5678 9012 3456", { x: 30, y: 210, size: 12, font });
  first.drawText("SSN: 123-45-6789", { x: 30, y: 190, size: 12, font });
  const ssn = font.widthOfTextAtSize("SSN: ", 12);
  first.drawRectangle({ x: 30 + ssn - 1, y: 186, width: font.widthOfTextAtSize("123-45-6789", 12) + 2, height: 16, color: rgb(0, 0, 0) });
  first.drawRectangle({ x: 30, y: 20, width: 300, height: 30, color: rgb(0.92, 0.92, 0.92) });
  const second = document.addPage([400, 300]);
  second.drawText("Nothing personal here, only the weather.", { x: 30, y: 250, size: 12, font });
  return document.save();
}

async function items(bytes: Uint8Array, page: number): Promise<TextItemLike[]> {
  const pdf = await open(bytes);
  const content = await (await pdf.getPage(page)).getTextContent();
  return content.items.filter((item) => "str" in item) as unknown as TextItemLike[];
}

describe("finding what to redact", () => {
  it("finds e-mails, Luhn-valid card numbers and ID numbers, with boxes over just those words", async () => {
    const bytes = await sample();
    const found = findOnPage(await items(bytes, 1), PATTERNS);
    expect(found.map((entry) => entry.text)).toEqual(["ada@example.com", "4111 1111 1111 1111", "123-45-6789"]);
    const [email] = found;
    // "Email: " is about 38 points of 12-point Helvetica; the box starts after it and stays on its line.
    expect(email.rects[0].x).toBeGreaterThan(30 + 34);
    expect(email.rects[0].y).toBeLessThan(230);
    expect(email.rects[0].y + email.rects[0].height).toBeGreaterThan(230 + 10);
    expect(email.rects[0].y + email.rects[0].height).toBeLessThan(250);
  });

  it("matches typed words whole, case ignored, across the spaces between them", async () => {
    const pattern = termsPattern("ada lovelace\nweather\n")!;
    expect(findOnPage(await items(await sample(), 1), [{ pattern }]).map((entry) => entry.text)).toEqual(["Ada Lovelace"]);
    expect(findOnPage(await items(await sample(), 2), [{ pattern }]).map((entry) => entry.text)).toEqual(["weather"]);
    expect(termsPattern("  \n")).toBeNull();
  });
});

describe("checking a redaction", () => {
  it("finds the dark box, not the light one", async () => {
    const pdf = await open(await sample());
    const list = await (await pdf.getPage(1)).getOperatorList();
    const rects = darkRectangles(list.fnArray, list.argsArray, ops);
    expect(rects).toHaveLength(1);
    expect(rects[0].height).toBeCloseTo(16, 3);
  });

  it("reports the text still under the box, and under a redaction mark never applied", async () => {
    const document = await PDFDocument.load(await sample());
    const annotation = document.context.obj({ Type: "Annot", Subtype: "Redact", Rect: [60, 245, 140, 262] });
    document.getPage(0).node.set(PDFName.of("Annots"), document.context.obj([document.context.register(annotation)]));
    const pdf = await open(await document.save());
    const result = await findHiddenText(pdf, ops);
    expect(result.hidden).toEqual([
      { page: 1, text: "123-45-6789", line: "SSN: 123-45-6789", how: "black box" },
      { page: 1, text: "Ada Lovelace", line: "Name: Ada Lovelace", how: "redaction mark" },
    ]);
    expect(result.textless).toEqual([]);
  });
});

describe("redacting", () => {
  it("rebuilds the pages with something to hide as pictures, keeps the rest, and drops the properties", async () => {
    const bytes = await sample();
    // A 2 x 2 black PNG stands in for the page drawn with its boxes.
    const raw = Buffer.from([0, 0, 0, 0, 0, 0, 0]);
    const chunk = (type: string, data: Buffer) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      let crc = -1;
      for (const byte of body) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
      const sum = Buffer.alloc(4);
      sum.writeUInt32BE((crc ^ -1) >>> 0);
      return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 0, 0, 0, 0]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat([raw.subarray(0, 3), raw.subarray(0, 3)]))), chunk("IEND", Buffer.alloc(0))]);
    const out = await assembleRedacted(bytes, new Map([[0, { image: new Uint8Array(png), kind: "png" as const, width: 400, height: 300 }]]));
    const pdf = await open(out);
    expect(pdf.numPages).toBe(2);
    expect(await items(out, 1)).toEqual([]);
    expect((await items(out, 2)).map((item) => item.str).join("")).toContain("weather");
    const { info } = (await pdf.getMetadata()) as unknown as { info: Record<string, unknown> };
    expect(info.Title).toBeUndefined();
    expect(info.Producer).toBe("key.is");
  });
});
