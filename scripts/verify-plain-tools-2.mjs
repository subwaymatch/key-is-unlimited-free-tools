/**
 * Browser verification of the seventh batch: the PDF password and form
 * tools, the e-book and e-mail readers, the SQLite, CSV, XML and GPS tools,
 * the HAR sanitiser, the certificate inspector, the secret scanner, the SVG
 * optimiser and the passport photo sheet.
 *
 * Builds nothing itself: run `npm run build` first. Serves the static
 * export, makes its own fixtures in Node - PDFs through pdf-lib, a database
 * through Node's own SQLite, an Outlook message and certificates from the
 * test fixtures, bundled on the fly with esbuild - drops them on each page
 * in Chromium, saves what comes back and reads it: protected PDFs are
 * opened with PDF.js, workbooks and archives unzipped, JPEGs measured.
 *
 *   npm run build && node scripts/verify-plain-tools-2.mjs
 *
 * Requires Node 22 (for node:sqlite) and a Chromium Playwright can find on
 * its own, or one named in CHROMIUM_PATH.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import { buildSync } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(root, ".fixtures", "plain-2");
const OUT = join(root, "out");
const PORT = 4176;

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

/** A PNG of RGB pixels from a function of x and y, written by hand. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
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
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A JPEG's size from its frame header, and the density its JFIF header states. */
function jpegInfo(bytes) {
  let at = 2;
  const density = bytes.toString("latin1", 6, 10) === "JFIF" ? { unit: bytes[13], x: bytes.readUInt16BE(14), y: bytes.readUInt16BE(16) } : null;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7), density };
    at += 2 + length;
  }
  return null;
}

/** A TypeScript module from the tests, bundled so this script can import it. */
async function importTs(relative) {
  const outfile = join(FIXTURES, `${relative.replace(/[^\w]+/g, "-")}.mjs`);
  buildSync({ entryPoints: [join(root, relative)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

async function threePages() {
  const document = await PDFDocument.create();
  document.setTitle("Secret plans");
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page += 1) document.addPage([300, 200]).drawText(`Page ${page} says hello`, { x: 20, y: 100, size: 14, font });
  return document.save();
}

async function filledForm(name, agree) {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  const form = document.getForm();
  const text = form.createTextField("applicant");
  text.setText(name);
  text.addToPage(page, { x: 20, y: 300 });
  const box = form.createCheckBox("agree");
  box.addToPage(page, { x: 20, y: 250 });
  if (agree) box.check();
  return document.save();
}

function epub() {
  const chapter = (title, body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
  return zipSync(
    {
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
      "OEBPS/content.opf": strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Two Chapters</dc:title><dc:creator>Ada</dc:creator></metadata><manifest><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'),
      "OEBPS/a.xhtml": strToU8(chapter("First", "<p>It was a <em>dark</em> night.</p><p>Second paragraph.</p>")),
      "OEBPS/b.xhtml": strToU8(chapter("Second", "<p>The end.</p>")),
    },
    { level: 6 },
  );
}

const EML = [
  "From: Ada <ada@example.com>",
  "To: Charles <charles@example.com>",
  "Subject: =?UTF-8?Q?Figures_=E2=80=94_Q3?=",
  "Date: Tue, 1 Sep 2026 09:30:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello Charles, the report is attached.",
  "--b1",
  'Content-Type: application/pdf; name="report.pdf"',
  'Content-Disposition: attachment; filename="report.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 fake report").toString("base64"),
  "--b1--",
  "",
].join("\r\n");

function gpxTrack(points) {
  return `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Run</name><trkseg>${points.map(([lat, lon, ele], index) => `<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele><time>2026-09-01T08:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
}

function distance(a, b) {
  const radians = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * radians) / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(((b[1] - a[1]) * radians) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

async function ensureFixtures() {
  mkdirSync(FIXTURES, { recursive: true });
  const write = (name, bytes) => {
    const path = join(FIXTURES, name);
    writeFileSync(path, bytes);
    return path;
  };
  const { sampleMsg } = await importTs("tests/msgFixture.ts");
  const { CHAIN_PEM, EC_PEM } = await importTs("tests/certificates.ts");

  const { DatabaseSync } = await import("node:sqlite");
  const dbPath = join(FIXTURES, "shop.db");
  if (existsSync(dbPath)) writeFileSync(dbPath, "");
  const db = new DatabaseSync(dbPath);
  db.exec("DROP TABLE IF EXISTS people; DROP TABLE IF EXISTS orders;");
  db.exec("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, city TEXT); INSERT INTO people (name, city) VALUES ('Ada', 'London'), ('Charles', 'London');");
  db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, person INTEGER, total REAL); INSERT INTO orders (person, total) VALUES (1, 9.5), (2, 12.25), (1, 3);");
  db.close();

  // Secrets are put together here so no source file holds one whole.
  const token = ["gh", "p_", "R4nd0mT0k3nV4lu3F0rT3st1ngPurp0s3s12"].join("");
  const aws = ["AK", "IA", "Z7Q2W3E4R5T6Y7U8"].join("");

  const line = Array.from({ length: 101 }, (_, index) => [50 + index * 0.0001, 0, 100 + index]);
  const ride = [[51.5, -0.1, 10], [51.51, -0.1, 25], [51.52, -0.11, 20]];

  return {
    plain: write("plain.pdf", await threePages()),
    formA: write("form-ada.pdf", await filledForm("Ada", true)),
    formB: write("form-charles.pdf", await filledForm("Charles, \"C\"", false)),
    epub: write("book.epub", epub()),
    eml: write("message.eml", EML),
    msg: write("sample.msg", sampleMsg()),
    db: dbPath,
    customers: write("customers.csv", "id,name\n1,Ada\n2,Charles\n3,Mary\n"),
    orders: write("orders.csv", "id,total\n1,10\n1,15\n3,7\n9,99\n"),
    before: write("before.csv", "sku,price\nA,1.00\nB,2.00\nC,3.00\n"),
    after: write("after.csv", "sku,price\nA,1.00\nC,3.50\nD,4.00\n"),
    sales: write("sales.csv", "region,month,amount\nNorth,Jan,10\nNorth,Feb,5.5\nSouth,Jan,\"1,000\"\n"),
    people: write("people.csv", "Full name,Email,notes\nAda Lovelace,ada@example.org,call +44 20 7946 0000\nCharles Babbage,cb@example.org,none\n"),
    feed: write("feed.xml", '<?xml version="1.0"?><rss><channel><title>News</title><item><title>One</title></item><item><title>Two &amp; three</title></item></channel></rss>'),
    broken: write("broken.xml", "<a>\n  <b>\n  </c>\n</a>"),
    json: write("data.json", JSON.stringify({ library: { "@name": "City", book: [{ title: "A" }, { title: "B" }] } })),
    ride: write("ride.gpx", gpxTrack(ride)),
    line: write("line.gpx", gpxTrack(line)),
    har: write(
      "network.har",
      JSON.stringify({
        log: {
          version: "1.2",
          entries: [
            {
              startedDateTime: "2026-09-01T10:00:00.000Z",
              time: 50,
              request: { method: "GET", url: "https://api.example.test/me?access_token=SECRET1&page=2", headers: [{ name: "Authorization", value: "Bearer SECRET2" }], cookies: [{ name: "sid", value: "SECRET3" }], queryString: [{ name: "access_token", value: "SECRET1" }] },
              response: { status: 200, headers: [{ name: "Set-Cookie", value: "sid=SECRET3" }], cookies: [], content: { size: 20, mimeType: "application/json", text: '{"name":"Ada","refresh_token":"SECRET4"}' } },
            },
          ],
        },
      }),
    ),
    chain: write("chain.pem", CHAIN_PEM),
    ec: write("ec.pem", EC_PEM),
    config: write("config.env", `# settings\nGITHUB_TOKEN=${token}\naws_access_key_id = ${aws}\nDEBUG=true\n`),
    clean: write("clean.txt", "Nothing secret here.\nJust words.\n"),
    svg: write(
      "logo.svg",
      '<?xml version="1.0"?>\n<!-- Inkscape -->\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100" viewBox="0 0 100.000 100.000" id="svg1" inkscape:version="1.2" onload="alert(1)">\n  <metadata><x/></metadata>\n  <circle cx="50.123456" cy="50.000001" r="40" fill="#e00" id="c1"/>\n  <script>alert(2)</script>\n</svg>\n',
    ),
    portrait: write("portrait.png", png(600, 800, (x, y) => [Math.round((x / 600) * 255), Math.round((y / 800) * 255), 128])),
  };
}

/* ---- Serving ------------------------------------------------------------ */

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

/** The text of every page of a PDF as PDF.js reads it, with a password if it needs one. */
async function pdfText(bytes, password) {
  const task = getDocument({ data: new Uint8Array(bytes), password, useWorkerFetch: false, disableFontFace: true, verbosity: 0 });
  const document = await task.promise;
  const pages = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => item.str ?? "").join(""));
  }
  const permissions = await document.getPermissions();
  await task.destroy();
  return { pages, permissions };
}

async function main() {
  log("Preparing fixtures...");
  const fixtures = await ensureFixtures();
  if (!existsSync(join(OUT, "index.html"))) fail("out/index.html missing - run `npm run build` first.");

  const server = await startServer();
  log(`Serving ${OUT} on http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const downloadDir = join(tmpdir(), `plain-tools-2-verify-${Date.now()}`);
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
  const cardFor = (name, index = 0) => page.locator("li", { hasText: name }).nth(index);
  const done = async (card) => card.getByText("Done", { exact: true }).waitFor({ timeout: 60_000 });
  const download = async (locator) => {
    const [event] = await Promise.all([page.waitForEvent("download"), locator.click()]);
    const path = join(downloadDir, event.suggestedFilename());
    await event.saveAs(path);
    return { path, name: event.suggestedFilename(), bytes: readFileSync(path) };
  };
  const downloadNamed = (scope, name) => download(scope.getByRole("link", { name: `Download ${name}` }));
  const shot = (name) => page.screenshot({ path: join(FIXTURES, `verify-${name}.png`), fullPage: true });
  const openSettings = async (title) => {
    const toggle = page.getByRole("button", { name: title });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  };

  try {
    log("\nIndex:");
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    const links = await page.locator("main a[href^='/']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    for (const slug of ["protect-pdf", "unlock-pdf", "pdf-form-data", "epub-to-text", "extract-email", "open-msg", "sqlite-to-csv", "join-csv", "compare-csv", "pivot-csv", "anonymize-csv", "format-xml", "xml-to-json", "convert-gps", "trim-gps-track", "sanitize-har", "inspect-certificate", "find-secrets", "optimize-svg", "passport-photo"]) {
      check(`index links to /${slug}`, links.includes(`/${slug}`));
    }

    // ---- Protect and unlock --------------------------------------------
    log("\nProtect PDF - a password, and copying forbidden:");
    await open("protect-pdf");
    await page.getByLabel("Password", { exact: true }).fill("s3cret pass");
    await page.getByLabel("The same again").fill("s3cret pass");
    await page.getByRole("checkbox", { name: /^Copying/ }).click();
    await drop(fixtures.plain);
    const protectCard = cardFor("plain.pdf");
    await done(protectCard);
    const protectedPdf = await downloadNamed(protectCard, "plain-protected.pdf");
    let refused = false;
    try {
      await pdfText(protectedPdf.bytes);
    } catch (error) {
      refused = error?.name === "PasswordException";
    }
    check("PDF.js refuses it without the password", refused);
    const opened = await pdfText(protectedPdf.bytes, "s3cret pass");
    check("PDF.js opens it with the password, every page's text intact", JSON.stringify(opened.pages) === JSON.stringify(["Page 1 says hello", "Page 2 says hello", "Page 3 says hello"]), JSON.stringify(opened.pages));
    // PDF.js lists the flags that are allowed; 16 is copying, 4 printing.
    const allowed = [...(opened.permissions ?? [])];
    check("copying is forbidden and printing allowed", !allowed.includes(16) && allowed.includes(4), JSON.stringify(allowed));
    check("the file says AES-256", protectedPdf.bytes.toString("latin1").includes("/AESV3"));
    await shot("protect-pdf");

    log("\nUnlock PDF - with the password, then a wrong one:");
    await open("unlock-pdf");
    await page.getByLabel("Password", { exact: true }).fill("s3cret pass");
    await drop(protectedPdf.path);
    const unlockCard = cardFor("plain-protected.pdf");
    await done(unlockCard);
    const unlockText = await unlockCard.innerText();
    check("names the encryption and the restriction", /AES-256/.test(unlockText) && /no copying text/.test(unlockText), unlockText.slice(0, 300));
    const unlocked = await downloadNamed(unlockCard, "plain-protected-unlocked.pdf");
    const unlockedDocument = await PDFDocument.load(unlocked.bytes);
    check("the copy opens without a password, all three pages there", !unlockedDocument.isEncrypted && unlockedDocument.getPageCount() === 3 && unlockedDocument.getTitle() === "Secret plans");
    check("and PDF.js reads its text", (await pdfText(unlocked.bytes)).pages[2] === "Page 3 says hello");
    await openSettings(/^Password/);
    await page.getByLabel("Password", { exact: true }).fill("wrong");
    await drop(protectedPdf.path);
    const wrongCard = cardFor("plain-protected.pdf", 1);
    await wrongCard.getByText("Failed", { exact: true }).waitFor({ timeout: 30_000 });
    check("a wrong password is refused", /That password does not open this PDF/.test(await wrongCard.innerText()));
    await shot("unlock-pdf");

    // ---- Forms, e-books, e-mail ------------------------------------------
    log("\nPDF form data - two filled forms:");
    await open("pdf-form-data");
    await drop([fixtures.formA, fixtures.formB]);
    await page.getByText("2 fields, 2 filled in").first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Extract the form data" }).click();
    const formCsv = await download(page.getByRole("link", { name: "Download form-data.csv" }));
    check("one row per form, a column per field", formCsv.bytes.toString("utf8").replace(/^\ufeff/, "") === 'file,applicant,agree\r\nform-ada.pdf,Ada,Yes\r\nform-charles.pdf,"Charles, ""C""",No\r\n', JSON.stringify(formCsv.bytes.toString("utf8")));
    await shot("pdf-form-data");

    log("\nEPUB to text:");
    await open("epub-to-text");
    await drop(fixtures.epub);
    const epubCard = cardFor("book.epub");
    await done(epubCard);
    const bookText = (await downloadNamed(epubCard, "book.txt")).bytes.toString("utf8");
    check("the chapters come out in spine order", bookText === "Two Chapters\n\nAda\n\n\nFirst\n\nIt was a dark night.\n\nSecond paragraph.\n\n\nSecond\n\nThe end.\n", JSON.stringify(bookText));
    await shot("epub-to-text");

    log("\nOpen an .eml:");
    await open("extract-email");
    await drop(fixtures.eml);
    const emlCard = cardFor("message.eml");
    await done(emlCard);
    check("reads the encoded subject", /Figures \u2014 Q3/.test(await emlCard.innerText()));
    const attachment = await downloadNamed(emlCard, "report.pdf");
    check("the attachment comes back byte for byte", attachment.bytes.toString("latin1") === "%PDF-1.4 fake report");
    const messageText = (await downloadNamed(emlCard, "message.txt")).bytes.toString("utf8");
    check("the text has the headers and the body", messageText.includes("Subject: Figures \u2014 Q3") && messageText.includes("Hello Charles, the report is attached."), JSON.stringify(messageText));
    await shot("extract-email");

    log("\nOpen an Outlook .msg:");
    await open("open-msg");
    await drop(fixtures.msg);
    const msgCard = cardFor("sample.msg");
    await done(msgCard);
    const msgText = await msgCard.innerText();
    check("reads the subject, the sender and the recipients", /Quarterly r\u00e9sum\u00e9/.test(msgText) && /Ada Lovelace/.test(msgText) && /Mary Somerville/.test(msgText), msgText.slice(0, 300));
    const figures = await downloadNamed(msgCard, "figures.csv");
    check("the small attachment comes out", figures.bytes.toString("utf8") === "quarter,total\nQ1,10\n");
    // The picture the HTML shows by Content-ID is written into the web page rather than listed.
    const page_ = (await downloadNamed(msgCard, "sample.html")).bytes.toString("utf8");
    const embedded = page_.match(/src="data:image\/png;base64,([^"]+)"/)?.[1];
    const chart = embedded ? Buffer.from(embedded, "base64") : Buffer.alloc(0);
    check("the large inline picture comes out whole, inside the page", chart.length === 6000 && chart[1] === 7 && chart[5999] === (5999 * 7) % 256 && !page_.includes("<script"), `${chart.length} bytes`);
    const eml = (await downloadNamed(msgCard, "sample.eml")).bytes.toString("utf8");
    check("the .eml carries the message", eml.includes("Message-ID: <abc123@example.com>") && eml.includes("multipart/mixed") && eml.includes('filename*=UTF-8\'\'figures.csv'));
    await shot("open-msg");

    // ---- Data -----------------------------------------------------------
    log("\nSQLite to CSV:");
    await open("sqlite-to-csv");
    await drop(fixtures.db);
    const dbCard = cardFor("shop.db");
    await done(dbCard);
    check("lists both tables", /people \(2\), orders \(3\)/.test(await dbCard.innerText()), (await dbCard.innerText()).slice(0, 300));
    check("people.csv has the rowids and the rows", (await downloadNamed(dbCard, "people.csv")).bytes.toString("utf8") === "id,name,city\r\n1,Ada,London\r\n2,Charles,London\r\n");
    check("orders.csv has the numbers", (await downloadNamed(dbCard, "orders.csv")).bytes.toString("utf8") === "id,person,total\r\n1,1,9.5\r\n2,2,12.25\r\n3,1,3\r\n");
    await shot("sqlite-to-csv");

    log("\nJoin two CSVs:");
    await open("join-csv");
    await drop([fixtures.customers, fixtures.orders]);
    await page.getByText("2 columns: id, total").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Join the files" }).click();
    const joined = await download(page.getByRole("link", { name: "Download customers-joined.csv" }));
    check("every customer, orders alongside, one row per match", joined.bytes.toString("utf8") === "id,name,total\r\n1,Ada,10\r\n1,Ada,15\r\n2,Charles,\r\n3,Mary,7\r\n", JSON.stringify(joined.bytes.toString("utf8")));
    await shot("join-csv");

    log("\nCompare two CSVs:");
    await open("compare-csv");
    await drop([fixtures.before, fixtures.after]);
    await page.getByText("2 columns: sku, price").first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Compare the files" }).click();
    const differences = await download(page.getByRole("link", { name: "Download before-vs-after.csv" }));
    check("removed, changed and added rows", differences.bytes.toString("utf8") === "change,changed columns,sku,price\r\nremoved,,B,2.00\r\nchanged,price,C,3.00 -> 3.50\r\nadded,,D,4.00\r\n", JSON.stringify(differences.bytes.toString("utf8")));
    await shot("compare-csv");

    log("\nPivot a CSV - sum of amount by region:");
    await open("pivot-csv");
    await page.getByLabel("Group rows by").fill("region");
    await page.getByRole("radio", { name: /^Sum/ }).click();
    await page.getByLabel("Values from").fill("amount");
    await drop(fixtures.sales);
    const pivotCard = cardFor("sales.csv");
    await done(pivotCard);
    check("sums by group with a total", (await downloadNamed(pivotCard, "sales-pivot.csv")).bytes.toString("utf8") === "region,Sum of amount\r\nNorth,15.5\r\nSouth,1000\r\nTotal,1015.5\r\n");
    await shot("pivot-csv");

    log("\nAnonymize a CSV:");
    await open("anonymize-csv");
    await drop(fixtures.people);
    const anonCard = cardFor("people.csv");
    await done(anonCard);
    const anonymised = (await downloadNamed(anonCard, "people-anonymised.csv")).bytes.toString("utf8");
    check("names and addresses replaced, the phone in the notes scrubbed", anonymised === "Full name,Email,notes\r\nPerson 1,user1@example.com,call 555-0001\r\nPerson 2,user2@example.com,none\r\n", JSON.stringify(anonymised));
    await shot("anonymize-csv");

    log("\nFormat XML - a feed indented, a broken file located:");
    await open("format-xml");
    await drop(fixtures.feed);
    const feedCard = cardFor("feed.xml");
    await done(feedCard);
    check("indented", (await downloadNamed(feedCard, "feed-formatted.xml")).bytes.toString("utf8") === '<?xml version="1.0"?>\n<rss>\n  <channel>\n    <title>News</title>\n    <item>\n      <title>One</title>\n    </item>\n    <item>\n      <title>Two &amp; three</title>\n    </item>\n  </channel>\n</rss>\n');
    await drop(fixtures.broken);
    const brokenCard = cardFor("broken.xml");
    await brokenCard.getByText("Failed", { exact: true }).waitFor({ timeout: 30_000 });
    check("says where the broken one breaks", /Line 3, column 3: <\/c> does not match <b>/.test(await brokenCard.innerText()), (await brokenCard.innerText()).slice(0, 300));
    await shot("format-xml");

    log("\nXML to JSON, and back:");
    await open("xml-to-json");
    await drop([fixtures.feed, fixtures.json]);
    const feedJsonCard = cardFor("feed.xml");
    await done(feedJsonCard);
    const feedJson = JSON.parse((await downloadNamed(feedJsonCard, "feed.json")).bytes.toString("utf8"));
    check("repeated items become an array", JSON.stringify(feedJson) === JSON.stringify({ rss: { channel: { title: "News", item: [{ title: "One" }, { title: "Two & three" }] } } }), JSON.stringify(feedJson));
    const jsonCard = cardFor("data.json");
    await done(jsonCard);
    const xml = (await downloadNamed(jsonCard, "data.xml")).bytes.toString("utf8");
    check("JSON comes back as XML with attributes", xml.includes('<library name="City">') && xml.includes("<title>B</title>"), JSON.stringify(xml));
    await shot("xml-to-json");

    log("\nConvert GPS:");
    await open("convert-gps");
    await drop(fixtures.ride);
    const rideCard = cardFor("ride.gpx");
    await done(rideCard);
    check("measures the track", /3 points, 2\.\d\d km/.test(await rideCard.innerText()), (await rideCard.innerText()).slice(0, 300));
    const geojson = JSON.parse((await downloadNamed(rideCard, "ride.geojson")).bytes.toString("utf8"));
    check("GeoJSON has the line with heights and times", geojson.features[0].geometry.type === "LineString" && JSON.stringify(geojson.features[0].geometry.coordinates[1]) === "[-0.1,51.51,25]" && geojson.features[0].properties.coordTimes.length === 3);
    const kml = (await downloadNamed(rideCard, "ride.kml")).bytes.toString("utf8");
    check("KML has the coordinates", kml.includes("<coordinates>-0.1,51.5,10 -0.1,51.51,25 -0.11,51.52,20</coordinates>"));
    await shot("convert-gps");

    log("\nHide home on a GPS track - 200 m:");
    await open("trim-gps-track");
    await page.getByRole("radio", { name: /^200 m/ }).click();
    await drop(fixtures.line);
    const lineCard = cardFor("line.gpx");
    await done(lineCard);
    const trimmed = (await downloadNamed(lineCard, "line-trimmed.gpx")).bytes.toString("utf8");
    const kept = [...trimmed.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.-]+)"/g)].map((match) => [Number(match[1]), Number(match[2])]);
    check("every point left is more than 200 m from both ends", kept.length > 20 && kept.length < 101 - 30 && kept.every((point) => distance(point, [50, 0]) > 200 && distance(point, [50.01, 0]) > 200), `${kept.length} points kept`);
    await shot("trim-gps-track");

    // ---- Files ----------------------------------------------------------
    log("\nSanitize a HAR:");
    await open("sanitize-har");
    await drop(fixtures.har);
    const harCard = cardFor("network.har");
    await done(harCard);
    const sanitised = (await downloadNamed(harCard, "network-sanitised.har")).bytes.toString("utf8");
    const response = JSON.parse(sanitised).log.entries[0].response.content.text;
    check("no secret survives, and the rest does", !/SECRET\d/.test(sanitised) && response === '{"name":"Ada","refresh_token":"[redacted]"}', sanitised.match(/SECRET\d/)?.[0] ?? response);
    check("the request table lists it", (await downloadNamed(harCard, "network-requests.csv")).bytes.toString("utf8").includes("GET,200,application/json,20,50"));
    await shot("sanitize-har");

    log("\nInspect a certificate - a chain, then a lone certificate:");
    await open("inspect-certificate");
    await drop(fixtures.chain);
    const chainCard = cardFor("chain.pem");
    await done(chainCard);
    const chainText = await chainCard.innerText();
    check("names the leaf and its issuer", /leaf\.example\.test/.test(chainText) && /Test Root CA/.test(chainText), chainText.slice(0, 400));
    check("says the chain is in order", /issued by the one after it/.test(chainText));
    const reportText = (await downloadNamed(chainCard, "chain-report.txt")).bytes.toString("utf8");
    check("the report has both certificates and their fingerprints", (reportText.match(/SHA-256 fingerprint/g) ?? []).length === 2);
    await drop(fixtures.ec);
    const ecCard = cardFor("ec.pem");
    await done(ecCard);
    const der = await downloadNamed(ecCard, "ec.cer");
    const pemBody = readFileSync(fixtures.ec, "utf8").replace(/-----[^-]+-----|\s/g, "");
    check("the DER is the PEM's own bytes", der.bytes.equals(Buffer.from(pemBody, "base64")));
    check("reads the elliptic curve key", /ECDSA P-256/.test(await ecCard.innerText()));
    await shot("inspect-certificate");

    log("\nFind secrets:");
    await open("find-secrets");
    await drop([fixtures.config, fixtures.clean]);
    const configCard = cardFor("config.env");
    await done(configCard);
    const secretsReport = (await downloadNamed(configCard, "config-secrets.csv")).bytes.toString("utf8");
    check("finds the GitHub token and the AWS key, with their lines", /config\.env,2,14,GitHub token,high,ghp_R4/.test(secretsReport) && /config\.env,3,21,AWS access key ID,high,AKIA/.test(secretsReport), JSON.stringify(secretsReport));
    check("hides the middle of each", !secretsReport.includes("T0k3nV4lu3"));
    const cleanCard = cardFor("clean.txt");
    await cleanCard.getByText("Nothing to do", { exact: true }).waitFor({ timeout: 30_000 });
    check("a clean file is reported clean", /No secrets were found/.test(await cleanCard.innerText()));
    await shot("find-secrets");

    // ---- Images ---------------------------------------------------------
    log("\nOptimize SVG:");
    await open("optimize-svg");
    await drop(fixtures.svg);
    const svgCard = cardFor("logo.svg");
    await done(svgCard);
    const svgOut = (await downloadNamed(svgCard, "logo.min.svg")).bytes.toString("utf8");
    check("editor data, metadata and scripts are gone, numbers rounded", svgOut === '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50.123" cy="50" r="40" fill="#e00"/></svg>', JSON.stringify(svgOut));
    check("says it could run code", /could run code/.test(await svgCard.innerText()));
    await shot("optimize-svg");

    log("\nPassport photo - 35 x 45 mm on a 4 x 6 print, then on A4:");
    await open("passport-photo");
    await drop(fixtures.portrait);
    const passportCard = cardFor("portrait.png");
    await done(passportCard);
    const sheet = jpegInfo((await downloadNamed(passportCard, "portrait-passport-4x6.jpg")).bytes);
    check("the sheet is 4 x 6 in at 300 dpi, and says so", sheet?.width === 1800 && sheet?.height === 1200 && sheet?.density?.unit === 1 && sheet?.density?.x === 300, JSON.stringify(sheet));
    check("holds eight photos", /8 photos of 35 x 45 mm/.test(await passportCard.innerText()));
    const single = jpegInfo((await downloadNamed(passportCard, "portrait-passport-35x45.jpg")).bytes);
    check("the single photo is 35 x 45 mm at 300 dpi", single?.width === 413 && single?.height === 531, JSON.stringify(single));
    await openSettings(/^Photo size/);
    await page.getByRole("radio", { name: /^A4 paper/ }).click();
    await drop(fixtures.portrait);
    const a4Card = cardFor("portrait.png", 1);
    await done(a4Card);
    const a4 = await PDFDocument.load((await downloadNamed(a4Card, "portrait-passport-a4.pdf")).bytes);
    const a4Size = a4.getPage(0).getSize();
    // Thirty-two fit on A4 turned sideways against thirty upright, so it may come out landscape.
    const sides = [a4Size.width, a4Size.height].sort((a, b) => a - b);
    check("the PDF is A4", Math.abs(sides[0] - 595.3) < 1 && Math.abs(sides[1] - 841.9) < 1, `${a4Size.width} x ${a4Size.height}`);
    check("with as many photos as fit", /32 photos of 35 x 45 mm/.test(await a4Card.innerText()), (await a4Card.innerText()).match(/\d+ photos of/)?.[0] ?? "");
    await shot("passport-photo");

    log("\nPage:");
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } catch (error) {
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
