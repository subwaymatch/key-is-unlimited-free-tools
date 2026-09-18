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
import { crc32, deflateSync } from "node:zlib";

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
    page.drawRectangle({ x: 10, y: 10, width: page.getWidth() - 20, height: page.getHeight() - 20, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 2 });
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
    for (const slug of ["extract-pdf-pages", "reorder-pdf-pages", "flatten-pdf", "pdf-booklet", "convert-csv", "json-to-csv", "format-json", "clean-notebook", "convert-text-file", "encrypt-file", "compare-files", "merge-images", "extract-colours"]) {
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

    log("\nPage:");
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
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
