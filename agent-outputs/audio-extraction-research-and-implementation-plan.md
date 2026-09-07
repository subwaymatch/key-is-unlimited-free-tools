# In-Browser Audio Extraction from Video - Research Report & Implementation Plan

**Project:** Next.js audio-extraction app, deployed to Cloudflare, processing 100% client-side via WebAssembly
**Date:** 2026-08-28
**Status:** Research complete - feasibility confirmed, implementation plan below

---

## 1. Executive summary

**The app is feasible as specified, including videos well over 2 GB.**

- **ffmpeg.wasm works past its famous "2 GB limit"** - but only via one specific mechanism. The default API (`writeFile`) copies the whole video into ffmpeg's in-memory filesystem (MEMFS), which lives inside a WASM heap capped at 2 GB. The workaround is **WORKERFS mounting** (`ffmpeg.mount()`, available since v0.12.7): the dropped `File` is mounted read-only and read directly from disk on demand, so the video never enters memory. This is community-verified with a **13.2 GB MKV** and a 5 GB MP4. Only the *output* must fit in the heap - and extracted audio is small, so this fits the audio-extraction use case almost perfectly.
- **Cloudflare hosting works, with one catch**: the ~31 MiB `ffmpeg-core.wasm` exceeds Cloudflare's hard **25 MiB per-static-asset limit**, so the core must be loaded at runtime from a CDN (jsDelivr/unpkg - both verified to send the right CORS/CORP headers) or from a Cloudflare R2 bucket (free egress). Everything else deploys as a free, unlimited static-asset site: Next.js `output: 'export'` served as **Cloudflare Workers static assets** (Pages is now de-facto legacy for new projects).
- **Use the single-threaded core.** Audio extraction is dominated by demuxing (I/O), not parallelizable codec work. The multithreaded core would require COOP/COEP headers (SharedArrayBuffer) *and* has a fixed 1 GB heap - strictly worse here. Skipping it also means no cross-origin-isolation headaches at all.
- **Real-time progress is supported**: ffmpeg.wasm emits `progress` and `log` events per job, enough to drive per-file live progress bars, with caveats handled in section 6.5.
- **Plan for ffmpeg.wasm's weak maintenance.** The project is in caretaker mode (last release Jan 2025, ~387 open issues) though still hugely used (~714k downloads/week). The plan isolates ffmpeg behind a small `AudioExtractor` interface so the engine could later be swapped for **Mediabunny** (a very actively maintained, streaming-first TypeScript/WebCodecs library that independently confirms this whole product category is viable - see section 7).

**Recommended stack:** Next.js (App Router, static export) + TypeScript + Tailwind -> Cloudflare Workers static assets - `@ffmpeg/ffmpeg` 0.12.15 + single-thread `@ffmpeg/core` 0.12.10 loaded from CDN/R2 - WORKERFS input mounting - sequential job queue with live progress - outputs: M4A/AAC, MP3, WAV, OGG (Opus), FLAC, plus a lossless "original codec" stream-copy mode.

---

## 2. Requirements recap

1. Next.js app deployable to Cloudflare.
2. Audio extraction from video happens in the browser via WASM (user preference: **ffmpeg.wasm**).
3. Drag & drop one **or more** video files; conversion starts automatically.
4. Listen to converted audio in-app; download in **multiple file formats**.
5. Support videos **well over 2 GB**, using workarounds where needed.
6. **Real-time progress feedback** - the user is never left waiting without an indicator.

---

## 3. Research findings A - ffmpeg.wasm and the 2 GB problem

### 3.1 Current versions and sizes

| Package | Latest | Published | Notes |
|---|---|---|---|
| `@ffmpeg/ffmpeg` | 0.12.15 | 2025-01-07 | JS API wrapper (spawns its own worker) |
| `@ffmpeg/core` | 0.12.10 | 2025-01-07 | `ffmpeg-core.wasm` = 32,232,419 B ~ **30.7 MiB** |
| `@ffmpeg/core-mt` | 0.12.10 | 2025-04-28 | `ffmpeg-core.wasm` = 32,718,323 B ~ **31.2 MiB** + tiny worker JS |
| `@ffmpeg/util` | 0.12.2 | 2025-01-07 | `fetchFile`, `toBlobURL` helpers |

Both cores are **above Cloudflare's 25 MiB static-asset limit** (see section 4.2).

### 3.2 What the "2 GB limit" actually is

It is a stack of three separate limits ([official FAQ](https://ffmpegwasm.netlify.app/docs/faq): "2 GB, which is a hard limit in WebAssembly"):

1. **Emscripten heap cap.** The single-thread core is built with `-sALLOW_MEMORY_GROWTH` and Emscripten's default `MAXIMUM_MEMORY` of **2 GB**. The multithread core is built with a **fixed 1 GB heap** and *no* growth (growth + threads is discouraged). Neither build opts into wasm32's theoretical 4 GB. (Verified in [`build/ffmpeg-wasm.sh`](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/build/ffmpeg-wasm.sh).)
2. **MEMFS staging.** `ffmpeg.writeFile()` copies the entire input into the in-memory Emscripten FS, *inside* that heap - so input + output + ffmpeg working memory must all fit under 2 GB (or 1 GB for mt).
3. **JS-side ArrayBuffer limits.** Materializing >2 GB into a single ArrayBuffer fails in browsers before WASM is even involved ([discussion #755](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/755)).

Dead ends checked so far: the one-line 4 GB heap bump ([PR #893](https://github.com/ffmpegwasm/ffmpeg.wasm/pull/893)) has been unmerged for a year; there is **no official wasm64 build**, and wasm64 would exclude all Safari/iOS users anyway ([caniuse](https://caniuse.com/wf-wasm-memory64): Chrome 133+, Firefox 134+, Safari none). Byte-slicing the input file (`File.slice` chunking) does **not** work for MP4/MKV because chunks lack container metadata (MP4's `moov` atom may sit at the end of the file - "moov atom not found").

### 3.3 The workaround that works: WORKERFS mounting

`FFmpeg.mount(FFFSType.WORKERFS, { files: [file] }, '/mnt')` mounts the dropped `File` object into ffmpeg's filesystem **read-only, backed by `Blob.slice`** - reads happen on demand from disk, and the file never enters the WASM heap.

- Added in [PR #581](https://github.com/ffmpegwasm/ffmpeg.wasm/pull/581), shipped in **v0.12.7**; API: [`mount`/`unmount`](https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/FFmpeg/).
- **Verified at scale by the community**: a **13.2 GB MKV** read with Firefox memory staying at ~66 MB ([discussion #516](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/516)); a **5 GB video trimmed** successfully with an [example repo](https://github.com/pavloshargan/ffmpeg-browser-4gb-plus) ([discussion #755](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/755)).
- Because the mount is a *seekable* file (unlike piped input), ffmpeg can seek to a trailing `moov` atom in non-faststart MP4s.

**Remaining constraints:**

- WORKERFS is **read-only - output is still written to MEMFS**, so the output must fit in the 2 GB heap. For audio this is almost always fine (3 h of 256 kbps AAC ~ 330 MB). The one edge case: **uncompressed WAV** of very long videos (~11.5 MB/min for 16-bit/48 kHz stereo -> 2 GB ~ ~2.9 hours; WAV's RIFF format itself caps at 4 GiB). Mitigation in section 6.7.
- During PR #581 testing, **Safari** showed heavier memory growth during WORKERFS reads (suspected caching into RAM). Safari needs explicit testing in Phase 5; the fallback engine (section 7) is the insurance policy.

### 3.4 Single-thread vs multi-thread core

Choose **single-thread** (`@ffmpeg/core`):

| | Single-thread | Multi-thread (`core-mt`) |
|---|---|---|
| Heap | grows to 2 GB | **fixed 1 GB** |
| COOP/COEP / SharedArrayBuffer required | **No** | Yes |
| Speed on codec-bound work | baseline | ~2x faster |
| Speed on audio stream-copy / audio encode | ~ same (demux is I/O-bound; audio encoders are effectively single-threaded) | ~ same |

For this workload, mt costs heap and deployment complexity and buys nothing. Skipping it also means **no cross-origin isolation is needed at all**, which keeps the door open for third-party embeds and simplifies local dev.

### 3.5 Extraction modes and expected performance

ffmpeg.wasm compiles the stock ffmpeg CLI, so both classic modes work:

- **Stream copy (lossless, fast):** `-i input -vn -acodec copy out.m4a` - demux + remux only, no decode/encode. Bounded by WORKERFS read speed; realistically tens of seconds to a few minutes for multi-GB files, not the ~25x WASM slowdown that applies to encoding.
- **Re-encode (format conversion):** `-i input -vn -c:a libmp3lame -q:a 2 out.mp3` etc. This is where WASM's slowdown is felt - a long video can take minutes. Live progress (section 6.5) matters most here.

The core includes the encoders this app needs: native `aac`, `libmp3lame` (MP3), `libopus`/`libvorbis` (OGG), native `flac`, and PCM (WAV). (Phase 0 verifies the exact encoder list at runtime with `ffmpeg -encoders`.)

### 3.6 Maintenance status (risk)

Last npm release Jan 2025; last meaningful repo activity mid-2025; ~387 open issues, including an unanswered ["Is this project maintained?"](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/939). Still ~714k weekly downloads and functionally solid. **Mitigations:** pin exact versions, load the core from pinned immutable CDN URLs (or self-host on R2), and hide ffmpeg behind an engine interface so it can be replaced (section 7).

---

## 4. Research findings B - Cloudflare deployment

### 4.1 Which Cloudflare product

**Cloudflare Workers static assets** is the recommended target. Cloudflare's own [best-practices doc](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) says to start new projects on Workers, not Pages (Pages docs now carry a "use Workers instead" banner). For a fully static site, you point `assets.directory` at the build output and ship **no Worker script at all** - and [static-asset requests are free and unlimited](https://developers.cloudflare.com/workers/platform/pricing/) on every plan.

For Next.js specifically there are three paths; the first is right for this app:

| Path | Fit |
|---|---|
| **`output: 'export'` -> static assets** | Yes. App is 100% client-side; every response is a free static asset; simplest, no server runtime, `_headers` applies to all responses |
| `@opennextjs/cloudflare` | Mature but adds a Worker runtime, billable invocations, and a worker-size budget - buys nothing here |
| `vinext` | Cloudflare's new Vite-based Next.js runtime - still experimental; same "buys nothing" argument |

### 4.2 The 25 MiB problem and how to load the ffmpeg core

Both Workers static assets and Pages enforce **25 MiB per file** ([limits](https://developers.cloudflare.com/workers/platform/limits/)). `ffmpeg-core.wasm` is ~30.7 MiB -> **it cannot ship in `public/`**; `wrangler deploy` would reject it.

Two verified workarounds (do **A** first, **B** as a hardening step):

- **A. Third-party CDN + `toBlobURL`** - what ffmpeg.wasm's own docs do. Load from jsDelivr/unpkg pinned to `@ffmpeg/core@0.12.10`. Both CDNs were verified (2026-08-28) to send `Access-Control-Allow-Origin: *` **and** `Cross-Origin-Resource-Policy: cross-origin`, plus `cache-control: ... immutable` on jsDelivr - so the ~31 MB download is a one-time cost per browser. `toBlobURL` fetches with CORS and re-serves via a same-origin `blob:` URL, which is also why the worker scripts can be instantiated from it.
- **B. Cloudflare R2 (first-party hosting)** - free tier: 10 GB storage, and **egress is free** on all tiers ([pricing](https://developers.cloudflare.com/r2/pricing/)). Use a **custom domain** (the `r2.dev` subdomain is rate-limited, dev-only) and set a bucket [CORS policy](https://developers.cloudflare.com/r2/buckets/cors/). Removes the third-party availability dependency.

### 4.3 Headers

Since the plan uses the single-thread core, **no COOP/COEP headers are required**. The [`_headers` file](https://developers.cloudflare.com/workers/static-assets/headers/) (same format as Pages, placed in `public/` so it lands in `out/`) is still used for cache control - and is the ready-made slot for COOP/COEP if multithreading is ever adopted:

```
# public/_headers
/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

# Only needed if @ffmpeg/core-mt is ever adopted:
# /*
#   Cross-Origin-Opener-Policy: same-origin
#   Cross-Origin-Embedder-Policy: require-corp
```

Note: with `output: 'export'`, `headers()` in `next.config` is unsupported - `_headers` is the production mechanism, and `wrangler dev` serves `out/` with it applied for production-parity testing.

### 4.4 Next.js-specific integration pitfalls (known, with fixes)

- **SSR/prerender breaks on import**: `@ffmpeg/ffmpeg` touches `Worker` at load time. Import it only inside a `'use client'` component via dynamic `import()` (or `next/dynamic` with `ssr: false`). ([#678](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/678), [#769](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/769))
- **Bundler mangles the class-worker URL**: `@ffmpeg/ffmpeg` spawns its worker via `new Worker(new URL('./worker.js', import.meta.url))`, which webpack/Turbopack can rewrite or lose (Next 15 + Turbopack breakage: [#793](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/793)). Robust fix: pass **`classWorkerURL`** explicitly to `ffmpeg.load()` as a same-origin/blob URL, so nothing depends on bundler URL rewriting.
- **Config**: `next.config.ts` with `output: 'export'`; `wrangler.jsonc` with just `{ "assets": { "directory": "./out" } }` and no `main`.

### 4.5 Cost profile

Effectively **$0**: video bytes never leave the user's machine, static-asset requests are free and unlimited, the wasm comes from a free CDN (or free-egress R2), and there are no Worker invocations. Deploys via `wrangler deploy` locally or Workers Builds/GitHub Actions.

---

## 5. Research findings C - beyond 2 GB without ffmpeg: the fallback landscape

This matters for two reasons: as **insurance** against ffmpeg.wasm's caretaker-mode risk and Safari unknowns, and for the one **output-size edge case** (section 3.3) that MEMFS can't handle.

### 5.1 Mediabunny - the strongest alternative

[Mediabunny](https://mediabunny.dev/) (v1.55.x, released days ago; 7k+ stars; MPL-2.0; successor to mp4-muxer/webm-muxer) is a **pure-TypeScript, WebCodecs-based** media toolkit - "like FFmpeg, but built from the ground up for the web":

- **Streaming everywhere**: `BlobSource` reads the dropped file lazily in slices (~8 MiB resident regardless of file size - 10 GB inputs are fine); `StreamTarget` writes output incrementally with backpressure, straight into OPFS or `showSaveFilePicker()` - **no output size cap**, which covers the WAV edge case.
- **Formats**: reads MP4/MOV/MKV/WebM/Ogg/MP3/WAV/ADTS/FLAC/MPEG-TS; writes WAV, MP3, Ogg, FLAC, ADTS, MP4/M4A. Its `Conversion` API **stream-copies when codecs match** (AAC-in-MP4 -> M4A needs no decoding at all) and re-encodes via WebCodecs only when needed.
- **Codec gaps patched by tiny WASM extensions**: `@mediabunny/mp3-encoder` (LAME, ~130 kB gzipped - browsers can't encode MP3 via WebCodecs) and `@mediabunny/aac-encoder` (for Firefox/Linux, where WebCodecs AAC encode is missing).
- **Trade-off**: depends on WebCodecs audio - Chrome/Edge 94+, Firefox 130+, **Safari only since 26.0 (Sept 2025)**, not on Firefox for Android. Codec-copy paths work even without WebCodecs.
- Bundle: ~5-70 kB gzipped (tree-shakable) vs ffmpeg's 31 MiB core.

### 5.2 libav.js

[libav.js](https://github.com/Yahweasel/libav.js) (6.10.x, actively maintained, LGPL): FFmpeg's libraries compiled to WASM with **real streaming device I/O** - "no restriction on file sizes". Focused builds are only 1.5-3 MiB. Lower-level, C-flavored API; the `obsolete` variant adds MP3/LAME. A solid fallback for browsers without WebCodecs; also offers a WebCodecs polyfill.

### 5.3 Output-delivery practicalities (multi-GB safety)

- Blob + `<a download>` is fine for typical audio outputs (hundreds of MB); Chromium pages large blobs to disk (2 GB in-memory cap on desktop, then disk-backed).
- For guaranteed multi-GB output safety: stream via `showSaveFilePicker()` (Chromium only) or write to **OPFS** (Chrome 86+/Firefox 111+/Safari 15.2+, generous quotas - up to ~60% of disk in Chromium) and hand the user the disk-backed `File`. StreamSaver.js is legacy - do not use.

### 5.4 Engine comparison

| | ffmpeg.wasm + WORKERFS | Mediabunny (+ WASM encoders) | libav.js |
|---|---|---|---|
| >2 GB **input** | Yes (verified 13.2 GB) | Yes (streaming by design) | Yes (device I/O) |
| >2 GB **output** | No, MEMFS cap | Yes, StreamTarget | Yes |
| Container coverage | Widest (all of ffmpeg) | MP4/MOV/MKV/WebM/TS/... (no AVI/WMV) | Wide (build-dependent) |
| Works without WebCodecs | Yes | Copy-only paths | Yes |
| Download size | ~31 MiB core | ~5-200 kB | 1.5-3 MiB |
| Maintenance | Caution, caretaker mode | Yes, very active | Yes, active |
| API effort | Low (CLI strings) | Low (high-level Conversion API) | High |

**Conclusion:** ffmpeg.wasm satisfies the requirements today (user preference honored, widest format support, one engine for every browser). Mediabunny is the designated fallback/v2 engine; the architecture keeps that swap cheap.

---

## 6. Implementation plan

### 6.1 Architecture overview

```
+- Browser ------------------------------------------------------+
|  Next.js UI (static export)                                    |
|  +----------+   +--------------+   +------------------------+  |
|  | DropZone |-->| Job queue    |-->| FFmpegEngine (worker)  |  |
|  | multi-   |   | (sequential, |   | - load core (CDN/R2)   |  |
|  | file     |   |  cancellable)|   | - mount(WORKERFS,file) |  |
|  +----------+   +------+-------+   | - exec(-vn ...)        |  |
|                        | progress  | - readFile -> Blob     |  |
|  +---------------------v--------+  | - unmount, cleanup     |  |
|  | FileCard: phase + % bar,     |  +------------------------+  |
|  | <audio> player, downloads    |      31 MiB core from        |
|  +------------------------------+      jsDelivr / R2 ----------+--> CDN
+----------------------------------------------------------------+
   Deployed as Cloudflare Workers static assets (free, no Worker script)
```

Key decisions:

- **Engine interface**: `AudioExtractor { probe(file); extract(file, format, onProgress): Job }` - `FFmpegEngine` today, `MediabunnyEngine` possible later without UI changes.
- **Sequential queue** (concurrency 1): one ffmpeg instance; bounds memory; simpler progress. Files auto-start on drop in arrival order.
- **State machine per job**: `queued -> loading-engine -> probing -> extracting(percent) -> done | error | cancelled`, mirrored 1:1 in the UI.

### 6.2 Project scaffold

```
app/
  layout.tsx, page.tsx, globals.css
components/
  DropZone.tsx          # drag & drop + click-to-browse, multi-file
  FileQueue.tsx         # list of FileCards
  FileCard.tsx          # phase label, progress bar, player, downloads
  FormatPicker.tsx      # global output-format selection
lib/
  engine/
    types.ts            # AudioExtractor interface, Job, ProbeResult
    ffmpegEngine.ts     # load / mount / exec / events / terminate
    coreLoader.ts       # toBlobURL from pinned CDN or R2, cached promise
    probe.ts            # parse `-i` stderr -> duration, audio codec
    formats.ts          # format table -> ffmpeg args + mime + extension
  queue.ts              # sequential job runner, cancellation
  download.ts           # Blob URLs, save helpers, revocation
public/
  _headers
next.config.ts          # output: 'export'
wrangler.jsonc          # { assets: { directory: "./out" } }
```

### 6.3 Engine core (the load-bearing code)

```ts
// coreLoader.ts - core is >25 MiB, so it CANNOT be a static asset (section 4.2)
import { toBlobURL } from '@ffmpeg/util';
const CDN = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';

export async function loadFFmpeg(onProgress: (p: LoadPhase) => void) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');   // client-only!
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => logBuffer.push(message));
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CDN}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CDN}/ffmpeg-core.wasm`, 'application/wasm'),
    // classWorkerURL: same-origin copy of @ffmpeg/ffmpeg's worker chunk,
    // to sidestep bundler new URL() rewriting (issue #793)
  });
  return ffmpeg;
}

// ffmpegEngine.ts - the >2 GB path: mount, never writeFile
import { FFFSType } from '@ffmpeg/ffmpeg';

async function extract(ffmpeg: FFmpeg, file: File, fmt: Format,
                       onProgress: (ratio: number) => void) {
  await ffmpeg.createDir('/mnt');
  await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, '/mnt');
  try {
    const dur = await probeDuration(ffmpeg, `/mnt/${file.name}`); // section 6.5
    ffmpeg.on('progress', ({ time }) => onProgress(clamp01(time / 1e6 / dur)));
    const out = `out.${fmt.ext}`;
    await ffmpeg.exec(['-i', `/mnt/${file.name}`, '-vn', ...fmt.args, out]);
    const data = await ffmpeg.readFile(out);            // audio-sized, fits MEMFS
    await ffmpeg.deleteFile(out);
    return new Blob([data], { type: fmt.mime });
  } finally {
    await ffmpeg.unmount('/mnt');
  }
}
```

Cancellation: `ffmpeg.terminate()` kills the worker; the engine then reloads lazily for the next job.

### 6.4 Output formats

| Format | ffmpeg args | Mode | Notes |
|---|---|---|---|
| **Original (lossless)** | `-acodec copy` | stream copy | Fastest; container picked from probed codec: AAC->`.m4a`, MP3->`.mp3`, Opus/Vorbis->`.ogg`, FLAC->`.flac`, PCM->`.wav`, else->`.mka` |
| **M4A (AAC)** | `-c:a aac -b:a 192k` (copy if source is AAC) | copy/encode | Default output |
| **MP3** | `-c:a libmp3lame -q:a 2` | encode | Universal compatibility |
| **WAV** | `-c:a pcm_s16le` | encode | See size guard section 6.7 |
| **OGG (Opus)** | `-c:a libopus -b:a 128k` | encode | Best quality/size |
| **FLAC** | `-c:a flac` | encode | Lossless compressed |

UI: format checkboxes (default: Original + MP3), applied to all dropped files; per-file re-convert to additional formats after the fact. Playback via `<audio controls src={URL.createObjectURL(blob)}>` (all listed formats are playable in modern browsers except FLAC-in-Safari edge cases - the player uses the M4A/MP3 output when available). Downloads via `<a download>` object URLs, revoked on card removal; "Download all" iterates the anchors (zipping is a non-goal at these sizes).

### 6.5 Real-time progress (explicit requirement)

Every phase gives feedback; no spinner-less waits:

1. **Core download (first job only, ~31 MiB):** fetch the wasm manually with a streaming reader and `Content-Length` to show a real percentage, then hand the bytes to a blob URL (equivalent of `toBlobURL` with progress). Cached by the browser afterwards (`immutable` on jsDelivr).
2. **Probe (fast):** indeterminate bar, "Reading file info...". A no-output `-i` run's stderr yields `Duration: HH:MM:SS.cc` and the audio codec line - parsed by `probe.ts`.
3. **Extraction:** `ffmpeg.on('progress', ({ progress, time }))`. The built-in `progress` ratio is **unreliable when ffmpeg can't infer duration** (a known 0.12.x wart) - so the UI computes its own ratio: `time` (us of media processed) / probed duration. Stream-copy jobs finish in seconds; encode jobs get a live percentage + processed-time label (e.g., "12:34 / 1:56:00").
4. **Finalizing:** brief indeterminate state around `readFile`/Blob creation.
5. **Queue-level**: overall "file 2 of 5" indicator; per-card phase labels throughout.

The `log` event stream is kept in a collapsible "details" panel per file - invaluable for bug reports.

### 6.6 UX flow

1. Landing page = one large drop zone ("Drop videos here - they never leave your device"). Multi-drop and folder-picker supported.
2. On drop, each file becomes a card and the queue starts immediately (requirement: auto-start). The engine loads on first use, with the download progress bar from section 6.5.
3. Cards show live phase/progress, then flip to: inline audio player, per-format download buttons, file sizes, duration, and "convert to another format".
4. Errors are per-card (unsupported container, no audio track, out-of-memory), never page-level; the queue continues with the next file.
5. Privacy note in the footer: all processing is local; no upload ever happens (also the honest answer to "why is it this fast/slow").

### 6.7 Large-file guardrails

- **Input >2 GB:** handled structurally by WORKERFS (section 3.3) - no special casing needed, but Phase 0 verifies it on real 3-8 GB files in Chrome, Firefox, Safari.
- **Output size guard:** before a WAV job, estimate size (`duration x sampleRate x channels x 2 B`); if the estimate approaches ~1.5 GB, warn and suggest FLAC (lossless, ~50-60% smaller) instead. This is the only spot where the MEMFS output cap can realistically bite.
- **Memory hygiene:** unmount + delete outputs after each job; revoke object URLs on card removal; one job at a time.
- **Safari:** dedicated test pass for WORKERFS memory behavior (section 3.3); if Safari proves problematic on multi-GB files, gate huge files there behind the Mediabunny fallback engine (section 7) or a "use Chrome/Firefox for files over N GB" notice - decision point at Phase 5.

### 6.8 Deployment pipeline

1. `next build` (static export) -> `out/`.
2. `wrangler.jsonc`: `{ "name": "extract-audio", "compatibility_date": "2026-08-28", "assets": { "directory": "./out" } }` - assets-only Worker, all requests free.
3. `wrangler deploy` locally; GitHub Actions with `cloudflare/wrangler-action` (or Workers Builds git integration) for CI/CD.
4. `wrangler dev` for production-parity local serving of `out/` + `_headers`.
5. Hardening step: mirror the pinned `@ffmpeg/core` files to an R2 bucket behind a custom domain with a CORS policy, and flip `coreLoader.ts`'s base URL - removes the jsDelivr dependency.

### 6.9 Phases & estimates

| Phase | Scope | Est. |
|---|---|---|
| **0. Feasibility spike** | Throwaway page: load core from CDN, WORKERFS-mount a >4 GB file, stream-copy + MP3-encode, verify encoder list (`-encoders`), measure timings in Chrome/Firefox/Safari. **Go/no-go gate for section 3.3's Safari caveat.** | 1-2 d |
| **1. Scaffold + deploy** | Next.js static export, Tailwind, `wrangler` config, `_headers`, CI deploy to a `*.workers.dev` URL from day one | 0.5-1 d |
| **2. Engine wrapper** | `coreLoader` (with download progress), `ffmpegEngine` (mount/exec/readFile/unmount, cancel), `probe`, `formats`, unit tests for arg-building & stderr parsing | 2-3 d |
| **3. Queue + progress UI** | DropZone, FileQueue/FileCard state machine, live progress wiring, error surfaces | 2-3 d |
| **4. Playback + downloads** | Audio player, per-format downloads, format picker, re-convert, WAV size guard | 1-2 d |
| **5. Large-file & browser hardening** | 3-8 GB test matrix (Chrome/Firefox/Safari/Edge, one mobile pass), memory profiling, Safari decision (section 6.7), copy-mode container mapping edge cases | 2-3 d |
| **6. Polish** | Empty/loading states, a11y (keyboard drop-zone, aria-live progress), privacy footer, R2 core mirror, README | 1-2 d |
| | **Total** | **~10-16 d** |

Testing approach: unit tests (vitest) for `formats.ts`/`probe.ts`; Playwright e2e with small fixture videos for the full drop->convert->play->download flow; large-file tests stay manual/scripted (fixtures generated locally with native ffmpeg, e.g. `ffmpeg -f lavfi -i testsrc2 -t 4:00:00 ...`) since multi-GB fixtures don't belong in CI.

### 6.10 Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| ffmpeg.wasm abandonment | Medium | Pinned versions + blob-loaded core keep working indefinitely; `AudioExtractor` interface makes a Mediabunny swap a contained change (section 7) |
| Safari memory growth on WORKERFS multi-GB reads | Medium | Phase 0/5 testing; per-browser gate or fallback engine |
| WAV output > MEMFS cap on very long videos | Low | Pre-flight size estimate + FLAC suggestion (section 6.7) |
| jsDelivr outage/blocking | Low | R2 mirror behind own domain (section 6.8) |
| Bundler breaks ffmpeg's worker URL (Turbopack) | Medium | Explicit `classWorkerURL`; pin Next version; e2e test catches regressions |
| Built-in `progress` event garbage values | High (known) | Computed ratio from probed duration + `time` (section 6.5) |
| iOS memory limits on huge files | Medium | It's a desktop-first workload; document limits, test in Phase 5 |

---

## 7. Fallback / v2 path (documented decision)

If Phase 0/5 reveal a blocker (most plausibly Safari + multi-GB WORKERFS), or when >2 GB *outputs* or faster conversions become requirements, the designated successor engine is **Mediabunny** (section 5.1): `MediabunnyEngine` implements the same `AudioExtractor` interface using `BlobSource` (streaming input), `Conversion` with `video: { discard: true }` (stream-copy where possible, WebCodecs otherwise), `@mediabunny/mp3-encoder` / `@mediabunny/aac-encoder` for codec gaps, and `StreamTarget`->OPFS for unbounded outputs. Browsers without WebCodecs audio (Safari <= 18, Firefox Android) would remain on the ffmpeg.wasm engine - which is why the plan ships ffmpeg.wasm first rather than Mediabunny-only.

---

## 8. Key sources

**ffmpeg.wasm:** [FAQ (2 GB limit)](https://ffmpegwasm.netlify.app/docs/faq) - [Usage docs](https://ffmpegwasm.netlify.app/docs/getting-started/usage/) - [Performance](https://ffmpegwasm.netlify.app/docs/performance/) - [FFmpeg class API (mount/unmount)](https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/FFmpeg/) - [PR #581 WORKERFS](https://github.com/ffmpegwasm/ffmpeg.wasm/pull/581) - [Discussion #516 (13.2 GB test)](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/516) - [Discussion #755 (5 GB example)](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/755) - [ffmpeg-browser-4gb-plus example](https://github.com/pavloshargan/ffmpeg-browser-4gb-plus) - [PR #893 (4 GB, unmerged)](https://github.com/ffmpegwasm/ffmpeg.wasm/pull/893) - [Issue #939 (maintenance)](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/939) - [Build flags](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/build/ffmpeg-wasm.sh) - [Emscripten MAXIMUM_MEMORY](https://emscripten.org/docs/tools_reference/settings_reference.html) - [wasm64 support](https://caniuse.com/wf-wasm-memory64)

**Cloudflare:** [Workers best practices (use Workers, not Pages)](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) - [Platform limits (25 MiB assets)](https://developers.cloudflare.com/workers/platform/limits/) - [Static-asset `_headers`](https://developers.cloudflare.com/workers/static-assets/headers/) - [Pricing (free asset requests)](https://developers.cloudflare.com/workers/platform/pricing/) - [R2 pricing (free egress)](https://developers.cloudflare.com/r2/pricing/) - [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) - [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) - [Next.js framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) - [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports) - [Next+Turbopack worker issue #793](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/793)

**Alternatives:** [Mediabunny](https://mediabunny.dev/) - [Formats & codecs](https://mediabunny.dev/guide/supported-formats-and-codecs) - [Reading (BlobSource)](https://mediabunny.dev/guide/reading-media-files) - [Conversion API](https://mediabunny.dev/guide/converting-media-files) - [MP3 encoder extension](https://mediabunny.dev/guide/extensions/mp3-encoder) - [libav.js](https://github.com/Yahweasel/libav.js) - [libav.js device I/O](https://github.com/Yahweasel/libav.js/blob/master/docs/IO.md) - [web-demuxer](https://github.com/ForeverSc/web-demuxer) - [WebCodecs codec support](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection) - [Safari 26 WebCodecs audio](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) - [Storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) - [Chromium blob storage](https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob/README.md)
