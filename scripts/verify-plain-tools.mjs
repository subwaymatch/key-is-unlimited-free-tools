/**
 * Browser verification of the no-engine tools added in the fourth batch:
 * the PDF extractor, reorderer, flattener and booklet maker, the CSV, JSON,
 * notebook and text-file converters, the passphrase sealer, the file
 * comparer, the picture merger and the palette extractor.
 *
 * Builds nothing itself: run `npm run build` first. Serves the static
 * export, makes its own fixtures in Node (PDFs through pdf-lib, PNGs written
 * by hand), drops them on each page with Chromium, saves what comes back
 * and reads it. No ffmpeg is needed: none of these tools loads the engine.
 *
 *   npm run build && node scripts/verify-plain-tools.mjs
 *
 * Requires a Chromium Playwright can find on its own, or one named in
 * CHROMIUM_PATH.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, gzipSync, inflateSync } from "node:zlib";

import { strToU8, unzipSync, zipSync } from "fflate";
import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(root, ".fixtures", "plain");
const OUT = join(root, "out");
const PORT = 4175;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".icc": "application/octet-stream",
};

const log = (...args) => console.log(...args);
const fail = (message) => {
  console.error(`\nFAIL ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

/* ---- Fixtures ----------------------------------------------------------- */

/** A PNG of RGBA pixels from a function of x and y, written by hand. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A PNG as the canvas writes one - 8-bit, not interlaced - decoded far enough to read a pixel. */
function decodePng(bytes) {
  let at = 8;
  const idat = [];
  let width = 0;
  let height = 0;
  let colorType = 6;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    at += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous ? previous[i] : 0;
      const c = previous && i >= channels ? previous[i - channels] : 0;
      const x = row[i];
      current[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + Math.floor((a + b) / 2) : x + paeth(a, b, c)) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const base = (y * stride + x * channels);
      return channels >= 3 ? [out[base], out[base + 1], out[base + 2]] : [out[base], out[base], out[base]];
    },
  };
}

const near = (pixel, wanted, tolerance = 12) => pixel.every((value, index) => Math.abs(value - wanted[index]) <= tolerance);

/** A workbook as Excel writes one: shared strings, a date style, two sheets. */
function excelFixture() {
  const xml = (body) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`);
  return zipSync({
    "[Content_Types].xml": xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
    "_rels/.rels": xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="People" sheetId="1" r:id="rId1"/><sheet name="Numbers" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "xl/sharedStrings.xml": xml('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3"><si><t>Name</t></si><si><t>When</t></si><si><r><t>A</t></r><r><t>da</t></r></si></sst>'),
    "xl/styles.xml": xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'),
    "xl/worksheets/sheet1.xml": xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45292</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Bob</t></is></c><c r="B3" s="1"><v>45292.5</v></c></row></sheetData></worksheet>'),
    "xl/worksheets/sheet2.xml": xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1" t="b"><v>1</v></c></row></sheetData></worksheet>'),
  });
}

/** A TAR with a file at the top and one in a directory, as tar writes them. */
function tarFixture() {
  const block = (name, size, type) => {
    const out = Buffer.alloc(512);
    const write = (offset, text) => out.write(text, offset, "latin1");
    write(0, name);
    write(100, "0000644\0");
    write(108, "0001750\0");
    write(116, "0001750\0");
    write(124, `${size.toString(8).padStart(11, "0")}\0`);
    write(136, "14000000000\0");
    write(148, "        ");
    out[156] = type.charCodeAt(0);
    write(257, "ustar\0");
    write(263, "00");
    let sum = 0;
    for (const byte of out) sum += byte;
    write(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    return out;
  };
  const padded = (data) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  const hello = Buffer.from("hello tar\n");
  const data = pseudoRandom(1000, 4);
  return Buffer.concat([block("hello.txt", hello.length, "0"), padded(hello), block("dir/", 0, "5"), block("dir/data.bin", data.length, "0"), padded(data), Buffer.alloc(1024)]);
}

/**
 * Five numbered pages of slightly different widths, so an order can be read
 * off the output. The third is stored on its side with a quarter turn in
 * its /Rotate entry, the way a scanner or a phone writes a page, with its
 * digit drawn so that it reads upright once the viewer applies the turn.
 */
async function numberedPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < 5; index += 1) {
    const turned = index === 2;
    const page = document.addPage(turned ? [400, 320] : [300 + index * 10, 400]);
    // A border 40 pt (14 mm) in from every edge: the margin the crop tool has to find.
    page.drawRectangle({ x: 40, y: 40, width: page.getWidth() - 80, height: page.getHeight() - 80, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 2 });
    if (turned) {
      // Shown turned a quarter clockwise, the unrotated -x axis points up.
      page.setRotation(degrees(90));
      page.drawText(String(index + 1), { x: 280, y: 90, size: 200, font, color: rgb(0.1, 0.1, 0.6), rotate: degrees(90) });
    } else {
      page.drawText(String(index + 1), { x: 90, y: 120, size: 200, font, color: rgb(0.1, 0.1, 0.6) });
    }
  }
  return document.save();
}

async function formPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 300]);
  const form = document.getForm();
  const name = form.createTextField("name");
  name.setText("Ada");
  name.addToPage(page, { x: 20, y: 200, width: 200, height: 30 });
  const box = form.createCheckBox("agree");
  box.check();
  box.addToPage(page, { x: 20, y: 100, width: 20, height: 20 });
  return document.save();
}

function pseudoRandom(length, seed) {
  const out = Buffer.alloc(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[index] = state >>> 24;
  }
  return out;
}

async function ensureFixtures() {
  mkdirSync(FIXTURES, { recursive: true });
  const write = (name, bytes) => {
    const path = join(FIXTURES, name);
    writeFileSync(path, bytes);
    return path;
  };
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { name: "python3" }, widgets: { state: {} } },
    cells: [
      { cell_type: "markdown", id: "a", metadata: {}, source: ["# Title"] },
      { cell_type: "code", id: "b", execution_count: 7, metadata: { collapsed: true }, outputs: [{ output_type: "stream", text: ["hi\n"] }], source: ["print('hi')"] },
    ],
  };
  return {
    numbered: write("numbered.pdf", await numberedPdf()),
    form: write("form.pdf", await formPdf()),
    csv: write("sample.csv", 'name,note,n\r\n"Smith, John","He said ""hi""",1\r\nplain,"two\nlines",2\r\nlast,,3\r\n'),
    records: write("records.json", JSON.stringify({ data: [{ id: 1, name: "Ada", address: { city: "London" } }, { id: 2, name: "Bob", tags: ["x", "y"] }], total: 2 })),
    minified: write("minified.json", '{"b":1,"a":[1,2,{"c":true}]}'),
    broken: write("broken.json", '{\n  "a": 1,\n  "b": }\n'),
    notebook: write("notebook.ipynb", JSON.stringify(notebook, null, 1)),
    latin: write("latin.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x61, 0x75, 0x20, 0x6c, 0x61, 0x69, 0x74, 0x0d, 0x0a])),
    old: write("old.txt", "a\nb\nc\nd\ne\n"),
    new: write("new.txt", "a\nB\nc\nd\ne\nf\n"),
    red: write("red.png", png(200, 100, () => [255, 0, 0, 255])),
    blue: write("blue.png", png(100, 100, () => [0, 0, 255, 255])),
    halves: write("halves.png", png(200, 100, (x) => (x < 100 ? [255, 0, 0, 255] : [0, 0, 255, 255]))),
    secret: write("secret.bin", pseudoRandom(2_621_440, 9)),
    // A PNG called .jpg, for the identifier.
    photoJpg: write("photo.jpg", png(200, 100, () => [255, 0, 0, 255])),
    svg: write("mark.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="#ff0000"/><circle cx="15" cy="5" r="3" fill="#0000ff"/></svg>'),
    messy: write("messy.csv", "name, city \r\n Ada ,Oslo\r\nAda,Oslo\r\n,\r\nBob,Bergen\r\n"),
    workbook: write("book.xlsx", excelFixture()),
    tarball: write("bundle.tar.gz", gzipSync(tarFixture())),
    gz: write("notes.txt.gz", gzipSync(Buffer.from("plain gzip\n"))),
  };
}

/* ---- The server --------------------------------------------------------- */

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    let filePath = join(OUT, decodeURIComponent(url.pathname));
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    if (!existsSync(filePath) && existsSync(`${filePath}.html`)) filePath = `${filePath}.html`;
    if (!existsSync(filePath)) filePath = join(OUT, "index.html");
    response.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream", "Content-Length": statSync(filePath).size });
    createReadStream(filePath).pipe(response);
  });
  return new Promise((resolveServer) => server.listen(PORT, "127.0.0.1", () => resolveServer(server)));
}

const checks = [];

function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  log(`  ${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function main() {
  log("Preparing fixtures...");
  const fixtures = await ensureFixtures();
  if (!existsSync(join(OUT, "index.html"))) fail("out/index.html missing - run `npm run build` first.");

  const server = await startServer();
  log(`Serving ${OUT} on http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const downloadDir = join(tmpdir(), `plain-tools-verify-${Date.now()}`);
  mkdirSync(downloadDir, { recursive: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  const open = async (slug) => page.goto(`http://127.0.0.1:${PORT}/${slug}`, { waitUntil: "networkidle" });
  const drop = async (paths) => page.locator('input[type="file"][multiple]').setInputFiles(paths);
  const cardFor = (name) => page.locator("li", { hasText: name }).first();
  const download = async (locator) => {
    const [event] = await Promise.all([page.waitForEvent("download"), locator.click()]);
    const path = join(downloadDir, event.suggestedFilename());
    await event.saveAs(path);
    return { path, name: event.suggestedFilename(), bytes: readFileSync(path) };
  };
  const downloadNamed = (scope, name) => download(scope.getByRole("link", { name: `Download ${name}` }));
  const pdfWidths = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((entry) => Math.round(entry.getWidth()));
  const shot = (name) => page.screenshot({ path: join(FIXTURES, `verify-${name}.png`), fullPage: true });
  // Dropping a file folds the settings panel away; a later change has to open it again.
  const openSettings = async (title) => {
    const toggle = page.getByRole("button", { name: title });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  };

  try {
    // ---- The index ------------------------------------------------------
    log("\nIndex:");
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    const links = await page.locator("main a[href^='/']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    for (const slug of ["extract-pdf-pages", "reorder-pdf-pages", "flatten-pdf", "pdf-booklet", "convert-csv", "json-to-csv", "format-json", "clean-notebook", "convert-text-file", "encrypt-file", "compare-files", "merge-images", "extract-colours", "rotate-image", "pad-image", "adjust-image", "svg-to-png", "resize-pdf-pages", "crop-pdf", "extract-pdf-images", "csv-to-excel", "excel-to-csv", "profile-csv", "clean-csv", "identify-file", "split-file", "join-files", "extract-tar"]) {
      check(`index links to /${slug}`, links.includes(`/${slug}`));
    }
    check("the Data category is on the index", (await page.locator("main").getByRole("heading", { name: "Data" }).count()) === 1);

    // ---- Extract PDF pages ---------------------------------------------
    log("\nExtract PDF pages - 5, 1:");
    await open("extract-pdf-pages");
    await page.getByLabel("Pages and ranges").fill("5, 1");
    await drop(fixtures.numbered);
    const extractCard = cardFor("numbered.pdf");
    await extractCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("reads the document", /5 pages/.test(await extractCard.innerText()));
    const extracted = await downloadNamed(extractCard, "numbered-pages-5,1.pdf");
    check("extracts the pages named, in that order", JSON.stringify(await pdfWidths(extracted.bytes)) === "[340,300]", JSON.stringify(await pdfWidths(extracted.bytes)));
    await shot("extract-pdf-pages");

    // ---- Reorder PDF pages ---------------------------------------------
    log("\nReorder PDF pages - reversed, then page 3 first:");
    await open("reorder-pdf-pages");
    await drop(fixtures.numbered);
    const reverseCard = cardFor("numbered.pdf");
    await reverseCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const reversed = await downloadNamed(reverseCard, "numbered-reversed.pdf");
    check("reverses the pages", JSON.stringify(await pdfWidths(reversed.bytes)) === "[340,330,400,310,300]", JSON.stringify(await pdfWidths(reversed.bytes)));
    await openSettings(/^New order/);
    await page.getByRole("radio", { name: /^The order I type/ }).click();
    await page.getByLabel("Pages, in the order they should come").fill("3");
    await drop(fixtures.numbered);
    const typedCard = page.locator("li", { hasText: "numbered.pdf" }).nth(1);
    await typedCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const reordered = await downloadNamed(typedCard, "numbered-reordered.pdf");
    check("moves the typed page to the front and keeps the rest", JSON.stringify(await pdfWidths(reordered.bytes)) === "[400,300,310,330,340]", JSON.stringify(await pdfWidths(reordered.bytes)));
    check("says the rest follow", /4 pages not named follow/.test(await typedCard.innerText()));
    await shot("reorder-pdf-pages");

    // ---- Flatten PDF ----------------------------------------------------
    log("\nFlatten PDF - a text field and a check box:");
    await open("flatten-pdf");
    await drop(fixtures.form);
    const flattenCard = cardFor("form.pdf");
    await flattenCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("counts the fields", /1 text field, 1 check box/.test(await flattenCard.innerText()), (await flattenCard.innerText()).slice(0, 200));
    const flattened = await downloadNamed(flattenCard, "form-flattened.pdf");
    const flattenedDocument = await PDFDocument.load(flattened.bytes);
    check("the output has no fields left", flattenedDocument.getForm().getFields().length === 0);
    check("the output page carries the drawn widgets", flattenedDocument.getPage(0).node.Resources()?.toString().includes("FlatWidget"));
    await drop(fixtures.numbered);
    const plainCard = cardFor("numbered.pdf");
    await plainCard.getByText("Nothing to do", { exact: true }).waitFor({ timeout: 30_000 });
    check("a document without fields is reported, not written", /no form fields to flatten/.test(await plainCard.innerText()));
    await shot("flatten-pdf");

    // ---- Booklet --------------------------------------------------------
    log("\nBooklet - five pages onto four sides:");
    await open("pdf-booklet");
    await drop(fixtures.numbered);
    const bookletCard = cardFor("numbered.pdf");
    await bookletCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const booklet = await downloadNamed(bookletCard, "numbered-booklet.pdf");
    const bookletDocument = await PDFDocument.load(booklet.bytes);
    check("four sides for five pages", bookletDocument.getPageCount() === 4, String(bookletDocument.getPageCount()));
    check("each side is two pages wide", Math.round(bookletDocument.getPage(0).getWidth()) === 680 && Math.round(bookletDocument.getPage(0).getHeight()) === 400, `${bookletDocument.getPage(0).getWidth()} x ${bookletDocument.getPage(0).getHeight()}`);
    check("says how to print it", /2 sheets of paper for 5 pages, with 3 blank faces/.test(await bookletCard.innerText()), (await bookletCard.innerText()).slice(0, 300));
    await openSettings(/^Layout & sheet/);
    await page.getByRole("radio", { name: /^Two per sheet/ }).click();
    await page.getByRole("radio", { name: /^A4/ }).click();
    await drop(fixtures.numbered);
    const twoUpCard = page.locator("li", { hasText: "numbered.pdf" }).nth(1);
    await twoUpCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const twoUp = await downloadNamed(twoUpCard, "numbered-2-per-sheet.pdf");
    const twoUpDocument = await PDFDocument.load(twoUp.bytes);
    check("three A4 landscape sheets, two pages each", twoUpDocument.getPageCount() === 3 && Math.round(twoUpDocument.getPage(0).getWidth()) === 842, `${twoUpDocument.getPageCount()} sheets, ${twoUpDocument.getPage(0).getWidth()} wide`);
    await shot("pdf-booklet");

    // The booklet's sides rendered, to look at: five pages pad to eight, so
    // the first side is a blank and page 1, and the third side is a blank
    // and page 3, the one stored on its side, which has to come out upright.
    log("\nBooklet rendered through PDF to images:");
    await open("pdf-to-images");
    await drop(booklet.path);
    const renderCard = cardFor("numbered-booklet.pdf");
    await renderCard.getByText("Done", { exact: true }).waitFor({ timeout: 120_000 });
    const sideOne = await downloadNamed(renderCard, "numbered-booklet-page-01.jpg");
    writeFileSync(join(FIXTURES, "verify-booklet-side-1.jpg"), sideOne.bytes);
    const sideThree = await downloadNamed(renderCard, "numbered-booklet-page-03.jpg");
    writeFileSync(join(FIXTURES, "verify-booklet-side-3.jpg"), sideThree.bytes);
    check("the sides render", sideOne.bytes.length > 1000 && sideThree.bytes.length > 1000, `${sideOne.bytes.length} and ${sideThree.bytes.length} bytes; look at .fixtures/plain/verify-booklet-side-*.jpg`);

    // ---- Convert CSV ----------------------------------------------------
    log("\nConvert CSV - JSON and TSV from a file with quotes:");
    await open("convert-csv");
    await page.getByRole("checkbox", { name: /^TSV/ }).click();
    await drop(fixtures.csv);
    const csvCard = cardFor("sample.csv");
    await csvCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("reads three rows and three columns, comma detected", /3 rows, 3 columns/.test(await csvCard.innerText()) && /comma \(detected\)/.test(await csvCard.innerText()), (await csvCard.innerText()).slice(0, 200));
    const json = await downloadNamed(csvCard, "sample.json");
    const parsedRows = JSON.parse(json.bytes.toString("utf8"));
    check("JSON has the quoted fields, typed values and a null", JSON.stringify(parsedRows) === JSON.stringify([{ name: "Smith, John", note: 'He said "hi"', n: 1 }, { name: "plain", note: "two\nlines", n: 2 }, { name: "last", note: null, n: 3 }]), JSON.stringify(parsedRows));
    const tsv = await downloadNamed(csvCard, "sample.tsv");
    check("TSV keeps the header and quotes a field with a line break", tsv.bytes.toString("utf8").startsWith("name\tnote\tn\nSmith, John\tHe said \"\"hi\"\"") === false && tsv.bytes.toString("utf8").split("\n")[0] === "name\tnote\tn" && tsv.bytes.toString("utf8").includes('"two\nlines"'), tsv.bytes.toString("utf8").slice(0, 80));
    await shot("convert-csv");

    // ---- JSON to CSV ----------------------------------------------------
    log("\nJSON to CSV - an object holding a list:");
    await open("json-to-csv");
    await drop(fixtures.records);
    const recordsCard = cardFor("records.json");
    await recordsCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check('reads the "data" list', /2 records from the "data" list/.test(await recordsCard.innerText()), (await recordsCard.innerText()).slice(0, 200));
    const csvOut = await downloadNamed(recordsCard, "records.csv");
    const csvLines = csvOut.bytes.toString("utf8").split("\r\n");
    check("flattens nested fields and joins lists", csvLines[0] === "id,name,address.city,tags" && csvLines[1] === "1,Ada,London," && csvLines[2] === "2,Bob,,x; y", csvLines.slice(0, 3).join(" | "));
    await shot("json-to-csv");

    // ---- Format JSON ----------------------------------------------------
    log("\nFormat JSON - minified in, formatted out; a broken file located:");
    await open("format-json");
    await drop(fixtures.minified);
    const formatCard = cardFor("minified.json");
    await formatCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const formatted = await downloadNamed(formatCard, "minified-formatted.json");
    check("indents by two spaces with a final newline", formatted.bytes.toString("utf8") === '{\n  "b": 1,\n  "a": [\n    1,\n    2,\n    {\n      "c": true\n    }\n  ]\n}\n', JSON.stringify(formatted.bytes.toString("utf8")));
    await drop(fixtures.broken);
    const brokenCard = cardFor("broken.json");
    await brokenCard.getByText("Failed", { exact: true }).waitFor({ timeout: 30_000 });
    check("a broken file is located by line and column", /Line 3, column \d+/.test(await brokenCard.innerText()), (await brokenCard.innerText()).slice(0, 300));
    await shot("format-json");

    // ---- Clean notebook -------------------------------------------------
    log("\nClean notebook:");
    await open("clean-notebook");
    await drop(fixtures.notebook);
    const notebookCard = cardFor("notebook.ipynb");
    await notebookCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const cleaned = await downloadNamed(notebookCard, "notebook-clean.ipynb");
    const cleanedNotebook = JSON.parse(cleaned.bytes.toString("utf8"));
    check("outputs, counts and scratch metadata are gone", cleanedNotebook.cells[1].outputs.length === 0 && cleanedNotebook.cells[1].execution_count === null && cleanedNotebook.cells[1].metadata.collapsed === undefined && cleanedNotebook.metadata.widgets === undefined);
    check("says what it did", /1 output removed, 1 execution count reset, 2 metadata entries dropped/.test(await notebookCard.innerText()), (await notebookCard.innerText()).slice(0, 300));
    await shot("clean-notebook");

    // ---- Convert text file ----------------------------------------------
    log("\nConvert text file - Windows-1252 with CRLF to UTF-8 with LF:");
    await open("convert-text-file");
    await drop(fixtures.latin);
    const latinCard = cardFor("latin.txt");
    await latinCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("detects the encoding and the line endings", /Windows-1252/.test(await latinCard.innerText()) && /CRLF \(Windows\)/.test(await latinCard.innerText()), (await latinCard.innerText()).slice(0, 300));
    const converted = await downloadNamed(latinCard, "latin-lf.txt");
    // "cafe au lait" with the accent as UTF-8 bytes, so this file stays ASCII.
    check("writes UTF-8 with LF", converted.bytes.equals(Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x0a, 0x61, 0x75, 0x20, 0x6c, 0x61, 0x69, 0x74, 0x0a])), JSON.stringify(converted.bytes.toString("utf8")));
    await shot("convert-text-file");

    // ---- Encrypt and decrypt --------------------------------------------
    log("\nEncrypt a 2.5 MB file and decrypt it again:");
    await open("encrypt-file");
    await page.locator('input[type="password"]').fill("correct horse battery staple");
    await drop(fixtures.secret);
    const sealCard = cardFor("secret.bin");
    await sealCard.getByText("Done", { exact: true }).waitFor({ timeout: 60_000 });
    check("says it is encrypting", /not yet sealed, so encrypting/.test(await sealCard.innerText()));
    const sealed = await downloadNamed(sealCard, "secret.bin.enc");
    check("the sealed file is the header plus three tagged blocks", sealed.bytes.length === 40 + 2_621_440 + 3 * 16, String(sealed.bytes.length));
    check("the sealed file does not contain the plaintext", sealed.bytes.indexOf(readFileSync(fixtures.secret).subarray(1000, 1064)) === -1);
    await drop(sealed.path);
    const openCard = cardFor("secret.bin.enc");
    await openCard.getByText("Done", { exact: true }).waitFor({ timeout: 60_000 });
    const opened = await downloadNamed(openCard, "secret.bin");
    check("decrypting gives the original bytes back", opened.bytes.equals(readFileSync(fixtures.secret)));
    await openSettings(/^Passphrase/);
    await page.locator('input[type="password"]').fill("wrong passphrase");
    await drop(sealed.path);
    const wrongCard = page.locator("li", { hasText: "secret.bin.enc" }).nth(1);
    await wrongCard.getByText("Failed", { exact: true }).waitFor({ timeout: 60_000 });
    check("the wrong passphrase is refused", /Wrong passphrase/.test(await wrongCard.innerText()));
    await shot("encrypt-file");

    // ---- Compare files --------------------------------------------------
    log("\nCompare two text files:");
    await open("compare-files");
    await drop([fixtures.old, fixtures.new]);
    await page.getByRole("button", { name: "Compare the two files" }).click();
    const diffLink = page.getByRole("link", { name: "Download old-vs-new.diff" });
    await diffLink.waitFor({ timeout: 30_000 });
    const diff = await download(diffLink);
    const diffText = diff.bytes.toString("utf8");
    check("the diff is unified", diffText.startsWith("--- old.txt\n+++ new.txt\n@@ -1,5 +1,6 @@\n a\n-b\n+B\n c\n d\n e\n+f\n"), JSON.stringify(diffText));
    check("says what changed", /2 lines added, 1 removed, 4 unchanged/.test(await page.locator("main").innerText()));
    await shot("compare-files");

    // ---- Merge images ---------------------------------------------------
    log("\nMerge images - a 200x100 and a 100x100 side by side as PNG:");
    await open("merge-images");
    await page.getByRole("radio", { name: /^PNG/ }).click();
    await drop([fixtures.red, fixtures.blue]);
    await page.getByRole("button", { name: "Merge the pictures" }).click();
    const mergedLink = page.getByRole("link", { name: "Download red-and-1-more-merged.png" });
    await mergedLink.waitFor({ timeout: 30_000 });
    const merged = await download(mergedLink);
    const mergedSize = pngSize(merged.bytes);
    check("the row is both widths plus three gaps by the height plus two", mergedSize.width === 336 && mergedSize.height === 124, `${mergedSize.width}x${mergedSize.height}`);
    await shot("merge-images");

    // ---- Extract colours ------------------------------------------------
    log("\nExtract colours - half red, half blue:");
    await open("extract-colours");
    await drop(fixtures.halves);
    const paletteCard = cardFor("halves.png");
    await paletteCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const codes = await downloadNamed(paletteCard, "halves-palette.txt");
    const codesText = codes.bytes.toString("utf8");
    check("finds the two colours at half each", /#ff0000  rgb\(255, 0, 0\)  50%/.test(codesText) && /#0000ff  rgb\(0, 0, 255\)  50%/.test(codesText), codesText.split("\n").slice(0, 4).join(" | "));
    check("writes CSS variables", codesText.includes("--colour-1:") && codesText.includes("--colour-2:"));
    const strip = await downloadNamed(paletteCard, "halves-palette.png");
    check("draws the swatch strip", pngSize(strip.bytes).width === 960);
    await shot("extract-colours");

    // ---- Rotate, pad and adjust ------------------------------------------
    log("\nRotate image - a 200x100 turned right:");
    await open("rotate-image");
    await drop(fixtures.red);
    const rotateCard = cardFor("red.png");
    await rotateCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const rotated = await downloadNamed(rotateCard, "red-rotated-right.png");
    check("the turned picture is 100x200", pngSize(rotated.bytes).width === 100 && pngSize(rotated.bytes).height === 200, `${pngSize(rotated.bytes).width}x${pngSize(rotated.bytes).height}`);
    await shot("rotate-image");

    log("\nPad image - a 200x100 made square on white:");
    await open("pad-image");
    await page.getByRole("radio", { name: /^White/ }).click();
    await drop(fixtures.red);
    const padCard = cardFor("red.png");
    await padCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const padded = decodePng((await downloadNamed(padCard, "red-1x1-padded.png")).bytes);
    check("the frame is 200x200 with the picture in the middle", padded.width === 200 && padded.height === 200 && near(padded.pixel(100, 10), [255, 255, 255]) && near(padded.pixel(100, 100), [255, 0, 0]), `${padded.width}x${padded.height}, top ${padded.pixel(100, 10)}, middle ${padded.pixel(100, 100)}`);
    await shot("pad-image");

    log("\nAdjust image - black and white:");
    await open("adjust-image");
    await drop(fixtures.red);
    const adjustCard = cardFor("red.png");
    await adjustCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const grey = decodePng((await downloadNamed(adjustCard, "red-grayscale.png")).bytes);
    check("red becomes the grey of its brightness", near(grey.pixel(0, 0), [76, 76, 76]), String(grey.pixel(0, 0)));
    await shot("adjust-image");

    // ---- SVG ----------------------------------------------------------------
    log("\nSVG to PNG - a 20x10 drawing at 512 wide:");
    await open("svg-to-png");
    await page.getByRole("radio", { name: /^512 px/ }).click();
    await drop(fixtures.svg);
    const svgCard = cardFor("mark.svg");
    await svgCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const drawn = decodePng((await downloadNamed(svgCard, "mark-512px.png")).bytes);
    check("the PNG is 512x256 with the shapes where they should be", drawn.width === 512 && drawn.height === 256 && near(drawn.pixel(10, 10), [255, 0, 0]) && near(drawn.pixel(384, 128), [0, 0, 255]), `${drawn.width}x${drawn.height}, corner ${drawn.pixel(10, 10)}, circle ${drawn.pixel(384, 128)}`);
    await shot("svg-to-png");

    // ---- PDF pages resized, cropped, and their pictures taken out -----------
    log("\nResize PDF pages - five odd pages onto A4:");
    await open("resize-pdf-pages");
    await drop(fixtures.numbered);
    const resizeCard = cardFor("numbered.pdf");
    await resizeCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const resized = await PDFDocument.load((await downloadNamed(resizeCard, "numbered-a4.pdf")).bytes);
    check("every page is A4 portrait", resized.getPageCount() === 5 && resized.getPages().every((entry) => Math.round(entry.getWidth()) === 595 && Math.round(entry.getHeight()) === 842), resized.getPages().map((entry) => `${Math.round(entry.getWidth())}x${Math.round(entry.getHeight())}`).join(" "));
    await shot("resize-pdf-pages");

    log("\nCrop PDF - to the content, then 50 mm off the top:");
    await open("crop-pdf");
    await drop(fixtures.numbered);
    const trimCard = cardFor("numbered.pdf");
    await trimCard.getByText("Done", { exact: true }).waitFor({ timeout: 120_000 });
    const trimmed = await PDFDocument.load((await downloadNamed(trimCard, "numbered-cropped.pdf")).bytes);
    const trimBox = trimmed.getPage(0).getCropBox();
    // The border is 40 pt in and the tool keeps 3 mm (8.5 pt) around it, so about 30 pt comes off each edge.
    check("trimming to the content shrinks the page to the drawn border", trimBox.width > 228 && trimBox.width < 252 && trimBox.height > 328 && trimBox.height < 352, `${trimBox.width.toFixed(1)}x${trimBox.height.toFixed(1)} from 300x400`);
    await openSettings(/^How to crop/);
    await page.getByRole("radio", { name: /^By a measurement/ }).click();
    await page.getByLabel("Top").fill("50");
    for (const side of ["Right", "Bottom", "Left"]) await page.getByLabel(side).fill("0");
    await drop(fixtures.numbered);
    const marginCard = page.locator("li", { hasText: "numbered.pdf" }).nth(1);
    await marginCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const margined = await PDFDocument.load((await downloadNamed(marginCard, "numbered-cropped.pdf")).bytes);
    const upright = margined.getPage(0).getCropBox();
    const sideways = margined.getPage(2).getCropBox();
    check("50 mm comes off the top of an upright page", Math.abs(upright.height - (400 - 141.73)) < 0.5 && upright.y === 0, `${upright.x},${upright.y} ${upright.width.toFixed(1)}x${upright.height.toFixed(1)}`);
    check("and off the stored left of the page shown turned", Math.abs(sideways.x - 141.73) < 0.5 && Math.abs(sideways.width - (400 - 141.73)) < 0.5 && sideways.height === 320, `${sideways.x.toFixed(1)},${sideways.y} ${sideways.width.toFixed(1)}x${sideways.height.toFixed(1)}`);
    await shot("crop-pdf");

    log("\nExtract images from PDF - a PNG and a JPEG placed on two pages:");
    const jpegDataUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 80;
      const context = canvas.getContext("2d");
      context.fillStyle = "#00c000";
      context.fillRect(0, 0, 120, 80);
      return canvas.toDataURL("image/jpeg", 0.92);
    });
    check("the browser writes a JPEG for the fixture", jpegDataUrl.startsWith("data:image/jpeg;base64,"), jpegDataUrl.slice(0, 30));
    // Copied out of Node's buffer pool: pdf-lib reads the bytes through a DataView on the whole underlying buffer.
    const jpegBytes = Uint8Array.from(Buffer.from(jpegDataUrl.split(",")[1], "base64"));
    const withImages = await PDFDocument.create();
    const embeddedPng = await withImages.embedPng(readFileSync(fixtures.red));
    withImages.addPage([300, 300]).drawImage(embeddedPng, { x: 20, y: 20, width: 200, height: 100 });
    const embeddedJpg = await withImages.embedJpg(jpegBytes);
    withImages.addPage([300, 300]).drawImage(embeddedJpg, { x: 20, y: 20, width: 60, height: 40 });
    const imagesPdf = join(FIXTURES, "images.pdf");
    writeFileSync(imagesPdf, await withImages.save());
    await open("extract-pdf-images");
    await drop(imagesPdf);
    const imagesCard = cardFor("images.pdf");
    await imagesCard.getByText("Done", { exact: true }).waitFor({ timeout: 120_000 });
    check("finds two pictures", /2 pictures/.test(await imagesCard.innerText()), (await imagesCard.innerText()).slice(0, 200));
    const firstImage = decodePng((await downloadNamed(imagesCard, "images-page-01-image-01.png")).bytes);
    const secondImage = decodePng((await downloadNamed(imagesCard, "images-page-02-image-01.png")).bytes);
    check("the PNG comes out at its stored 200x100, red", firstImage.width === 200 && firstImage.height === 100 && near(firstImage.pixel(50, 50), [255, 0, 0]), `${firstImage.width}x${firstImage.height} ${firstImage.pixel(50, 50)}`);
    check("the JPEG comes out at its stored 120x80, green", secondImage.width === 120 && secondImage.height === 80 && near(secondImage.pixel(50, 40), [0, 192, 0], 20), `${secondImage.width}x${secondImage.height} ${secondImage.pixel(50, 40)}`);
    await shot("extract-pdf-images");

    // ---- Spreadsheets -------------------------------------------------------
    log("\nCSV to Excel:");
    await open("csv-to-excel");
    await drop(fixtures.csv);
    const excelCard = cardFor("sample.csv");
    await excelCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const workbookFiles = unzipSync((await downloadNamed(excelCard, "sample.xlsx")).bytes);
    const sheetXml = Buffer.from(workbookFiles["xl/worksheets/sheet1.xml"]).toString("utf8");
    check("the workbook has its parts and typed cells", "[Content_Types].xml" in workbookFiles && sheetXml.includes('<c r="C2"><v>1</v></c>') && sheetXml.includes("Smith, John") && sheetXml.includes('<c r="A1" s="1" t="inlineStr">'), sheetXml.slice(0, 200));
    await shot("csv-to-excel");

    log("\nExcel to CSV - two sheets, shared strings and dates:");
    await open("excel-to-csv");
    await drop(fixtures.workbook);
    const bookCard = cardFor("book.xlsx");
    await bookCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const people = (await downloadNamed(bookCard, "book-people.csv")).bytes.toString("utf8");
    const numbers = (await downloadNamed(bookCard, "book-numbers.csv")).bytes.toString("utf8");
    check("the sheets come out with dates as dates", people === "Name,When\r\nAda,2024-01-01\r\nBob,2024-01-01 12:00:00\r\n" && numbers === "42,TRUE\r\n", JSON.stringify([people, numbers]));
    await shot("excel-to-csv");

    // ---- Profile and clean --------------------------------------------------
    log("\nProfile a CSV:");
    await open("profile-csv");
    await drop(fixtures.csv);
    const profileCard = cardFor("sample.csv");
    await profileCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const profile = (await downloadNamed(profileCard, "sample-profile.txt")).bytes.toString("utf8");
    check("the report types the columns", profile.includes("3 rows, 3 columns") && profile.includes("n\n  type: whole numbers") && profile.includes("range: 1 to 3, mean 2") && profile.includes("note\n  type: text\n  filled: 2, empty: 1"), profile.slice(0, 300));
    await shot("profile-csv");

    log("\nClean a CSV:");
    await open("clean-csv");
    await drop(fixtures.messy);
    const messyCard = cardFor("messy.csv");
    await messyCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const cleanedCsv = (await downloadNamed(messyCard, "messy-clean.csv")).bytes.toString("utf8");
    check("cells trimmed, the repeat and the empty row gone", cleanedCsv === "name,city\r\nAda,Oslo\r\nBob,Bergen\r\n", JSON.stringify(cleanedCsv));
    check("says what changed", /2 cells trimmed; 1 duplicate row removed; 1 empty row dropped/.test(await messyCard.innerText()), (await messyCard.innerText()).slice(0, 300));
    await shot("clean-csv");

    // ---- Files ----------------------------------------------------------------
    log("\nIdentify a file - a PNG called .jpg, and a CSV:");
    await open("identify-file");
    await drop([fixtures.photoJpg, fixtures.csv]);
    const identifyCard = cardFor("photo.jpg");
    await identifyCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("the bytes say PNG whatever the name", /PNG image/.test(await identifyCard.innerText()) && /The name says \.jpg but the bytes say PNG image/.test(await identifyCard.innerText()), (await identifyCard.innerText()).slice(0, 300));
    const csvIdentity = cardFor("sample.csv");
    await csvIdentity.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("a CSV is read as text and as a table", /CSV table/.test(await csvIdentity.innerText()) && /The extension matches/.test(await csvIdentity.innerText()), (await csvIdentity.innerText()).slice(0, 300));
    await shot("identify-file");

    log("\nSplit a file into 1 MB pieces, then join them:");
    await open("split-file");
    await page.getByRole("radio", { name: /^Custom/ }).click();
    await page.getByRole("spinbutton", { name: "Megabytes" }).fill("1");
    await drop(fixtures.secret);
    const splitCard = cardFor("secret.bin");
    await splitCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("three pieces", /3 pieces of 1.0 MB/.test(await splitCard.innerText()), (await splitCard.innerText()).slice(0, 200));
    const pieces = [];
    for (const index of [1, 2, 3]) pieces.push(await downloadNamed(splitCard, `secret.bin.00${index}`));
    check("the pieces add up to the file", pieces[0].bytes.length === 1_000_000 && pieces[2].bytes.length === 621_440 && Buffer.concat(pieces.map((piece) => piece.bytes)).equals(readFileSync(fixtures.secret)), pieces.map((piece) => piece.bytes.length).join(", "));
    await shot("split-file");

    await open("join-files");
    await drop([pieces[2].path, pieces[0].path, pieces[1].path]);
    await page.getByRole("button", { name: "Join the pieces" }).click();
    const joinedLink = page.getByRole("link", { name: "Download secret.bin" });
    await joinedLink.waitFor({ timeout: 30_000 });
    const joined = await download(joinedLink);
    check("joined in number order whatever order they were dropped", joined.bytes.equals(readFileSync(fixtures.secret)), String(joined.bytes.length));
    await shot("join-files");

    log("\nExtract TAR - a .tar.gz and a plain .gz:");
    await open("extract-tar");
    await drop([fixtures.tarball, fixtures.gz]);
    const tarCard = cardFor("bundle.tar.gz");
    await tarCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    check("lists the files and skips the directory", /2 files/.test(await tarCard.innerText()) && /1 entry that was a directory/.test(await tarCard.innerText()), (await tarCard.innerText()).slice(0, 300));
    const hello = await downloadNamed(tarCard, "hello.txt");
    const inner = await downloadNamed(tarCard, "data.bin");
    check("the files come out whole", hello.bytes.toString("utf8") === "hello tar\n" && inner.bytes.equals(pseudoRandom(1000, 4)));
    const gzCard = cardFor("notes.txt.gz");
    await gzCard.getByText("Done", { exact: true }).waitFor({ timeout: 30_000 });
    const notes = await downloadNamed(gzCard, "notes.txt");
    check("a plain gzip gives its one file back", notes.bytes.toString("utf8") === "plain gzip\n" && /gzip file/.test(await gzCard.innerText()));
    await shot("extract-tar");

    log("\nPage:");
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } catch (error) {
    // The page as it stood when a step gave up, for whoever reads the log.
    await page.screenshot({ path: join(FIXTURES, "verify-failure.png"), fullPage: true }).catch(() => {});
    log(`Page text at the failure:\n${(await page.locator("main").innerText().catch(() => "")).slice(0, 1500)}`);
    throw error;
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  const failed = checks.filter((entry) => !entry.ok);
  log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) fail(`${failed.length} check(s) failed: ${failed.map((entry) => entry.name).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
