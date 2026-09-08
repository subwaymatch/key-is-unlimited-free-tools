/**
 * End-to-end verification of the video tools: a real browser, the real core.
 *
 * The unit tests pin every argument string, but whether the pinned core
 * actually has the encoder, whether a two-pass log survives MEMFS, whether a
 * filter graph parses - those only exist in a browser. This script builds
 * fixtures with the system ffmpeg, serves the static export, drives each tool
 * page with Chromium, and checks what comes out with ffprobe.
 *
 *   NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=/core npm run build
 *   node scripts/verify-video-tools.mjs
 *
 * Requires ffmpeg/ffprobe on PATH and a Chromium Playwright can find (or one
 * named in CHROMIUM_PATH). The core is served locally, which keeps the run
 * hermetic and doubles as a test of the self-hosted-core configuration.
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
const PORT = 4174;

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
  ".xml": "application/xml",
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
    // The ordinary case: H.264 + AAC, a keyframe every second so a fast cut
    // has somewhere to land, and metadata to strip.
    tagged: build("tagged.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-g", "25", "-keyint_min", "25",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
      "-metadata", "title=Holiday", "-metadata", "comment=do not share",
      // MP4 keeps a stream's name in its handler box, which is where ffprobe
      // reads it back from; a stream "title" would not survive the muxer.
      "-metadata:s:v:0", "handler_name=Camera", "-metadata:s:a:0", "handler_name=Mic",
    ]),
    // The "make this video work" case: an AVI with MPEG-4 part 2 and MP2.
    avi: build("legacy.avi", [
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100",
      "-t", "4", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "mp2", "-b:a", "128k", "-ac", "2",
    ]),
    // Big enough that 8 MB is a real target: 30 s at 5 Mbps is about 19 MB.
    big: build("big.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
      "-t", "30", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-b:v", "5M", "-minrate", "5M", "-maxrate", "5M", "-bufsize", "1M",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ]),
    silent: build("silent.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ]),
    music: build("music.mp3", [
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "3", "-c:a", "libmp3lame", "-b:a", "128k",
      "-metadata", "title=Song", "-metadata", "artist=Someone",
    ]),
  };
}

/** Serves the static export, plus the ffmpeg core under /core. */
function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    const path = decodeURIComponent(url.pathname);

    let filePath = path.startsWith("/core/")
      ? join(CORE_DIST, path.slice("/core/".length))
      : join(OUT, path);

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath) && existsSync(`${filePath}.html`)) {
      filePath = `${filePath}.html`;
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

const seconds = (info) => Number(info.format.duration);
const stream = (info, type) => info.streams.find((entry) => entry.codec_type === type);

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
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const downloadDir = join(tmpdir(), `video-tools-verify-${Date.now()}`);
  mkdirSync(downloadDir, { recursive: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  const open = async (slug) => {
    await page.goto(`http://127.0.0.1:${PORT}/${slug}`, { waitUntil: "networkidle" });
  };
  const drop = async (path) => {
    await page.locator('input[type="file"]').setInputFiles(path);
  };
  const cardFor = (name) => page.locator("li", { hasText: name }).first();
  const download = async (locator) => {
    const [event] = await Promise.all([page.waitForEvent("download"), locator.click()]);
    const path = join(downloadDir, event.suggestedFilename());
    await event.saveAs(path);
    return { path, name: event.suggestedFilename(), info: ffprobeJson(path) };
  };

  try {
    // ---- The index ------------------------------------------------------
    log("\nIndex:");
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    const links = await page.locator("main a[href^='/']").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href")),
    );
    for (const slug of [
      "extract-audio",
      "convert-video",
      "compress-video",
      "trim-video",
      "video-to-gif",
      "remove-audio",
      "remove-metadata",
    ]) {
      check(`index links to /${slug}`, links.includes(`/${slug}`));
    }
    check("index does not link a planned tool", !links.includes("/change-speed"));

    // ---- Convert --------------------------------------------------------
    log("\nConvert - H.264 + AAC MP4 (a copy) and an MPEG-4/MP2 AVI (an encode):");
    await open("convert-video");
    await drop(fixtures.tagged);
    const taggedCard = cardFor("tagged.mp4");
    // The first run downloads and starts the core.
    await taggedCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    check("probes the video stream", /H264 640x360/.test(await taggedCard.innerText()));
    check("copies a source that already fits", /stream copy/i.test(await taggedCard.innerText()));
    const copied = await download(taggedCard.getByText("Download"));
    check("copy keeps the source name and lands in an .mp4", copied.name === "tagged.mp4", copied.name);
    check("copy is still H.264 + AAC", stream(copied.info, "video")?.codec_name === "h264" && stream(copied.info, "audio")?.codec_name === "aac");
    check("copy keeps the length", Math.abs(seconds(copied.info) - 6) < 0.3, `${seconds(copied.info).toFixed(2)}s`);
    check("shows a video preview of the output", (await taggedCard.locator("video").count()) >= 1);

    await drop(fixtures.avi);
    const aviCard = cardFor("legacy.avi");
    await aviCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    check("encodes a source that does not fit", !/stream copy/i.test(await aviCard.innerText()));
    const encoded = await download(aviCard.getByText("Download"));
    check("AVI comes out as an MP4", encoded.name === "legacy.mp4", encoded.name);
    check("encoded video is H.264 4:2:0", stream(encoded.info, "video")?.codec_name === "h264" && stream(encoded.info, "video")?.pix_fmt === "yuv420p");
    check("encoded audio is AAC", stream(encoded.info, "audio")?.codec_name === "aac");
    check("encode keeps the length", Math.abs(seconds(encoded.info) - 4) < 0.3, `${seconds(encoded.info).toFixed(2)}s`);

    // The MKV remux from the card's chips. The clip panel offers the same
    // format for the whole file, so take the first of the two.
    await taggedCard.getByRole("button", { name: /MKV/ }).first().click();
    const mkvRow = taggedCard.locator("li").filter({ hasText: /^MKV/ });
    await mkvRow.getByText("Download").waitFor({ timeout: 120_000 });
    const mkv = await download(mkvRow.getByText("Download"));
    check("MKV remux keeps both streams as they are", mkv.name === "tagged.mkv" && stream(mkv.info, "video")?.codec_name === "h264" && stream(mkv.info, "audio")?.codec_name === "aac", mkv.name);

    // A file with no video is refused with a reason, not a stack trace.
    await drop(fixtures.music);
    const musicCard = cardFor("music.mp3");
    await musicCard.getByText("No video track found.").waitFor({ timeout: 60_000 });
    check("explains that an audio file has no video to convert", true);
    await page.screenshot({ path: join(FIXTURES, "verify-convert.png"), fullPage: true });

    // ---- Compress -------------------------------------------------------
    log("\nCompress - 19 MB to under 8 MB, two passes:");
    await open("compress-video");
    await page.getByRole("button", { name: /Target size/ }).click();
    // Base UI renders the radio and a hidden input under one label; take the role.
    await page.getByRole("radio", { name: /^8 MB/ }).click();
    check("summary reflects the choice", /8 MB/.test(await page.getByRole("button", { name: /Target size/ }).innerText()));
    await drop(fixtures.big);
    const bigCard = cardFor("big.mp4");
    await bigCard.getByText("Compressing the video to 8 MB...").waitFor({ timeout: 120_000 });
    check("says what it is doing", true, "phase line");
    await bigCard.getByText("Done", { exact: true }).waitFor({ timeout: 600_000 });
    const small = await download(bigCard.getByText("Download"));
    const smallBytes = statSync(small.path).size;
    check("output is under the target", smallBytes < 8_000_000, `${(smallBytes / 1e6).toFixed(2)} MB`);
    check("output is not far under it", smallBytes > 6_000_000, "two-pass rate control used the budget");
    check("filename carries the target", small.name === "big-8mb.mp4", small.name);
    check("compressed video keeps its length", Math.abs(seconds(small.info) - 30) < 0.5, `${seconds(small.info).toFixed(2)}s`);
    check("compressed audio is AAC", stream(small.info, "audio")?.codec_name === "aac");
    // Auto resolution: 8 MB over 30 s is about 2 Mbps, which affords the
    // source's 360 rows, so the frame is untouched.
    check("auto resolution left a small frame alone", stream(small.info, "video")?.height === 360, `${stream(small.info, "video")?.width}x${stream(small.info, "video")?.height}`);

    // A file already under the target is refused up front.
    await drop(fixtures.tagged);
    const alreadyCard = cardFor("tagged.mp4");
    // A file whose only output failed shows the reason on the card and on the row.
    await alreadyCard.getByText(/already under 8 MB/).first().waitFor({ timeout: 120_000 });
    check("refuses to compress a file already under the target", true);
    await page.screenshot({ path: join(FIXTURES, "verify-compress.png"), fullPage: true });

    // ---- Remove audio ---------------------------------------------------
    log("\nRemove audio:");
    await open("remove-audio");
    await drop(fixtures.tagged);
    const muteCard = cardFor("tagged.mp4");
    await muteCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    const muted = await download(muteCard.getByText("Download"));
    check("muted file is named after the source", muted.name === "tagged-muted.mp4", muted.name);
    check("muted file has no audio stream", stream(muted.info, "audio") === undefined);
    check("muted file keeps the video as it was", stream(muted.info, "video")?.codec_name === "h264" && /stream copy/i.test(await muteCard.innerText()));

    // ---- Remove metadata ------------------------------------------------
    log("\nRemove metadata - a tagged MP4 and a tagged MP3:");
    await open("remove-metadata");
    await drop(fixtures.tagged);
    const cleanCard = cardFor("tagged.mp4");
    await cleanCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    const clean = await download(cleanCard.getByText("Download"));
    const before = ffprobeJson(fixtures.tagged);
    // MP4 keeps a stream's title in its handler box; ffprobe reads it back as handler_name.
    check("the source really carried tags", before.format.tags?.title === "Holiday" && stream(before, "video")?.tags?.handler_name === "Camera");
    check("global tags are gone", !clean.info.format.tags?.title && !clean.info.format.tags?.comment, JSON.stringify(clean.info.format.tags ?? {}));
    check("stream tags are gone", stream(clean.info, "video")?.tags?.handler_name !== "Camera" && stream(clean.info, "audio")?.tags?.handler_name !== "Mic");
    check("the muxer did not stamp its own name", !/Lavf/.test(clean.info.format.tags?.encoder ?? ""), clean.info.format.tags?.encoder ?? "no encoder tag");
    check("streams are untouched", stream(clean.info, "video")?.codec_name === "h264" && stream(clean.info, "audio")?.codec_name === "aac");
    check("clean file is named after the source", clean.name === "tagged-clean.mp4", clean.name);

    await drop(fixtures.music);
    const songCard = cardFor("music.mp3");
    await songCard.getByText("Done", { exact: true }).waitFor({ timeout: 120_000 });
    const song = await download(songCard.getByText("Download"));
    check("an MP3 stays an MP3", song.name === "music-clean.mp3", song.name);
    check("its tags are gone", !song.info.format.tags?.title && !song.info.format.tags?.artist, JSON.stringify(song.info.format.tags ?? {}));
    check("offers an audio preview for an audio output", (await songCard.locator("audio").count()) === 1);

    // ---- Trim -----------------------------------------------------------
    log("\nTrim - 0:01 to 0:03, fast and precise:");
    await open("trim-video");
    await drop(fixtures.tagged);
    const trimCard = cardFor("tagged.mp4");
    await trimCard.getByText("Ready", { exact: true }).waitFor({ timeout: 240_000 });
    check("reads the file and waits for a range", (await trimCard.getByText("Download").count()) === 0);
    check("shows the source video to scrub", (await trimCard.locator("video").count()) === 1);
    const markers = trimCard.getByRole("group", { name: "Clip markers" });
    check("insists on a range before offering a cut", (await markers.getByRole("button", { name: "Fast cut" }).count()) === 0);
    await markers.getByLabel("Start", { exact: true }).fill("1");
    await markers.getByLabel("End", { exact: true }).fill("3");
    await markers.getByRole("button", { name: "Fast cut" }).click();
    const fastRow = trimCard.locator("li").filter({ hasText: /^Fast cut/ });
    await fastRow.getByText("Download").waitFor({ timeout: 120_000 });
    const fast = await download(fastRow.getByText("Download"));
    check("fast cut carries its range in the name", fast.name === "tagged-1s-3s.mp4", fast.name);
    // Keyframes every second, so the copy lands on 1.0 exactly.
    check("fast cut is two seconds, on the keyframe", Math.abs(seconds(fast.info) - 2) < 0.3, `${seconds(fast.info).toFixed(2)}s`);
    check("fast cut is a stream copy", stream(fast.info, "video")?.codec_name === "h264" && /stream copy/i.test(await fastRow.innerText()));

    await markers.getByRole("button", { name: "Precise cut" }).click();
    const preciseRow = trimCard.locator("li").filter({ hasText: /^Precise cut/ });
    await preciseRow.getByText("Download").waitFor({ timeout: 240_000 });
    const precise = await download(preciseRow.getByText("Download"));
    check("precise cut is exactly two seconds", Math.abs(seconds(precise.info) - 2) < 0.1, `${seconds(precise.info).toFixed(3)}s`);
    check("precise cut re-encoded to H.264 + AAC", stream(precise.info, "video")?.codec_name === "h264" && stream(precise.info, "audio")?.codec_name === "aac");
    await page.screenshot({ path: join(FIXTURES, "verify-trim.png"), fullPage: true });

    // ---- GIF ------------------------------------------------------------
    log("\nVideo to GIF - 0:00 to 0:02 at 15 fps, 480 px:");
    await open("video-to-gif");
    await drop(fixtures.tagged);
    const gifCard = cardFor("tagged.mp4");
    await gifCard.getByText("Ready", { exact: true }).waitFor({ timeout: 240_000 });
    const gifMarkers = gifCard.getByRole("group", { name: "Clip markers" });
    await gifMarkers.getByLabel("End", { exact: true }).fill("2");
    await gifMarkers.getByRole("button", { name: "GIF" }).click();
    const gifRow = gifCard.locator("li").filter({ hasText: /^GIF/ });
    await gifRow.getByText("Download").waitFor({ timeout: 240_000 });
    const gif = await download(gifRow.getByText("Download"));
    check("GIF carries its range in the name", gif.name === "tagged-0s-2s.gif", gif.name);
    check("GIF is a GIF", stream(gif.info, "video")?.codec_name === "gif");
    check("GIF was scaled to 480 wide", stream(gif.info, "video")?.width === 480, `${stream(gif.info, "video")?.width}px`);
    check("GIF runs at 15 fps", stream(gif.info, "video")?.r_frame_rate === "15/1", stream(gif.info, "video")?.r_frame_rate);
    check("GIF is two seconds", Math.abs(seconds(gif.info) - 2) < 0.2, `${seconds(gif.info).toFixed(2)}s`);
    // The poster is a blob image too, so look for the one that is the download.
    const gifHref = await gifRow.locator("a[download]").getAttribute("href");
    check("shows the GIF inline", (await gifCard.locator(`img[src="${gifHref}"]`).count()) === 1);

    // A silent video is fine here: there is no audio to need.
    await drop(fixtures.silent);
    const silentCard = cardFor("silent.mp4");
    await silentCard.getByText("Ready", { exact: true }).waitFor({ timeout: 120_000 });
    check("a silent video is accepted by a video tool", true);
    await page.screenshot({ path: join(FIXTURES, "verify-gif.png"), fullPage: true });

    // ---- Engine-level assertions ----------------------------------------
    log("\nEngine:");
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
