# Extract Audio from Video

Pull the audio track out of a video entirely in the browser. Drop one or more files, conversion
starts automatically, and the results can be played inline or downloaded as M4A, MP3, WAV, FLAC,
Opus, or a lossless stream copy of the original track. Outputs can be the whole track or a clip of
it — set markers by hand, or let the app find and cut the silence at either end.

Nothing is uploaded. Decoding happens locally with ffmpeg compiled to WebAssembly, which also means
**videos larger than the usual ~2 GB WebAssembly ceiling work** — a 3 GiB file has been verified
end to end with a peak browser heap of 37 MiB.

The research this implementation is based on is in
[`agent-outputs/`](agent-outputs/audio-extraction-research-and-implementation-plan.md).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

`dev` and `build` first run `scripts/copy-ffmpeg-worker.mjs`, which copies ffmpeg.wasm's class
worker into `public/ffmpeg/` (see [The class worker](#the-class-worker) below).

```bash
npm test             # unit tests for the parsers and format catalogue
npm run typecheck
npm run lint
npm run build        # static export to out/
```

## How it handles files over 2 GB

ffmpeg.wasm is well known for a 2 GB input limit. The limit is real, but it comes from *how the
file is handed to ffmpeg*, not from ffmpeg itself:

| | Ordinary approach | What this app does |
|---|---|---|
| API | `ffmpeg.writeFile(name, await fetchFile(file))` | `ffmpeg.mount(WORKERFS, { blobs: [...] }, "/input")` |
| Where the video lives | Copied into the WebAssembly heap (~2 GB cap) | Stays on disk; read on demand via `Blob.slice` |
| Practical input limit | ~2 GB | No meaningful limit |
| Peak memory | Whole file | Tens of MB |

WORKERFS is a read-only Emscripten filesystem backed by the `File` object. ffmpeg seeks and reads
through it as if it were a local file, so the bytes never enter the heap. Because the mount is
seekable, non-faststart MP4s (whose `moov` atom sits at the end) still work — unlike piped input.

The heap still bounds the **output**, which is a non-issue for audio: two hours of AAC is a few
hundred MB. The one exception is uncompressed WAV, which grows about 11.5 MB per minute, so
`lib/engine/formats.ts` estimates the size up front and suggests FLAC instead of failing after a
long wait.

Verify it yourself (needs ffmpeg on `PATH` and several GB of free disk):

```bash
NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=/core npm run build
node scripts/verify-large-file.mjs
```

It builds a >2 GiB fixture, drives Chromium through a real conversion, checks the output with
`ffprobe`, and samples browser memory throughout.

## Architecture

```
components/          UI: drop zone, queue, per-file cards, format + trim pickers
  *.module.css       plain CSS modules; no utility-class framework
lib/useConversionQueue.ts   sequential job runner, progress + cancellation
lib/engine/
  types.ts           AudioExtractor contract (engine-agnostic)
  ffmpegEngine.ts    ffmpeg.wasm implementation — mount, probe, extract, scan
  coreLoader.ts      fetches the ~31 MB core with byte-level progress
  formats.ts         output catalogue; decides stream-copy vs re-encode
  trim.ts            pure trim logic — ranges, timecodes, silence parsing
  probe.ts           pure parsers for ffmpeg's stderr
  constants.ts       pinned versions and asset URLs
```

Files convert **one at a time**. There is a single ffmpeg worker with a single heap, so concurrency
would multiply peak memory without making anything faster — the work is I/O- and codec-bound, not
parallel.

The UI talks only to the `AudioExtractor` interface. ffmpeg.wasm has been in caretaker mode since
early 2025, so if it needs replacing (or a WebCodecs engine is wanted for speed), that is a
contained change behind the interface rather than a rewrite.

### Stream copy vs re-encode

"Original" and "M4A" copy the audio track without decoding it whenever the source codec already
fits the target container — bit-for-bit identical output, and seconds instead of minutes on a large
file. The UI labels these outputs `STREAM COPY`. Everything else re-encodes.

### Trimming and clipping

An output is a format *and* a range, so one file can produce "the whole thing as MP3" and
"1:30–2:15 as MP3" side by side. Each clipped output is badged with its range in the UI and carries
it in the filename (`holiday-1m30s-2m15s.mp3`), so several clips of one video do not all land in
Downloads under the same name.

There are two ways to set the range:

- **Markers.** Type start and end timecodes (`1:30`, `0:04.5`, `90`). Per-file markers appear on
  the card once the file has been probed, where the duration is known and — when the preview is of
  the untrimmed track — its playback position can be dropped straight into either field.
- **Automatic silence trimming.** ffmpeg's `silencedetect` filter runs over the audio, and the
  leading and trailing silences it reports become the range. Only the head and tail are cut: pauses
  in the middle are left alone, since removing those would re-time the audio, which is a different
  feature.

The arguments are `-ss` **before** `-i` and `-t` **after** it, and both choices matter:

- `-ss` as an *input* option makes ffmpeg seek to the start point rather than decoding and
  discarding everything before it. WORKERFS mounts are seekable, so on a multi-gigabyte file this
  is the difference between instant and minutes.
- `-to` is measured against the input timeline in some ffmpeg versions and the output timeline in
  others, which makes it a coin flip once `-ss` has already shifted timestamps. `-t` is a *length*,
  so it means one thing everywhere.

A range covering the whole file resolves to no arguments at all, which keeps the untrimmed stream
copy byte-exact. A trim also shrinks the estimated WAV size, so a range can bring a long file back
under the output ceiling that would otherwise push it to FLAC.

Silence detection is a full decode of the audio stream (via the null muxer, which writes nothing),
so it costs roughly one re-encode and is only ever run when asked for. It reports progress like any
other phase.

### Cancelling one format

Each output is a format *and* a range, and each can be cancelled on its own. Cancelling one that is
merely queued is free. Cancelling one that is already running is not: ffmpeg blocks its worker for
the whole of a command, so there is no cooperative interrupt and the worker has to be killed.

That is survivable because of where the bytes live. A finished output is a JS `Blob` on the main
thread that never entered the worker, so the downloads already on the card keep working — a 73 MB
stream copy that finished a minute ago is untouched. What the termination *does* cost is the mount,
so any format still queued behind the cancelled one is re-run on a fresh engine, which is why the
run loop reads the next pending output each pass rather than iterating a list fixed before the
first one started.

### Styling

Plain CSS modules, one per component, plus `app/globals.css` for the palette and a small reset.
Colours are CSS custom properties on `:root` with a `prefers-color-scheme` override, so the theme
follows the OS setting with no flash and no JavaScript. There is no utility-class framework and no
PostCSS config; the whole stylesheet is about 17 KB.

### Real-time progress

Every phase reports something, so the app is never silent:

- **Core download** — a real percentage, read from the response stream (~31 MB, once per browser).
- **Probing** — indeterminate; ffmpeg is reading the container.
- **Converting** — a percentage computed from processed media time over the probed duration, or
  over the length of the clip when one is being extracted: input seeking restarts the output
  timeline at zero. ffmpeg's own `progress` ratio is unreliable when it cannot infer a duration, so
  it is not used.
- **Listening for silence** — the same percentage, over the whole file, during a silence scan.
- **Per-file logs** — ffmpeg's raw output, collapsed behind a disclosure, batched at 300 ms so a
  chatty run cannot thrash React.

### Encoder detection

The set of encoders in a given ffmpeg.wasm build is not documented anywhere authoritative, so the
app runs `ffmpeg -encoders` once at startup and greys out any format the loaded core cannot
produce, rather than failing halfway through a conversion.

## Deploying to Cloudflare

The app is a static export served from Workers static assets — no Worker script, so every request
is a free static-asset request.

```bash
npm run build        # -> out/
npx wrangler deploy  # or: npm run deploy
npm run preview      # build + wrangler dev, with _headers applied
```

### The 25 MiB problem

`ffmpeg-core.wasm` is ~30.7 MiB and Cloudflare enforces a hard **25 MiB per static asset**, so the
core cannot ship in `public/`. It is fetched at runtime from jsDelivr, which serves it with
`access-control-allow-origin: *` and an `immutable` cache lifetime.

To self-host instead — worth doing if you would rather not depend on a third party — mirror the two
core files to an R2 bucket (egress is free), put it behind a custom domain, give it a CORS policy,
and point the app at it:

```bash
NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=https://cdn.example.com/ffmpeg npm run build
```

The files to mirror are `ffmpeg-core.js` and `ffmpeg-core.wasm` from
`node_modules/@ffmpeg/core/dist/esm/`.

### Headers

`public/_headers` sets cache headers only. Cross-origin isolation (COOP/COEP) is **not** required,
because the app uses the single-threaded core. The multithreaded core would need
`SharedArrayBuffer` — and therefore those headers — while offering nothing here: audio extraction
is dominated by demuxing rather than parallel codec work, and `@ffmpeg/core-mt` has a *smaller*
fixed 1 GB heap. The commented-out block in `_headers` is there if that trade-off ever changes.

## Implementation notes

Two things about integrating ffmpeg.wasm with Next.js are worth knowing, because both fail in ways
that are hard to diagnose.

### The class worker

`FFmpeg.load()` spawns its worker with
`new Worker(new URL(classWorkerURL, import.meta.url), { type: "module" })`. Next.js chunks are not
ES modules, so webpack replaces `import.meta.url` with a build-time `file:///…` literal. A
root-relative worker path resolved against that base becomes `file:///ffmpeg/worker.js`, and the
Worker constructor throws `SecurityError`. The app therefore passes an **absolute** URL built from
`window.location.origin`.

The worker is also an ES module that relative-imports its siblings, which is why
`scripts/copy-ffmpeg-worker.mjs` copies the whole `dist/esm` directory rather than one file. That
script also asserts the versions pinned in `lib/engine/constants.ts` still match `package.json`, so
a dependency bump cannot silently desync the CDN URL.

### ESM core, not UMD

The class worker is a module worker, so `importScripts` is unavailable and it falls back to
`(await import(coreURL)).default`. For the UMD core that is `undefined`, and the assignment then
clobbers the global the UMD bundle had just set — surfacing as `failed to import ffmpeg-core.js`.
The `dist/esm` build has a real default export and must be used.

## Verification

```bash
npm test                                                    # 95 unit tests
NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=/core npm run build
node scripts/verify-e2e.mjs                                 # 41 browser checks
node scripts/verify-large-file.mjs                          # >2 GiB input
```

`verify-e2e.mjs` drives a real Chromium through seven cases — an MP4 with AAC, a video with no
audio track, an MKV with 5.1 FLAC, a hand-set 1s–3s clip, an 8s file padded with two seconds of
silence at each end, an MP3 cancelled mid-conversion, and that same MP3 retried — and validates
every downloaded file with `ffprobe`. The clip comes back 2.04s long and automatic trimming turns
the padded file into 4.22s; cancelling MP3 on a 5-minute file leaves the finished stream copy
downloadable and still converts the M4A queued behind it, over the whole 5 minutes, on a rebuilt
engine. It serves the core locally so the run is hermetic, which also exercises the
self-hosted-core configuration.

Not yet verified: Safari. ffmpeg.wasm's WORKERFS pull request reported heavier memory growth there
during large reads, so a real Safari pass on a multi-gigabyte file is the main open question before
calling large-file support universal.

## Known limitations

- Only the first audio track is extracted; files with several are labelled but not selectable.
- Silence is only removed from the beginning and end. Cutting the pauses in the middle would need a
  filter graph and would re-time what is left, so it is deliberately out of scope.
- Markers are typed rather than dragged on a waveform. Drawing one would mean decoding the audio to
  PCM up front — a second full pass, on top of the extraction itself.
- WAV output is capped near 1.5 GB by the engine's in-memory output buffer (~2.9 hours of 48 kHz
  stereo). FLAC is suggested instead.
- Cancelling terminates the ffmpeg worker, since ffmpeg blocks its worker while running and cannot
  be interrupted cooperatively. See [Cancelling one format](#cancelling-one-format) for why that is
  survivable. The engine restarts on the next job; the core is already cached, so this costs a
  WebAssembly instantiation, not a 31 MB download.
