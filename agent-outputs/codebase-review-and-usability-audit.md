# Codebase review and usability audit

September 2026, at commit `37eeddd` (113 live tools).

This is the fourth audit of the site, and the first to cover the whole catalogue since the tools
with no engine arrived. The first three rounds found and fixed the engine's crash handling, the
queue's lost state, the PDF hang in a hidden tab and most of the interface's rough edges, and it
shows: the ffmpeg queue's state machine, the streaming CSV parser, the encryption format and the
page shell all held up under deliberate attempts to break them. What remains is concentrated in
three places:

1. **Tools that promise to remove something and do not remove all of it.** Delete PDF pages
   leaves the deleted pages in the file; Remove PDF metadata leaves the XMP packet; Remove image
   metadata keeps whatever follows the picture in a JPEG. These break the exact promise the
   tool is used for.
2. **Scale.** The site's headline is "no file size limit", and the media tools largely live up to
   it, but the no-engine tools were never tested at realistic sizes: a 2.7 MB CSV with 300k short rows
   crashes six tools, a 39 MB CSV cannot become a workbook, and sealing or zipping a 4 GB file
   needs 4 GB of memory.
3. **Round trips between the site's own tools.** A .docx packed by Create ZIP comes back corrupt
   from Extract ZIP; a page turned by Rotate PDF gets its page number sideways from Add page
   numbers. Each tool was tested alone; nothing tests them in sequence.

The usability audit's biggest findings are structural rather than cosmetic: with 113 tools there
is no search, and in most no-engine tools a setting changed after a file finishes silently does
nothing.

## Contents

- [Method](#method)
- [Priorities](#priorities)
- [Part 1: Usability audit](#part-1-usability-audit)
- [Part 2: Code review](#part-2-code-review)
- [Test suite and tooling](#test-suite-and-tooling)
- [Appendix: how to reproduce](#appendix-how-to-reproduce)

## Method

**Baseline.** `npm ci`, then `lint`, `typecheck`, `check:characters`, `test` and `build`, all on
this commit.

**Usability.** The production build served by `wrangler dev`, so the real `_headers` (CSP
included) and `_redirects` applied. Chromium, driven by Playwright, at 1280 x 800, 390 x 844 and
360 x 740, in the light and the dark theme. axe-core 4 on eleven pages in both themes. Real files
through twelve tools in six of the seven categories (all but subtitles): a 6.4 MB PNG, a CSV with a
quoted comma and a ZIP code, a five-page PDF with a rotated page, a damaged PDF, a text file named
`.mp4`, a small text file, and a 4-second VP8/Opus WebM recorded in the browser. Keyboard-only
navigation of the header and a tool page.

**Code review.** Six parallel reviewers, one per area (engine core, ffmpeg command builders, PDF,
data and text, images and archives and crypto, app shell and tooling), each told to verify every
finding by running code, mostly as throwaway vitest files that were deleted afterwards. The findings marked
"verified independently" below were then re-run a second time from scratch for this report:
PDF-1, IMG-1, IMG-7, DATA-1 and DATA-5 by test, APP-1 in the browser, and ENG-1, IMG-2, IMG-5,
CMD-1 and CMD-3 by reading the code path.

**Limits.** No real iPhone, iPad or Safari, so the canvas-size findings (IMG-4, PDF-12) are from
documented platform limits rather than a device. No screen reader. The ffmpeg core could not be
fetched from jsDelivr through this sandbox's proxy, so the browser was handed the same pinned
files from `node_modules/@ffmpeg/core` by request interception; the app's own SHA-256 check passed
on them, so the code path was the production one. No file over a few megabytes was pushed through
the browser; the large-input findings come from unit tests at the stated sizes.

**Severity.** P0: data or privacy loss, security, or a core tool broken. P1: a wrong result or a
failure on common input. P2: an edge case, a leak, or degraded UX. P3: minor or maintainability.

## Priorities

115 findings: 1 P0, 21 P1, 53 P2, 40 P3. The P0 and the P1s, in the order they are worth fixing:

| # | ID | Sev | One line |
| --- | --- | --- | --- |
| 1 | PDF-1 | P0 | Delete pages, clear metadata, remove annotations: the removed content is still in the saved PDF. |
| 2 | IMG-2 | P1 | Remove image metadata keeps everything after the picture in a JPEG, including trailing images with their own GPS. |
| 3 | APP-1 | P1 | The 31 MB ffmpeg core is downloaded on hover or focus on the 74 tool pages that never use it. |
| 4 | CMD-1 | P1 | Any odd-sized video (window captures, screen recordings) fails every H.264 re-encode. |
| 5 | CMD-3 | P1 | A `%` in a text watermark draws nothing and reports success. |
| 6 | CMD-4 | P1 | Add fade fails on every WebM with its default settings. |
| 7 | DATA-1 | P1 | A 2.7 MB CSV of 300k short rows crashes six CSV tools; any table over ~125k rows crashes more. |
| 8 | IMG-1 | P1 | Extract ZIP corrupts zip-based files (.docx, .xlsx, .epub) inside archives made by Create ZIP, and invents entries. |
| 9 | UX-1 | P1 | In 59 tools, a setting changed after a file finishes silently does nothing. |
| 10 | UX-2 | P1 | 113 tools, no search, and a 20,000 px index on a phone. |
| 11 | UX-3 | P1 | Encrypt file takes the passphrase once, masked; a typo loses the file. |
| 12 | PDF-2 | P1 | Page numbers and watermarks land sideways or off-page on rotated or cropped pages. |
| 13 | PDF-3 | P1 | Add image to PDF draws phone photos sideways and squashed. |
| 14 | CMD-2 | P1 | Burning subtitles into a clipped range shifts every cue by the clip's start. |
| 15 | CMD-5 | P1 | Edit tags fails on an Ogg Opus or Vorbis file with embedded art. |
| 16 | ENG-1 | P1 | A file with more than about 130 chapters is refused as having no audio or video. |
| 17 | DATA-5 | P1 | CSV to SQL drops leading zeros from ZIP codes and overflows 32-bit INTEGER. |
| 18 | DATA-4 | P1 | Excel to CSV/JSON shifts rows up after an empty styled row. |
| 19 | DATA-3 | P1 | An encoding decided from the first 64 KB silently replaces later accented characters. |
| 20 | IMG-3 | P1 | Extract TAR mangles non-ASCII names from macOS and Python archives. |
| 21 | IMG-4 | P1 | iPhone photos over 16.7 MP likely fail every canvas tool on iOS Safari (not run on a device). |
| 22 | DATA-2 | P1 | CSV or JSON to Excel fails past about 7 million cells, well under Excel's row limit. |

**Quick wins.** Each of these is a line or two and removes a whole class of failure: CMD-3
(`:expansion=none`), APP-1 (a `warmUp` prop), IMG-7 (clamp the ZIP date), DATA-1 and DATA-10
(loops instead of spreads, plus a lint rule), PDF-6 (reuse `nextTick`), PDF-13 (pad to the count),
IMG-15 (loop in `uniqueNames`), UX-6 (`white-space: nowrap`), UX-3's "above" -> "below", TOOL-4
(`--others`).

**Shared fixes that close several findings at once:**

- A "re-encode the picture" helper in `lib/engine/` that makes the size even, chooses a container
  that holds H.264, and sizes from the displayed frame: CMD-1, CMD-4, CMD-13.
- A "copy everything else that fits" stream map: CMD-7, CMD-8, CMD-9, CMD-14.
- For every PDF tool whose job is to remove something, save through a fresh document built with
  `copyPages`: PDF-1, PDF-11.
- A single `makeCanvas` with an area check: IMG-4, PDF-12.
- A module-level "work in progress anywhere" flag shared by the three queues, used for the unload
  guard and for an engine FIFO: UX-4, ENG-2, ENG-12.
- A settings snapshot per job in the plain queue, compared with the live settings: UX-1, CMD-15.

## Part 1: Usability audit

What was driven, and how, is in [Method](#method). Findings first, then what already works well.

### UX-1 (P1) A setting changed after a file has finished does nothing, and says nothing

**Where:** the 59 tools built on `components/PlainToolApp.tsx` (`:239-245`).

The settings panel collapses the moment a file lands, and a job runs with the settings of that
moment. Opening the panel again and choosing something else changes the panel's summary line but
not the card under it, and there is no way to re-run the file short of removing it and dropping it
again.

**Seen:** Compress image, photo.png at the default 500 KB -> a 496 KB JPEG. Opened "Target size" and
chose 200 KB. The panel header now reads "under 200 KB, JPEG"; the card still offers the 496 KB
file, unchanged, with no hint that it was made under other settings.

**Recommendation:** when the settings differ from those a finished job ran with, show "Settings
changed - apply to N files" above the queue (or a "Run again" on each stale card), and label a
stale card with the settings it was made under. The ffmpeg tools already solve part of this with
their "also as" chips; the plain tools need the general case.

### UX-2 (P1) 113 tools and no way to search them

**Where:** `app/page.tsx`, `components/SiteHeader.tsx`, `app/not-found.tsx`, `components/SiteFooter.tsx`.

The index is 7,573 px tall at 1280 px wide and 20,523 px on a 390 px phone. The "All tools" menu
opens a 3,900 px dropdown on a phone (it scrolls with the page, so it works, but it is a very long
way to "Sort and dedupe lines"). The 404 page repeats the whole list. There is no search box, no
type-to-filter, and no jump links to the seven categories anywhere. Someone who arrives looking
for "heic to jpg", "unzip" or "mp4 to mp3" has to scan by eye.

**Recommendation:** a filter input at the top of the index, in the menu and on the 404 page,
matching names, taglines, `accepts` and a few aliases per tool (the `_redirects` list is a start:
"mp3", "gif", "mute"). The registry already has everything needed; this is a client-side filter
over `liveToolsByCategory()`. Category chips that jump to each section would help the index on
phones, and collapsing each category in the phone menu would cut the dropdown to one screen.

### UX-3 (P1) Encrypt file: a mistyped passphrase loses the file for good

**Where:** `components/tools/EncryptFileApp.tsx:60-99`.

The passphrase is typed once, masked by default, and never confirmed. A typo when sealing a file
produces a file nobody can open, and the page is candid that there is no recovery. Separately, the
drop zone says "Type the passphrase above first" while the field is below it.

**Recommendation:** ask for the passphrase twice when the dropped file is not already one of this
page's sealed files (decrypting needs it once), or show it unmasked by default with a Hide button;
and change the copy to "below".

### UX-4 (P2) Leaving the page mid-job loses work without warning in 72 tools

**Where:** `lib/useConversionQueue.ts:1285` and `lib/useMergeQueue.ts:521` install a `beforeunload`
guard; `lib/plainQueue.ts` installs none.

Hashing a 40 GB image, sealing a large file, compressing a long PDF or splitting a big CSV can take
minutes, and a reload or an accidental close throws it away silently. The ffmpeg tools warn; the
72 tools on the plain queue do not. (ENG-12 below is the related case of the ffmpeg guard only
watching the tool that is mounted.)

**Recommendation:** the same guard in `usePlainQueue`, keyed on any job queued or working, ideally
on one module-level "anything running anywhere" flag shared by all three queues.

### UX-5 (P2) Internal error text reaches the user

**Seen:**
- Merge PDFs, a damaged PDF: "This file could not be processed. Cannot read properties of undefined
  (reading 'Pages')".
- Convert video, a text file named `.mp4`: "/input/source.mp4: Invalid data found when processing
  input", naming a path and a file the user never had.
- The PDF reviewer found the same pattern for WinAnsi encoding errors (PDF-5) and a mislabelled
  picture (PDF-3); the image reviewer for a canvas that could not be created (IMG-4).

The generic `PlainError` fallback appends the raw `Error.message`. The good errors on this site are
very good (Compress image on a PDF: "This is not an image. Drop a JPEG, PNG, WebP, GIF, BMP, AVIF or
HEIC file."), which makes these stand out.

**Recommendation:** in the plain queue's fallback, show a sentence about the file ("This PDF looks
damaged and could not be read") and put the raw message behind a disclosure like the media tools'
"Show ffmpeg log". In the engine, replace `/input/source.<ext>` with the user's file name before
display.

### UX-6 (P2) The header breaks on phones

**Where:** `components/SiteHeader.module.css` (`.trigger`, `.current`).

At 360 and 390 px, "All tools" wraps onto two lines (the trigger is 53 px tall instead of about
28 px), because the current tool's name beside it takes the space: "Remove image metad...".

**Recommendation:** `white-space: nowrap; flex-shrink: 0` on the trigger, and let only the current
name shrink.

### UX-7 (P2) On phones, most of every tool page is navigation

The footer lists all 113 tools in one column, about 4,000 px, under every tool page, after a
six-card "Other tools" block. A tool page on a 390 px phone is 5,400 to 6,900 px tall; the tool
itself is the first 1,000 or so.

**Recommendation:** below 640 px, collapse each footer category into a `<details>` (the links stay
in the HTML for crawlers), or show the category names only, each linking to its section of the
index.

### UX-8 (P3) Contrast of option blurbs in the light theme

axe-core, on every page with option cards: `#737373` on the selected card's `#f5f5f5` is 4.34:1
against the 4.5:1 minimum for 13 px text (`.optionBlurb` and `.fieldLabel` in
`components/Settings.module.css`). The dark theme had no violations. Darkening
`--muted-foreground` slightly, or keeping the selected card's background white and marking
selection with the border alone, fixes both. APP-5 lists the other light-theme pairs that fail.

### UX-9 (P3) Smaller things

- **Categories.** "Subtitles to transcript" is filed under Data rather than Subtitles, and "Sort and
  dedupe lines" under Data rather than Files (`lib/tools.ts:1439, 1451`).
- **Touch copy.** On a phone the zone still says "Drop video files here"; "Choose or drop..." reads
  better where dragging is not a thing.
- **Settings default open or shut.** 62 tools open their panel on load (43 plain, 19 media) and the
  rest start collapsed; the plain tools also collapse it on drop, and the media tools start work on
  drop. Both are defensible, but the rule is not visible to a user moving between tools, and with
  the panel shut Extract audio quietly produces two files (the stream copy and an MP3). The
  one-line summary in the collapsed header is doing most of the work; keep it accurate.
- **The primary action looks secondary.** Video to GIF's only way to start is a small "+ GIF" chip
  after "Use the whole clip:", styled like the optional extra formats elsewhere.
- **Validation shown before interaction.** Encrypt file shows its `role="alert"` message ("Type a
  passphrase") on page load, so a screen reader announces an error before anything was done.

### What works well

- The core flow is fast and legible: drop, a card per file, progress, a Download per output,
  "Download all as a ZIP", "Clear finished".
- Keyboard: every control reached by Tab has a visible 2 px outline; the menu opens with Enter, and
  Escape closes it and returns focus to its trigger.
- No horizontal scrolling at 360, 390 or 1280 px; the dark theme is complete and passed axe.
- Honest, specific copy about limits, and a privacy page that names the CDN request and the
  analytics (two of its claims need scoping; see APP-12).
- Error and no-op states are mostly excellent: wrong file type in Compress image, "Nothing to do -
  this file is already under 25 MB" in Compress video, an engine download banner with a real
  progress figure.
- Files, settings and finished outputs survive moving between tools and pressing Back.
- Dropping anywhere on the page works, not just on the zone.

## Part 2: Code review

Each area opens with the files it covers. Line numbers are at `37eeddd`. "Verified independently"
means the finding was reproduced a second time, from scratch, for this report.

### Engine core and media shell (ENG)

`lib/engine/ffmpegEngine.ts`, `coreLoader.ts`, `probe.ts`, `lib/useConversionQueue.ts`,
`lib/useMergeQueue.ts`, `components/ToolApp.tsx`, `FileCard.tsx`, `Waveform.tsx`.

| ID | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| ENG-1 | P1 | `ffmpegEngine.ts:98, 404, 622` | The probe keeps only the first 400 lines of `ffmpeg -i`. Chapters print before the stream table at three lines each, so an audiobook or film with about 130 or more titled chapters is refused as "No audio track found" (or "No video track found"), not retryable. Confirmed through the real engine class with a faked core: 100 chapters parse, 140 fail; verified independently in the code. | No cap for the probe, or keep `Stream #`, `Duration` and chapter lines through a `keep` filter as the silence scan does. |
| ENG-2 | P2 | `ffmpegEngine.ts:456, 493`; `useConversionQueue.ts:605-639`; `useMergeQueue.ts:227-262` | Every tool has its own queue but they share one engine with no lock. Start a long compress, go to Extract audio, drop a file: it fails at once with "The engine is already processing another file." and is never picked up again. The failed run also replaces, then clears, the running job's log listener. | One engine-level FIFO in `engineState` that `runJob` and `withEngine` await, shown as "Waiting for another tool..."; make the log sink a set. |
| ENG-3 | P2 | `ffmpegEngine.ts:324-349, 1284-1298` | `FFmpeg.load()` never settles if the worker script fails to load (a 404 after a deploy changes the versioned worker path, a CSP block), and `terminate()` cannot reach an instance that has not finished loading. The card sits at "Starting the ffmpeg engine..." for ever; Cancel sits at "Cancelling..." and every later file waits. | Keep the instance in a field before awaiting `load`; race `load` against a timeout and the worker's `error` event. |
| ENG-4 | P2 | `lib/engine/formats.ts:92-118, 196-210, 262-274` | Only WAV is sized before the run. "Original" (a default) copying a PCM, TrueHD or DTS-HD track, and FLAC of a long source, have no blocker: two hours of 24-bit 5.1 PCM is about 6 GB, which runs until the tab dies and takes every finished output in every tool with it. | Estimate from the stream's bitrate (or rate x channels x sample size for PCM) for every copy and encode, and refuse past the output ceiling as WAV already does. |
| ENG-5 | P2 | `ffmpegEngine.ts:825-858, 929-937, 1170, 1238` | `/out.<ext>` is deleted only after a successful read. A non-zero exit or a failed read leaves a partial output, up to about 1.5 GB, in the core's memory for the next job. Poster and waveform temp files leak the same way. | Delete outputs and temp files in a `finally` around the whole run. |
| ENG-6 | P2 | `ffmpegEngine.ts:136-150, 441-451` | Crash detection is an allowlist of messages. `RangeError: Array buffer allocation failed` and `NotReadableError` (source file changed or its drive unplugged) are not in it, so the engine keeps running on a possibly corrupted instance and the row shows the raw message. | Treat every `exec` rejection other than terminate/not-loaded as fatal; map allocation failures to the output-ceiling message. |
| ENG-7 | P2 | `useConversionQueue.ts:1240-1269`; `useMergeQueue.ts:493-512` | The shared "strip metadata" switch is read once per tool store. Turn it off in tool A, on in tool B, return to A: A shows off and writes "off" back, so A's outputs keep GPS and device tags against the user's last choice. | Keep the shared switch in one module-level store. |
| ENG-8 | P2 | `lib/download.ts:66-78` | "Download all as a ZIP" collects every chunk and then copies them into a new Blob: two extra copies of outputs that can be gigabytes each. | Build the archive as `new Blob([header, outputBlob, ...])` so existing Blobs are referenced, not copied; or save one by one above a size threshold. |
| ENG-9 | P3 | `ffmpegEngine.ts:299-303, 330-351` | A failed load clears `#ffmpeg` without terminating the instance: one live worker leaks per attempt. | Terminate the local instance in the catch. |
| ENG-10 | P3 | `components/Waveform.tsx:131-150` | `pointermove` selects immediately, so a tap with 1 px of jitter (common on touch, with `touch-action: none`) replaces the range with a 17 ms one and the panel shows an error. | Do not select until the drag passes `MIN_DRAG_SECONDS`. |
| ENG-11 | P3 | `lib/engine/coreLoader.ts:72, 101, 136` | After a checksum mismatch, a retry uses plain `fetch`, so the browser serves the same bad `immutable` response from cache. A drop mid-stream surfaces as a bare "network error". | Retry with `cache: "reload"`; wrap the read loop in the same `ExtractionError`. |
| ENG-12 | P3 | `useConversionQueue.ts:1277-1287`; `EngineBanner.tsx:28` | The unload guard watches only the mounted tool's store, so a conversion running in a tool you navigated away from dies on close without a warning. The crash note's dismissal is per component and returns on every page. | Key the guard on engine activity; keep the dismissal with the engine state. |
| ENG-13 | P3 | various | Dead or drifted code: `describeTrim` and `formatElapsed` are used only by tests; `extensionOf`/`baseName` duplicate `fileExtension`/`fileStem` and `baseName` falls back to "audio" for video; `TrimPanel`'s `disabled={isRunning}` is always false; the ">2 GB without WORKERFS" branch implies a fallback that does not exist; card-level Cancel and Retry have no file-specific accessible name. | Delete or reuse; add `aria-label` with the file name. |

The queue's state machine itself held up: cancel, retry, restart and re-queue are re-read from the
store on each pass, and no path was found that leaves a job stuck within one tool. The weak points
are all at the engine boundary.

### ffmpeg command builders (CMD)

Every file in `lib/engine/` that builds a plan, and the media tool components. Findings marked
"on the wasm core" were reproduced by running the pinned `@ffmpeg/core` 0.12.10 under Node with the
argv the real builders produce.

| ID | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| CMD-1 | P1 | `lib/engine/video.ts:47` (`H264_ENCODE`), used at `:343`, `:688` and by speed, precise trim, rotate, burn, watermark, fade and exact pieces | libx264 with `yuv420p` refuses odd dimensions, and only resize, the compressor when it scales, GIF to video and merge make the size even. **An 853 x 481 window capture or screen recording fails** Convert (to MP4), Compress, Change speed and Precise cut with "width not divisible by 2". Reproduced on the wasm core; verified independently in the code for Convert. | One shared "re-encode picture" helper that appends `scale=trunc(iw/2)*2:trunc(ih/2)*2` to every H.264 chain. |
| CMD-2 | P1 | `lib/engine/burn.ts:44-50, 89` | With `-ss` before `-i`, frames reach the `subtitles` filter re-based to zero, so a clipped burn draws the cues shifted by the clip's start: a clip from 5 s shows the cue for 0.5 s at 0.5 s and never shows the one at 6 s. Reproduced on the wasm core and native ffmpeg 7 by measuring frame luma. | `setpts=PTS+S/TB,subtitles=...,setpts=PTS-STARTPTS`, or shift the cue times by -S. |
| CMD-3 | P1 | `lib/engine/watermark.ts:121` | drawtext still expands `%` and `\` in a `textfile`. **"100% organic" logs "Stray %", draws nothing, and the job reports success.** Reproduced on the wasm core; verified independently in the code (no `expansion=none`). | Add `:expansion=none`. |
| CMD-4 | P1 | `lib/engine/level.ts:188` | Add fade with the picture on (the default) keeps a WebM a WebM but encodes H.264, which WebM cannot hold: every VP9/Opus .webm fails. Reproduced on the wasm core. | Use `pictureContainer`, or check the container holds H.264, whenever the picture is re-encoded. |
| CMD-5 | P1 | `lib/engine/tags.ts:111` | For audio with no new cover the plan maps `0:v?`; an Ogg Opus or Vorbis file with an embedded picture probes it as an mjpeg stream the Ogg muxer rejects. Retagging a yt-dlp .opus with a thumbnail fails. Reproduced on the wasm core. | Map `0:v?` only for containers in `COVER_CONTAINERS`. |
| CMD-6 | P2 | `lib/engine/video.ts:863, 892-895` | The one-pass `split -> palettegen` buffers every decoded frame until EOF, about ten times the size the guard estimates, against a 2 GB heap. A 40 s range of a 720p clip at source size passes the guard and fails with "Out of memory" after decoding; at the default 480 px and 15 fps, ranges over about 3 minutes fail. | Guard on buffered bytes, or run `palettegen` as its own pass to a scratch PNG. |
| CMD-7 | P2 | `lib/engine/chapters.ts:139`; `formats.ts:32` | The audio path `-map 0:a:0 -vn` drops cover art in Add chapters, Split by chapters, Split audio and Loop (which all say "every stream copied") and in Normalize, Volume, Fade, Speed and Channels; the video path drops MKV attachments, so ASS tracks lose their fonts. Reproduced on the wasm core. | Map `0:v?` attached pictures where the container takes covers; `-map 0:t?` for Matroska. |
| CMD-8 | P2 | `lib/engine/softsubs.ts:103` | If any existing subtitle track is a bitmap, all existing tracks are dropped, even into MKV, which carries PGS beside SRT: adding an SRT to a Blu-ray rip loses every existing track. | Keep all tracks for MKV; filter bitmaps only for MP4, MOV and WebM. |
| CMD-9 | P2 | `lib/engine/video.ts:796, 1189-1190` | Remove metadata passes `-sn` and maps only `0:v:0`, so subtitle tracks and extra video streams disappear, although the page says "the only thing that changes is what the file says about you". Remove audio drops subtitles too. | Keep `-map 0:s?` where the container holds it, or say so. |
| CMD-10 | P2 | `lib/engine/pieces.ts:73`; `split.ts:168` | Both splitters stop at 64 pieces without a word: a 2-hour file cut every minute ends at 1:04:00 and the chip says "Part 64 of 64"; an 80-chapter audiobook gives 64 files. | Let the last piece run to the end, or warn as `frames.ts` does. |
| CMD-11 | P2 | `lib/engine/frames.ts:40-45, 69`; `picture.ts:331` | Frame times come from the container duration; a seek into an audio tail past the last video frame writes no file, and the engine's `readFile` throws a raw filesystem error. | Bound by the video stream's length; turn a missing output into an `ExtractionError`. |
| CMD-12 | P2 | `lib/engine/tracks.ts:54` | `pcm_bluray` and `pcm_dvd` fall through to Matroska, which has no tag for them: extracting an m2ts LPCM track fails. Reproduced on the wasm core. | Re-encode to `pcm_s16le`/`s24le` WAV or FLAC. |
| CMD-13 | P2 | `lib/engine/picture.ts:100-128, 185, 221` | Resize computes sizes from the coded frame, but ffmpeg autorotates first: a portrait phone clip is labelled "1280x720" and comes out 720x1280, and "720p, 9:16" is hidden although it would work. | Use `merge.ts`'s `displaySize()`. |
| CMD-14 | P2 (likely) | `lib/engine/chapters.ts:138` | `0:s?` with `-c copy` into MP4 for a TS/M2TS source, which cannot hold DVB or PGS subtitles: Add chapters on a DVB recording with subtitles would fail the mux. | Drop bitmap subtitles, or fall back to MKV. |
| CMD-15 | P3 | `lib/engine/frames.ts:57`; `pieces.ts:105, 174` | Format ids ("frame-3", "part-2") omit the interval, image type and rule, so after a settings change a new output is taken for a duplicate of the old one. | Put the settings in the id. |
| CMD-16 | P3 | `lib/engine/audio.ts:247` | Normalize picks its container differently from Volume and Fade: a WebM normalises to MKV with AAC, a MOV to MP4. | Use `soundtrackTarget`. |
| CMD-17 | P3 | `lib/engine/audio.ts:177, 190` | Every PCM source is written back as 16-bit, and ALAC as AAC at 192k, though the core has `pcm_s24le` and `alac`: a 24-bit WAV or ALAC file comes back degraded from Normalize, Fade or Volume. | Keep the bit depth and ALAC. |

User text reaches ffmpeg safely almost everywhere: as separate argv entries or scratch files, with
the ffmetadata escaping of `= ; # \` and newline correct and `\,` used inside `-filter_complex`.
The recurring gap is structural: each tool decides its own filters, container and stream maps, so
the even-size step, the H.264-into-WebM check, rotation and cover art were each missed somewhere.
A shared "re-encode the picture" helper and a shared "copy everything else that fits" map would
close most of this table at once.

### PDF tools (PDF)

`lib/pdf/*` and the 24 PDF components.

| ID | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| PDF-1 | **P0** | `lib/pdf/pages.ts:287-294, 496-504, 246-248`; `lib/pdf/outline.ts:305` | pdf-lib's `save()` writes every object it loaded, reachable or not. **Delete PDF pages leaves the deleted pages' content streams and images in the file**; Remove PDF metadata's "clear" leaves the XMP packet; Flatten's "remove annotations" leaves the annotations; a replaced outline leaves the old titles. Verified independently: a 3-page PDF with page 2 removed saves with 2 pages and 3 content streams, one holding page 2's text. The tools' own copy promises the opposite. | Rebuild into a fresh document with `copyPages` (which copies only what is reachable) for every tool whose job is to remove something, or prune unreachable objects from `context` before `save()`. Add a test that searches the saved bytes for the removed content. |
| PDF-2 | P1 | `pages.ts:316-330, 412-430` | Page numbers and the text watermark ignore `/Rotate`, the MediaBox origin and the CropBox. On a page turned by this site's own Rotate tool the "bottom-center" number runs sideways down the left edge; on a cropped page it lands outside the visible area. `stampImage.ts` already does this correctly. | Place in shown coordinates from `getCropBox()` and map back through the rotation, as `stampImage.ts` does. |
| PDF-3 | P1 | `components/tools/AddImageToPdfApp.tsx:45-57` | A JPEG is embedded raw (pdf-lib ignores EXIF orientation) but sized from the oriented bitmap, so a phone photo of a signature is drawn sideways and squashed. The format comes from the file name, so a mislabelled file blames the PDF. `ImagesToPdfApp` handles both. | Reuse `pictureForPdf`. |
| PDF-4 | P2 | `lib/pdf/impose.ts:177-187`; `pageBoxes.ts:222-243` | `embedPage` without a bounding box drops the MediaBox origin and ignores the CropBox: in Booklet and Resize pages, a page with MediaBox `[100 100 400 500]` is shifted and clipped by 100 pt, and an Acrobat-cropped page prints uncropped. | Pass the CropBox to `embedPage` and size the faces from it. |
| PDF-5 | P2 | `pages.ts:414`; `WatermarkPdfApp.tsx:235` | Standard Helvetica is WinAnsi: Cyrillic, Greek, CJK, an arrow or a check mark in the watermark fails every file with "WinAnsi cannot encode...", offered as retryable. | Validate in the panel and say only Latin text can be stamped, or embed a Unicode font. |
| PDF-6 | P2 | `lib/pdf/extract.ts:359` | `pagePixels` renders without `onContinue`, so Crop PDF ("to the content") and Remove blank pages freeze in a background tab. `render.ts` fixed exactly this for `renderPage` in round three; the copy did not get it. | Share `nextTick` from `render.ts`. |
| PDF-7 | P2 | `render.ts:52-71` | When `getDocument` rejects (password, damage) the loading task is never destroyed; its worker and a copy of the bytes stay alive. | `loadingTask.destroy()` in the catch. |
| PDF-8 | P2 | `pages.ts:31-37`; `files.ts:125`; `ComparePdfsApp.tsx:43` | Any `/Encrypt` is reported as "cannot be read without the password", including owner-password-only files that every viewer opens. Compare PDFs refuses them at the pdf-lib step although its PDF.js path could read them. | Say "encrypted, possibly only against editing"; use PDF.js for facts in PDF.js tools. |
| PDF-9 | P2 | `lib/pdf/sizeSplit.ts:346-400` | Each piece re-saves the whole remainder and then bisects: 197 saves writing 2,807 pages to make 25 pieces from 100; with a tiny limit, quadratic before `MAX_PIECES` refuses; the abort signal is checked only between pieces. | Refuse up front on `size / limit > MAX_PIECES`; gallop from the previous piece's length; check the signal inside `sizeOf`. |
| PDF-10 | P2 | `lib/pdf/outline.ts:209-218` | A leading number wins over a trailing one, so pasted contents lines are misread: "1.2 Background ..... 5" goes to page 1 titled "2 Background ..... 5". | Prefer the trailing number after dot leaders. |
| PDF-11 | P2 | `pages.ts:505-510` | "Set these, keep the rest" rewrites Info but leaves the XMP `dc:title`/`dc:creator`, which Acrobat prefers, and leaves `ModDate`. | Rewrite or drop XMP when editing; bump `ModDate`. |
| PDF-12 | P2 | `render.ts:117-135`; `extract.ts:237-243` | Canvas size is unbounded (an A3 page at 300 dpi is 17.4 MP, over iOS Safari's 16.7 MP limit, and `getContext` returns null) and canvases are never released. | Cap the area by lowering the scale; zero each canvas after encoding. |
| PDF-13 | P3 | `PdfToImagesApp.tsx:56`; `ExtractPdfImagesApp.tsx:79` | `padStart(2)` with up to 200 pages: page-100 sorts before page-11. | Pad to the width of the count. |
| PDF-14 | P3 | `extract.ts:213-218, 308-316` | Images de-duplicated per page only (a logo on every page comes out N times); a second PDF.js loader that never sets `workerSrc`, working only because `render.ts` loads first. | Dedupe by object across the document; share the loader. |
| PDF-15 | P3 | `lib/pdf/ranges.ts:38-40` | An en dash pasted from a word processor ("1-3" typed with U+2013) is rejected; "3-0" is described as "starts before page 1". | Normalise U+2013 and U+2212 to "-". |

### Images, archives, hashing, encryption, file utilities (IMG)

| ID | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| IMG-1 | P1 | `lib/zip/archive.ts:99-127` | Extract ZIP uses fflate's streaming `Unzip`, which finds the end of a data-descriptor entry by searching for the next `PK` signature. The site's own Create ZIP writes descriptors and stores already-compressed files as-is, so **a .docx (or any zip-based file) packed by Create ZIP and opened by Extract ZIP comes back corrupt, plus phantom entries.** Verified independently: `report.docx, after.txt` in, `report.docx (825 B, was 626), word/document.xml, other.xml, after.txt` out. Stored videos hit a false signature about 0.75 times per GB. | Read the central directory with `File.slice` and inflate each entry by its known size. |
| IMG-2 | P1 | `lib/images/metadata.ts:318-320` | After SOS, everything to the end of the file is copied, including data after EOI: MPF secondary images, Samsung trailers, Pixel motion-photo MP4s, which can carry their own Exif and GPS. The card says it is gone. Verified independently in the code. | Stop at the first image's EOI, or strip each appended image too. |
| IMG-3 | P1 | `lib/zip/tar.ts:96-110` | pax record lengths are UTF-8 bytes but the parser slices the decoded string by characters: `path=cafe.txt` with an accent extracts as `"cafe.txt\n"` and the next record is lost. Every macOS or Python tar with a non-ASCII name has one. | Parse records on bytes; decode each value. |
| IMG-4 | P1 (likely) | `lib/images/canvas.ts:180-216` and every `getContext` in `lib/images` | No canvas area check and no null check. iOS WebKit refuses canvases over 16,777,216 px; an iPhone's own 24 MP photo is over that, so Convert, Rotate, Adjust, Watermark and Compress fail on it with "null is not an object (evaluating 'context.fillStyle')". Not run on a device. | One shared `makeCanvas` that checks the area and downscales or throws a `PlainError`. |
| IMG-5 | P2 | `metadata.ts:310` | A stray byte between segments ends the copy: two padding zeros after APP1 produce a 2-byte "clean" file (SOI only), reported as a success. Verified independently in the code. | Scan to the next marker, or copy the rest unchanged. |
| IMG-6 | P2 | `lib/hash/digest.ts:310-316`; `ChecksumApp.tsx:57, 73` | Only a bare hash is accepted. A pasted `sha256sum` line (the format this tool itself saves), a BSD line or "SHA-256: ..." is reported as "matches none of these" even when right. | Take the first 8-64 character hex run. |
| IMG-7 | P2 | `archive.ts:73` | fflate throws "date not in range 1980-2099" for an mtime before 1980: Create ZIP and Rename files fail outright on files with epoch or Nix store times. Verified independently. | Clamp mtime to 1980-01-01..2099. |
| IMG-8 | P2 | `lib/crypto/passphrase.ts:134-177`; `lib/zip/tarWrite.ts:122-153`; `archive.ts:62-86` | Encrypt, decrypt, plain .tar and ZIP collect every output chunk until the end, so a 4 GB file needs about 4 GB of renderer memory, against the tool's "Any size" and the code comment that a large file is never decrypted into memory whole. | Fold parts into a Blob every ~64 MB; reference the input `File` slices for a plain tar. |
| IMG-9 | P2 | `ExtractTarApp.tsx:35-42` | Only the first 500 entries become outputs, and Download all packs only those; entry 501 onward is unreachable. | Put everything in the ZIP; cap only the rows shown. |
| IMG-10 | P2 | `lib/images/palette.ts:87-92` | The median split can put one colour in both halves, inventing a colour not in the picture: 90% red and 10% blue asked for five swatches gives a purple 6%. | Split at a value boundary, or count distinct colours first. |
| IMG-11 | P2 | `lib/files/parts.ts:78-89` | The join command quotes the whole glob, which stops the shell expanding it: `cat 'my video.mp4.???'` fails. | Quote the base and leave `.???` outside. |
| IMG-12 | P2 | `lib/images/transform.ts:259-265` | An SVG with `width`/`height` and no `viewBox` renders at its own size in the corner of a larger transparent PNG; Favicon rasterises an SVG at its own (often 24 px) size and enlarges it. | Add `viewBox="0 0 w h"` from the original size when absent. |
| IMG-13 | P2 | `archive.ts:116` | Names without the UTF-8 flag are decoded as latin1; macOS Archive Utility writes UTF-8 without the flag, so accented names come out as mojibake. | Decode as UTF-8 when the bytes are valid UTF-8. |
| IMG-14 | P3 | `tar.ts:79, 130, 244` | pax `size` is parsed and ignored (Python writes 0 in the ustar field for 8 GB or more); the ustar prefix is read for GNU headers, where it holds atime/ctime. | Use `paxSize`; read the prefix only for `ustar\0`. |
| IMG-15 | P3 | `archive.ts:39-48` | `uniqueNames(["a.txt","a.txt","a (2).txt"])` returns a duplicate, so one file is lost on extraction (used by ZIP and Rename files). | Loop until the name is unused. |
| IMG-16 | P3 | `passphrase.ts:77, 169-171` | The header's iteration count is unbounded: a crafted file with 2^32-1 iterations freezes the tab in PBKDF2 before authentication. Truncating every block after the first is reported as "Wrong passphrase". | Cap iterations (about 10 million); word truncation separately. |
| IMG-17 | P3 | `metadata.ts:196, 221` | A malformed Exif pointer throws `RangeError`, and the tool refuses to strip the file. | Bounds-check the offset. |
| IMG-18 | P3 | `animation.ts:113-120` | Only the first 64 KB are scanned, so a GIF whose first frame is larger is called a still. | Scan further, or say "at least". |
| IMG-19 | P3 | `lib/files/identify.ts:122, 171` | Two-byte ASCII signatures are checked before the text test: a CSV beginning "BMI,Age" is a BMP. | Require more of the header for weak signatures. |
| IMG-20 | P3 | various | `photo` without an extension becomes `photo-clean.photo`; SVG to PNG accepts `.svgz` it cannot read; Join files cannot order a `.z01`...`.zip` set; `mime === "image/jpeg" && mayHaveTransparency(file)` in five tools is dead code. | Small fixes each. |

The encryption design is sound: PBKDF2-SHA-256 at 600,000 rounds, a 16-byte salt, AES-256-GCM in
the STREAM construction with a last-block flag, and the header as associated data. Truncation,
dropping the last block, swapping blocks, flipping a header byte and a wrong passphrase all fail
cleanly in tests. The only weaknesses are memory (IMG-8) and the unbounded iteration count (IMG-16).

### Data, text and subtitles (DATA)

| ID | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| DATA-1 | P1 | `lib/data/readCsv.ts:65, 67`; `CleanCsvApp.tsx:69, 71`; `lib/data/tables.ts:43, 201`; `lib/data/export.ts:18`; `SortCsvApp.tsx:47`; `MergeCsvApp.tsx:66` | `rows.push(...batch)` and `Math.max(...widths)` exceed V8's argument limit at about 125k items. **A 2.7 MB, 300k-row CSV crashes the shared reader** ("Maximum call stack size exceeded") in CSV to SQL, Sort, Merge, Split, Clean and Markdown; any table over about 125k rows crashes the width calculation. Verified independently for `readCsvRows` and `markdownTable`. | Loops instead of spreads, everywhere a spread can be large. A lint rule (`no-restricted-syntax` on spread arguments) would keep it out. |
| DATA-2 | P1 | `lib/data/xlsx.ts:127-135, 193` | Each sheet is one JS string; past about 7 million cells `join` exceeds V8's maximum string length. 900k rows x 8 short cells (a 39 MB CSV) fails with "Invalid string length" after the row-limit check has passed. | Encode row by row to bytes and stream through fflate's `Zip`. |
| DATA-3 | P1 | `lib/text/encoding.ts:69-88` (used by Convert text file, Sort lines, Compare files and every CSV tool) | The encoding is chosen from the first 64 KB and the rest decoded without `fatal`. A Windows-1252 file whose first accented character is past 64 KB is labelled "ASCII, which is also UTF-8" and every later accented byte becomes U+FFFD in the output, silently. | Where the whole file is in memory, validate all of it; when streaming, decode with `fatal: true` and restart as 1252 on failure, or at least count U+FFFD and warn. |
| DATA-4 | P1 | `xlsx.ts:320` | The row regex treats a self-closing `<row r="2" .../>` (written by Excel, XlsxWriter and pandas for empty styled rows) as an opening tag, swallowing the next row: data moves up a row. | Match both forms, and take the row number from the cell reference. |
| DATA-5 | P1 | `export.ts:81, 133` | CSV to SQL types `\d{1,18}` as INTEGER and writes `String(Number(x))`: ZIP codes lose their leading zeros (02134 -> 2134; verified independently), 17-digit IDs change, 10-digit phone numbers and epoch-ms times overflow a 32-bit INTEGER in Postgres and MySQL, and `1e400` becomes a bare `Infinity`. | INTEGER only without leading zeros and within 32 bits, BIGINT to 18 digits, else TEXT; write the source digits verbatim. |
| DATA-6 | P2 | `lib/data/csv.ts:282-290` | JSON to CSV/Excel treats a single record with one list field as the list: `{"id":7,"name":"Ada","tags":["math","code"]}` becomes a one-column CSV of the tags, and the record is lost. | Unwrap only arrays of objects in an envelope-like parent. |
| DATA-7 | P2 | `tables.ts:60-76` | Merge CSV keys columns by lowercased name, so two blank or repeated headers collapse and one cell overwrites the other; cells past the header width are dropped. | Key by name plus occurrence; keep or warn about overflow. |
| DATA-8 | P2 | `lib/subtitles/parse.ts:151-166` | An SRT without a blank line between cues merges the next cue's number and timing into the text, with no warning. | Start a new cue at any timing line inside a block. |
| DATA-9 | P2 | `xlsx.ts:229-234` | The reader appends furigana (`<rPh>`) to Japanese text: a cell reading "Tokyo" in kanji comes back with its katakana reading glued on. | Drop `<rPh>` before collecting runs. |
| DATA-10 | P2 | `lib/text/diff.ts:62` | `out.push(...edits)` again: two 150k-line files that differ in two places crash Compare files. | Push in a loop. |
| DATA-11 | P2 | `lib/data/json.ts:185-190, 247-250` | Format JSON rewrites numbers: 12345678901234567890 -> 12345678901234567000, 1.0 -> 1, -0 -> 0. | Warn on integers beyond 2^53, or re-indent with a tokenizer that keeps number text. |
| DATA-12 | P2 | `lib/subtitles/transcript.ts:77` | The transcript CSV writes dialogue lines such as "- Where are you?" that Excel evaluates as formulas, and has no BOM, so accents break in Excel. No CSV writer in the repo neutralises formula cells. | Prefix `= + - @` cells with `'` in spreadsheet-oriented output; offer a BOM as the other CSV tools do. |
| DATA-13 | P3 | `csv.ts:200-212`; `export.ts` `sqlColumnNames` | Header deduplication can still collide ("a","a","a_2" -> a, a_2, a_2: a duplicate SQL column); a `__proto__` header vanishes from JSON records. | Check against the set already emitted; `Object.create(null)`. |
| DATA-14 | P3 | `csv.ts:260-275` | Flattening: a literal key "a.b" and nested a.b collide; an empty nested object yields no column. | Detect and suffix. |
| DATA-15 | P3 | `tables.ts:165-166`; `SortCsvApp.tsx:58` | A descending numeric sort puts non-numbers first (the UI says last); a column past a short header throws. | Apply direction to numbers only; guard the header. |
| DATA-16 | P3 | `xlsx.ts` | Sheet names can still collide ("Data","Data","Data (2)"); U+FFFE/U+FFFF are not stripped; literal `_x0041_` is not escaped; the 32,767-character cut has no note on the card. | Fix each; note the cut. |
| DATA-17 | P3 | `parse.ts:167, 201`; `write.ts:61` | WebVTT: entities decoded before tags are cleaned; a header without a blank line swallows the first cue; "-->" in text is not escaped. | Reorder; tolerate; escape. |
| DATA-18 | P3 | `write.ts:155` | ASS round trip drops `Comment:` events and [Fonts]/[Graphics]; SSA `Marked=0` written empty; "Press {Enter}" becomes a hidden override block. | Keep and escape. |
| DATA-19 | P3 | `export.ts` `markdownCell` | CSV to Markdown passes raw HTML through (an `<img onerror>` cell is live in renderers that allow HTML) and a bare CR breaks the row; the HTML output lacks `<meta charset>`. | Escape `<`, `>`, `&` and CR; add the meta tag. |
| DATA-20 | P3 | `lib/text/lines.ts:253` | CR-only line endings are read as one line by Sort lines and the diff; Compare files calls a CRLF-vs-LF difference "only the encoding or a byte-order mark". | Split on CR too; name line endings in the verdict. |
| DATA-21 | P3 | `xlsx.ts` | Namespace-prefixed sheets (`<x:row>`) read as empty; a time-only cell in a 1904 workbook gets a date; formula results print as 0.30000000000000004. | Strip prefixes; handle time-only; round to 15 significant digits as Excel shows. |
| DATA-22 | P3 | `diff.ts` | Past `MYERS_LIMIT` a whole gap is reported as replaced: 100k repetitive lines with 5% edits show every line changed. | Recurse with a coarser anchor, or say the diff is approximate. |
| DATA-23 | P3 | `csv.ts:137-144` | An unterminated quote silently swallows the rest of the file into one field. | Flag "ended inside quotes" and note it on the card. |
| DATA-24 | P3 | `CleanCsvApp.tsx` | Re-implements `readCsvRows` and has drifted (no size cap, no .xlsx refusal). | Call the shared reader. |

The streaming CSV state machine is correct across chunk, CRLF and UTF-8 boundaries, and the subtitle
reader already decodes strictly with a 1252 fallback; the problems are scale assumptions never
tested at realistic sizes, types inferred through `Number()`, and regex XML parsing.

### App shell, plain queue, configuration (APP)

`lib/plainQueue.ts`, `lib/tools.ts`, `components/PlainToolApp.tsx`, `CombineApp.tsx`,
`DropZone.tsx`, `components/ui/*`, `app/*`, `public/_headers`, scripts and CI.

| ID | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| APP-1 | P1 | `components/DropZone.tsx:81-86, 143-145` | The drop zone's warm-up (400 ms of hover, or any focus) fetches and hashes the 31 MB ffmpeg core on **every** tool page, including the 74 that never load ffmpeg. Verified independently: hovering the zone on Compress image, or tabbing to the input on Merge PDFs, requests `ffmpeg-core.wasm` from jsDelivr. On a phone, tapping "Choose files" focuses the input. This is 31 MB of someone's data plan for nothing, contradicts the component's own comment, and makes the privacy page's "one third-party request" (for the media tools) untrue for every other tool. | A `warmUp` prop defaulting to false, set only by `ToolApp` and the engine merge apps. |
| APP-2 | P2 | `lib/plainQueue.ts:485, 453-456, 542`; `CombineApp.tsx:105` | Dropping a file while a combine run (Merge PDFs, Images to PDF, Create ZIP...) is working resets the status to idle: the progress bar and Cancel vanish, the action button returns, and pressing it starts a second concurrent run. The first lands as "done" without the new file; its object URL is overwritten and never revoked. | Disable the zone while busy, or queue additions without touching status and outputs until the run settles. |
| APP-3 | P2 | `plainQueue.ts:487-508` | `addFiles` in the combine queue starts `inspect` for every file at once, and image inspection decodes the whole picture to read its size. 30 PNGs of 5000 x 5000 dropped on Images to PDF took Chromium from 768 MB to 3.1 GB; a hundred phone photos will likely kill the tab. | A pool of two to four; read dimensions from the header, or decode with `resizeWidth`. |
| APP-4 | P2 | `PlainToolApp.tsx:291-301`; `plainQueue.ts:255-258` | Every progress report replaces the job array and re-renders every card, unmemoised, with fresh callbacks: quadratic in the number of files. With five reports per file, 50 files took 3.6 s of rendering, 200 took 42.6 s (jsdom). A thousand files on Checksum or Rename files will freeze the page. | `React.memo` the card with id-based handlers; throttle progress patches to one per frame. |
| APP-5 | P2 | `PlainToolApp.module.css:70-83, 118-123`; `app/globals.css:23, 35-36`; `Settings.module.css` | Light-theme contrast: the Waiting/Working/Nothing-to-do pill is 3.76:1, the Failed pill 4.41:1, alert hints 4.33:1 and 4.35:1, the selected option card's blurb 4.34:1 (also found by axe, UX-8); control borders `#d4d4d4` on white are 1.48:1 against the 3:1 non-text minimum. The dark theme passes. | `--muted-foreground` to about `#666`; control borders to about `#8a8a8a`. |
| APP-6 | P2 | `PlainToolApp.tsx:157, 171-178, 278-282`; `components/ui/Button.tsx:16-22` | Nothing tells a screen-reader user a file has finished: the badge is not live, the phase region exists only while working (and speaks on every chunk), and "N remaining" unmounts at zero. Remove, Retry and Clear finished drop focus to `<body>`. `Button.tsx` says `focusableWhenDisabled` keeps disabled controls reachable, but it is never passed. | One persistent polite region ("photo.png done", "five.pdf failed"); move focus to the next card or the heading after a removal; pass the prop or fix the comment. |
| APP-7 | P3 | `components/ui/FileField.tsx:28-30, 49-54` | The second-file input (a logo, a cover, a subtitle file) is named by the chosen file, or "No file chosen", never by its purpose; its note and error are not linked. | A `label` prop and `aria-describedby`. |
| APP-8 | P3 | `plainQueue.ts:234`; `PlainToolApp.tsx:198` | A failed "Also as" output records only the generic message, not the hint or which format failed; two failures render duplicate React keys. | Store "WebP: message hint"; key by index. |
| APP-9 | P3 | `DropZone.tsx:101-127`; `CreateZipApp.tsx:34` | A disabled zone still highlights on drag and says "Drop to add the files", then discards the drop silently; a dropped folder becomes an unreadable pseudo-file that fails the whole ZIP; Create ZIP's `reject` is a no-op (`file.size === 0 ? null : null`). | No highlight when disabled; expand or refuse directories with `webkitGetAsEntry()`; remove or finish the check. |
| APP-10 | P3 | `lib/tools.ts:1545-1553`; `ToolPage.tsx:112` | Related tools are always the first six of the category, so 65 of 112 tools never appear in any "Other tools" block; the block sits outside every landmark. | Pick neighbours by registry position; wrap in `<aside>` or move into `<main>`. |
| APP-11 | P3 | `public/`, `app/manifest.ts`, `README.md:1013-1018` | No `robots.txt` (the 404 page is served), so crawlers are not pointed at the sitemap; the manifest's only icon is the ICO and its colours differ from `themeColor`; the README's self-hosted core recipe omits that `connect-src` must list the new host, which breaks every conversion if followed. | `app/robots.ts` with a `sitemap` entry; 192 and 512 PNG icons; one line in the README. |
| APP-12 | P3 | `app/privacy/page.tsx:68-70, 99-101` | The privacy page says "exactly one third-party request" and then names the analytics; with APP-1 the no-engine pages also fetch the core. It says every tool removes metadata by default and points to an "Output options" panel, but the PDF tools deliberately copy title and author and the plain tools have no such panel. | Scope both claims to the media tools; list the analytics requests. |

The registry is consistent (every live tool has a page, slugs and directories match, the `engine`
flag matches the component used, canonicals and JSON-LD are right), the main plain queue's cancel,
retry and URL revocation are correct and tested, and `_headers` is accurate: PDF.js 6, the blob
workers and the core all run under the production CSP with no violations.

## Test suite and tooling

**Baseline on this commit:** `lint`, `typecheck`, `check:characters` and `build` pass;
`npm test` runs 742 tests green and skips 51, in about 16 s, with no flaky patterns found. The
build fits Cloudflare's 25 MiB per-file limit (the `out/` directory is 52 MB in all).

| ID | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| TOOL-1 | P2 | `.github/workflows/ci.yml`; `tests/*.integration.test.ts` | CI never installs ffmpeg and the integration suites use `describe.skipIf(!hasFfmpeg)`, so the 51 tests that run generated command lines against a real ffmpeg are skipped on every CI run, silently. They are the only tests that check a plan actually works. | `apt-get install ffmpeg` in CI, and an env flag that turns "ffmpeg missing" into a failure there. |
| TOOL-2 | P2 | `scripts/verify-*.mjs` | The browser verifications exist and are good, but nothing runs them automatically, and their static servers skip `_headers`, so the CSP is never exercised by a test. `verify-plain-tools.mjs` needs only Chromium. | A CI job for `verify-plain-tools`, serving `_headers` (or run behind `wrangler dev`). |
| TOOL-3 | P2 | `vitest.config.ts`; `components/` | There are no component tests for 116 tool components or the shared UI, and the config cannot render one (no `jsx: "automatic"`, so "React is not defined"). The shells (`PlainToolApp`, `CombineApp`, `DropZone`, the header menu) are where APP-2, APP-4, APP-6 and UX-1 live. | `esbuild: { jsx: "automatic" }`, then a handful of tests on the shells. |
| TOOL-4 | P3 | `scripts/check-characters.mjs:96` | The check lists files with `git ls-files`, so an untracked new file is never checked; CLAUDE.md tells contributors to run it before committing, which is exactly when new files are untracked. | `git ls-files --cached --others --exclude-standard`. |
| TOOL-5 | P3 | `package.json` | `npm audit --omit=dev` reports `postcss <= 8.5.22` under `next`, build-time only and not reachable in a static export; fixed only by Next 16. Dev-only advisories under `wrangler`/`miniflare` (sharp) and `@vitest/mocker`. | Note it; take Next 16 when convenient. |

**Missing tests that matter most**, from all six areas:

- That removed content is absent from the saved bytes (PDF-1, IMG-2): a search of the output for a
  marker string planted in what was removed.
- Round trips between the site's own tools: Create ZIP -> Extract ZIP with a stored .docx
  (IMG-1), Rotate PDF -> Add page numbers (PDF-2), CSV to Excel -> Excel to CSV.
- Anything at realistic size: a 300k-row CSV (DATA-1), a 1M-cell workbook (DATA-2), a 150k-line
  diff (DATA-10), a 140-chapter probe (ENG-1).
- `FFmpegEngine` itself: every engine test fakes the `AudioExtractor` interface, so probe capture,
  the crash classifier, cleanup on failure, load failure and terminate are untested (ENG-1, 3, 5,
  6, 9). A fake `@ffmpeg/ffmpeg` class is enough.
- The PDF.js paths (render, text, images, pixels): none are exercised by any test.

## Appendix: how to reproduce

**The browser pass.** `npm run build`, then `npx wrangler dev --port 8787` to serve `out/` with
`_headers` and `_redirects`. Drive it with `playwright-core` and the preinstalled Chromium. Where
jsDelivr is unreachable, fulfil `https://cdn.jsdelivr.net/**` from
`node_modules/@ffmpeg/core/dist/esm/`; the app's checksum still runs on those bytes.

**PDF-1**, deleted pages left in the file (pdf-lib alone shows it):

```js
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (const text of ["Public", "SECRETSALARYTABLE", "Another"]) {
  doc.addPage().drawText(text, { font, x: 50, y: 700 });
}
const source = await PDFDocument.load(await doc.save());
source.removePage(1);
const out = await source.save({ useObjectStreams: false });
// 2 pages, 3 content streams; inflate each and one still contains SECRETSALARYTABLE.
```

**IMG-1**, the ZIP round trip, as a vitest file:

```ts
const docx = zipSync({ "word/document.xml": strToU8("<w>hello</w>".repeat(20)) }, { level: 0 });
const zip = await createZip([new File([docx], "report.docx"), new File(["tail"], "after.txt")]);
const entries = await readZip(new File([zip], "out.zip"));
// entries: report.docx (wrong size), word/document.xml, after.txt - expected two.
```

**DATA-1**, the argument-spread crash:

```ts
let csv = "id,flag\n";
for (let i = 0; i < 300_000; i++) csv += `${i},1\n`;
await readCsvRows(new File([csv], "big.csv")); // RangeError: Maximum call stack size exceeded
```

**APP-1**, the unneeded core download: open `/compress-image`, rest the pointer on the drop zone
for half a second (or Tab to its input on `/merge-pdf`), and watch the network panel for
`ffmpeg-core.wasm`.

**UX-1**: on `/compress-image`, drop a large PNG at the default 500 KB, then choose 200 KB in
"Target size". The header of the panel changes; the card does not.
