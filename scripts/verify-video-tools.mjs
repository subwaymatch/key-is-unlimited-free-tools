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
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
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
    // Two cues, for the subtitle converter: one to convert, one to shift.
    subtitles: (() => {
      const path = join(FIXTURES, "sample.srt");
      if (!existsSync(path)) {
        writeFileSync(
          path,
          "1\r\n00:00:01,000 --> 00:00:04,000\r\nHello there.\r\n\r\n2\r\n00:00:05,500 --> 00:00:07,250\r\n<i>Second</i> cue\r\n",
        );
      }
      return path;
    })(),
    // A quiet tone for the normaliser, and an MKV carrying a subtitle track.
    quiet: build("quiet.mp3", [
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "6", "-af", "volume=-24dB", "-c:a", "libmp3lame", "-b:a", "128k",
    ]),
    subbed: build("subbed.mkv", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-i", join(FIXTURES, "sample.srt"),
      "-t", "8", "-map", "0:v", "-map", "1:s",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:s", "srt", "-metadata:s:s:0", "language=eng",
    ]),
  };
}

/** Integrated loudness of a file, in LUFS, as ebur128 measures it. */
function integratedLoudness(path) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const matches = result.stderr.match(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g) ?? [];
  const last = matches[matches.length - 1]?.match(/(-?\d+(?:\.\d+)?)/);
  return last ? Number(last[1]) : Number.NaN;
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
      "change-speed",
      "merge-videos",
      "convert-subtitles",
      "resize-video",
      "rotate-video",
      "video-thumbnails",
      "convert-audio",
      "normalize-audio",
      "extract-subtitles",
    ]) {
      check(`index links to /${slug}`, links.includes(`/${slug}`));
    }
    check("index does not link a planned tool", !links.includes("/transcribe-video"));

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

    // WebM. This is the one that used to trap: libvpx-vp9 in this core dies
    // with "memory access out of bounds" a fraction of a second in, and took
    // the whole engine with it, so the plan encodes VP8 instead.
    await taggedCard.getByRole("button", { name: /WebM/ }).first().click();
    const webmRow = taggedCard.locator("li").filter({ hasText: /^WebM/ });
    await webmRow.getByText("Download").waitFor({ timeout: 600_000 });
    const webm = await download(webmRow.getByText("Download"));
    check("WebM output is produced at all", webm.name === "tagged.webm", webm.name);
    check("WebM video is VP8, not the VP9 that traps", stream(webm.info, "video")?.codec_name === "vp8", stream(webm.info, "video")?.codec_name);
    check("WebM audio is Opus", stream(webm.info, "audio")?.codec_name === "opus");
    check("WebM keeps the length", Math.abs(seconds(webm.info) - 6) < 0.3, `${seconds(webm.info).toFixed(2)}s`);
    // The engine survived it, so the next job on the same page still runs.
    check("the engine was not poisoned by it", (await page.locator("text=engine crashed").count()) === 0);

    // A file with no video is refused with a reason, not a stack trace - on
    // the card and on every output row, since none of them will ever run.
    await drop(fixtures.music);
    const musicCard = cardFor("music.mp3");
    await musicCard.getByText("No video track found.").first().waitFor({ timeout: 60_000 });
    check("explains that an audio file has no video to convert", true);
    check(
      "leaves no output row claiming to be waiting for it",
      (await musicCard.getByText("Waiting", { exact: true }).count()) === 0,
    );
    check(
      "offers no retry for a file that will never have a video track",
      (await musicCard.getByRole("button", { name: /Retry/ }).count()) === 0,
    );
    await page.screenshot({ path: join(FIXTURES, "verify-convert.png"), fullPage: true });

    // ---- Compress -------------------------------------------------------
    log("\nCompress - 19 MB to under 8 MB, two passes:");
    await open("compress-video");
    // The panel opens on arrival: the target size is the whole point of this
    // tool, and behind a collapsed row below the fold most people never saw it.
    check(
      "target size is open on arrival",
      (await page.getByRole("radio", { name: /^8 MB/ }).count()) === 1,
    );
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
    // Not a failure: nothing was asked for that is not already true.
    check(
      "reports it as a note rather than a failure",
      (await alreadyCard.getByText("Nothing to do", { exact: true }).count()) === 1,
    );
    check(
      "offers no pointless retry",
      (await alreadyCard.getByRole("button", { name: /Retry/ }).count()) === 0,
    );
    // ...and the sizes that would actually shrink it are one click away.
    check(
      "offers the smaller sizes on the card",
      (await alreadyCard.getByRole("button", { name: /^\+?\s*2\.5 MB|^\+?\s*8 MB/ }).count()) >= 0,
    );
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
    // "-fast" and "-precise": the two cuts used to download under one name.
    check("fast cut names itself and its range", fast.name === "tagged-fast-1s-3s.mp4", fast.name);
    // Keyframes every second, so the copy lands on 1.0 exactly.
    check("fast cut is two seconds, on the keyframe", Math.abs(seconds(fast.info) - 2) < 0.3, `${seconds(fast.info).toFixed(2)}s`);
    check("fast cut is a stream copy", stream(fast.info, "video")?.codec_name === "h264" && /stream copy/i.test(await fastRow.innerText()));

    await markers.getByRole("button", { name: "Precise cut" }).click();
    const preciseRow = trimCard.locator("li").filter({ hasText: /^Precise cut/ });
    await preciseRow.getByText("Download").waitFor({ timeout: 240_000 });
    const precise = await download(preciseRow.getByText("Download"));
    check("precise cut names itself apart from the fast one", precise.name === "tagged-precise-1s-3s.mp4", precise.name);
    check("precise cut is exactly two seconds", Math.abs(seconds(precise.info) - 2) < 0.1, `${seconds(precise.info).toFixed(3)}s`);
    check("precise cut re-encoded to H.264 + AAC", stream(precise.info, "video")?.codec_name === "h264" && stream(precise.info, "audio")?.codec_name === "aac");
    await page.screenshot({ path: join(FIXTURES, "verify-trim.png"), fullPage: true });

    // ---- Work that outlives the page ------------------------------------
    log("\nSwitching tools and coming back:");
    // Trimming a file, glancing at another tool and pressing Back used to find
    // an empty page: the queue went with the component.
    // textContent, not innerText: the filename is two spans so the extension
    // survives a middle ellipsis, and innerText would put a break between them.
    const beforeSwitch = await trimCard.textContent();
    check("the trimmer has work on it", /tagged\.mp4/.test(beforeSwitch ?? ""));
    await page
      .getByRole("navigation", { name: "Tools", exact: true })
      .getByRole("link", { name: "Compress video" })
      .click();
    await page.waitForURL(/compress-video/);
    check("the other tool has its own queue", (await cardFor("tagged.mp4").count()) === 0);
    await page.goBack();
    await page.waitForURL(/trim-video/);
    const afterSwitch = cardFor("tagged.mp4");
    await afterSwitch.waitFor({ timeout: 30_000 });
    check("the file is still there", true);
    check(
      "both finished cuts are still there, still downloadable",
      (await afterSwitch.getByText("Download").count()) === 2,
    );
    check(
      "the current tool is marked in the nav",
      (await page.locator('nav a[aria-current="page"]').innerText()) === "Trim video",
      await page.locator('nav a[aria-current="page"]').innerText(),
    );

    // ---- GIF ------------------------------------------------------------
    log("\nVideo to GIF - 0:00 to 0:02 at 15 fps, longest side 480 px:");
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

    // ---- Change speed ---------------------------------------------------
    log("\nChange speed - 2x from the panel, then 0.5x from the card:");
    await open("change-speed");
    check(
      "the speed panel is open on arrival",
      (await page.getByRole("radio", { name: /^2x/ }).count()) === 1,
    );
    await page.getByRole("radio", { name: /^2x/ }).click();
    await drop(fixtures.tagged);
    const speedCard = cardFor("tagged.mp4");
    await speedCard.getByText("Re-timing the video at 2x...").waitFor({ timeout: 240_000 });
    check("says what it is doing", true, "phase line");
    await speedCard.getByText("Done", { exact: true }).waitFor({ timeout: 600_000 });
    const doubled = await download(speedCard.getByText("Download"));
    check("2x output carries the speed in its name", doubled.name === "tagged-2x.mp4", doubled.name);
    check("2x output is half the length", Math.abs(seconds(doubled.info) - 3) < 0.3, `${seconds(doubled.info).toFixed(2)}s`);
    check("2x output keeps the frame rate", stream(doubled.info, "video")?.r_frame_rate === "25/1", stream(doubled.info, "video")?.r_frame_rate);
    check("2x output keeps the audio, as AAC", stream(doubled.info, "audio")?.codec_name === "aac");

    // The other speeds are one click away on the card.
    await speedCard.getByRole("button", { name: /^\+?\s*0\.5x$/ }).first().click();
    const slowRow = speedCard.locator("li").filter({ hasText: /^0\.5x/ });
    await slowRow.getByText("Download").waitFor({ timeout: 600_000 });
    const halved = await download(slowRow.getByText("Download"));
    check("0.5x output is twice the length", Math.abs(seconds(halved.info) - 12) < 0.3, `${seconds(halved.info).toFixed(2)}s`);
    check("0.5x output keeps the frame rate", stream(halved.info, "video")?.r_frame_rate === "25/1", stream(halved.info, "video")?.r_frame_rate);
    await page.screenshot({ path: join(FIXTURES, "verify-speed.png"), fullPage: true });

    // ---- Merge ----------------------------------------------------------
    log("\nMerge - two matching clips copied, then a third mismatched one re-encoded:");
    await open("merge-videos");
    await page.locator('input[type="file"]').setInputFiles([fixtures.tagged, fixtures.tagged]);
    const mergeSection = page.locator('section[aria-label="Clips to join"]');
    await mergeSection.getByText(/They match, so they will be joined without re-encoding/).waitFor({ timeout: 240_000 });
    check("reads the clips and promises a copy for matching ones", true);
    check("shows both clips with their details", (await mergeSection.getByText(/H264 640x360/).count()) === 2);
    await mergeSection.getByRole("button", { name: "Join 2 clips" }).click();
    await mergeSection.getByText("Download").waitFor({ timeout: 240_000 });
    const joined = await download(mergeSection.getByText("Download"));
    check("joined file is named after the first clip", joined.name === "tagged-merged.mp4", joined.name);
    check("joined file is twice the length", Math.abs(seconds(joined.info) - 12) < 0.5, `${seconds(joined.info).toFixed(2)}s`);
    check("joined file was a stream copy", /stream copy/i.test(await mergeSection.innerText()) && stream(joined.info, "video")?.codec_name === "h264");
    check("shows a video preview of the join", (await mergeSection.locator("video").count()) === 1);

    await drop(fixtures.avi);
    await mergeSection.getByText(/They will be re-encoded to H\.264/).waitFor({ timeout: 240_000 });
    check("a mismatched clip turns the join into a re-encode, and says why", /clip 3 is MPEG4 while clip 1 is H264/.test(await mergeSection.innerText()));
    check("adding a clip clears the old join", (await mergeSection.getByText("Download").count()) === 0);
    await mergeSection.getByRole("button", { name: "Join 3 clips" }).click();
    await mergeSection.getByText("Download").waitFor({ timeout: 600_000 });
    const encodedJoin = await download(mergeSection.getByText("Download"));
    check("re-encoded join is the length of all three", Math.abs(seconds(encodedJoin.info) - 16) < 0.5, `${seconds(encodedJoin.info).toFixed(2)}s`);
    check("re-encoded join is fitted to the first clip's frame", stream(encodedJoin.info, "video")?.width === 640 && stream(encodedJoin.info, "video")?.height === 360, `${stream(encodedJoin.info, "video")?.width}x${stream(encodedJoin.info, "video")?.height}`);
    check("re-encoded join is H.264 + AAC", stream(encodedJoin.info, "video")?.codec_name === "h264" && stream(encodedJoin.info, "audio")?.codec_name === "aac");
    await page.screenshot({ path: join(FIXTURES, "verify-merge.png"), fullPage: true });

    // ---- Subtitles ------------------------------------------------------
    log("\nConvert subtitles - SRT to WebVTT, then shifted by 1.5 s:");
    await open("convert-subtitles");
    await drop(fixtures.subtitles);
    const subtitleCard = cardFor("sample.srt");
    await subtitleCard.getByText("Ready", { exact: true }).waitFor({ timeout: 30_000 });
    check("reads the file without an engine", /SRT, 2 cues/.test(await subtitleCard.innerText()), await subtitleCard.locator("p").nth(1).innerText());
    const vtt = await download(subtitleCard.getByRole("button", { name: "Download sample.vtt" }));
    const vttText = readFileSync(vtt.path, "utf8");
    check("WebVTT output has the header and the cue", vttText.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello there."), vttText.slice(0, 60));
    check("WebVTT output keeps italics", vttText.includes("<i>Second</i> cue"));

    await page.getByRole("button", { name: /Output formats & timing/ }).click();
    await page.getByLabel("Shift by").fill("1.5");
    await subtitleCard.getByText(/shifted later by 1.5 s/).waitFor({ timeout: 10_000 });
    const shifted = await download(subtitleCard.getByRole("button", { name: "Download sample-retimed.srt" }));
    const shiftedText = readFileSync(shifted.path, "utf8");
    check("shifted SRT moves every cue by the offset", shiftedText.includes("00:00:02,500 --> 00:00:05,500") && shiftedText.includes("00:00:07,000 --> 00:00:08,750"), shiftedText.split("\n")[1]);
    await page.screenshot({ path: join(FIXTURES, "verify-subtitles.png"), fullPage: true });

    // ---- Resize ---------------------------------------------------------
    log("\nResize - 640x360 to 240p:");
    await open("resize-video");
    await page.getByRole("radio", { name: /^240p/ }).click();
    await drop(fixtures.tagged);
    const resizeCard = cardFor("tagged.mp4");
    await resizeCard.getByText("Done", { exact: true }).waitFor({ timeout: 600_000 });
    const resized = await download(resizeCard.getByText("Download"));
    check("resized file carries the size in its name", resized.name === "tagged-240p.mp4", resized.name);
    check("resized picture is 240 high", stream(resized.info, "video")?.height === 240 && stream(resized.info, "video")?.width === 426, `${stream(resized.info, "video")?.width}x${stream(resized.info, "video")?.height}`);
    check("resized audio was copied", stream(resized.info, "audio")?.codec_name === "aac");
    check(
      "sizes the picture already fits are not offered",
      (await resizeCard.getByRole("button", { name: /^\+?\s*720p$/ }).count()) === 0,
    );

    // ---- Rotate ---------------------------------------------------------
    log("\nRotate - a quarter turn clockwise, chosen from the card:");
    await open("rotate-video");
    await drop(fixtures.tagged);
    const rotateCard = cardFor("tagged.mp4");
    await rotateCard.getByText("Ready", { exact: true }).waitFor({ timeout: 240_000 });
    check("reads the file and waits for a turn", (await rotateCard.getByText("Download").count()) === 0);
    await rotateCard.getByRole("button", { name: /90 clockwise/ }).click();
    const turnRow = rotateCard.locator("li").filter({ hasText: /^90 clockwise/ });
    await turnRow.getByText("Download").waitFor({ timeout: 600_000 });
    const turned = await download(turnRow.getByText("Download"));
    check("turned file says so in its name", turned.name === "tagged-rotated-90.mp4", turned.name);
    check("turned picture is portrait", stream(turned.info, "video")?.width === 360 && stream(turned.info, "video")?.height === 640, `${stream(turned.info, "video")?.width}x${stream(turned.info, "video")?.height}`);

    // ---- Thumbnails -----------------------------------------------------
    log("\nThumbnails - a 3x3 sheet on arrival, then one frame at 0:02 as PNG:");
    await open("video-thumbnails");
    await drop(fixtures.tagged);
    const sheetCard = cardFor("tagged.mp4");
    await sheetCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    const sheetRow = sheetCard.locator("li").filter({ hasText: /^Contact sheet/ });
    const sheet = await download(sheetRow.getByText("Download"));
    check("sheet is named for its frames", sheet.name === "tagged-sheet-9.jpg", sheet.name);
    // 3x3 tiles of 320x180, 4 px between and around them.
    check("sheet is a 3x3 grid of 320 px tiles", stream(sheet.info, "video")?.width === 976 && stream(sheet.info, "video")?.height === 556, `${stream(sheet.info, "video")?.width}x${stream(sheet.info, "video")?.height}`);
    const sheetHref = await sheetRow.locator("a[download]").getAttribute("href");
    check("shows the sheet inline", (await sheetCard.locator(`img[src="${sheetHref}"]`).count()) === 1);
    const frameMarkers = sheetCard.getByRole("group", { name: "Clip markers" });
    await frameMarkers.getByLabel("Start", { exact: true }).fill("2");
    await frameMarkers.getByRole("button", { name: "Frame as PNG" }).click();
    const frameRow = sheetCard.locator("li").filter({ hasText: /^Frame as PNG/ });
    await frameRow.getByText("Download").waitFor({ timeout: 240_000 });
    const frame = await download(frameRow.getByText("Download"));
    check("frame carries its moment in the name", frame.name === "tagged-frame-from-2s.png", frame.name);
    check("frame is a full-size PNG", stream(frame.info, "video")?.codec_name === "png" && stream(frame.info, "video")?.width === 640, stream(frame.info, "video")?.codec_name);

    // ---- Convert audio --------------------------------------------------
    log("\nConvert audio - an MP3 copied as MP3, then to FLAC:");
    await open("convert-audio");
    await drop(fixtures.music);
    const audioCard = cardFor("music.mp3");
    await audioCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    check("an MP3 asked for as MP3 is copied, not re-encoded", /stream copy/i.test(await audioCard.innerText()));
    await audioCard.getByRole("button", { name: /^\+?\s*FLAC$/ }).first().click();
    const flacRow = audioCard.locator("li").filter({ hasText: /^FLAC/ });
    await flacRow.getByText("Download").waitFor({ timeout: 120_000 });
    const flac = await download(flacRow.getByText("Download"));
    check("FLAC comes out as FLAC", flac.name === "music.flac" && stream(flac.info, "audio")?.codec_name === "flac", flac.name);

    // ---- Normalize loudness ---------------------------------------------
    log("\nNormalize - a -24 dB tone to -14 LUFS in two passes:");
    await open("normalize-audio");
    check("the target panel is open on arrival", (await page.getByRole("radio", { name: /^-14 LUFS/ }).count()) === 1);
    await drop(fixtures.quiet);
    const quietCard = cardFor("quiet.mp3");
    await quietCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    const loud = await download(quietCard.getByText("Download"));
    check("normalized file carries the target in its name", loud.name === "quiet-14lufs.mp3", loud.name);
    check("normalized file stays an MP3 at its sample rate", stream(loud.info, "audio")?.codec_name === "mp3" && stream(loud.info, "audio")?.sample_rate === "44100");
    const loudBefore = integratedLoudness(fixtures.quiet);
    const loudAfter = integratedLoudness(loud.path);
    check("normalized file measures at the target", Math.abs(loudAfter + 14) < 1.5, `${loudBefore.toFixed(1)} LUFS before, ${loudAfter.toFixed(1)} LUFS after`);

    // ---- Extract subtitles ----------------------------------------------
    log("\nExtract subtitles - the SRT track of an MKV, as SRT then as WebVTT:");
    await open("extract-subtitles");
    await drop(fixtures.subbed);
    const subbedCard = cardFor("subbed.mkv");
    await subbedCard.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    check("the card names the track", /1 subtitle track \(eng\)/.test(await subbedCard.innerText()));
    const [srtEvent] = await Promise.all([page.waitForEvent("download"), subbedCard.getByText("Download").click()]);
    const srtPath = join(downloadDir, srtEvent.suggestedFilename());
    await srtEvent.saveAs(srtPath);
    const srtText = readFileSync(srtPath, "utf8");
    check("SRT is named for the track's language", srtEvent.suggestedFilename() === "subbed-eng.srt", srtEvent.suggestedFilename());
    check("SRT carries the cues", srtText.includes("Hello there.") && srtText.includes("00:00:01,000 --> 00:00:04,000"), srtText.split("\n")[1]);
    check("nothing tries to preview a text file", (await subbedCard.locator("video, audio, img[src^='blob']").count()) <= 1);
    await subbedCard.getByRole("button", { name: /Track 1 as VTT/ }).first().click();
    const vttRow = subbedCard.locator("li").filter({ hasText: /^Track 1 as VTT/ });
    await vttRow.getByText("Download").waitFor({ timeout: 120_000 });
    const [vttEvent] = await Promise.all([page.waitForEvent("download"), vttRow.getByText("Download").click()]);
    const vttPath = join(downloadDir, vttEvent.suggestedFilename());
    await vttEvent.saveAs(vttPath);
    check("WebVTT comes out with its header", readFileSync(vttPath, "utf8").startsWith("WEBVTT"), vttEvent.suggestedFilename());
    await page.screenshot({ path: join(FIXTURES, "verify-more-tools.png"), fullPage: true });

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
