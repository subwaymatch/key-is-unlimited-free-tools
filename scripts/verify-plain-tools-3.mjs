/**
 * Browser verification of the eighth batch: Markdown, notebooks and YAML
 * converted, JWTs decoded and checked, QR codes made and read, and the
 * developer inspectors: file search, logs, protobuf, WebAssembly, git
 * bundles and fonts, the 3D model converter and repairer, PDF redaction
 * and its check, visual PDF comparison and the EPUB details editor, then
 * pictures resized to an exact size, GPS legs merged, a sprite sheet
 * packed, an animated GIF optimised and a pasted screenshot redacted.
 *
 * Builds nothing itself: run `npm run build` first. Serves the static
 * export, makes its own fixtures in Node - a README, a notebook with a
 * chart in it, Kubernetes YAML, tokens signed by Node's own crypto, and
 * QR codes drawn by the site's encoder, bundled on the fly with esbuild -
 * drives each page in Chromium, saves what comes back and reads it: HTML
 * searched, JSON and YAML parsed, and every downloaded QR code decoded
 * again from its PNG pixels.
 *
 *   npm run build && node scripts/verify-plain-tools-3.mjs
 *
 * Requires git on the PATH, for the bundle, and a Chromium Playwright can
 * find on its own, or one named in CHROMIUM_PATH.
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync, gzipSync, inflateSync } from "node:zlib";

import { buildSync } from "esbuild";
import { strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(root, ".fixtures", "plain-3");
const OUT = join(root, "out");
const PORT = 4177;

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

/* ---- Pictures ------------------------------------------------------------ */

/** A PNG of grey pixels, written by hand. */
function grayPng(width, height, gray) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
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
  header.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A PNG's pixels as luminance: 8-bit greyscale, RGB or RGBA, not interlaced, every filter undone. */
function decodePng(bytes) {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[body[9]];
      if (body[8] !== 8 || body[12] !== 0) throw new Error("Only 8-bit, non-interlaced PNGs are read here.");
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const base = index * channels;
    if (channels < 3) gray[index] = pixels[base];
    else {
      const alpha = channels === 4 ? pixels[base + 3] / 255 : 1;
      gray[index] = Math.round(((pixels[base] * 299 + pixels[base + 1] * 587 + pixels[base + 2] * 114) / 1000) * alpha + 255 * (1 - alpha));
    }
  }
  return { width, height, gray };
}

/** A TypeScript module from the site, bundled so this script can import it. */
async function importTs(relative) {
  const outfile = join(FIXTURES, `${relative.replace(/[^\w]+/g, "-")}.mjs`);
  buildSync({ entryPoints: [join(root, relative)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

/** The screenshot fixture's pixels: a diagonal gradient. */
function gradient(width, height) {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) gray[y * width + x] = 60 + ((x * 3 + y) % 150);
  return gray;
}

const b64 = (value) => Buffer.from(value).toString("base64url");

/* ---- Fixtures ------------------------------------------------------------ */

const README = `# Project Notes

Some *emphasis*, a [link](https://example.com) and \`code\`.

## Table

| Name | Qty |
|:-----|----:|
| Apples | 3 |

## Tasks

- [x] Written
- [ ] Shipped

\`\`\`js
console.log("hi");
\`\`\`

<script>alert("no")</script>
`;

// A tiny checkerboard PNG, standing in for the chart a notebook embeds.
const RED_PNG = grayPng(2, 2, new Uint8Array([0, 255, 255, 0])).toString("base64");

const NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3", language: "python" }, language_info: { name: "python" } },
  cells: [
    { cell_type: "markdown", metadata: {}, source: ["# Quarterly Analysis\n", "Figures for **Q3**."] },
    { cell_type: "code", execution_count: 1, metadata: {}, source: ["total = 40 + 2\n", "print(total)"], outputs: [{ output_type: "stream", name: "stdout", text: ["42\n"] }] },
    { cell_type: "code", execution_count: 2, metadata: {}, source: ["plot()"], outputs: [{ output_type: "display_data", metadata: {}, data: { "image/png": RED_PNG, "text/plain": ["<Figure>"] } }] },
  ],
};

const MANIFESTS = `# Two documents; anchors belong to their own document
apiVersion: v1
kind: ConfigMap
data: {mode: production}
---
x-defaults: &defaults
  replicas: 2
  image: nginx:1.27
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels: {app: web, tier: "frontend"}
spec:
  <<: *defaults
  replicas: 3
  enabled: yes
  ports:
    - 80
    - 443
  script: |
    echo one
    echo two
`;

async function ensureFixtures() {
  mkdirSync(FIXTURES, { recursive: true });
  const write = (name, content) => {
    const path = join(FIXTURES, name);
    writeFileSync(path, content);
    return path;
  };
  const { encodeQr } = await importTs("lib/qr/encode.ts");
  const draw = (codes, scale) => {
    // Codes side by side on one light picture, a quiet zone round each.
    const drawn = codes.map((code) => ({ code, side: (code.size + 8) * scale }));
    const width = drawn.reduce((sum, entry) => sum + entry.side, 0) + 40;
    const height = Math.max(...drawn.map((entry) => entry.side)) + 40;
    const gray = new Uint8Array(width * height).fill(236);
    let left = 20;
    for (const { code, side } of drawn) {
      for (let y = 0; y < code.size; y += 1) {
        for (let x = 0; x < code.size; x += 1) {
          if (!code.modules[y * code.size + x]) continue;
          for (let dy = 0; dy < scale; dy += 1) gray.fill(24, (20 + (y + 4) * scale + dy) * width + left + (x + 4) * scale, (20 + (y + 4) * scale + dy) * width + left + (x + 5) * scale);
        }
      }
      left += side;
    }
    return grayPng(width, height, gray);
  };
  const varint = (value) => {
    const out = [];
    for (; value > 127; value = Math.floor(value / 128)) out.push((value & 127) | 128);
    out.push(value);
    return out;
  };
  const field = (number, text) => [(number << 3) | 2, ...varint(Buffer.byteLength(text)), ...Buffer.from(text)];
  const person = Buffer.from([...field(1, "Ada Lovelace"), 0x10, ...varint(1815), ...field(3, "ada@example.com"), ...field(3, "countess@example.org")]);
  const repo = join(FIXTURES, "repo");
  if (!existsSync(join(FIXTURES, "project.bundle"))) {
    const git = (...args) => execFileSync("git", ["-C", repo, "-c", "user.name=Ada Lovelace", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
    mkdirSync(join(repo, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(join(repo, "README.md"), "# Engine\n");
    writeFileSync(join(repo, "src", "main.py"), 'print("hello")\n');
    git("add", "-A");
    git("commit", "-q", "-m", "First commit");
    writeFileSync(join(repo, "src", "main.py"), 'print("hello, world")\n');
    git("commit", "-q", "-am", "Greet the world");
    git("bundle", "create", join(FIXTURES, "project.bundle"), "--all");
  }
  const appLog = ["2025-10-10 13:55:36 INFO Server started on port 8080", "2025-10-10 13:55:40 ERROR Connection to 10.0.0.12:5432 refused", "2025-10-10 13:56:40 ERROR Connection to 10.0.0.13:5432 refused", "2025-10-10 13:57:00 WARN Slow query took 1200 ms", ""].join("\n");
  const accessLog = [
    '203.0.113.9 - - [10/Oct/2025:13:55:36 -0700] "GET /index.html HTTP/1.1" 200 2326 "-" "Mozilla/5.0"',
    '203.0.113.9 - - [10/Oct/2025:13:56:01 -0700] "GET /missing HTTP/1.1" 404 153 "-" "Mozilla/5.0"',
    '198.51.100.4 - - [10/Oct/2025:14:10:00 -0700] "GET /index.html HTTP/1.1" 200 2326 "-" "Googlebot/2.1"',
    "",
  ].join("\n");
  const { writeStl } = await importTs("lib/geometry/formats.ts");
  const cube = (side, drop) => {
    const positions = [];
    for (let index = 0; index < 8; index += 1) positions.push(index & 1 ? side : 0, index & 2 ? side : 0, index & 4 ? side : 0);
    const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]].slice(drop ? 1 : 0);
    return { positions: Float64Array.from(positions), triangles: Uint32Array.from(faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])), parts: [], up: "z", unit: null };
  };
  const personalPdf = async (word) => {
    const document = await PDFDocument.create();
    document.setTitle("Customer record");
    const font = await document.embedFont(StandardFonts.Helvetica);
    const first = document.addPage([400, 300]);
    first.drawText("Name: Ada Lovelace", { x: 30, y: 250, size: 12, font });
    first.drawText("Email: ada@example.com", { x: 30, y: 230, size: 12, font });
    first.drawText("SSN: 123-45-6789", { x: 30, y: 210, size: 12, font });
    first.drawRectangle({ x: 30 + font.widthOfTextAtSize("SSN: ", 12) - 1, y: 206, width: font.widthOfTextAtSize("123-45-6789", 12) + 2, height: 16, color: rgb(0, 0, 0) });
    const second = document.addPage([400, 300]);
    second.drawText(`The weather is ${word}.`, { x: 30, y: 250, size: 12, font });
    return document.save();
  };
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf = '<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="id">urn:uuid:1</dc:identifier>\n    <dc:title>Draft</dc:title>\n    <dc:creator>Unknown</dc:creator>\n    <dc:language>en</dc:language>\n  </metadata>\n  <manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest>\n  <spine><itemref idref="c1"/></spine>\n</package>\n';
  // Two legs of a ride, the later one first in the list.
  const leg = (name, start, lat) => `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${[0, 1, 2].map((step) => `<trkpt lat="${lat + step * 0.001}" lon="-0.1"><time>${new Date(Date.UTC(2025, 5, 1, start, step * 5)).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
  // A gradient behind a square that moves: every frame written whole, as screen recorders write them.
  const { lzwEncode } = await importTs("lib/images/gif.ts");
  const gifFrames = [];
  const [gw, gh] = [120, 80];
  for (let frame = 0; frame < 16; frame += 1) {
    const indices = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y += 1) for (let x = 0; x < gw; x += 1) indices[y * gw + x] = Math.floor((x / gw) * 60);
    for (let y = 30; y < 50; y += 1) for (let x = 5 + frame * 6; x < 25 + frame * 6; x += 1) indices[y * gw + x] = 63;
    gifFrames.push(indices);
  }
  const palette = [];
  for (let index = 0; index < 64; index += 1) palette.push(index === 63 ? [220, 40, 40] : [index * 4, 120, 255 - index * 4]);
  const gif = [...Buffer.from("GIF89a"), gw, 0, gh, 0, 0xf5, 0, 0, ...palette.flat(), 0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0];
  for (const indices of gifFrames) gif.push(0x21, 0xf9, 4, 0, 5, 0, 0, 0, 0x2c, 0, 0, 0, 0, gw, 0, gh, 0, 0, 6, ...lzwEncode(indices, 6));
  gif.push(0x3b);
  const halves = new Uint8Array(300 * 200);
  for (let y = 0; y < 200; y += 1) for (let x = 0; x < 300; x += 1) halves[y * 300 + x] = x < 150 ? 40 : 200;
  return {
    wide: write("wide.png", grayPng(300, 200, halves)),
    screenshot: write("screen.png", grayPng(200, 120, gradient(200, 120))),
    animation: write("recording.gif", Buffer.from(gif)),
    sprites: [write("icon-a.png", grayPng(32, 32, new Uint8Array(32 * 32).fill(30))), write("icon-b.png", grayPng(64, 16, new Uint8Array(64 * 16).fill(120))), write("icon-c.png", grayPng(16, 48, new Uint8Array(16 * 48).fill(220)))],
    legLate: write("afternoon.gpx", leg("Afternoon", 14, 51.6)),
    legEarly: write("morning.gpx", leg("Morning", 9, 51.5)),
    personal: write("record.pdf", await personalPdf("fine")),
    personalChanged: write("record-v2.pdf", await personalPdf("stormy")),
    book: write("draft.epub", Buffer.from(zipSync({ mimetype: [strToU8("application/epub+zip"), { level: 0 }], "META-INF/container.xml": strToU8(container), "OEBPS/content.opf": strToU8(opf), "OEBPS/one.xhtml": strToU8("<html><body><p>One.</p></body></html>") }))),
    cubeStl: write("cube.stl", writeStl(cube(20, false))),
    openStl: write("open-box.stl", writeStl(cube(20, true))),
    notesA: write("notes-a.txt", "shopping\nTODO: buy milk\neggs\n"),
    notesB: write("app.js", "const a = 1;\n// todo later\nfunction run() {}\n// TODO: tests\n"),
    zipped: write("more.zip", Buffer.from(zipSync({ "docs/plan.md": strToU8("# Plan\n\n- TODO: write the plan\n") }))),
    appLog: write("app.log.gz", gzipSync(appLog)),
    accessLog: write("access.log", accessLog),
    person: write("person.bin", person),
    personProto: write("person.proto", 'syntax = "proto3";\nmessage Person {\n  string name = 1;\n  int32 born = 2;\n  repeated string emails = 3;\n}\n'),
    wasm: join(root, "node_modules", "pdfjs-dist", "wasm", "qcms_bg.wasm"),
    bundle: join(FIXTURES, "project.bundle"),
    font: join(root, "public", "fonts", "DejaVuSans.ttf"),
    readme: write("README.md", README),
    notebook: write("analysis.ipynb", JSON.stringify(NOTEBOOK)),
    yaml: write("deploy.yaml", MANIFESTS),
    json: write("config.json", JSON.stringify({ name: "site", ports: [80, 443], debug: false, note: "yes", nested: { list: [{ a: 1 }, { b: "two\nlines" }] } })),
    twoCodes: write("two-codes.png", draw([encodeQr("https://key.is/read-qr-code", { level: "M" }), encodeQr("WIFI:T:WPA;S:Office;P:correct horse;;", { level: "Q" })], 6)),
  };
}

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
  const { parseYaml } = await importTs("lib/data/yaml.ts");
  const { readQrCodes } = await importTs("lib/qr/detect.ts");
  const { readModel } = await importTs("lib/geometry/formats.ts");
  const { analyzeMesh } = await importTs("lib/geometry/mesh.ts");
  const { readEpubInfo } = await importTs("lib/documents/epubMetadata.ts");
  const { readGeo } = await importTs("lib/geo/gps.ts");
  const { decodeGif } = await importTs("lib/images/gif.ts");
  const pdfPages = async (bytes) => {
    const pdf = await getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, disableFontFace: true, verbosity: 0 }).promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) pages.push((await (await pdf.getPage(number)).getTextContent()).items.map((item) => item.str ?? "").join(" "));
    const { info } = await pdf.getMetadata();
    return { pages, info };
  };
  const readPng = (bytes) => {
    const { width, height, gray } = decodePng(bytes);
    return readQrCodes(gray, width, height).map((code) => code.text);
  };
  if (!existsSync(join(OUT, "index.html"))) fail("out/index.html missing - run `npm run build` first.");

  const server = await startServer();
  log(`Serving ${OUT} on http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const downloadDir = join(tmpdir(), `plain-tools-3-verify-${Date.now()}`);
  mkdirSync(downloadDir, { recursive: true });
  const context = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`${message.text()} ${message.location()?.url ?? ""}`.trim());
  });
  page.on("requestfailed", (request) => log(`  (request failed: ${request.url()} on ${page.url()})`));

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
    for (const slug of ["markdown-to-html", "notebook-to-html", "yaml-to-json", "decode-jwt", "create-qr-code", "read-qr-code", "search-files", "analyze-log", "decode-protobuf", "inspect-wasm", "inspect-git-bundle", "inspect-font", "convert-3d-model", "repair-3d-model", "redact-pdf", "check-pdf-redaction", "compare-pdfs-visually", "edit-epub-metadata", "merge-gps", "create-sprite-sheet", "optimize-gif", "redact-image"]) check(`index links to /${slug}`, links.includes(`/${slug}`));

    // ---- Markdown --------------------------------------------------------
    log("\nMarkdown to HTML - a README as a page, then with a table of contents:");
    await open("markdown-to-html");
    await drop([fixtures.readme]);
    const mdCard = cardFor("README.md");
    await done(mdCard);
    const page1 = (await downloadNamed(mdCard, "README.html")).bytes.toString("utf8");
    check("a whole page titled by its first heading", page1.startsWith("<!doctype html>") && page1.includes("<title>Project Notes</title>"));
    check("headings with GitHub's anchors", page1.includes('<h2 id="table">Table</h2>') && page1.includes('<h2 id="tasks">Tasks</h2>'));
    check("the table aligned, the task list ticked, the code fenced", page1.includes('<th style="text-align:right">Qty</th>') && page1.includes("<input type=\"checkbox\" disabled checked>") && page1.includes('<code class="language-js">'));
    check("the script is gone", !/<script/i.test(page1));
    await openSettings(/^Output/);
    await page.getByRole("checkbox", { name: /^Table of contents/ }).click();
    await drop([fixtures.readme]);
    const tocCard = cardFor("README.md", 1);
    await done(tocCard);
    const page2 = (await downloadNamed(tocCard, "README.html")).bytes.toString("utf8");
    check("the table of contents links the headings", page2.includes('<nav class="toc"><ul><li><a href="#project-notes">Project Notes</a><ul><li><a href="#table">Table</a></li>'));
    await shot("markdown-to-html");

    // ---- Notebook --------------------------------------------------------
    log("\nNotebook to HTML - code, output and a chart, then results only:");
    await open("notebook-to-html");
    await drop([fixtures.notebook]);
    const nbCard = cardFor("analysis.ipynb");
    await done(nbCard);
    const nbPage = (await downloadNamed(nbCard, "analysis.html")).bytes.toString("utf8");
    check("titled by its heading", nbPage.includes("<title>Quarterly Analysis</title>"));
    check("the code and its printed output", nbPage.includes("total = 40 + 2") && nbPage.includes('<pre class="stdout">42\n</pre>'));
    check("the chart embedded", nbPage.includes(`<img src="data:image/png;base64,${RED_PNG}"`));
    check("the card counts the cells and pictures", /Cells\s*2 code, 1 text/.test(await nbCard.innerText()) && /1 of them a picture/.test(await nbCard.innerText()), (await nbCard.innerText()).replace(/\s+/g, " ").slice(0, 160));
    await openSettings(/^What to show/);
    await page.getByRole("checkbox", { name: /^Show the code/ }).click();
    await drop([fixtures.notebook]);
    const reportCard = cardFor("analysis.ipynb", 1);
    await done(reportCard);
    const report = (await downloadNamed(reportCard, "analysis.html")).bytes.toString("utf8");
    check("results only: no code, output kept", !report.includes("total = 40 + 2") && report.includes("42"));
    await shot("notebook-to-html");

    // ---- YAML ------------------------------------------------------------
    log("\nYAML to JSON - two documents with an anchor and a merge key; JSON back to YAML:");
    await open("yaml-to-json");
    await drop([fixtures.yaml]);
    const yamlCard = cardFor("deploy.yaml");
    await done(yamlCard);
    const documents = JSON.parse((await downloadNamed(yamlCard, "deploy.json")).bytes.toString("utf8"));
    check("two documents as an array", Array.isArray(documents) && documents.length === 2);
    check("the merge key expanded, the local value winning", documents[1]?.spec?.image === "nginx:1.27" && documents[1]?.spec?.replicas === 3);
    check("yes stays a string, flow mappings and block scalars read", documents[1]?.spec?.enabled === "yes" && documents[1]?.metadata?.labels?.tier === "frontend" && documents[1]?.spec?.script === "echo one\necho two\n");
    check("the card says comments are dropped", /Comments are not part of YAML/.test(await yamlCard.innerText()));
    await drop([fixtures.json]);
    const jsonCard = cardFor("config.json");
    await done(jsonCard);
    const yamlText = (await downloadNamed(jsonCard, "config.yaml")).bytes.toString("utf8");
    const roundTrip = parseYaml(yamlText)[0];
    check("the YAML reads back as the same data", JSON.stringify(roundTrip) === readFileSync(fixtures.json, "utf8"), yamlText.split("\n").slice(0, 3).join(" | "));
    check('"yes" is quoted so no YAML 1.1 reader takes it for true', yamlText.includes("note: \"yes\""));
    await shot("yaml-to-json");

    // ---- JWT -------------------------------------------------------------
    log("\nDecode a JWT - the example, an RS256 token and its key, a wrong key, and nonsense:");
    await open("decode-jwt");
    await page.getByRole("button", { name: "Try an example" }).click();
    await page.getByText("Verified", { exact: true }).waitFor({ timeout: 10_000 });
    check("the example is in date and verified", (await page.getByText("In date", { exact: true }).count()) === 1);
    check("claims are named", (await page.locator("dt", { hasText: "Issuer" }).count()) === 1 && (await page.getByText("Ada Lovelace").count()) === 1);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }))}.${b64(JSON.stringify({ sub: "42", exp: now - 3600, iat: now - 7200 }))}`;
    const token = `${input}.${b64(sign("sha256", Buffer.from(input), rsa.privateKey))}`;
    await page.getByLabel("Token").fill(`Bearer ${token}`);
    await page.getByText("Needs a key", { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByText("Expired", { exact: true }).waitFor({ timeout: 10_000 });
    const expiry = await page.getByText(/^Expired .* ago\.$/).innerText();
    check("an expired token says so", expiry === "Expired 1 hour ago.", expiry);
    await page.getByLabel("Public key").fill(rsa.publicKey.export({ type: "spki", format: "pem" }).toString());
    await page.getByText("Verified", { exact: true }).waitFor({ timeout: 10_000 });
    check("verified against the PEM public key", true);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await page.getByLabel("Public key").fill(JSON.stringify({ keys: [{ ...other.publicKey.export({ format: "jwk" }), kid: "k1" }] }));
    await page.getByText("Does not match", { exact: true }).waitFor({ timeout: 10_000 });
    check("refused against another key from a JWK set", true);
    await page.getByLabel("Token").fill("not-a-token");
    check("nonsense is explained", (await page.locator("main").getByRole("alert").innerText()).includes("This has 1 part, not three."));
    await shot("decode-jwt");

    // ---- QR create -------------------------------------------------------
    log("\nQR code generator - a link as PNG and SVG, a Wi-Fi network, and three at once:");
    await open("create-qr-code");
    await page.getByRole("textbox", { name: "Link or text" }).fill("https://key.is/create-qr-code");
    await page.getByRole("img", { name: /^QR code for/ }).waitFor({ timeout: 10_000 });
    const qrPng = await download(page.getByRole("button", { name: "PNG" }));
    check("the PNG decodes to the link", JSON.stringify(readPng(qrPng.bytes)) === JSON.stringify(["https://key.is/create-qr-code"]), qrPng.name);
    const png = decodePng(qrPng.bytes);
    check("at the size asked, whole pixels to a module", png.width === png.height && png.width <= 1024 && png.width > 900, `${png.width} px`);
    const qrSvg = (await download(page.getByRole("button", { name: "SVG" }))).bytes.toString("utf8");
    check("the SVG is one path", qrSvg.startsWith("<svg") && (qrSvg.match(/<path /g) ?? []).length === 1);
    await page.getByRole("radio", { name: /^A Wi-Fi network/ }).click();
    await page.getByRole("textbox", { name: "Network name" }).fill("Cafe;Main");
    await page.getByRole("textbox", { name: "Password" }).fill("latte art");
    const wifi = await download(page.getByRole("button", { name: "PNG" }));
    check("the Wi-Fi code holds the joining text, escaped", JSON.stringify(readPng(wifi.bytes)) === JSON.stringify(["WIFI:T:WPA;S:Cafe\\;Main;P:latte art;;"]));
    await page.getByRole("radio", { name: /^One code per line/ }).click();
    await page.getByRole("textbox", { name: "One code per line" }).fill("https://example.com/table/1\nhttps://example.com/table/2\n\nhttps://example.com/table/3");
    const zip = await download(page.getByRole("button", { name: /^Download 3 codes/ }));
    const entries = unzipSync(new Uint8Array(zip.bytes));
    const names = Object.keys(entries).sort();
    check("three files, named after what they say", JSON.stringify(names) === JSON.stringify(["1-example-com-table-1.png", "2-example-com-table-2.png", "3-example-com-table-3.png"]), names.join(", "));
    check("each decodes to its line", names.every((name, index) => readPng(Buffer.from(entries[name]))[0] === `https://example.com/table/${index + 1}`));
    await shot("create-qr-code");

    // ---- QR read ---------------------------------------------------------
    log("\nRead a QR code - a link and a Wi-Fi network in one picture:");
    await open("read-qr-code");
    await drop([fixtures.twoCodes]);
    const readCard = cardFor("two-codes.png");
    await done(readCard);
    const readText = await readCard.innerText();
    check("both codes found", /Codes found\s*2/.test(readText.replace(/:/g, "")) || readText.includes("Codes found"), readText.slice(0, 200));
    check("the link and where it opens", readText.includes("https://key.is/read-qr-code") && readText.includes("key.is"));
    check("the Wi-Fi network spelled out", readText.includes("Office") && readText.includes("correct horse"));
    const all = (await downloadNamed(readCard, "two-codes-qr-codes.txt")).bytes.toString("utf8");
    check("all codes as one file", all.split("\n").filter(Boolean).length === 2);
    await shot("read-qr-code");

    // ---- Search ----------------------------------------------------------
    log("\nSearch in files - TODO across two files and a ZIP, then as whole words with case:");
    await open("search-files");
    await page.getByLabel("Text or pattern").fill("TODO");
    await drop([fixtures.notesA, fixtures.notesB, fixtures.zipped]);
    await page.getByRole("button", { name: "Search the files" }).click();
    const grep = (await download(page.getByRole("link", { name: "Download search-results.txt" }))).bytes.toString("utf8");
    check("every match, file:line:text, the ZIP's file included", grep.includes("notes-a.txt:2:TODO: buy milk") && grep.includes("app.js:2:// todo later") && grep.includes("more.zip/docs/plan.md:3:- TODO: write the plan"), grep.split("\n").slice(0, 4).join(" | "));
    check("context lines with dashes", grep.includes("notes-a.txt-1-shopping"));
    const table = (await download(page.getByRole("link", { name: "Download search-results.csv" }))).bytes.toString("utf8");
    check("the CSV has a row per matching line", table.trim().split("\n").length === 5, `${table.trim().split("\n").length - 1} rows`);
    check("the summary counts them", (await page.locator("main").innerText()).includes("Searched 3 text files. Found 4 matches on 4 lines in 3 files."));
    await shot("search-files");

    // ---- Logs ------------------------------------------------------------
    log("\nAnalyze a log file - a gzipped app log and an access log:");
    await open("analyze-log");
    await drop([fixtures.appLog, fixtures.accessLog]);
    const appCard = cardFor("app.log.gz");
    await done(appCard);
    const appText = await appCard.innerText();
    check("the gzipped log is unpacked and its levels counted", /2 error/.test(appText) && /1 warn/.test(appText), appText.replace(/\s+/g, " ").slice(0, 200));
    check("repeated errors grouped", /The most frequent error, 2 times/.test(appText));
    const accessCard = cardFor("access.log");
    await done(accessCard);
    const accessReport = (await downloadNamed(accessCard, "access-report.md")).bytes.toString("utf8");
    check("the access log's statuses, 404s and bots", accessReport.includes("| 404 | 1 |") && accessReport.includes("### Not found (404)") && accessReport.includes("From bots and scripts: 1"));
    await shot("analyze-log");

    // ---- Protobuf --------------------------------------------------------
    log("\nDecode protobuf - raw, then with its .proto:");
    await open("decode-protobuf");
    await drop([fixtures.person]);
    const rawCard = cardFor("person.bin");
    await done(rawCard);
    const rawText = (await downloadNamed(rawCard, "person-raw.txt")).bytes.toString("utf8");
    check("fields by number, as protoc --decode_raw prints them", rawText === '1: "Ada Lovelace"\n2: 1815\n3: "ada@example.com"\n3: "countess@example.org"\n', JSON.stringify(rawText));
    await openSettings(/^\.proto file/);
    await page.locator("#proto-file").setInputFiles(fixtures.personProto);
    await page.getByText("person.proto").first().waitFor();
    await drop([fixtures.person]);
    const namedCard = cardFor("person.bin", 1);
    await done(namedCard);
    const named = JSON.parse((await downloadNamed(namedCard, "person.json")).bytes.toString("utf8"));
    check("with names from the .proto", JSON.stringify(named) === JSON.stringify({ name: "Ada Lovelace", born: 1815, emails: ["ada@example.com", "countess@example.org"] }), JSON.stringify(named));
    await shot("decode-protobuf");

    // ---- WebAssembly -----------------------------------------------------
    log("\nInspect WebAssembly - PDF.js's colour module:");
    await open("inspect-wasm");
    await drop([fixtures.wasm]);
    const wasmCard = cardFor("qcms_bg.wasm");
    await done(wasmCard);
    const wasmText = await wasmCard.innerText();
    check("built with Rust and wasm-bindgen, exports named", wasmText.includes("Rust, with wasm-bindgen") && wasmText.includes("qcms_convert_array"));
    const wasmReport = (await downloadNamed(wasmCard, "qcms_bg-wasm-report.md")).bytes.toString("utf8");
    check("the engine accepts it, and the sections are listed", wasmReport.includes("- Valid: yes") && wasmReport.includes("| code |"));
    await shot("inspect-wasm");

    // ---- Git bundle ------------------------------------------------------
    log("\nOpen a git bundle - two commits, and the files at the tip:");
    await open("inspect-git-bundle");
    await drop([fixtures.bundle]);
    const bundleCard = cardFor("project.bundle");
    await done(bundleCard);
    const bundleText = await bundleCard.innerText();
    check("refs and commits", bundleText.includes("main") && /2 commits/.test(bundleText), bundleText.replace(/\s+/g, " ").slice(0, 200));
    const tipZip = await download(bundleCard.getByRole("link", { name: /^Download project-[0-9a-f]{7}\.zip$/ }));
    const tipFiles = unzipSync(new Uint8Array(tipZip.bytes));
    check("the tip's files, as git has them", Object.keys(tipFiles).sort().join(",") === "README.md,src/main.py" && Buffer.from(tipFiles["src/main.py"]).toString() === 'print("hello, world")\n');
    const commitsCsv = (await downloadNamed(bundleCard, "project-commits.csv")).bytes.toString("utf8");
    const headId = execFileSync("git", ["-C", join(FIXTURES, "repo"), "rev-parse", "HEAD"]).toString().trim();
    check("commit ids match git's", commitsCsv.split("\n")[1].startsWith(headId));
    await shot("inspect-git-bundle");

    // ---- Font ------------------------------------------------------------
    log("\nInspect a font - DejaVu Sans:");
    await open("inspect-font");
    await drop([fixtures.font]);
    const fontCard = cardFor("DejaVuSans.ttf");
    await done(fontCard);
    const fontText = await fontCard.innerText();
    check("names, glyphs and languages", fontText.includes("DejaVu Sans") && fontText.includes("6,253") && fontText.includes("Russian") && fontText.includes("Greek"), fontText.replace(/\s+/g, " ").slice(0, 240));
    const specimen = decodePng((await downloadNamed(fontCard, "DejaVuSans-specimen.png")).bytes);
    check("a specimen drawn in the font", specimen.width === 1200 && specimen.height > 400, `${specimen.width} x ${specimen.height}`);
    const characters = (await downloadNamed(fontCard, "DejaVuSans-characters.txt")).bytes.toString("utf8");
    check("every character listed by block", characters.startsWith("Basic Latin (94)"));
    await shot("inspect-font");

    // ---- 3D --------------------------------------------------------------
    log("\nConvert a 3D model - an STL cube to 3MF and to glTF:");
    await open("convert-3d-model");
    await drop([fixtures.cubeStl]);
    const toMf = cardFor("cube.stl");
    await done(toMf);
    const mf = analyzeMesh(readModel(new Uint8Array((await downloadNamed(toMf, "cube.3mf")).bytes), "cube.3mf").mesh);
    check("the 3MF is the same watertight 8000 mm3 cube", mf.watertight && Math.abs(mf.volume - 8000) < 1e-6 && mf.vertices === 8, JSON.stringify({ volume: mf.volume, vertices: mf.vertices }));
    check("with a preview", (await toMf.innerText()).includes("Preview"));
    await openSettings(/^Format & size/);
    await page.getByRole("radio", { name: /^glTF/ }).click();
    await drop([fixtures.cubeStl]);
    const toGlb = cardFor("cube.stl", 1);
    await done(toGlb);
    const glb = readModel(new Uint8Array((await downloadNamed(toGlb, "cube.glb")).bytes), "cube.glb").mesh;
    check("the glTF is Y-up, turned to stay upright", glb.up === "y" && Math.abs(analyzeMesh(glb).volume - 8000) < 1e-6 && /turned a quarter/.test(await toGlb.innerText()));
    await shot("convert-3d-model");

    log("\nCheck and repair a 3D model - a sound cube, then a box with its bottom missing:");
    await open("repair-3d-model");
    await drop([fixtures.cubeStl]);
    const sound = cardFor("cube.stl");
    await done(sound);
    const soundText = await sound.innerText();
    check("a sound cube is watertight, 8 cm3, about 10 g of PLA", /Watertight\s*yes/.test(soundText) && soundText.includes("8.00 cm3") && soundText.includes("about 10 g of PLA") && soundText.includes("Nothing to repair"), soundText.replace(/\s+/g, " ").slice(0, 240));
    await drop([fixtures.openStl]);
    const open_ = cardFor("open-box.stl");
    await done(open_);
    check("the open box's hole is found", /1 hole \(4 open edges\)/.test(await open_.innerText()));
    const fixed = analyzeMesh(readModel(new Uint8Array((await downloadNamed(open_, "open-box-repaired.stl")).bytes), "fixed.stl").mesh);
    check("and filled: the repaired box is watertight and 8000 mm3", fixed.watertight && Math.abs(fixed.volume - 8000) < 1e-3, JSON.stringify({ watertight: fixed.watertight, volume: fixed.volume }));
    await shot("repair-3d-model");

    // ---- Redaction ---------------------------------------------------------
    log("\nRedact a PDF - a name typed, and e-mails and ID numbers by their shape:");
    await open("redact-pdf");
    await page.getByLabel("Words and names to remove").fill("Ada Lovelace");
    await drop([fixtures.personal]);
    const redactCard = cardFor("record.pdf");
    await done(redactCard);
    const redactedFile = await downloadNamed(redactCard, "record-redacted.pdf");
    const redacted = await pdfPages(redactedFile.bytes);
    check("the page with personal details has no text left at all", redacted.pages[0].trim() === "", JSON.stringify(redacted.pages[0]));
    check("the other page is untouched, text and all", redacted.pages[1].includes("weather"));
    check("the document's title is gone", redacted.info.Title === undefined);
    check("the card says what was removed", /1 e-mail addresses/.test(await redactCard.innerText()) && /1 typed words/.test(await redactCard.innerText()), (await redactCard.innerText()).replace(/\s+/g, " ").slice(0, 200));
    await shot("redact-pdf");

    log("\nCheck a PDF's redaction - a box drawn over text, then a real redaction:");
    await open("check-pdf-redaction");
    await drop([fixtures.personal, redactedFile.path]);
    const badCard = cardFor("record.pdf");
    await done(badCard);
    const badText = await badCard.innerText();
    check("the box over the ID number hides nothing", badText.includes("123-45-6789") && /does not work/.test(badText));
    const goodCard = cardFor("record-redacted.pdf");
    await done(goodCard);
    check("the real redaction passes", /no black boxes or redaction marks|no text underneath/.test(await goodCard.innerText()) && !(await goodCard.innerText()).includes("123-45-6789"));
    await shot("check-pdf-redaction");

    log("\nCompare PDFs visually - one word changed on page 2:");
    await open("compare-pdfs-visually");
    await drop([fixtures.personal, fixtures.personalChanged]);
    await page.getByRole("button", { name: "Compare the two PDFs" }).click();
    const comparison = await download(page.getByRole("link", { name: "Download record-vs-record-v2.pdf" }));
    const comparisonPdf = await PDFDocument.load(comparison.bytes);
    check("one changed page in the comparison", comparisonPdf.getPageCount() === 1);
    check("named as page 2", (await page.locator("main").innerText()).includes("changed: page 2."));
    await shot("compare-pdfs-visually");

    // ---- EPUB --------------------------------------------------------------
    log("\nEdit EPUB details - title, authors and series:");
    await open("edit-epub-metadata");
    await page.locator('input[type="file"]').first().setInputFiles(fixtures.book);
    await page.getByLabel("Title").fill("The Finished Book");
    await page.getByLabel(/^Authors/).fill("Ada Lovelace\nCharles Babbage");
    await page.getByLabel("Series", { exact: true }).fill("Engines");
    await page.getByLabel("Number in the series").fill("2");
    const epub = await download(page.getByRole("button", { name: "Save the EPUB" }));
    const epubInfo = readEpubInfo(unzipSync(new Uint8Array(epub.bytes)));
    check("the saved book has the new details", epubInfo.metadata.title === "The Finished Book" && epubInfo.metadata.authors.join("|") === "Ada Lovelace|Charles Babbage" && epubInfo.metadata.series === "Engines" && epubInfo.metadata.seriesIndex === "2", JSON.stringify(epubInfo.metadata));
    check("mimetype first and stored", epub.bytes.toString("latin1", 30, 38) === "mimetype" && epub.bytes.readUInt16LE(8) === 0);
    await shot("edit-epub-metadata");

    // ---- Pictures and GPS ----------------------------------------------------
    log("\nResize a picture to an exact size - 300 x 200 cropped to fill 100 x 100:");
    await open("resize-image");
    await openSettings(/^Size & format/);
    await page.getByRole("radio", { name: /^Exact size/ }).click();
    await page.getByRole("spinbutton", { name: "Width" }).fill("100");
    await page.getByRole("spinbutton", { name: "Height" }).fill("100");
    await page.getByRole("radio", { name: /^Crop to fill/ }).click();
    await drop([fixtures.wide]);
    const resizeCard = cardFor("wide.png");
    await done(resizeCard);
    const exact = decodePng((await downloadNamed(resizeCard, "wide-100x100.png")).bytes);
    check("exactly 100 x 100", exact.width === 100 && exact.height === 100, `${exact.width} x ${exact.height}`);
    check("cropped from the middle: dark on the left, light on the right", exact.gray[50 * 100 + 10] < 80 && exact.gray[50 * 100 + 90] > 160, `${exact.gray[50 * 100 + 10]} / ${exact.gray[50 * 100 + 90]}`);
    await shot("resize-image-exact");

    log("\nMerge GPS tracks - an afternoon leg and a morning leg, added in the wrong order:");
    await open("merge-gps");
    await drop([fixtures.legLate, fixtures.legEarly]);
    await page.getByRole("button", { name: "Merge the files" }).click();
    const merged = readGeo((await download(page.getByRole("link", { name: "Download afternoon-merged.gpx" }))).bytes.toString("utf8"), "merged.gpx").data;
    check("one track, each leg a segment of its own", merged.tracks.length === 1 && merged.tracks[0].segments.length === 2 && merged.tracks[0].segments.every((segment) => segment.length === 3), JSON.stringify(merged.tracks.map((track) => track.segments.map((segment) => segment.length))));
    check("in time order: the morning first", merged.tracks[0].segments[0][0].time.startsWith("2025-06-01T09:00"), merged.tracks[0].segments[0][0].time);
    check("the card says the legs were put in time order", (await page.locator("main").innerText()).includes("The legs are in time order"));
    await shot("merge-gps");

    log("\nCreate a sprite sheet - three icons of different sizes:");
    await open("create-sprite-sheet");
    await drop(fixtures.sprites);
    await page.getByRole("button", { name: "Make the sprite sheet" }).click();
    const sheet = decodePng((await download(page.getByRole("link", { name: "Download spritesheet.png" }))).bytes);
    const sheetJson = JSON.parse((await download(page.getByRole("link", { name: "Download spritesheet.json" }))).bytes.toString("utf8"));
    const css = (await download(page.getByRole("link", { name: "Download spritesheet.css" }))).bytes.toString("utf8");
    check("the JSON's size is the sheet's", sheetJson.meta.size.w === sheet.width && sheetJson.meta.size.h === sheet.height, `${sheet.width} x ${sheet.height}`);
    const placed = ["icon-a.png", "icon-b.png", "icon-c.png"].map((name, index) => {
      const { frame } = sheetJson.frames[name];
      return Math.abs(sheet.gray[(frame.y + (frame.h >> 1)) * sheet.width + frame.x + (frame.w >> 1)] - [30, 120, 220][index]) <= 1;
    });
    check("each icon is where the JSON says", placed.every(Boolean), JSON.stringify(sheetJson.frames));
    check("a CSS class for each", css.includes(".sprite-icon-a") && css.includes(".sprite-icon-c") && css.includes("background-position"));
    await shot("create-sprite-sheet");

    log("\nOptimize a GIF - a recording written whole, frame after frame:");
    await open("optimize-gif");
    await drop([fixtures.animation]);
    const gifCard = cardFor("recording.gif");
    await done(gifCard);
    const optimized = await downloadNamed(gifCard, "recording-optimized.gif");
    const before = decodeGif(new Uint8Array(readFileSync(fixtures.animation)));
    const after = decodeGif(new Uint8Array(optimized.bytes));
    check("smaller", optimized.bytes.length < readFileSync(fixtures.animation).length * 0.6, `${readFileSync(fixtures.animation).length} -> ${optimized.bytes.length}`);
    check("every frame and delay exactly the same", after.frames.length === before.frames.length && after.frames.every((frame, index) => Buffer.from(frame.pixels).equals(Buffer.from(before.frames[index].pixels)) && frame.delay === before.frames[index].delay));
    const shown = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/gif;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
    }, optimized.bytes.toString("base64"));
    check("Chromium draws its first frame pixel for pixel", Buffer.from(shown).equals(Buffer.from(before.frames[0].pixels)));
    await shot("optimize-gif");

    log("\nRedact a screenshot - pasted, a box dragged over it, black and then pixelated:");
    await open("redact-image");
    await page.evaluate((base64) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], "image.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
    }, readFileSync(fixtures.screenshot).toString("base64"));
    const stage = page.getByRole("application", { name: /drag to cover/ });
    await stage.waitFor();
    const bounds = await stage.boundingBox();
    const at = (x, y) => [bounds.x + (x / 200) * bounds.width, bounds.y + (y / 120) * bounds.height];
    await page.mouse.move(...at(40, 30));
    await page.mouse.down();
    await page.mouse.move(...at(100, 60), { steps: 6 });
    await page.mouse.move(...at(140, 90), { steps: 6 });
    await page.mouse.up();
    const source = gradient(200, 120);
    const inBox = (x, y) => x >= 42 && x < 138 && y >= 32 && y < 88;
    const outside = (x, y) => x < 38 || x >= 142 || y < 28 || y >= 92;
    const blacked = decodePng((await download(page.getByRole("button", { name: "Save the picture" }))).bytes);
    let black = true;
    let untouched = true;
    for (let y = 0; y < 120; y += 1) {
      for (let x = 0; x < 200; x += 1) {
        if (inBox(x, y) && blacked.gray[y * 200 + x] !== 0) black = false;
        if (outside(x, y) && blacked.gray[y * 200 + x] !== source[y * 200 + x]) untouched = false;
      }
    }
    check("the saved picture is black under the box", black && blacked.width === 200 && blacked.height === 120);
    check("and untouched outside it", untouched);
    await page.mouse.click(...at(90, 60));
    await page.getByRole("radio", { name: /^Pixelate/ }).click();
    const pixelated = decodePng((await download(page.getByRole("button", { name: "Save the picture" }))).bytes);
    const blockValues = new Set();
    let pixelOutside = true;
    for (let y = 0; y < 120; y += 1) {
      for (let x = 0; x < 200; x += 1) {
        if (inBox(x, y)) blockValues.add(pixelated.gray[y * 200 + x]);
        if (outside(x, y) && pixelated.gray[y * 200 + x] !== source[y * 200 + x]) pixelOutside = false;
      }
    }
    check("picked and changed to pixelated: a few flat blocks, not the gradient", blockValues.size > 1 && blockValues.size <= 20 && !blockValues.has(0), `${blockValues.size} values`);
    check("still untouched outside", pixelOutside);
    await shot("redact-image");

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
