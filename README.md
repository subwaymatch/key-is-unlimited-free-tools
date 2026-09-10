# key.is: free browser tools with no file size limit

A site of file tools that run entirely in the browser through ffmpeg compiled to WebAssembly.
Nothing is uploaded, so there is no server to charge for, throttle, or cap a file, and **videos
larger than the usual ~2 GB WebAssembly ceiling work** - a 3 GiB file has been verified end to end
with a peak browser heap of 37 MiB.

The live tools, each on its own route:

| Route | What it does | How |
| --- | --- | --- |
| `/extract-audio` | Pull the audio out of a video as M4A, MP3, WAV, FLAC, Opus or a stream copy, whole or clipped | The original tool; see [Stream copy vs re-encode](#stream-copy-vs-re-encode) and [Trimming](#trimming-and-clipping) |
| `/convert-video` | Turn MOV, MKV, AVI, WebM or anything else into an MP4 that plays anywhere (or WebM, or an MKV remux) | Copies an H.264 track and an AAC track when the source already has them; encodes only what does not fit |
| `/compress-video` | Shrink a video to a target size: 8 MB, 25 MB, 100 MB or any number | Bitrate computed from the probed length, two-pass H.264, automatic downscaling when the bitrate cannot fill the frame |
| `/trim-video` | Cut a range out of a video | A fast cut copies the streams and lands on the nearest keyframe; a precise cut re-encodes to the frame |
| `/video-to-gif` | Turn a range into a looping GIF | `palettegen` and `paletteuse` in one filter graph, at a chosen frame rate and width |
| `/remove-audio` | Mute a video | `-an` with the video stream copied |
| `/remove-metadata` | Strip tags, dates, location, chapters and data tracks from a video or audio file | `-map_metadata -1` with every stream copied |

Every tool is one configuration of the same machinery: a catalogue of formats in `lib/engine/`,
a page shell in `components/ToolApp.tsx`, and an entry in the registry in `lib/tools.ts` that
puts it on the index, in the header and footer, in the related-tools block and in the sitemap.
Adding a tool is a registry entry, a catalogue and a page.

The research behind the site is in [`agent-outputs/`](agent-outputs/): the
[audio extraction plan](agent-outputs/audio-extraction-research-and-implementation-plan.md) for the
engine, and the
[tool catalogue and build order](agent-outputs/browser-tool-catalogue-and-build-order.md) for
which tools come next and why.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

`dev` and `build` first run `scripts/copy-ffmpeg-worker.mjs`, which copies ffmpeg.wasm's class
worker into `public/ffmpeg/<version>/` and checks that the versions and core checksums pinned in
`lib/engine/constants.ts` still match what is installed (see
[The class worker](#the-class-worker) below).

```bash
npm test             # unit tests: parsers, format catalogues, core loader, conversion queue
npm run typecheck
npm run lint
npm run check:characters  # ASCII-punctuation policy, see CONTRIBUTING.md
npm run build        # static export to out/
```

Everything here is written in ASCII punctuation, and CI enforces it. Before
sending a change, read the policy in [CONTRIBUTING.md](CONTRIBUTING.md) and run
`npm run check:characters -- --fix` if it complains.

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
seekable, non-faststart MP4s (whose `moov` atom sits at the end) still work - unlike piped input.

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
app/<slug>/page.tsx  one route per tool, metadata from the registry
lib/tools.ts         the registry: index, header, footer, related tools and sitemap derive from it
components/
  ToolApp.tsx        the page every tool is built from: banner, drop zone, settings, queue, cards
  tools/*.tsx        one small file per tool: its catalogue, features and settings panel
  FileCard.tsx       a file in the queue: outputs, progress, preview, clip panel
  *.module.css       plain CSS modules; no utility-class framework
lib/useConversionQueue.ts   sequential job runner, progress + cancellation, per-tool options
lib/toolFeatures.ts  what a tool's cards offer: clip panel, silence detection, whole-file chips
lib/engine/
  types.ts           the engine contract, and the OutputFormat shape every tool's catalogue uses
  ffmpegEngine.ts    ffmpeg.wasm implementation - mount, probe, run a plan (one pass or two), scan
  coreLoader.ts      fetches the ~31 MB core with byte-level progress; verifies its checksum
  formats.ts         the audio catalogue; decides stream-copy vs re-encode
  video.ts           the video catalogues: convert, compress, trim, GIF, mute, strip metadata
  trim.ts            pure trim logic - ranges, timecodes, silence parsing
  probe.ts           pure parsers for ffmpeg's stderr, audio and video streams alike
  constants.ts       pinned versions, checksums and asset URLs
```

Files convert **one at a time**. There is a single ffmpeg worker with a single heap, so concurrency
would multiply peak memory without making anything faster - the work is I/O- and codec-bound, not
parallel.

The UI talks only to the engine interface in `types.ts`. ffmpeg.wasm has been in caretaker mode
since early 2025, so if it needs replacing (or a WebCodecs engine is wanted for speed), that is a
contained change behind the interface rather than a rewrite.

### One queue, many tools

An output is a format and a range, and a format is an `OutputFormat`: a label, a `plan()` that
turns the probe into ffmpeg arguments, and an optional `blocker()` that refuses a job before it
starts. The audio formats, the video containers, "the same file without its audio" and "a GIF of
this range at 15 fps" are all instances of that one shape, which is why one queue and one card
serve every tool.

A tool hands the queue its catalogue, what a new file should get from it, which stream the file
must have (audio, video, or either), and whether to open a file that has nothing queued yet - the
trimmer and the GIF maker read the file on arrival so the length, a preview and the waveform are
there to choose a range from, and produce nothing until one is chosen. Where settings shape the
plan, the tool bakes them into the format object (and its id) when the output is queued, so a file
queued at 25 MB stays a 25 MB job however the panel changes afterwards.

A plan may carry analysis passes. The compressor's first pass writes x264's statistics to the
core's filesystem and its second reads them; the engine adds the pass log location itself,
reports both passes on one progress bar, and removes the log afterwards, since it shares the heap
with the next job's output.

### The video tools, and the output ceiling

Input is mounted and never copied, but output is built in the core's heap (section 6 of the
[catalogue](agent-outputs/browser-tool-catalogue-and-build-order.md)), so one output file caps
out near 1.5 GB. Every video format guards for that up front rather than failing after an hour of
encoding: a stream copy is sized from the file, scaled to the range being kept; an encode from a
bits-per-pixel estimate of the frame, deliberately on the high side; a GIF from its scaled frame,
frame rate and length. A refusal names the size and the way out - trim a range, or compress to a
target size, which is the framing that sidesteps the ceiling by construction.

The converter copies what fits. An H.264 track in 8-bit 4:2:0 and an AAC track go into the MP4 as
they are, which turns a MOV, MKV or TS that only needed repackaging into a few-second job; 10-bit
H.264, HEVC, VP9, ProRes and the rest are encoded with `libx264 -preset veryfast`, since the
encoder runs single-threaded in WebAssembly and `medium` is roughly two and a half times slower for
a few percent smaller output. WebM copies VP8 and VP9 and otherwise encodes VP9, slowly; MKV
repackages every stream untouched.

The compressor turns a byte budget and the probed length into a bitrate, gives audio a slice that
shrinks as the budget does (128 kbps down to 48), and refuses a target that would leave the
picture under 50 kbps. Auto resolution picks the tallest frame the bitrate can keep clean, measured
by the long side so a portrait clip is boxed the same way as a landscape one, and never enlarges.
Two passes land within a couple of percent of the bitrate; one pass is twice as quick and leaves a
wider margin.

The trimmer offers two cuts because they trade the two things people care about: a stream copy is
instant and lossless but can only start on a keyframe, so it lands up to a few seconds before the
marker; a re-encode lands on the frame and encodes the audio too, since a copied audio track would
keep the packets between the keyframe and the marker and drift out of sync.

### Stream copy vs re-encode

"Original" and "M4A" copy the audio track without decoding it whenever the source codec already
fits the target container - bit-for-bit identical output, and seconds instead of minutes on a large
file. The UI labels these outputs `STREAM COPY`. Everything else re-encodes.

"Original" picks the container from the codec: AAC and ALAC go to M4A; MP3, Opus, Vorbis, FLAC and
the Dolby codecs to their native files; little-endian PCM to WAV; and anything else to Matroska
audio. That last group includes the big-endian PCM older QuickTime files carry, which the WAV muxer
rejects at mux time rather than at probe time. "M4A (AAC)" copies only when the source is already
AAC: an ALAC source is re-encoded, because the format promises AAC in its name and "Original"
already offers the lossless copy.

### Trimming and clipping

An output is a format *and* a range, so one file can produce "the whole thing as MP3" and
"1:30-2:15 as MP3" side by side. Each clipped output is badged with its range in the UI and carries
it in the filename (`holiday-1m30s-2m15s.mp3`), so several clips of one video do not all land in
Downloads under the same name.

There are two ways to set the range:

- **Markers.** Type start and end timecodes (`1:30`, `0:04.5`, `90`). Per-file markers appear on
  the card once the file has been probed, where the duration is known and - when the preview is of
  the untrimmed track - its playback position can be dropped straight into either field.
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
other phase. Files with no duration in their container - a browser's MediaRecorder never writes
one - are measured by the decode itself, so a trailing silence can still be told apart from a pause.

### Cancelling one format

Each output is a format *and* a range, and each can be cancelled on its own. Cancelling one that is
merely queued is free. Cancelling one that is already running is not: ffmpeg blocks its worker for
the whole of a command, so there is no cooperative interrupt and the worker has to be killed.

That is survivable because of where the bytes live. A finished output is a JS `Blob` on the main
thread that never entered the worker, so the downloads already on the card keep working - a 73 MB
stream copy that finished a minute ago is untouched. What the termination *does* cost is the mount,
so any format still queued behind the cancelled one is re-run on a fresh engine, which is why the
run loop reads the next pending output each pass rather than iterating a list fixed before the
first one started.

Cancelling a whole file while the core is still downloading has nothing to kill: the download is
left to finish, since the next file needs it anyway, and the card says "Cancelling..." until it does.
Cancelling a file that has not started costs nothing at all, and a queued file whose every format
has been cancelled is settled without ever being opened.

### Styling

Plain CSS modules, one per component, plus `app/globals.css` for the palette and a small reset.
Colours are CSS custom properties on `:root` with a `prefers-color-scheme` override, so the theme
follows the OS setting with no flash and no JavaScript. There is no utility-class framework and no
PostCSS config; the whole stylesheet is about 17 KB.

### Real-time progress

Every phase reports something, so the app is never silent:

- **Core download** - a real percentage, read from the response stream against the pinned size of
  the core (~31 MB, once per browser). CDNs serve the wasm compressed, so the response's own
  Content-Length describes the compressed body and would put the bar at 100% a third of the way in.
- **Probing** - indeterminate; ffmpeg is reading the container.
- **Converting** - a percentage computed from processed media time over the probed duration, or
  over the length of the clip when one is being extracted: input seeking restarts the output
  timeline at zero. ffmpeg's own `progress` ratio is unreliable when it cannot infer a duration, so
  it is not used.
- **Listening for silence** - the same percentage, over the whole file, during a silence scan.
- **Per-file logs** - ffmpeg's raw output, collapsed behind a disclosure, batched at 300 ms so a
  chatty run cannot thrash React.

### Encoder detection

The set of encoders in a given ffmpeg.wasm build is not documented anywhere authoritative, so the
app runs `ffmpeg -encoders` once at startup and greys out any format the loaded core cannot
produce, rather than failing halfway through a conversion.

## Deploying to Cloudflare

The app is a static export served from Workers static assets - no Worker script, so every request
is a free static-asset request.

```bash
npm run build        # -> out/
npx wrangler deploy  # or: npm run deploy
npm run preview      # build + wrangler dev, with _headers applied
```

`wrangler deploy` creates the Worker if it does not exist yet, so a first deploy needs nothing set
up in the dashboard beyond `npx wrangler login`. The Worker is named by `name` in `wrangler.jsonc`;
it has no connection to the repository name, and Cloudflare cannot rename a Worker in place -
changing `name` deploys a *second* Worker under the new name and leaves the old one running until
you delete it.

If you also connect [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) to
deploy on push, that link is bound to a specific Worker on the account, not to the repository. If
that Worker is ever deleted or renamed, its build fails with *"This Worker does not exist on your
account"* until you re-point it at Settings -> Builds -> Git Repository -> Manage.

### Custom domains

`key.is` and `www.key.is` are declared as `custom_domain` routes in `wrangler.jsonc`, so a deploy
binds them to this Worker and Cloudflare owns their DNS records.

Declaring them matters because the binding is otherwise invisible from the repository: it lives as
records and route patterns in the dashboard, and nothing here says which host answers.

That is exactly how `key.is` broke once. The zone had no Worker-managed records at all - every `A`
record still pointed at an unrelated host left over from an earlier deploy - and the Worker was
attached by a `*.key.is/*` **route** instead. A wildcard route matches every subdomain but *not* the
bare apex, so `www.key.is` (and every other subdomain) was intercepted at the edge and served this
Worker, while `https://key.is` fell through to the stale origin and returned that host's 404.

Migrating from that setup takes the subdomains down briefly: deleting the leftover records stops
them resolving, and they only come back once a deploy has created the custom-domain records. Delete
and deploy back to back, then remove the old wildcard route.

Because Cloudflare wants to create the record itself, a deploy fails while a conflicting
`A`/`AAAA`/`CNAME` record for the same hostname already exists:

> ...already has a DNS record. Please remove it and try again.

Delete the stale record under **DNS -> Records** first, then deploy. To check which host is actually
answering, look at the response headers rather than the page - a 404 from a foreign host names
itself there:

```bash
curl -sSI https://key.is | grep -iE 'server|x-vercel|cf-ray'
```

### The 25 MiB problem

`ffmpeg-core.wasm` is ~30.7 MiB and Cloudflare enforces a hard **25 MiB per static asset**, so the
core cannot ship in `public/`. It is fetched at runtime from jsDelivr, which serves it with
`access-control-allow-origin: *` and an `immutable` cache lifetime.

Wherever it comes from, the download is hashed and compared with the SHA-256 pinned in
`lib/engine/constants.ts` before the worker sees a byte of it. The JS half of the core runs as a
worker on this page's origin, so a CDN serving anything other than the pinned build is refused
rather than executed. `fetch`'s own `integrity` option would make the same check, but it buffers
the whole response before resolving, which would take the progress bar with it.

To self-host instead - worth doing if you would rather not depend on a third party - mirror the two
core files to an R2 bucket (egress is free), put it behind a custom domain, give it a CORS policy,
and point the app at it:

```bash
NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=https://cdn.example.com/ffmpeg npm run build
```

The files to mirror are `ffmpeg-core.js` and `ffmpeg-core.wasm` from
`node_modules/@ffmpeg/core/dist/esm/`. Mirror them byte for byte: the checksum check does not care
where the core came from, only that it is the pinned build.

### Headers

`public/_headers` sets cache headers only. Cross-origin isolation (COOP/COEP) is **not** required,
because the app uses the single-threaded core. The multithreaded core would need
`SharedArrayBuffer` - and therefore those headers - while offering nothing here: audio extraction
is dominated by demuxing rather than parallel codec work, and `@ffmpeg/core-mt` has a *smaller*
fixed 1 GB heap. The commented-out block in `_headers` is there if that trade-off ever changes.

## Implementation notes

Two things about integrating ffmpeg.wasm with Next.js are worth knowing, because both fail in ways
that are hard to diagnose.

### The class worker

`FFmpeg.load()` spawns its worker with
`new Worker(new URL(classWorkerURL, import.meta.url), { type: "module" })`. Next.js chunks are not
ES modules, so webpack replaces `import.meta.url` with a build-time `file:///...` literal. A
root-relative worker path resolved against that base becomes `file:///ffmpeg/worker.js`, and the
Worker constructor throws `SecurityError`. The app therefore passes an **absolute** URL built from
`window.location.origin`.

The worker is also an ES module that relative-imports its siblings, which is why
`scripts/copy-ffmpeg-worker.mjs` copies the whole `dist/esm` directory rather than one file. It
copies into a directory named after the package version, because `public/_headers` caches
everything under `/ffmpeg/` as immutable for a year: a cache-buster on the worker URL alone would
fetch a new worker after an upgrade and run it against siblings still cached from the old one. The
script also asserts that the versions, core size and core checksums pinned in
`lib/engine/constants.ts` match what is installed, so a dependency bump cannot silently desync the
CDN URL, the worker path, or the integrity check.

### ESM core, not UMD

The class worker is a module worker, so `importScripts` is unavailable and it falls back to
`(await import(coreURL)).default`. For the UMD core that is `undefined`, and the assignment then
clobbers the global the UMD bundle had just set - surfacing as `failed to import ffmpeg-core.js`.
The `dist/esm` build has a real default export and must be used.

## Verification

```bash
npm test                                                    # unit tests, plus the plans against a local ffmpeg when there is one
NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=/core npm run build
node scripts/verify-e2e.mjs                                 # the audio extractor in a browser
node scripts/verify-video-tools.mjs                         # the six video tools in a browser
node scripts/verify-large-file.mjs                          # >2 GiB input
```

The unit tests include the conversion queue itself, driven through a fake engine behind the
engine interface, so every cancel, retry and re-queue transition is pinned without ffmpeg in the
loop, and every format's argument strings. `tests/plans.integration.test.ts` then runs each video
plan through whatever ffmpeg is on `PATH` and checks the result with ffprobe, so a filter that
does not parse fails in seconds rather than in a browser; it is skipped where ffmpeg is absent.
The browser scripts need ffmpeg and ffprobe on `PATH`, plus a Chromium: one Playwright can find
on its own (`npx playwright install chromium`), or any Chrome/Chromium binary named in
`CHROMIUM_PATH`.

`verify-video-tools.mjs` drives Chromium and the pinned core through every video tool: an MP4
converted by stream copy and an AVI converted by encoding, a remux to MKV, an audio file refused
by a video tool; a 19 MB file compressed to under 8 MB in two passes and a file already under the
target refused up front; a video muted; a tagged MP4 and a tagged MP3 stripped; a fast cut and a
precise cut of the same range; and a two-second GIF at 15 fps and 480 px. Every download is
checked with `ffprobe`.

`verify-e2e.mjs` drives a real Chromium through the audio extractor's seven cases - an MP4 with AAC, a video with no
audio track, an MKV with 5.1 FLAC, a hand-set 1s-3s clip, an 8s file padded with two seconds of
silence at each end, an MP3 cancelled mid-conversion, and that same MP3 retried - and validates
every downloaded file with `ffprobe`. The clip comes back 2.04s long and automatic trimming turns
the padded file into 4.22s; cancelling MP3 on a 5-minute file leaves the finished stream copy
downloadable and still converts the M4A queued behind it, over the whole 5 minutes, on a rebuilt
engine. It serves the core locally so the run is hermetic, which also exercises the
self-hosted-core configuration.

Not yet verified: Safari. ffmpeg.wasm's WORKERFS pull request reported heavier memory growth there
during large reads, so a real Safari pass on a multi-gigabyte file is the main open question before
calling large-file support universal.

## Known limitations

- Only the first audio track is used; files with several are labelled but not selectable. The
  MKV remux in the converter is the one exception and keeps them all.
- Silence is only removed from the beginning and end. Cutting the pauses in the middle would need a
  filter graph and would re-time what is left, so it is deliberately out of scope.
- Every output is capped near 1.5 GB by the engine's in-memory output buffer: WAV at about 2.9
  hours of 48 kHz stereo, and any video whose stream copy or encode would exceed it. Each format
  says so before starting and suggests a range or a target size; writing larger outputs in
  fragments to the File System Access API is the plan in section 6 of the catalogue and is not
  built yet.
- Video encoding runs on one core. Expect real time or slower for 1080p H.264, twice that with two
  passes, and much slower for VP9. The multithreaded core would need cross-origin isolation, which
  is a decision the catalogue asks to be made deliberately.
- The source preview on the trimmer and GIF maker only appears for containers the browser itself
  can play (MP4, WebM, MOV); an MKV or AVI is trimmed by timecode and, on the trimmer, by the
  waveform.
- Cancelling terminates the ffmpeg worker, since ffmpeg blocks its worker while running and cannot
  be interrupted cooperatively. See [Cancelling one format](#cancelling-one-format) for why that is
  survivable. The engine restarts on the next job; the core is already cached, so this costs a
  WebAssembly instantiation, not a 31 MB download.
