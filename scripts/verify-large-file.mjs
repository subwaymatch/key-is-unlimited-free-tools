/**
 * Verifies the claim the whole project rests on: that a video larger than
 * WebAssembly's ~2 GB heap can be processed anyway.
 *
 * The fixture is deliberately built from raw (uncompressed) video so it crosses
 * the limit in seconds of wall clock rather than hours of encoding. Its audio
 * track is ordinary AAC. If the input were being copied into the core's
 * in-memory filesystem, this file could not even be opened; because it is
 * mounted through WORKERFS and read on demand, only the small audio output
 * lands in memory.
 *
 * Browser memory is sampled throughout, since "it worked but used 3 GB of RAM"
 * would not actually be a solution.
 *
 *   node scripts/verify-large-file.mjs
 *
 * Separate from verify-e2e.mjs because it needs several GB of free disk and
 * takes minutes rather than seconds. Same requirements: ffmpeg/ffprobe on PATH
 * and a Chromium Playwright can find, or one named in CHROMIUM_PATH.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(root, ".fixtures/huge.mkv");
const OUT = join(root, "out");
const CORE_DIST = join(root, "node_modules/@ffmpeg/core/dist/esm");
const PORT = 4175;
const TIMEOUT_MS = 15 * 60 * 1000;

/** Seconds of raw 1080p video needed to comfortably exceed the 2 GB ceiling. */
const FIXTURE_SECONDS = 42;
const WASM_HEAP_LIMIT = 2 * 1024 ** 3;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const mib = (bytes) => `${(bytes / 1024 ** 2).toFixed(0)} MiB`;

function ensureFixture() {
  if (existsSync(FIXTURE) && statSync(FIXTURE).size > WASM_HEAP_LIMIT) return;
  mkdirSync(dirname(FIXTURE), { recursive: true });
  console.log(`Generating a >${gib(WASM_HEAP_LIMIT)} fixture (raw video, AAC audio)…`);
  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=25",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", String(FIXTURE_SECONDS),
    "-c:v", "rawvideo", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    FIXTURE,
  ]);
}

function startServer() {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, `http://localhost:${PORT}`).pathname);
    let filePath = path.startsWith("/core/")
      ? join(CORE_DIST, path.slice("/core/".length))
      : join(OUT, path);
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath)) filePath = join(OUT, "index.html");
    response.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": statSync(filePath).size,
    });
    createReadStream(filePath).pipe(response);
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

async function main() {
  ensureFixture();
  const inputBytes = statSync(FIXTURE).size;
  console.log(`Input: ${FIXTURE} — ${gib(inputBytes)}`);
  if (inputBytes <= WASM_HEAP_LIMIT) {
    throw new Error("fixture is not larger than the WebAssembly heap limit; nothing is proven");
  }

  const server = await startServer();
  const browser = await chromium.launch({
    // Undefined lets Playwright resolve its own managed Chromium.
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));

  let peakHeapBytes = 0;
  const sampleHeap = async () => {
    const used = await page
      .evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
      .catch(() => 0);
    peakHeapBytes = Math.max(peakHeapBytes, used);
  };

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

    // Only ask for the stream copy: the point is reading a huge input, not
    // spending ten minutes encoding MP3 in WebAssembly.
    await page.getByRole("button", { name: /Output formats/ }).click();
    await page.getByLabel(/MP3/).uncheck();

    console.log("Dropping the file…");
    const startedAt = Date.now();
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);

    const card = page.locator("li", { hasText: "huge.mkv" }).first();
    const done = card.getByText("Done", { exact: true }).waitFor({ timeout: TIMEOUT_MS });

    // Report progress while ffmpeg grinds through the file.
    const ticker = setInterval(async () => {
      await sampleHeap();
      const text = await card.innerText().catch(() => "");
      const phase = text.split("\n").find((line) => /…|%/.test(line)) ?? "working";
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`  t=${elapsed}s  ${phase.trim()}  heap≈${mib(peakHeapBytes)}`);
    }, 15_000);

    try {
      await done;
    } finally {
      clearInterval(ticker);
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    await sampleHeap();

    // The session is closed by the time the card says Done, so the WORKERFS
    // mount holding the File is gone. Sampled after a forced collection: if any
    // part of the input were retained — by the mount, or by a copy — it would
    // still be resident here, and the input is larger than the heap allows.
    const settledHeapBytes = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return performance.memory?.usedJSHeapSize ?? 0;
    });

    const cardText = await card.innerText();
    console.log(`\nFinished in ${elapsedSeconds.toFixed(1)}s`);
    console.log(cardText.split("\n").slice(0, 3).join("\n"));

    const downloadDir = join(tmpdir(), `verify-large-${Date.now()}`);
    mkdirSync(downloadDir, { recursive: true });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card.getByText("Download").first().click(),
    ]);
    const outPath = join(downloadDir, download.suggestedFilename());
    await download.saveAs(outPath);

    const probe = JSON.parse(
      execFileSync("ffprobe", [
        "-v", "error", "-show_format", "-show_streams", "-of", "json", outPath,
      ]).toString(),
    );
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const outputBytes = statSync(outPath).size;

    const results = [
      [`input exceeds the ${gib(WASM_HEAP_LIMIT)} WebAssembly heap`, inputBytes > WASM_HEAP_LIMIT,
        gib(inputBytes)],
      ["extraction completed", /Done/.test(cardText), `${elapsedSeconds.toFixed(1)}s`],
      ["output is valid AAC", audio?.codec_name === "aac", `codec=${audio?.codec_name}`],
      ["output duration matches the source", Math.abs(Number(probe.format.duration) - FIXTURE_SECONDS) < 1.5,
        `${Number(probe.format.duration).toFixed(1)}s of ${FIXTURE_SECONDS}s`],
      ["output contains no video", !probe.streams.some((s) => s.codec_type === "video"), ""],
      ["output is tiny next to the input", outputBytes < inputBytes / 100,
        `${mib(outputBytes)} from ${gib(inputBytes)}`],
      ["browser heap stayed far below the file size", peakHeapBytes < 600 * 1024 ** 2,
        `peak ≈ ${mib(peakHeapBytes)}`],
      ["nothing is retained once the input is unmounted", settledHeapBytes < 300 * 1024 ** 2,
        `${mib(settledHeapBytes)} after the session closed, from ${gib(inputBytes)} of input`],
    ];

    console.log("");
    let failures = 0;
    for (const [name, ok, detail] of results) {
      console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
      if (!ok) failures += 1;
    }

    console.log(
      `\nRead ${gib(inputBytes)} at roughly ${(inputBytes / 1024 ** 2 / elapsedSeconds).toFixed(0)} MiB/s ` +
        `without ever holding the file in memory.`,
    );

    if (failures > 0) {
      console.error(`\n✗ ${failures} check(s) failed`);
      process.exitCode = 1;
    }
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
