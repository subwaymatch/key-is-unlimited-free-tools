import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { CompoundFile, isCompoundFile } from "@/lib/documents/cfb";
import { bookHeading, chapterFromXhtml, encryptedPaths, packagePath, readPackage, resolvePath, wordCount } from "@/lib/documents/epub";
import { decodeWords, messageText, parseParams, readEmail, safeFileName, viewableHtml } from "@/lib/documents/mime";
import { codepageLabel, decompressRtf, messageToEml, readMsg } from "@/lib/documents/msg";
import { describeValues, fieldListCsv, formCsv, formTable, readFormValues, xfaFields } from "@/lib/pdf/formData";
import { htmlToText } from "@/lib/text/html";

import { writeCfb } from "./cfbWriter";
import { BIG_ATTACHMENT, SENT, sampleMsg } from "./msgFixture";

describe("PDF form data", () => {
  async function filledForm(name: string, agree: boolean): Promise<PDFDocument> {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 400]);
    const form = document.getForm();
    const text = form.createTextField("applicant.name");
    text.setText(name);
    text.addToPage(page, { x: 20, y: 300 });
    const box = form.createCheckBox("agree");
    box.addToPage(page, { x: 20, y: 250 });
    if (agree) box.check();
    const radio = form.createRadioGroup("size");
    radio.addOptionToPage("small", page, { x: 20, y: 200 });
    radio.addOptionToPage("large", page, { x: 60, y: 200 });
    radio.select("large");
    const dropdown = form.createDropdown("colour");
    dropdown.addOptions(["red", "blue"]);
    dropdown.select("blue");
    dropdown.addToPage(page, { x: 20, y: 150 });
    return PDFDocument.load(await document.save());
  }

  it("reads every kind of field, check boxes as Yes and No", async () => {
    const values = await readFormValues(await filledForm("Ada, \"the\" first", true));
    expect(values.source).toBe("acroform");
    expect(values.fields).toEqual([
      { name: "applicant.name", kind: "text", value: 'Ada, "the" first' },
      { name: "agree", kind: "check box", value: "Yes" },
      { name: "size", kind: "radio", value: "large" },
      { name: "colour", kind: "choice", value: "blue" },
    ]);
    expect(describeValues(values)).toBe("4 fields, 4 filled in");
  });

  it("lines several forms up in one table, a column per field", async () => {
    const a = await readFormValues(await filledForm("Ada", true));
    const b = await readFormValues(await filledForm("Charles", false));
    const table = formTable([
      { file: "a.pdf", fields: a.fields },
      { file: "b.pdf", fields: [...b.fields, { name: "extra", kind: "text", value: "only here" }] },
    ]);
    expect(table.columns).toEqual(["file", "applicant.name", "agree", "size", "colour", "extra"]);
    expect(table.rows).toEqual([
      ["a.pdf", "Ada", "Yes", "large", "blue", ""],
      ["b.pdf", "Charles", "No", "large", "blue", "only here"],
    ]);
    expect(formCsv(table).split("\r\n")[0]).toBe("\ufefffile,applicant.name,agree,size,colour,extra");
    expect(fieldListCsv(a.fields).split("\r\n")[1]).toBe("applicant.name,text,Ada");
  });

  it("reads an XFA form's data packet by path", () => {
    const xml = `<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><form1><page1><name>Ada</name><phone>123</phone><item>a</item><item>b</item></page1></form1></xfa:data></xfa:datasets>`;
    expect(xfaFields(xml)).toEqual([
      { name: "form1.page1.name", kind: "xfa", value: "Ada" },
      { name: "form1.page1.phone", kind: "xfa", value: "123" },
      { name: "form1.page1.item", kind: "xfa", value: "a" },
      { name: "form1.page1.item[1]", kind: "xfa", value: "b" },
    ]);
  });

  it("says when a document has no fields", async () => {
    const document = await PDFDocument.create();
    document.addPage();
    expect((await readFormValues(document)).source).toBe("none");
  });
});

describe("EPUB", () => {
  const container = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Short Book</dc:title><dc:creator>Ada</dc:creator><dc:creator>Charles</dc:creator><dc:language>en</dc:language></metadata>
    <manifest><item id="c2" href="Text/two.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="Text/one%20a.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest>
    <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
  const chapter = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>ignored</title><style>p{}</style></head><body>
    <h1>Chapter  One</h1><p>It was a <em>dark</em> and
    <strong>stormy</strong> night&nbsp;&mdash; truly.</p><ul><li>First</li><li>Second<ul><li>Inner</li></ul></li></ul><blockquote><p>Quoted words.</p></blockquote><p>Line<br/>break</p></body></html>`;

  it("finds the package and reads the spine in order", () => {
    expect(packagePath(container)).toBe("OEBPS/content.opf");
    const book = readPackage(opf, "OEBPS/content.opf");
    expect(book).toEqual({ title: "A Short Book", authors: ["Ada", "Charles"], language: "en", spine: ["OEBPS/Text/one a.xhtml", "OEBPS/Text/two.xhtml"] });
    expect(bookHeading(book, "markdown")).toBe("# A Short Book\n\n*Ada, Charles*");
    expect(resolvePath("OEBPS/Text/one.xhtml", "../Images/a.png#x")).toBe("OEBPS/Images/a.png");
  });

  it("writes a chapter as paragraphs, or as Markdown", () => {
    expect(chapterFromXhtml(chapter, "text")).toEqual({ text: "Chapter One\n\nIt was a dark and stormy night\u00a0\u2014 truly.\n\nFirst\n\nSecond\n\nInner\n\nQuoted words.\n\nLine\nbreak", loose: false });
    expect(chapterFromXhtml(chapter, "markdown").text).toBe("# Chapter One\n\nIt was a *dark* and **stormy** night\u00a0\u2014 truly.\n\n- First\n\n- Second\n\n  - Inner\n\n> Quoted words.\n\nLine\\\nbreak");
  });

  it("reads a chapter that is not well-formed the forgiving way", () => {
    const broken = "<html><body><p>One & two<p>Three<br>four</body></html>";
    expect(chapterFromXhtml(broken, "text")).toEqual({ text: "One & two\n\nThree\nfour", loose: true });
    expect(htmlToText("<div>a&amp;b</div><div>c</div>")).toBe("a&b\n\nc");
  });

  it("tells DRM from obfuscated fonts", () => {
    const xml = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:CipherData><enc:CipherReference URI="OEBPS/Fonts/a.otf"/></enc:CipherData></enc:EncryptedData></encryption>`;
    expect(encryptedPaths(xml)).toEqual(["OEBPS/Fonts/a.otf"]);
  });

  it("counts words", () => {
    expect(wordCount("It's a well-known fact, isn\u2019t it? 42 times.")).toBe(8);
  });
});

describe("e-mail", () => {
  const eml = [
    "From: =?UTF-8?B?QWRhIEzDs3ZlbGFjZQ==?= <ada@example.com>",
    "To: charles@example.com",
    "Subject: =?ISO-8859-1?Q?Caf=E9?=",
    " =?UTF-8?Q?_menu?=",
    "Date: Tue, 1 Sep 2026 09:30:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="outer"',
    "",
    "preamble",
    "--outer",
    'Content-Type: multipart/alternative; boundary="inner"',
    "",
    "--inner",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Hello =E2=80=94 see the pict=",
    "ure.",
    "--inner",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p onclick="x()">Hello</p><img src="cid:pic1"><script>bad()</script>',
    "--inner--",
    "--outer",
    "Content-Type: image/png",
    "Content-ID: <pic1>",
    "Content-Disposition: inline",
    "Content-Transfer-Encoding: base64",
    "",
    "iVBORw0K",
    "--outer",
    "Content-Type: application/pdf",
    "Content-Disposition: attachment;",
    " filename*0*=UTF-8''%E6%97%A5%E6%9C%AC;",
    " filename*1*=.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0=",
    "--outer--",
    "",
  ].join("\r\n");

  it("decodes encoded words, joining adjacent ones", () => {
    expect(decodeWords("=?UTF-8?B?QWRh?= =?UTF-8?Q?_L=C3=B3?= plain")).toBe("Ada L\u00f3 plain");
    expect(decodeWords("no words here")).toBe("no words here");
  });

  it("reads parameters, quoted, continued and encoded", () => {
    expect(parseParams('text/plain; charset="utf-8"; format=flowed')).toEqual({ value: "text/plain", params: { charset: "utf-8", format: "flowed" } });
    expect(parseParams("attachment; filename*=iso-8859-1'en'caf%E9.txt").params.filename).toBe("caf\u00e9.txt");
    expect(parseParams('attachment; filename="a;b.txt"').params.filename).toBe("a;b.txt");
  });

  it("takes a message apart into bodies and attachments", () => {
    const email = readEmail(new TextEncoder().encode(eml));
    expect(email.from).toBe("Ada L\u00f3velace <ada@example.com>");
    expect(email.subject).toBe("Caf\u00e9 menu");
    expect(email.text).toBe("Hello \u2014 see the picture.");
    expect(email.html).toContain("<img src=\"cid:pic1\">");
    expect(email.attachments.map((attachment) => [attachment.name, attachment.type, attachment.inline, attachment.contentId])).toEqual([
      ["attachment-1.png", "image/png", true, "pic1"],
      ["\u65e5\u672c.pdf", "application/pdf", false, null],
    ]);
    expect(new TextDecoder().decode(email.attachments[1].bytes)).toBe("%PDF-");
    const html = viewableHtml(email)!;
    expect(html).toContain('src="data:image/png;base64,iVBORw0K"');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
    expect(html).toContain("Caf\u00e9 menu");
    expect(messageText(email)).toBe("From: Ada L\u00f3velace <ada@example.com>\nTo: charles@example.com\nDate: Tue, 1 Sep 2026 09:30:00 +0000\nSubject: Caf\u00e9 menu\nAttachments: \u65e5\u672c.pdf\n\nHello \u2014 see the picture.\n");
  });

  it("reads a single-part message in an 8-bit charset", () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode("Subject: hi\r\nContent-Type: text/plain; charset=windows-1252\r\nContent-Transfer-Encoding: 8bit\r\n\r\ncaf"), 0xe9]);
    expect(readEmail(bytes).text).toBe("caf\u00e9");
  });

  it("makes names safe to save", () => {
    expect(safeFileName("../../etc/passwd", "x")).toBe("_.._etc_passwd");
    expect(safeFileName("   ", "fallback")).toBe("fallback");
  });
});

describe("Outlook messages", () => {
  it("reads a compound file's tree and both kinds of stream", () => {
    const bytes = writeCfb([{ name: "small", data: new Uint8Array([1, 2, 3]) }, { name: "folder", children: [{ name: "large", data: new Uint8Array(5000).fill(9) }] }]);
    expect(isCompoundFile(bytes)).toBe(true);
    const file = new CompoundFile(bytes);
    expect(file.root.children.map((entry) => entry.name).sort()).toEqual(["folder", "small"]);
    expect(Array.from(file.read(file.find(file.root, "SMALL")!))).toEqual([1, 2, 3]);
    const large = file.read(file.find(file.find(file.root, "folder")!, "large")!);
    expect(large.length).toBe(5000);
    expect(large.every((byte) => byte === 9)).toBe(true);
  });

  it("reads the message, its recipients and its attachments", () => {
    const message = readMsg(sampleMsg());
    expect(message.subject).toBe("Quarterly r\u00e9sum\u00e9");
    expect(message.from).toBe("Ada Lovelace <ada@example.com>");
    expect(message.to).toBe("Charles Babbage <charles@example.com>");
    expect(message.cc).toBe("Mary Somerville <mary@example.com>");
    expect(message.sent?.toISOString()).toBe(SENT.toISOString());
    expect(message.text).toContain("The figures are attached.");
    expect(message.html).toContain("<b>Charles</b>");
    expect(message.headers.find((entry) => entry.name === "X-Mailer")?.value).toBe("folded value");
    expect(message.attachments.map((attachment) => [attachment.name, attachment.type, attachment.inline])).toEqual([
      ["figures.csv", "text/csv", false],
      ["chart.png", "image/png", true],
      ["Earlier thread.eml", "message/rfc822", false],
    ]);
    expect(message.attachments[1].bytes).toEqual(BIG_ATTACHMENT);
    expect(new TextDecoder().decode(message.attachments[2].bytes)).toContain("Subject: Earlier thread");
  });

  it("writes it as an .eml that reads back the same", () => {
    const message = readMsg(sampleMsg());
    const eml = messageToEml(message);
    expect(eml).toContain("Message-ID: <abc123@example.com>");
    const back = readEmail(new TextEncoder().encode(eml));
    expect(back.subject).toBe("Quarterly r\u00e9sum\u00e9");
    expect(back.from).toBe('"Ada Lovelace" <ada@example.com>');
    expect(back.text).toBe(message.text);
    expect(back.html).toBe(message.html);
    expect(back.attachments.map((attachment) => attachment.name)).toEqual(["figures.csv", "chart.png", "Earlier thread.eml"]);
    expect(back.attachments[1].bytes).toEqual(BIG_ATTACHMENT);
    expect(back.attachments[1].contentId).toBe("chart@x");
  });

  it("expands compressed RTF, checked against the specification's example", () => {
    const compressed = Uint8Array.from(Buffer.from("2d0000002b0000004c5a4675f1c5c7a703000a007263706731323542320af32068656c090020627705b06c647d0a800fa0", "hex"));
    expect(new TextDecoder().decode(decompressRtf(compressed))).toBe("{\\rtf1\\ansi\\ansicpg1252\\pard hello world}\r\n");
  });

  it("maps code pages to decoders", () => {
    expect(codepageLabel(65001)).toBe("utf-8");
    expect(codepageLabel(1251)).toBe("windows-1251");
    expect(codepageLabel(28592)).toBe("iso-8859-2");
    expect(codepageLabel(undefined)).toBe("windows-1252");
  });
});
