# Catalogue of near-zero-cost browser tools, and a build order

Status: research note, 2026-09-06. Companion to
[the audio extraction plan](audio-extraction-research-and-implementation-plan.md).

This merges an earlier chatbot's brainstorm with corrections and additions made
while reading this codebase. The earlier list was a flat menu of about 130
ideas. The value added here is the cost model that sorts them, three
corrections where the original advice was wrong or risky, the categories it
missed entirely, a build order that follows from what `lib/engine/` already
does, and a plan for the visual design and site structure that the tools will
share (section 7).

Every entry is marked `prior` (from the earlier list) or `new` (added here).

---

## 1. The cost model

"Near-zero cost" is true at the hosting layer and misleading at the
engineering layer. This site is an assets-only Cloudflare Worker, so every
request is a free static asset no matter how many tools ship. Hosting is not
the constraint. The constraint is that **each new WebAssembly runtime is a
second copy of every problem this repo already solved once**: a CDN dependency
outside the 25 MiB static-asset limit, a checksum pin, a class-worker path,
a memory ceiling, and its own cancellation semantics.

So tools sort into four tiers, and the tier matters far more than the
"complexity" column in the original list.

| Tier | Meaning | Marginal cost |
| --- | --- | --- |
| **A** | Reuses the existing ffmpeg.wasm engine, queue, probe and trim code | UI plus new argument strings |
| **B** | No new WebAssembly at all: plain TypeScript and small libraries | Low, and no new failure modes |
| **C** | Needs a second WASM runtime (libvips, DuckDB, qpdf, ImageMagick) | High: new CDN pin, new memory model, new debugging |
| **D** | Needs a runtime plus a model download, or carries a licence constraint | Highest, but potentially the most defensible |

The original list treated a Tier A trimmer and a Tier C PDF workbench as
comparable weekend projects. They are not.

### Constraints that apply to every tool here

- **The 25 MiB static-asset limit.** `ffmpeg-core.wasm` is about 30.7 MiB and
  cannot be a Cloudflare asset, which is why it is pinned on jsDelivr with
  checksum verification. libvips, ImageMagick, Ghostscript, MuPDF and
  DuckDB-WASM are all large enough to inherit exactly this problem.
- **The heap ceiling is 2 GiB, and it is not a MEMFS limit.** The pinned
  `@ffmpeg/core@0.12.10` compiles `getHeapMax()` to return `2147483648`.
  MEMFS merely allocates from that heap, so an output file competes with
  ffmpeg's own muxer and encoder working set. Usable output is meaningfully
  below 2 GiB, and the real figure should be measured with
  `scripts/verify-large-file.mjs`, which already tracks peak heap.
- **Input and output are asymmetric.** WORKERFS mounts the input without
  copying, which is why a 13.2 GB file works. Nothing equivalent exists for
  output. See section 6 for what to do about it.
- **Cross-origin isolation is a fork in the road.** Switching to
  `@ffmpeg/core-mt` for multithreading requires the COOP/COEP headers
  currently commented out in `public/_headers`. Those headers block
  essentially every advertising network, because ad iframes and scripts do not
  send CORP or CORS headers. Multithreaded ffmpeg and display ads are close to
  mutually exclusive; decide once, deliberately.

---

## 2. Corrections to the earlier list

### 2.1 Whisper was dismissed too quickly

The original answer set aside client-side speech recognition as "less close to
zero operationally" because of model downloads. But a quantised Whisper
tiny or base is 40-75 MB, which is the same order as the ffmpeg core already
served from a CDN, using the same trick and the same checksum discipline.

"Video to subtitles, nothing uploaded" is more defensible than any format
converter on this list, because the paid competition charges per minute and
sends the audio to a server. The hard half, extracting and resampling the
audio track, is already built. This should be ranked as the highest-value
Tier D item, not a footnote.

### 2.2 Ghostscript and MuPDF are AGPL

Both were recommended casually for PDF work. Artifex dual-licenses precisely
because AGPL is load-bearing for a hosted service, and this project is
considering advertising. Prefer permissive alternatives:

| Library | Licence | Use |
| --- | --- | --- |
| `pdf-lib` | MIT | Merge, split, rotate, page numbers, watermark, form filling |
| `PDF.js` | Apache 2.0 | Rendering, PDF to image, text extraction |
| `qpdf` (WASM) | Apache 2.0 | Linearise, encrypt, decrypt, structural repair |
| Ghostscript | AGPL | Avoid without a commercial licence |
| MuPDF | AGPL | Avoid without a commercial licence |

### 2.3 The effort estimates were fantasy

A dozen entries were marked "Low". This repo is the counterexample: one tool
required WORKERFS mounting, the heap ceiling, module-worker path resolution,
encoder capability probing, checksum pinning, and cancellation by worker
termination. Treat "Low" in the original list as "Low *given a working engine
of the right tier*", which is exactly what the tier column now encodes.

---

## 3. The catalogue

### 3.1 Video and audio, on the existing engine (Tier A)

These reuse `lib/engine/`, `lib/useConversionQueue.ts`, `probe.ts`, `trim.ts`,
the format catalogue and the existing cancellation path. Mostly new arguments
and UI.

| Tool | Source | Note |
| --- | --- | --- |
| Video compressor with a target size | prior | Highest search volume on the list |
| "Make this video work": probe, pick browser-safe codecs, remux | prior | The strongest idea in the original list |
| Video format converter (MOV/WebM/MKV/AVI to MP4) | prior | Output size is the constraint, see section 6 |
| Audio format converter | prior | Already largely built |
| Video trimmer | prior | `trim.ts` exists |
| Audio trimmer | prior | Already built |
| Extract a video segment | prior | Same code path as the trimmer |
| Video to GIF, with resize, FPS and quality | prior | Palette generation is a two-pass job |
| Mute or remove audio | prior | `-an`, stream copy on the video |
| Replace the audio track | prior | Two inputs, needs UI for the second file |
| Merge videos | prior | Concat demuxer; needs matching codecs or a re-encode |
| Merge audio files | prior | Easier than video: no keyframe alignment |
| Change playback speed | prior | `atempo` chains beyond 2x |
| Resize, crop, rotate | prior | Social aspect-ratio presets are the product |
| Generate thumbnails or a contact sheet | prior | Cheap, and reuses probe output |
| Burn subtitles into video | prior | Needs the `subtitles` filter compiled in; verify |
| Extract embedded subtitles | prior | Stream copy of the subtitle track |
| Remove metadata | prior | `-map_metadata -1`, near-instant |
| Repair or remux without re-encoding | prior | Stream copy; fastest path in the whole catalogue |
| Silence remover and silence detector | prior | Already built for this tool |
| Loudness normalizer | prior | See the sharper version below |
| Mono and stereo conversion | prior | One filter |
| Sample rate and bitrate conversion | prior | One filter |
| Voice recording compressor | prior | Opus at a low bitrate |
| Podcast chapter splitter | prior | Split on chapter metadata |
| Audio waveform image | prior | `showwavespic` filter |
| Spectrogram image | prior | `showspectrumpic` filter |
| Audio channel extractor | prior | `pan` filter |
| Centre-channel (karaoke) removal | prior | Trivial to implement, usually sounds poor. Set expectations |
| Loop creator | prior | Concat plus crossfade |
| Crossfade multiple tracks | prior | `acrossfade` |
| Split a long recording into fixed chunks | prior | `-f segment`, confirmed present in the core |
| BPM and key estimation | prior | Needs a real DSP library, not ffmpeg. Reclassify as Tier C |
| Audio fingerprint or duplicate detection | prior | Needs Chromaprint. Tier C |
| **Loudness targeting to platform specs** | **new** | `loudnorm` to -14 LUFS for Spotify, -16 for podcast. Sharper product than "normalize volume" |
| **Audio and video redaction** | **new** | Bleep a time range, blur a region. Rare, high intent |
| **Extract every audio track** | **new** | Multi-language MKV. `FileCard` already notes "using the first" |
| **Add podcast chapter markers** | **new** | Chapters into M4A and MP3 |
| **Screen recording to GIF or MP4** | **new** | MediaRecorder captures, ffmpeg converts. Nothing uploaded |

### 3.2 Subtitles and text (Tier B, no WebAssembly at all)

Almost absent from the original list, which mentioned only burn-in and
extraction. These are plain text transforms: the cheapest things in this
document, with real search volume.

| Tool | Source |
| --- | --- |
| SRT, VTT and ASS conversion | **new** |
| Subtitle timing offset and resync by stretch factor | **new** |
| Dual-language subtitle merge | **new** |
| Subtitle to plain transcript | **new** |

### 3.3 Speech recognition (Tier D)

| Tool | Source | Note |
| --- | --- | --- |
| **Video or audio to subtitles** | **new emphasis** | Whisper tiny/base via `transformers.js` or `whisper.cpp`. See correction 2.1 |
| Transcript export in SRT, VTT, plain text | **new** | Falls out of the above for free |

### 3.4 Images (Tier C, except where noted)

Runtimes: libvips WASM, Squoosh codecs, OpenCV.js, or format-specific decoders.

| Tool | Source | Note |
| --- | --- | --- |
| Batch image compressor | prior | |
| HEIC and HEIF to JPEG or PNG | prior | High intent: iPhone photos |
| AVIF, WebP, JPEG, PNG conversion | prior | |
| Image resizer with exact dimensions | prior | |
| Social media crop generator | prior | Presets are the product |
| Batch watermarking | prior | |
| EXIF and GPS metadata remover | prior | Tier B: EXIF is parseable in plain JS |
| EXIF viewer | prior | Tier B |
| Animated GIF optimizer | prior | |
| GIF to animated WebP | prior | Possible on ffmpeg instead, which makes it Tier A |
| SVG optimizer and sanitiser | prior | Tier B via `svgo` |
| Colour palette extractor | prior | Tier B: canvas plus k-means |
| Background removal for simple product images | prior | Tier D if model-based |
| Image contact sheet generator | prior | Tier A via ffmpeg |
| Sprite sheet generator and splitter | prior | Tier B |
| QR code generator and reader | prior | Tier B |
| Screenshot redaction with permanent pixel removal | prior | Tier B. Verify the pixels are destroyed, not covered |
| Passport photo layout | prior | See the sharper version below |
| **Passport photo to a named country spec** | **new** | Encode 35x45mm UK, 2x2in US and so on. High intent |

### 3.5 PDF and documents (Tier C)

Licence-checked per correction 2.2.

| Tool | Source | Suggested library |
| --- | --- | --- |
| Merge PDFs | prior | `pdf-lib` |
| Split or extract pages | prior | `pdf-lib` |
| Reorder and rotate pages | prior | `pdf-lib` |
| Delete pages | prior | `pdf-lib` |
| Add page numbers | prior | `pdf-lib` |
| Add a watermark | prior | `pdf-lib` |
| Compress a PDF | prior | Hardest one honestly: needs image recompression |
| Images to PDF | prior | `pdf-lib` |
| PDF to images | prior | `PDF.js` |
| Fill and flatten forms | prior | `pdf-lib` |
| Password protect | prior | `qpdf` |
| Remove a known password | prior | `qpdf` |
| Redact content permanently | prior | Must rewrite content streams, not draw boxes |
| Extract embedded images | prior | `PDF.js` |
| Extract text from text-based PDFs | prior | `PDF.js` |
| Compare two PDFs visually | prior | Render both, diff pixels |
| Scan cleanup: deskew, threshold, crop | prior | OpenCV.js |
| Printable booklet layout | prior | `pdf-lib` |
| **EPUB metadata editor** | **new** | EPUB is a ZIP plus XML. Tier B |
| **EPUB to plain text or PDF** | **new** | Underserved niche |

### 3.6 Data (Tier C, DuckDB-WASM)

The original list's own favourite, and a genuinely differentiated direction.

| Tool | Source |
| --- | --- |
| CSV, JSON and Parquet conversion | prior |
| Excel or CSV to Parquet | prior |
| Large CSV viewer that does not freeze the tab | prior |
| Browser SQL query tool over local files | prior |
| CSV column profiler | prior |
| Missing-value and duplicate detector | prior |
| Delimiter and encoding repair | prior |
| Join two CSV files | prior |
| Pivot table generator | prior |
| JSON flattener | prior |
| JSONL to JSON or CSV | prior |
| Dataset anonymiser | prior |
| Column type inference and schema generation | prior |
| SQL CREATE TABLE generator | prior |
| Data dictionary generator | prior |
| Diff two CSV or Parquet files | prior |
| Extract tables from SQLite | prior |
| SQLite viewer and editor | prior |
| ZIP archive dataset explorer | prior |
| SPSS, Stata and SAS previewer | prior |

The original grouped these into a "large dataset rescue tool": open locally,
profile with DuckDB, detect encoding and malformed rows, clean via UI or SQL,
export clean CSV or Parquet. That framing is sound and worth keeping.

### 3.7 Developer tools (mixed tiers)

| Tool | Source | Tier |
| --- | --- | --- |
| ZIP, TAR and 7z viewer and creator | prior | B |
| File checksum calculator | prior | B, Web Crypto |
| Compare large files without uploading | prior | B |
| SQLite viewer | prior | C |
| Git bundle inspector | prior | C |
| Source formatter via Prettier | prior | B |
| Markdown preview and export | prior | B |
| Regex tester over large local files | prior | B |
| JSON, XML and YAML formatter and converter | prior | B |
| Protobuf decoder with a supplied schema | prior | B |
| Local log file analyzer | prior | B |
| HAR file analyzer | prior | B |
| Font subsetter | prior | C |
| Font format converter | prior | C |
| WebAssembly binary inspector | prior | B |
| Local static site previewer | prior | B |
| Notebook metadata cleaner and output stripper | prior | B |
| Notebook to HTML or PDF | prior | C |
| **Font coverage checker** | **new** | B. "Will this font render my text?" against a pasted sample |

The original singled out the notebook cleaner as a focused product: strip
outputs, scrub execution metadata, find embedded secrets, reduce size, produce
a clean submission copy. That remains a good self-contained idea.

### 3.8 3D and CAD (Tier B and C) - missing entirely from the original

| Tool | Source | Note |
| --- | --- | --- |
| **STL, OBJ and GLTF conversion** | **new** | Small ecosystem, little free competition |
| **GLB optimizer** | **new** | `gltf-transform` runs in the browser |
| **Mesh inspector and 3D print prep** | **new** | Measure, detect non-manifold geometry, repair |
| **3D model viewer** | **new** | three.js, no WASM needed |

### 3.9 Geospatial (Tier B) - missing entirely from the original

| Tool | Source |
| --- | --- |
| **GPX, KML and GeoJSON conversion** | **new** |
| **GPS track merge and trim** | **new** |
| **Strip GPS from a track before sharing** | **new** |

### 3.10 Email (Tier B and C) - missing entirely from the original

| Tool | Source | Note |
| --- | --- | --- |
| **.eml viewer with attachment extraction** | **new** | Tier B |
| **.msg parser** | **new** | Tier C. Genuine pain point with no good free private option |

### 3.11 Security and privacy (Tier B)

Strong reasons to stay client-side, and the category where "never leaves your
browser" is the product rather than an implementation detail.

| Tool | Source |
| --- | --- |
| Encrypt and decrypt files with a passphrase | prior |
| Secure file-sharing package creator | prior |
| Metadata scrubber | prior |
| Secret scanner for source archives | prior |
| PII finder for CSV | prior |
| PDF redaction verifier | prior |
| Image GPS remover | prior |
| Password strength estimator | prior |
| File hash and signature verifier | prior |
| Duplicate file finder by hash | prior |
| Encrypted notes export | prior |
| JWT and certificate inspector | prior |

The original's caveat holds and is worth repeating: use Web Crypto and
established formats, and never present home-rolled cryptography as a security
product.

---

## 4. Recommended build order

Exhaust Tier A before touching a second runtime.

1. **"Make this video work"** - probe, choose browser-safe codecs, remux
   without re-encoding where possible. People know their file is broken but not
   which conversion fixes it.
2. **Video compressor with an explicit target size.** Highest search volume,
   and the target-size framing solves the output ceiling by construction
   (section 6).
3. **The cheap Tier A cluster**: trim, mute, speed, GIF, thumbnails, merge,
   metadata strip, remux. Each is mostly argument strings against machinery
   that already works.
4. **Subtitles (3.2).** No new runtime at all, and the natural neighbour to an
   audio extractor.
5. **Whisper transcription.** The first genuinely new runtime, and the only
   item here that competitors cannot give away for free.

Only after that does a second runtime (images, PDF, DuckDB) earn its cost, and
the choice should be made on which single category can be taken deep rather
than spreading thin across three.

---

## 5. Positioning

"Video compressor" and "MOV to MP4" are contested by Clideo, VEED, FreeConvert
and CloudConvert with real marketing budgets. Ranking against them head-on is
not realistic.

The defensible position is the one this repo already earns: **no upload, and a
verified 3 GiB file at 37 MiB peak heap.** Incumbents cap uploads at 500 MB or
1 GB, so target the queries where they physically cannot compete:

- "compress 5GB video"
- "convert large MKV"
- "extract audio from 10GB video"
- "trim video without uploading"

Lower volume per query, but winnable outright.

Two wording notes. Say "no upload limit" rather than "no file size limit":
browsers still impose memory, storage and tab-lifecycle constraints. And if
advertising is added, revisit the "nothing leaves your browser" copy, which
stays literally true for files but will read as surprising next to third-party
ad tags.

---

## 6. The output ceiling, and what it means per tool

This governs every Tier A tool that writes a large file, so it belongs in the
plan rather than in each tool's implementation notes.

**The problem.** Input is solved: WORKERFS mounts without copying. Output is
not. ffmpeg writes into MEMFS, which lives in the 2 GiB heap alongside the
encoder's working set, so a single output file must fit in meaningfully less
than 2 GiB.

**OPFS does not fix this.** The pinned core contains only MEMFS and WORKERFS
(44 and 21 references respectively; zero for OPFS or WasmFS), so there is nothing to enable.
Rebuilding for WasmFS plus OPFS would likely cost WORKERFS, which is what makes
multi-gigabyte input work; it requires pthreads or JSPI, and pthreads drags in
the COOP/COEP decision above; and it is still wasm32, with a reported seek
failure past 2^32-1 bytes. It moves the ceiling from about 2 GiB to about
4 GiB at high cost.

**What works today, with the pinned core.** The needed muxers are already
compiled in, verified by inspecting the binary: `segment`, `stream_segment`,
`frag_keyframe`, `empty_moov`, `default_base_moof`, `mpegts` and `concat`.

- Fragmented MP4 (`-movflags +frag_keyframe+empty_moov+default_base_moof`) has
  no trailing moov atom to rewrite, so fragments can simply be appended. Paired
  with `-f segment`, the loop is: read a fragment, append it to a
  `FileSystemWritableFileStream`, unlink it, continue. Peak heap stays at one
  fragment. Caveat: fMP4 is slightly larger and some older players dislike it.
- MPEG-TS segments plus a final `concat` remux is the compatibility fallback.
- Write to the File System Access API where available, since it streams
  straight to the user's chosen file with no quota. OPFS is the fallback
  (Safari 15.2 and later, Firefox 111 and later), and a blob download is the
  last resort.

**Per tool, this means:**

| Tool | Does the ceiling bind? |
| --- | --- |
| Audio extraction (today) | Rarely. 3 hours of 256 kbps AAC is about 330 MB. Only uncompressed WAV of very long videos, and RIFF caps at 4 GiB anyway |
| Video compressor | Rarely, and never if the target size is an input. Compute the bitrate from the probed duration and check before encoding |
| Video converter or remux | Yes, routinely. Stream copy produces output the size of the input. This is the tool that needs fragmented output |
| Trim, mute, speed, GIF | Depends on the source. The same guard applies |

The size guard already planned for WAV generalises directly:

```
estimated bytes ~= (video_bitrate + audio_bitrate) * duration / 8
```

Two-pass encoding makes that estimate accurate enough to promise a target size.

**For genuinely large output**, the answer this project already reached stands:
section 5.4 of the audio extraction plan records that greater-than-2 GB output is
a MEMFS cap for ffmpeg.wasm but supported through StreamTarget in Mediabunny.
The streaming-first engine identified there as insurance is the right answer
for large outputs, rather than bolting OPFS onto ffmpeg.

---

## 7. Visual design and site structure

This is the plan for turning one tool into a site of tools. It is written
against the code as it stands after the revert of the Swiss grid redesign:
the indigo palette in `app/globals.css`, five radius tokens, nine distinct
`font-size` values across the CSS modules, and a single route at `/`.

Four requirements drive it, in order of importance: every page links to every
other tool; the site says plainly that everything is free, unlimited and has
no file size limit, without saying anything untrue; controls come from Base UI
on a neutral palette; and the type is Inter, slightly tightened, in very few
sizes.

### 7.1 One route per tool, one registry for all of them

This is a static export, so `app/<slug>/page.tsx` becomes `/<slug>` with its
own `metadata`. Each tool needs its own URL anyway: the search queries worth
winning ("extract audio from 10GB video") land on a page about that one job,
and a page can only carry one title and description.

Slugs are verb-object, lowercase, hyphenated, and permanent:

```
/                    index of every live tool, grouped by category
/extract-audio       the tool that exists today
/compress-video
/convert-video
/trim-video
/video-to-gif
/remove-audio
/convert-subtitles
```

The index moves to `/` now rather than after a second tool ships. An index
with one entry is honest, and moving the tool's URL later would throw away
whatever ranking it has earned by then.

Everything that lists tools reads from one registry, `lib/tools.ts`:

```ts
export interface ToolMeta {
  slug: string;            // "extract-audio"
  name: string;            // "Extract audio from video"
  tagline: string;         // one sentence, under 90 characters
  category: "video" | "audio" | "subtitles" | "images" | "documents" | "data";
  accepts: string[];       // ["video/*"], shown on the index card
  status: "live" | "planned";
}
export const TOOLS: readonly ToolMeta[] = [...];
```

The index, the header menu, the footer, the related-tools block, each page's
`metadata`, and `app/sitemap.ts` all derive from `TOOLS`. Adding a tool is one
registry entry plus one page file, and it appears everywhere at once. That is
what keeps "every page links to every tool" true without anyone remembering
to do it.

Only `status: "live"` tools render anywhere. No "coming soon" entries: they
are dead links to a visitor and thin pages to a crawler, and they cost trust
for nothing.

### 7.2 Every page carries the whole catalogue

Three places, each doing a different job:

| Where | What | Why |
| --- | --- | --- |
| Header | Wordmark, then an "All tools" menu (Base UI Navigation Menu, grouped by category; Drawer on narrow screens) | Reachable from any scroll position |
| Below the tool | "Related tools": same-category siblings first, then up to six others | The visitor who just finished one job is the visitor most likely to have another |
| Footer | Every live tool as plain links under category headings | Crawlable without JavaScript, and the fallback if the menu fails |

The footer list is ordinary anchors in the server-rendered HTML. Nothing
about discoverability depends on hydration.

### 7.3 The promise, and how to keep it true

The line that appears on every page, in the same words, in the same place:

> Free. Unlimited. No file size limit.

Under it, one sentence that explains why it is possible:

> Everything runs in your browser. Nothing is uploaded, so there is no
> server to charge you, throttle you, or cap your file.

And one qualifier, always adjacent rather than hidden, because the claim is
only honest with it:

> The only limits are your device's: memory, storage and the browser tab.

The word "limits" opens a Base UI Popover with the detail: input is read in
place through WORKERFS and never copied, a 3 GiB file has been verified end to
end at a 37 MiB peak heap, and any tool that writes a large output says so on
its own page. That last clause matters for the converter (section 6): it must
ship with fragmented output, or with its own note about the output ceiling,
before it can sit under the site-wide line without contradicting it.

Placement: a slim strip directly under the header on every page, so it reads
as the site's identity rather than a per-tool boast; the tool page's lead
paragraph repeating it in that tool's terms ("Extract the audio from a 10 GB
recording without uploading it"); the footer restating the privacy half.

Words, not badges. The ASCII policy rules out check marks and emoji, and a
row of pills with ticks is the visual signature of every site this one is
trying not to resemble.

### 7.4 Base UI

`@base-ui/react`, currently 1.8.0. Unstyled, driven by `className`, no
provider, no stylesheet to import. Portaled components want
`isolation: isolate` on the layout root so popups stack above the page
without `z-index` games; that goes on `<body>` in `globals.css`.

Styling stays in CSS modules as today. Base UI exposes state as data
attributes (`data-disabled`, `data-checked`, `data-popup-open`,
`data-highlighted`), which CSS modules select on directly, so no Tailwind and
no CSS-in-JS enters the repo.

What each existing control becomes:

| Today | Base UI | Note |
| --- | --- | --- |
| Nine raw `<button>`s in `FileCard`, five in `TrimPanel`, two in `AudioExtractorApp` | Button | One styled Button; variants by a `data-variant` attribute, not separate classes |
| `<select>` in `TrimPicker` | Select | Same options, keyboard-complete |
| Time inputs in `TrimPicker` | Field with Input | Field supplies label, description and error wiring |
| `role="progressbar"` in `ProgressBar` | Progress | Keeps the indeterminate state; the moving-bar CSS is unchanged |
| Labels in `FormatPicker` | Checkbox Group | Multi-select formats become real checkboxes |
| `role="alert"` in `EngineBanner` and `FileCard` | Unchanged | A live region is the right primitive already |
| Settings | Popover | Settings that apply to the next run do not need a dialog |
| Cancel on a running job | Alert Dialog | Only because it kills the worker; queued jobs cancel without asking |
| Header menu | Navigation Menu, Drawer on narrow screens | |
| "limits" explainer | Popover | |
| `DropZone` | Stays custom | Base UI has no file input. The `<label>` wrapping the input is the right pattern and keeps the whole box clickable |

Order of replacement: Button first, because it has the most instances and
sets the look of everything else; then Select and Progress; then Checkbox
Group; the navigation last, since it depends on the registry from 7.1.

Two notes from doing it:

**The navigation is deferred, not done.** A Navigation Menu whose panel holds
a single link is worse than the single link, so the header keeps the plain
anchors described in 7.2 until the catalogue outgrows one row. The trigger to
build it is roughly five live tools, or the first time the header list wraps on
a laptop. Nothing else depends on it: the footer already carries the whole
catalogue as plain anchors, so discovery does not wait on this.

**Radio Group came along with Checkbox Group.** FormatPicker and TrimPicker
share the `.option` styles, so migrating only the checkboxes would have left
one stylesheet serving a Base UI control and a native input at once.

**The disclosure toggles stay native for now.** The three `aria-expanded`
rows in FileCard and the settings toggle in AudioExtractorApp are full-width
disclosure rows rather than buttons; Base UI's Collapsible is the right
component for them, not Button, and it is not part of this step.

### 7.5 Colour: neutral, in the shadcn token shape, tighter corners

The current palette is built around an indigo accent (`#5b52e8`). It goes.
Colour is reserved for two things, job state and destructive actions; every
other surface, border and control is a grey.

The tokens take the shadcn/ui shape because it is a good shape and the names
are widely understood. The values are the Tailwind neutral scale, which is
also what shadcn's "neutral" theme is:

```css
:root {
  --background: #ffffff;
  --foreground: #0a0a0a;
  --card: #ffffff;
  --muted: #f5f5f5;
  --muted-foreground: #737373;
  --border: #e5e5e5;
  --border-strong: #d4d4d4;
  --input: #e5e5e5;
  --ring: #0a0a0a;
  --primary: #171717;
  --primary-foreground: #fafafa;
  --secondary: #f5f5f5;
  --secondary-foreground: #171717;
  --destructive: #dc2626;
  --destructive-foreground: #fafafa;
  --success: #15803d;
  --warning: #a16207;

  --radius-sm: 2px;
  --radius: 4px;
  --radius-lg: 6px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #fafafa;
    --card: #0a0a0a;
    --muted: #262626;
    --muted-foreground: #a3a3a3;
    --border: #262626;
    --border-strong: #404040;
    --input: #262626;
    --ring: #d4d4d4;
    --primary: #e5e5e5;
    --primary-foreground: #171717;
    --secondary: #262626;
    --secondary-foreground: #fafafa;
    --destructive: #ef4444;
    --destructive-foreground: #fafafa;
    --success: #4ade80;
    --warning: #facc15;
  }
}
```

The primary button is foreground-on-background inverted: near-black on
white, near-white on black. That is the whole accent system. `--success` and
`--warning` appear only on the status line of a job card, never as fills.

Radius is where this deliberately differs from shadcn. Its default is 10px in
recent versions and 8px before that; here the base is 4px, with 2px for small
controls and 6px for cards. Five radius tokens collapse to three. The result
reads as precise rather than soft, which suits a tool.

Cards are a 1px `--border` with no shadow; hover moves the border to
`--border-strong`. Focus is a 2px `--ring` outline with a 2px offset,
identical on every control. Dark mode stays on `prefers-color-scheme` alone,
as it is today; no toggle.

### 7.6 Type: Inter, slightly tightened, four sizes

Inter through `next/font/google`, self-hosted at build time so no request
leaves the visitor's browser for a font. The reverted commit `8e2c9ec` already
had this exactly right in `app/layout.tsx`, and that part can be cherry-picked
on its own:

```ts
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  axes: ["opsz"],
});
```

`opsz` is Inter 4's optical-size axis. **Confirmed in the built output**: the
woff2 files Next emits carry `fvar` axes `opsz` (14 to 32) and `wght` (100 to
900), so the browser picks the tighter display cut automatically at
`--text-lg` and `--text-xl`. No CSS is needed to engage it, because
`font-optical-sizing: auto` is the initial value; the absence of
`font-variation-settings` in the emitted stylesheet is expected and not a
symptom. At body size the axis is close to neutral, which is why the tracking
token below still does the work there.

Tracking is tightened slightly, not dramatically:

```css
--tracking-body: -0.011em;   /* every size except xl */
--tracking-tight: -0.02em;   /* --text-xl only */
```

Monospace resets to `letter-spacing: 0`. There is no positive-tracked
uppercase label style; that was part of the Swiss treatment and it is not
coming back.

Font sizes are the main discipline. The CSS modules use nine distinct values
today: 10px, 11px, 0.75rem, 0.8125rem, 0.875rem, 1rem, 1.125rem, 1.5rem,
1.875rem. They collapse to four tokens, and nothing sets `font-size` to a
literal value again:

| Token | Size | Line height | Used for |
| --- | --- | --- | --- |
| `--text-sm` | 0.8125rem (13px) | 1.4 | Metadata, captions, table cells, the promise qualifier |
| `--text-base` | 0.9375rem (15px) | 1.5 | Body, every control, navigation, the promise line |
| `--text-lg` | 1.25rem (20px) | 1.3 | Section headings, tool card titles |
| `--text-xl` | 1.75rem (28px) | 1.2 | The page title, once per page |

Hierarchy comes from weight and colour, not size: 400 for body, 500 for
labels and buttons, 600 for headings, and `--muted-foreground` for anything
secondary. No 700. The 10px and 11px uses today become `--text-sm`; if
something looks too large at 13px, the fix is colour or weight, not a fifth
size.

Timecodes, byte counts and percentages in `FileCard` get
`font-variant-numeric: tabular-nums` so they stop jittering as they update.

### 7.7 Layout

One content width, `72rem`, with `1.25rem` side padding. Tool pages are a
single column: title, promise strip, the tool, related tools, footer. The
index is category sections, each a grid of cards showing the tool name and
its tagline. No icons per tool, no illustrations, no hero. On a laptop the
drop zone is above the fold.

### 7.8 What this plan deliberately leaves out

- "Coming soon" entries, for the reasons in 7.1.
- Badges, pills and ticks for the promise, for the reasons in 7.3.
- The Swiss grid: the baseline grid, uppercase tracked labels and the
  `clamp()` display size from the reverted commit. Inter and the tracking
  survive; the grid system does not.
- A theme toggle. The OS preference is enough.

Reversed since: **icon sets**. This plan originally left them out, on the
grounds that an icon per tool is a maintenance surface and the tool name is the
identifier. Overruled by the owner, and implemented with lucide-react: a
registry key per tool resolved to a component by `components/ToolIcon.tsx`, so
`lib/tools.ts` stays free of React and `app/sitemap.ts` does not pull icons into
its graph. A test asserts the key set and the map agree in both directions. The
maintenance concern was real but small; the cost measured out at under a
kilobyte, since Next lists lucide-react in `optimizePackageImports` by default.
Icons also replaced two hand-drawn SVG paths that were already in the
components, so the change removed markup as well as adding it.

### 7.9 Sequence

Each step ships on its own and leaves the site working.

1. **Registry and shell.** `lib/tools.ts`, the index at `/`, the tool moved
   to `/extract-audio`, header, footer, related tools, `app/sitemap.ts`.
2. **Tokens.** Swap the palette, radii and type scale in `globals.css`;
   cherry-pick the Inter setup from `8e2c9ec`; replace every literal
   `font-size` in the CSS modules with a token.
3. **Base UI.** Button, then Select and Progress, then Checkbox Group, then
   the navigation, in the order given in 7.4. The navigation waits for a
   catalogue big enough to need it; see the note in 7.4.
4. **The promise.** The strip, the popover copy and the per-tool lead
   paragraph.

Step 2 changes how the existing tool looks before any new tool exists; that
is intended, so the second tool is built on the finished system rather than
retrofitted to it.

---

## 8. Open questions

- What is the real usable output size before the heap gives out, per codec?
  Measure with `scripts/verify-large-file.mjs`, which already reports peak heap.
- Does the pinned core have the `subtitles` filter for burn-in? The current
  capability probe reads `-encoders`; muxer and filter availability need
  `-muxers` and `-filters`. Extend the probe before promising either.
- Ads or multithreading? The COOP/COEP decision blocks one of the two and
  should be made before either path gets built on.
- One deep category or several shallow ones? The tier model says depth in
  Tier A first; the SEO argument says breadth attracts more queries. Depth is
  the better bet while the differentiator is file size rather than feature
  count.
- Which category gets the second tool? Section 4 says a Tier A video tool;
  section 7.1 is built so that the answer does not change the shell.
