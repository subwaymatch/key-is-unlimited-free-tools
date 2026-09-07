/**
 * End-to-end verification: drives a real browser through a real conversion.
 *
 * Unit tests cover the parsers and the format catalogue, but the parts most
 * likely to break - the class worker URL, the WORKERFS mount, ffmpeg's exit
 * codes, blob downloads - only exist in a browser. This script builds the app,
 * serves the export, drops fixture videos into it with Chromium, and checks the
 * bytes that come out with a real ffprobe.
 *
 * The ffmpeg core is served locally rather than from the CDN, which keeps the
 * run hermetic and doubles as a test of the self-hosted-core configuration
 * (the R2 deployment option).
 *
 *   node scripts/verify-e2e.mjs
 *
 * Requires ffmpeg/ffprobe on PATH to build and inspect the fixtures, and a
 * Chromium: either one Playwright can find on its own (`npx playwright install
 * chromium`, honouring PLAYWRIGHT_BROWSERS_PATH) or any Chrome/Chromium binary
 * named in CHROMIUM_PATH.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(root, ".fixtures");
const OUT = join(root, "out");
const CORE_DIST = join(root, "node_modules/@ffmpeg/core/dist/esm");
const PORT = 4173;

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
};

const log = (...args) => console.log(...args);
const fail = (message) => {
  console.error(`\nFAIL ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

function ensureFixtures() {
  mkdirSync(FIXTURES, { recursive: true });
  const build = (name, args) => {
    const path = join(FIXTURES, name);
    if (existsSync(path)) return path;
    log(`  generating ${name}...`);
    execFileSync("ffmpeg", ["-y", "-v", "error", ...args, path]);
    return path;
  };

  return {
    sample: build("sample.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ]),
    silent: build("silent.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ]),
    // 2s of silence, 4s of tone, 2s of silence - the shape automatic trimming
    // is supposed to recognise.
    padded: build("padded.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-filter_complex",
      "[1:a]atrim=0:4,asetpts=PTS-STARTPTS,adelay=2000|2000,apad=whole_dur=8[a]",
      "-map", "0:v", "-map", "[a]", "-t", "8",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ]),
    // Long enough that an MP3 conversion is still running when the test clicks
    // cancel: ffmpeg.wasm encodes at roughly 30x realtime, so 5 minutes of
    // audio takes about ten seconds.
    long: build("long.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=5",
      "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000",
      "-t", "300", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ]),
    surround: build("surround.mkv", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
      "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "flac", "-ac", "6",
    ]),
  };
}

/** Serves the static export, plus the ffmpeg core under /core. */
function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);

    let filePath = path.startsWith("/core/")
      ? join(CORE_DIST, path.slice("/core/".length))
      : join(OUT, path);

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath)) {
      filePath = join(OUT, "index.html");
    }

    response.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": statSync(filePath).size,
    });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolveServer) => {
    server.listen(PORT, "127.0.0.1", () => resolveServer(server));
  });
}

function ffprobeJson(path) {
  const raw = execFileSync("ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", path,
  ]);
  return JSON.parse(raw.toString());
}

const checks = [];
function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  log(`  ${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function main() {
  log("Preparing fixtures...");
  const fixtures = ensureFixtures();

  if (!existsSync(join(OUT, "index.html"))) {
    fail("out/index.html missing - run `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=/core npm run build` first.");
  }
  if (!existsSync(join(CORE_DIST, "ffmpeg-core.wasm"))) {
    fail("@ffmpeg/core is not installed.");
  }

  const server = await startServer();
  log(`Serving ${OUT} on http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch({
    // Undefined lets Playwright resolve its own managed Chromium.
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const downloadDir = join(tmpdir(), `extract-audio-verify-${Date.now()}`);
  mkdirSync(downloadDir, { recursive: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    check("page renders the drop zone", await page.getByText("Drop video files here").isVisible());

    // The whole dashed box opens the picker, not just the button inside it.
    for (const [where, target] of [
      ["its explanatory text", page.getByText("Conversion starts automatically", { exact: false })],
      ["the icon", page.locator("label svg").first()],
      ["the Choose files button", page.getByText("Choose files")],
    ]) {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), target.click()]);
      // Dismiss without queueing anything; an empty selection is ignored.
      await chooser.setFiles([]);
      check(`clicking ${where} opens the file picker`, Boolean(chooser));
    }

    // ---- Case 1: ordinary MP4 with an AAC track --------------------------
    log("\nCase 1 - 6s MP4 (H.264 + AAC):");
    await page.locator('input[type="file"]').setInputFiles(fixtures.sample);

    // The core download + WebAssembly start dominate this wait.
    await page.getByText("Done", { exact: true }).first().waitFor({ timeout: 180_000 });

    const card = page.locator("li", { hasText: "sample.mp4" }).first();
    const cardText = await card.innerText();

    check("probes duration and codec", /0:06/.test(cardText) && /AAC/.test(cardText), cardText.split("\n")[1]);
    check("reports stereo 48 kHz", /48 kHz/.test(cardText) && /stereo/.test(cardText));
    check(
      "extracts the original track as a stream copy",
      /stream copy/i.test(cardText),
      "no re-encode for the untouched track",
    );
    check("produces both requested formats", (await card.getByText("Download").count()) === 2);
    check("offers an audio player", (await card.locator("audio").count()) === 1);

    // Download the MP3 and confirm it is a real MP3 of the right length.
    const mp3Row = card.locator("div", { hasText: /^MP3/ }).first();
    const [mp3Download] = await Promise.all([
      page.waitForEvent("download"),
      mp3Row.getByText("Download").click(),
    ]);
    const mp3Path = join(downloadDir, mp3Download.suggestedFilename());
    await mp3Download.saveAs(mp3Path);

    check("downloads with the source file's name", mp3Download.suggestedFilename() === "sample.mp3");
    const mp3 = ffprobeJson(mp3Path);
    const mp3Audio = mp3.streams.find((stream) => stream.codec_type === "audio");
    check("MP3 download is a valid MP3", mp3Audio?.codec_name === "mp3", `codec=${mp3Audio?.codec_name}`);
    check("MP3 has no video stream", !mp3.streams.some((stream) => stream.codec_type === "video"));
    check(
      "MP3 duration matches the source",
      Math.abs(Number(mp3.format.duration) - 6) < 0.5,
      `${Number(mp3.format.duration).toFixed(2)}s`,
    );
    check("MP3 keeps the source sample rate", mp3Audio?.sample_rate === "48000");

    // The stream-copied output should be byte-identical AAC in an M4A.
    const originalRow = card.locator("div", { hasText: /^Original/ }).first();
    const [m4aDownload] = await Promise.all([
      page.waitForEvent("download"),
      originalRow.getByText("Download").click(),
    ]);
    const m4aPath = join(downloadDir, m4aDownload.suggestedFilename());
    await m4aDownload.saveAs(m4aPath);

    check("stream copy lands in an .m4a container", m4aDownload.suggestedFilename() === "sample.m4a");
    const m4a = ffprobeJson(m4aPath);
    const m4aAudio = m4a.streams.find((stream) => stream.codec_type === "audio");
    check("stream copy preserves the AAC codec", m4aAudio?.codec_name === "aac", `codec=${m4aAudio?.codec_name}`);
    check("stream copy drops the video track", !m4a.streams.some((s) => s.codec_type === "video"));

    await page.screenshot({ path: join(root, ".fixtures", "verify-converted.png"), fullPage: true });

    // ---- Case 2: a video with no audio -----------------------------------
    log("\nCase 2 - MP4 with no audio track:");
    await page.locator('input[type="file"]').setInputFiles(fixtures.silent);
    const silentCard = page.locator("li", { hasText: "silent.mp4" }).first();
    await silentCard.getByText("No audio track found.").waitFor({ timeout: 120_000 });
    check("explains that there is no audio to extract", true, "per-file error, queue continues");
    check("marks only that file as failed", (await silentCard.getByText("Failed").count()) >= 1);

    // ---- Case 3: MKV with 5.1 FLAC ---------------------------------------
    log("\nCase 3 - MKV with 5.1 FLAC:");
    await page.locator('input[type="file"]').setInputFiles(fixtures.surround);
    const mkvCard = page.locator("li", { hasText: "surround.mkv" }).first();
    await mkvCard.getByText("Done", { exact: true }).waitFor({ timeout: 180_000 });
    const mkvText = await mkvCard.innerText();
    check("parses the 5.1 surround layout", /5\.1/.test(mkvText), mkvText.split("\n")[1]);
    check("copies FLAC without re-encoding", /stream copy/i.test(mkvText));

    const flacRow = mkvCard.locator("div", { hasText: /^Original/ }).first();
    const [flacDownload] = await Promise.all([
      page.waitForEvent("download"),
      flacRow.getByText("Download").click(),
    ]);
    const flacPath = join(downloadDir, flacDownload.suggestedFilename());
    await flacDownload.saveAs(flacPath);
    check("FLAC copy keeps its native container", flacDownload.suggestedFilename() === "surround.flac");
    const flac = ffprobeJson(flacPath);
    const flacAudio = flac.streams.find((stream) => stream.codec_type === "audio");
    check("FLAC copy stays FLAC with 6 channels", flacAudio?.codec_name === "flac" && flacAudio?.channels === 6);

    // ---- Case 4: clipping a range with the per-file markers ---------------
    log("\nCase 4 - clipping 1:00-3:00 of the 6s MP4:");
    await card.getByRole("button", { name: "Trim or clip a range" }).click();
    const markers = card.getByRole("group", { name: "Clip markers" });
    await markers.getByLabel("Start", { exact: true }).fill("1");
    await markers.getByLabel("End", { exact: true }).fill("3");
    check("shows the length of the clip", /Clip is 0:02 long/.test(await markers.innerText()));

    await markers.getByRole("button", { name: "MP3", exact: true }).click();
    await card.getByText("Done", { exact: true }).waitFor({ timeout: 120_000 });
    await card.getByText("0:01-0:03").waitFor({ timeout: 120_000 });
    check("labels the output with the range it covers", true, "0:01-0:03 badge");

    // Scoped by the range badge: a plain "MP3" match would find the full-audio
    // row that case 1 produced.
    const clipRow = card.locator("li").filter({ hasText: "0:01-0:03" });
    const [clipDownload] = await Promise.all([
      page.waitForEvent("download"),
      clipRow.getByText("Download").click(),
    ]);
    const clipPath = join(downloadDir, clipDownload.suggestedFilename());
    await clipDownload.saveAs(clipPath);

    check(
      "clip filename carries its range",
      clipDownload.suggestedFilename() === "sample-1s-3s.mp3",
      clipDownload.suggestedFilename(),
    );
    const clip = ffprobeJson(clipPath);
    check(
      "clip is exactly the requested two seconds",
      Math.abs(Number(clip.format.duration) - 2) < 0.3,
      `${Number(clip.format.duration).toFixed(2)}s`,
    );
    check(
      "clip is a valid MP3",
      clip.streams.find((stream) => stream.codec_type === "audio")?.codec_name === "mp3",
    );

    // ---- Case 5: automatic silence trimming -------------------------------
    log("\nCase 5 - 8s MP4 padded with 2s of silence at each end:");
    await page.getByRole("button", { name: /Output formats/ }).click();
    await page.getByLabel(/Trim silence/).check();

    await page.locator('input[type="file"]').setInputFiles(fixtures.padded);
    const paddedCard = page.locator("li", { hasText: "padded.mp4" }).first();
    await paddedCard.getByText("Done", { exact: true }).waitFor({ timeout: 180_000 });

    const paddedRow = paddedCard.locator("li").filter({ hasText: /^MP3/ });
    const [paddedDownload] = await Promise.all([
      page.waitForEvent("download"),
      paddedRow.getByText("Download").click(),
    ]);
    const paddedPath = join(downloadDir, paddedDownload.suggestedFilename());
    await paddedDownload.saveAs(paddedPath);

    const padded = ffprobeJson(paddedPath);
    const paddedDuration = Number(padded.format.duration);
    // 4s of tone plus the 0.1s of silence deliberately kept at either end.
    check(
      "silence detection cuts the 2s head and 2s tail",
      Math.abs(paddedDuration - 4.2) < 0.5,
      `${paddedDuration.toFixed(2)}s of 8s`,
    );
    check(
      "trimmed filename carries the detected range",
      /^padded-\d+s-\d+s\.mp3$/.test(paddedDownload.suggestedFilename()),
      paddedDownload.suggestedFilename(),
    );
    check(
      "the trimmed output is still labelled with its range",
      /-/.test(await paddedCard.innerText()),
    );

    await page.screenshot({ path: join(root, ".fixtures", "verify-trimmed.png"), fullPage: true });

    // ---- Case 6: cancelling one format, leaving the others alone ----------
    log("\nCase 6 - cancelling MP3 mid-conversion on a 5min MP4:");
    await page.getByRole("button", { name: /Output formats/ }).click();
    await page.getByLabel(/Full audio/).check();
    await page.getByLabel(/M4A \(AAC\)/).check();
    await page.locator('input[type="file"]').setInputFiles(fixtures.long);

    const longCard = page.locator("li", { hasText: "long.mp4" }).first();
    const longOriginal = longCard.locator("li").filter({ hasText: /^Original/ });
    const longMp3 = longCard.locator("li").filter({ hasText: /^MP3/ });
    const longM4a = longCard.locator("li").filter({ hasText: /^M4A/ });

    // Wait until MP3 is genuinely running, not merely queued behind Original.
    await longCard.getByText("Extracting MP3...").waitFor({ timeout: 180_000 });
    check(
      "the stream copy finished before MP3 started",
      (await longOriginal.getByText("Download").count()) === 1,
    );

    await longCard.getByRole("button", { name: "Cancel MP3" }).click();
    await longMp3.getByText("Cancelled").waitFor({ timeout: 30_000 });
    check("cancels the running format on its own", true, "MP3 marked cancelled");
    check(
      "the finished stream copy survives the worker being killed",
      (await longOriginal.getByText("Download").count()) === 1,
      "its bytes are a JS Blob, not worker memory",
    );
    check(
      "the file itself is not cancelled",
      (await longCard.getByText("Cancelled", { exact: true }).count()) === 1,
      "only the MP3 row",
    );

    // M4A was queued behind MP3, so it has to survive on a rebuilt engine.
    await longM4a.getByText("Download").waitFor({ timeout: 240_000 });
    check("the format queued behind it still runs, on a fresh engine", true);

    const [m4aResume] = await Promise.all([
      page.waitForEvent("download"),
      longM4a.getByText("Download").click(),
    ]);
    const m4aResumePath = join(downloadDir, m4aResume.suggestedFilename());
    await m4aResume.saveAs(m4aResumePath);
    const resumed = ffprobeJson(m4aResumePath);
    check(
      "that format covers the whole file, not the part before the cancel",
      Math.abs(Number(resumed.format.duration) - 300) < 2,
      `${Number(resumed.format.duration).toFixed(1)}s`,
    );

    // ---- Case 7: retrying just the cancelled format -----------------------
    log("\nCase 7 - retrying the cancelled MP3:");
    await longCard.getByRole("button", { name: "Retry MP3" }).click();
    await longMp3.getByText("Download").waitFor({ timeout: 240_000 });

    const [mp3Retry] = await Promise.all([
      page.waitForEvent("download"),
      longMp3.getByText("Download").click(),
    ]);
    const mp3RetryPath = join(downloadDir, mp3Retry.suggestedFilename());
    await mp3Retry.saveAs(mp3RetryPath);
    const retried = ffprobeJson(mp3RetryPath);
    check(
      "the retried format converts from the start",
      Math.abs(Number(retried.format.duration) - 300) < 2,
      `${Number(retried.format.duration).toFixed(1)}s`,
    );
    check(
      "retrying one format does not re-run the others",
      (await longCard.getByText("Download").count()) === 3,
      "Original, M4A and MP3 all present exactly once",
    );

    await page.screenshot({ path: join(root, ".fixtures", "verify-cancelled.png"), fullPage: true });

    // ---- Engine-level assertions -----------------------------------------
    log("\nEngine:");
    const footer = await page.locator("footer").innerText();
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    check(
      "footer reports the pinned versions",
      /@ffmpeg\/ffmpeg 0\.12\.15/.test(footer) && /core 0\.12\.10/.test(footer),
    );
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  const failed = checks.filter((entry) => !entry.ok);
  log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    fail(`${failed.length} check(s) failed: ${failed.map((entry) => entry.name).join(", ")}`);
  }
  log(
    "Screenshots: .fixtures/verify-converted.png, .fixtures/verify-trimmed.png, " +
      ".fixtures/verify-cancelled.png",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
