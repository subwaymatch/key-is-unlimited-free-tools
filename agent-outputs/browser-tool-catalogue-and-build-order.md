# Catalogue of near-zero-cost browser tools, and a build order

Status: research note, 2026-09-06. Companion to
[the audio extraction plan](audio-extraction-research-and-implementation-plan.md).

This merges an earlier chatbot's brainstorm with corrections and additions made
while reading this codebase. The earlier list was a flat menu of about 130
ideas. The value added here is the cost model that sorts them, three
corrections where the original advice was wrong or risky, the categories it
missed entirely, and a build order that follows from what `lib/engine/` already
does.

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

## 7. Open questions

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
