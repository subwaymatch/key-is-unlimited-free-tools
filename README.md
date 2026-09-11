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
| `/video-to-gif` | Turn a range into a looping GIF | `palettegen` and `paletteuse` in one filter graph, at a chosen frame rate and longest side |
| `/remove-audio` | Mute a video | `-an` with the video stream copied |
| `/remove-metadata` | Strip tags, dates, location, chapters and data tracks from a video or audio file | `-map_metadata -1` with every stream copied |
| `/change-speed` | Speed a video up or slow it down, from 0.1x to 100x, audio pitch-corrected | `setpts` and `fps` on the video, an `atempo` chain on the audio, one H.264 encode |
| `/merge-videos` | Join several clips into one file | The concat demuxer with every stream copied when the clips match; the concat filter and one H.264 encode when they do not |
| `/convert-subtitles` | Turn SRT, WebVTT and ASS into each other or a transcript, and shift or stretch their timing | Plain TypeScript, no WebAssembly at all |
| `/resize-video` | Scale a video down to a height or a fraction, or crop it to 16:9, 9:16, 1:1, 4:5 or 4:3 first | A centred `crop` in ffmpeg's own arithmetic, the bounded `scale` the compressor uses, one H.264 encode, audio copied |
| `/rotate-video` | A quarter turn either way, a half turn, a mirror or a vertical flip | `transpose`, `hflip` and `vflip` on the picture as a player shows it; the output carries no rotation tag |
| `/video-thumbnails` | A contact sheet of frames spread across the video, or one frame as JPEG or PNG | `fps` at frames-per-length into `tile`, one image out; a single frame seeks to the start marker |
| `/convert-audio` | WAV, FLAC, M4A, OGG, Opus or a video's soundtrack to MP3, and every other way | The extractor's catalogue pointed at audio files: copied when the source is already the target |
| `/normalize-audio` | Bring a file or a video's soundtrack to -14 LUFS for streaming, -16 for podcasts, -23 for broadcast, or a custom target | `loudnorm` in two passes: measure, then one linear gain from the measurement; the picture of a video is copied |
| `/extract-subtitles` | Pull the subtitle tracks out of an MKV or MP4 as SRT or WebVTT | A stream copy through the `srt` or `webvtt` encoder, one file per track; image-based tracks refused with a reason |
| `/burn-subtitles` | Draw an SRT, WebVTT or ASS file, or the video's own track, into every frame | The `subtitles` filter on libass, with a font the site ships written into the core for the run and forced by name |
| `/compress-audio` | Opus for speech, AAC or MP3 for music, or a bitrate worked out to land under a size | Presets baked into the format; a target size becomes a rate from the length, Opus below 64 kbps and AAC above |
| `/audio-channels` | Mono, left or right only, sides swapped, mono on both sides, or the centre cut to remove vocals | `-ac` and `pan`, written back in the source's own format; the card offers only what applies to the file's channels |
| `/audio-waveform` | A waveform PNG on a transparent background, or a spectrogram with its legend | `showwavespic` on a mono mix and `showspectrumpic`, one PNG each |

Every tool is one configuration of the same machinery: a catalogue of formats in `lib/engine/`,
a page shell in `components/ToolApp.tsx`, and an entry in the registry in `lib/tools.ts` that
puts it on the index, in the header and footer, in the related-tools block and in the sitemap.
Adding a tool is a registry entry, a catalogue and a page. Two tools have a shape of their own
and share only the frame: the merger, which is one job over several files rather than one job
per file, and the subtitle converter, which never loads ffmpeg at all.

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
  ToolFrame.tsx      the page around any tool: title, lead, the tool, the fine print
  ToolApp.tsx        the page every queue-driven tool is built from: banner, drop zone, settings, queue, cards
  tools/*.tsx        one small file per tool: its catalogue, features and settings panel
  tools/MergeVideosApp.tsx      the merger: a list of clips to order, one join, one output
  tools/ConvertSubtitlesApp.tsx the subtitle converter: files parsed on arrival, outputs derived live
  FileCard.tsx       a file in the queue: outputs, progress, preview, clip panel
  *.module.css       plain CSS modules; no utility-class framework
lib/useConversionQueue.ts   sequential job runner, progress + cancellation, per-tool options
lib/useMergeQueue.ts        the merger's store: clips read as they arrive, joined on request
lib/engineState.ts   the one engine's load state, shared by the queue and the merger
lib/toolFeatures.ts  what a tool's cards offer: clip panel, silence detection, whole-file chips
lib/mediaTypes.ts    the cheap first pass: is this even a media file, and what an input accepts
lib/persist.ts       remembering a tool's settings between visits, without a hydration mismatch
lib/subtitles/       SRT, WebVTT and ASS parsers and writers, and retiming; no WebAssembly
public/fonts/        DejaVu Sans, the one font the burn-in tool has, with its licence
lib/engine/
  types.ts           the engine contract, and the OutputFormat shape every tool's catalogue uses
  ffmpegEngine.ts    ffmpeg.wasm implementation - mount, probe, run a plan (one pass or two), scan, merge
  coreLoader.ts      fetches the ~31 MB core with byte-level progress; verifies its checksum
  formats.ts         the audio catalogue; decides stream-copy vs re-encode
  audio.ts           loudness, compression to a rate or a size, channel operations, pictures of audio
  burn.ts            subtitles drawn into the picture: the filter, the font, a file or the file's own track
  video.ts           the video catalogues: convert, compress, trim, GIF, mute, strip metadata, speed
  picture.ts         resize and crop, rotate and flip, single frames and contact sheets
  captions.ts        subtitle tracks out as SRT or WebVTT; bitmap tracks refused
  merge.ts           the merger's decision - copy or re-encode, and why - and both command lines
  trim.ts            pure trim logic - ranges, timecodes, silence parsing
  probe.ts           pure parsers for ffmpeg's stderr, audio and video streams alike
  constants.ts       pinned versions, checksums and asset URLs
```

Files convert **one at a time**. There is a single ffmpeg worker with a single heap, so concurrency
would multiply peak memory without making anything faster - the work is I/O- and codec-bound, not
parallel.

The queue's state lives in a module-level store keyed by tool, not in the component. Two things
need that: the async pump runs outside the render cycle and must never read a stale snapshot, and
moving between tools unmounts the page. Trimming a file, glancing at the GIF maker and pressing
Back used to lose the file, the markers and both finished cuts without a word, because the state
and the object URLs went with the component. The component is now a view onto a store that outlives
it, and object URLs are released when a file is removed rather than when a page is left.

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
a few percent smaller output. WebM copies VP8 and VP9 and otherwise encodes **VP8**; MKV repackages
every stream untouched.

VP8 rather than VP9 is not a preference. `libvpx-vp9` is compiled into @ffmpeg/core 0.12.10 and
advertised by `-encoders`, and every invocation of it traps with `RuntimeError: memory access out
of bounds` a fraction of a second in - at any resolution, with or without audio, in
constant-quality or constrained mode, and with row threading and multithreading both off. Worse,
the trap took the whole instance with it: every later command in that worker failed, including a
probe of a completely different file, until the page was reloaded. `libvpx` (VP8) in the same build
encodes the same input without complaint. See [Surviving a crash](#surviving-a-crash) for the other
half of that fix.

The tools that only copy streams keep the source container. A MOV stays a MOV, an MKV stays an MKV,
and only a container that genuinely cannot hold the streams is changed - dropping the audio from a
file is one change, and turning it into an MP4 at the same time is a second one nobody asked for.
ffmpeg's format name cannot tell a MOV from an MP4 (both probe as `mov,mp4,m4a,3gp,3g2,mj2`), so
the plan is given the source file's extension along with the probe.

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

The speed changer is always a re-encode, since every frame's timestamp moves and every audio
sample is resampled. Video goes through `setpts=(PTS-STARTPTS)/f` and then the `fps` filter at
the source's own rate, so a 2x speed-up drops frames and a 0.5x slow-down repeats them rather
than the file coming out at 60 or 15 fps; audio goes through `atempo`, which holds the pitch,
chained in steps between 0.5 and 2 because that is the range every ffmpeg accepts and the
documented way past it. Two things about the engine had to change for it. Progress is measured
on the output's clock, so a plan says how long its output is relative to the range it reads
(`durationFactor`), or a 2x job would stop at 50%. And the range's `-t` moves to the input side
(`limitInput`): as an output option it stops the encoder once the *output* reaches the length of
the range, which cut every slow-down off halfway.

The merger decides between the two joins ffmpeg offers and says why. When every clip has the
same codec and profile, frame size and pixel format, frame rate, rotation and audio layout, the
concat demuxer copies the packets straight through - lossless, seconds, and the source container
kept - from a list the engine writes into the core's filesystem for the run. When anything
differs, and the summary line names each difference against clip 1, each clip is decoded, scaled
into the first clip's frame with black bars where the shape differs, brought to its frame rate,
and the concat filter writes one H.264 stream; clips without audio are given silence of their own
length so the sound stays in step. The clips are mounted together in one WORKERFS mount, so a
join of several multi-gigabyte files never copies any of them. Clips are read as they arrive and
the join waits for the button, so the decision is on screen before anything is committed to.

### Stream copy vs re-encode

Every audio format copies the track without decoding it whenever the source codec already matches -
bit-for-bit identical output, and seconds instead of minutes on a large file. The UI labels these
outputs `STREAM COPY`. Re-encoding an MP3 to an MP3, or an Opus to an Opus, throws quality away to
arrive at the format that was already there, which is never what "MP3" was asked for.

Where two formats would then produce the same file - "Original" and "M4A (AAC)" of an AAC source
are both a stream copy into an `.m4a` - "Original" adds `-original` to the name, so two downloads
do not land in the folder as `clip.m4a` and `clip (1).m4a` with no way to tell them apart.

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
Downloads under the same name. The trimmer's two cuts add `-fast` and `-precise` for the same
reason: they are the same range of the same file and would otherwise share one name.

A fast cut can only begin on a keyframe, so a cut from 0:03 routinely starts seconds earlier.
Nothing on the way in knows by how much - finding out would mean a pass over the source looking for
keyframes - but the finished file does, because it is longer than the range that was asked for by
exactly the overshoot. The engine probes the output before reading it back and the row reports
where the cut really landed, instead of presenting the requested range as if it were exact.

There are two ways to set the range:

- **Markers.** Type start and end timecodes (`1:30`, `0:04.5`, `90`). Per-file markers appear on
  the card once the file has been probed, where the duration is known and - when the preview is of
  the untrimmed track - its playback position can be dropped straight into either field. A bare
  number is a count of seconds and may be anything, but once there is a colon the fields are a
  clock: `9:99` is a typo, not 10:39, and is refused rather than quietly cut somewhere else. An end
  past the end of the file is clamped, and the panel says so rather than showing one range and
  producing another.
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

### Loudness

Loudness normalisation is the one tool whose final command line cannot be written up front.
`loudnorm` in a single pass is a dynamic normaliser that rides the gain through the file and pumps
on music; the honest version measures first and then applies one linear gain, and the second
pass's arguments are the numbers the first one printed. So a plan may now carry a `refine` hook:
the engine runs the analysis pass, keeps the log lines the plan asks for (loudnorm's JSON block,
five lines out of thousands), and hands them to the plan to write the final pass from. Without a
usable measurement - a silent file prints `-inf` - the plan falls back to the dynamic mode rather
than failing. Two more details worth knowing: `loudnorm` resamples to 192 kHz internally and would
write that out, so the source's sample rate is set on the output; and an audio file comes back in
its own format (MP3 as MP3, FLAC as FLAC, WAV as WAV) while a video keeps its picture copied and
gets an AAC soundtrack. The integration test measures the result with `ebur128` and expects it on
the number.

### More audio

The audio compressor's presets are codec and rate: Opus for speech, which is unmatched at low
rates and plays in every browser and messaging app, AAC and MP3 for music, which have to open in a
car stereo as well. A target size becomes a rate the way the video compressor's does, from the
length, with Opus below 64 kbps and mono below 32. The channel tool is `-ac` and `pan`: the card
offers only what applies to the file's channels, so a mono file is offered stereo and a stereo file
its sides, and vocal removal is the old centre cut, offered honestly as something that works on
some mixes and not on others. The waveform is `showwavespic` on a mono mix, on a transparent
background; the spectrogram is `showspectrumpic` with its legend. All of them write an audio file
back in its own format.

### Pictures and frames

Resize crops first and scales second, so "720p, 9:16" is a vertical crop of the source scaled to
fit 720 on its short side. The crop is written in ffmpeg's own arithmetic (`min(iw, ih*9/16)`),
which is what lets it be centred and even without the plan knowing the frame size; the scale is
the same bounded, portrait-aware box the compressor uses, and nothing is ever enlarged, which
`offer` uses to keep the sizes a file already fits under off its card. The rotator applies
`transpose` to the picture as a player shows it: ffmpeg turns a phone clip upright from its
rotation tag on decode, and the output carries no tag, which is what fixes a clip that plays
sideways in one app and upright in another. Both keep the source container where it can hold
H.264 and the audio as they are (a MOV stays a MOV, an MKV an MKV) and otherwise write an MP4 with
AAC, since a resized WebM coming back as an MKV would be a surprise.

Thumbnails are two formats on one card. The contact sheet runs on arrival: `fps` at
frames-per-length picks one frame every so many seconds, `tile` packs them into a near-square grid,
and `-frames:v 1` keeps the one sheet that comes out; it needs the length to space the frames, so
a file without a duration is asked for a range. A single frame seeks to the start marker with the
same `-ss`-before-`-i` the poster uses, which is why the card's "Start here" button is the way to
pick a moment off the preview.

### Subtitles

The probe now reads subtitle tracks - codec, language and title - and the engine has a fourth
expectation, `subtitles`, for a tool that needs at least one. Extraction is a stream copy through
the `srt` or `webvtt` encoder, one file per track, offered for as many tracks as the file has; an
image-based track (the PGS of a Blu-ray, the bitmaps of a DVD) is refused with a reason rather than
written out empty, since reading pictures of words is OCR. Text outputs are a fourth output kind,
which the card never tries to preview.

Burning subtitles in is the one Tier A tool the catalogue asked to verify before promising. The
pinned core is built with libass, freetype and fribidi but without fontconfig, so the `subtitles`
filter is there and cannot find a font on its own: without one it draws nothing and says so only
in the log. So the site ships DejaVu Sans, a plan may now carry *scratch files* that the engine
writes into the core's filesystem before the run and removes after it (a font, a subtitle file,
the merger's concat list), and the filter is pointed at the font's directory with every style's
family forced to it by name. A subtitle file the visitor adds is read in the browser and turned
into ASS in the chosen size, position and style, so what the filter renders is always something
the shipped font can draw; an ASS file is passed through in its own styling. A video's own text
track can be burned instead, read by the filter straight out of the mounted input, which is why
a plan now also knows where its input is mounted. The integration test burns onto a black frame
and measures the bottom third lighting up where the cue is and staying black where it is not.

The subtitle converter is the first tool with no WebAssembly in it: SRT, WebVTT and ASS are
plain text, and `lib/subtitles/` reads all three into one shape - a start, an end and some text
with only `<i>`, `<b>` and `<u>` kept as markup - and writes any of them back, or a plain
transcript. The parsers are lenient on purpose, since subtitle files in the wild have Windows
line endings, byte-order marks, missing sequence numbers, dots where commas should be, and
position tags from one format pasted into another; they take what they can read and say what they
skipped. Files that are not valid UTF-8 are read as Windows-1252, which is what nearly every
pre-2010 subtitle file is, and everything is written back as UTF-8.

Timing is fixed with two knobs, because two cover nearly every out-of-sync file: a shift for
subtitles that are early or late throughout, and a stretch for ones that start in sync and drift
because they were made for a video at a different frame rate (25 fps PAL against a 23.976 fps film
transfer, say; the factor is the ratio of the two rates and the presets name the common pairs).
Outputs are a function of the parsed cues and the panel, so changing a setting changes every file
already on the page with nothing to re-run.

### Surviving a crash

ffmpeg's own refusals come back as a non-zero exit code with a readable line in the log, and cost
one output. A *rejection* is different: the WebAssembly module trapped, the heap is in an undefined
state, and everything afterwards in that worker fails - which is how one bad codec used to take a
tab's entire session with it.

Every command goes through one place that tells the two apart. A trap marks the instance poisoned,
so later commands fail immediately rather than one at a time with errors that make no sense on the
card; the queue then fails only the output that crashed, throws the engine away, rebuilds it, and
re-runs whatever was still pending. The core is already cached, so the rebuild is a WebAssembly
instantiation rather than a 31 MB download, and the banner says once that it happened.

### Metadata

Every tool strips the source's metadata from its output by default: titles, artist and comments,
the recording date, the location a phone stamped into the file, chapter lists, and the muxer's own
encoder tag. A clip from a phone carries a GPS fix, and a site whose whole promise is that files
stay on your device has no business writing one into the file you are about to send someone.

It is the engine's job rather than each plan's - the same four arguments for every format, appended
last so they win over anything a plan mapped - and the "Output options" panel on every tool turns
it off for the case where the tags are the point, such as the title and artist of a music file.

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

### Navigation

The header is a wordmark, an "All tools" menu on Base UI's Navigation Menu grouped by category,
and the name of the tool in use. The plain row of links it replaced wrapped to three lines once
the catalogue passed a dozen tools. The menu's content is kept mounted, so every link is in the
server-rendered HTML for a crawler, and the footer carries the same list as plain anchors either
way; the current tool's link is marked `aria-current="page"` in the menu and named beside it.

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

`public/_headers` sets cache headers and the security headers: a Content-Security-Policy, HSTS,
`nosniff`, a Referrer-Policy, a Permissions-Policy that turns off the APIs this site has no use
for, and `frame-ancestors 'none'`.

Two entries in the CSP look wrong until you know why they are there, and both are commented in the
file. `script-src` needs `'wasm-unsafe-eval'` because ffmpeg *is* WebAssembly, and `'unsafe-inline'`
because the App Router emits inline bootstrap scripts and a static export has no server to stamp a
per-response nonce into them. `connect-src` has to allow `cdn.jsdelivr.net`, which is where the
core is fetched from - a policy that omits it looks tighter and breaks every conversion.

`public/_redirects` catches the short aliases people type (`/compress`, `/gif`, `/mp4`) and sends
them to the canonical verb-object routes.

Cross-origin isolation (COOP/COEP) is **not** required, because the app uses the single-threaded
core. The multithreaded core would need `SharedArrayBuffer` - and therefore those headers - while
offering nothing here: audio extraction is dominated by demuxing rather than parallel codec work,
and `@ffmpeg/core-mt` has a *smaller* fixed 1 GB heap. The commented-out block in `_headers` is
there if that trade-off ever changes.

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
node scripts/verify-video-tools.mjs                         # the video tools and the subtitle converter in a browser
node scripts/verify-large-file.mjs                          # >2 GiB input
```

The unit tests include the conversion queue itself, driven through a fake engine behind the
engine interface, so every cancel, retry and re-queue transition is pinned without ffmpeg in the
loop, and every format's argument strings. `tests/plans.integration.test.ts` and
`tests/merge.integration.test.ts` then run each video plan, the speed plan and both merge plans
through whatever ffmpeg is on `PATH` and check the result with ffprobe, so a filter that does not
parse fails in seconds rather than in a browser; they are skipped where ffmpeg is absent.
`tests/picture-audio-captions.integration.test.ts` does the same for the resize, rotate, frame,
sheet, loudness, subtitle, burn-in, audio compression, channel and waveform plans, running the
loudness plan's two passes the way the engine does and measuring the result with `ebur128`, and
writing a plan's scratch files where that ffmpeg can read them. The subtitle library is pure and
its tests round-trip every format.
The browser scripts need ffmpeg and ffprobe on `PATH`, plus a Chromium: one Playwright can find
on its own (`npx playwright install chromium`), or any Chrome/Chromium binary named in
`CHROMIUM_PATH`.

`verify-video-tools.mjs` drives Chromium and the pinned core through every video tool: an MP4
converted by stream copy and an AVI converted by encoding, a remux to MKV, a WebM encoded (the
conversion that used to trap and take the engine with it), an audio file refused by a video tool;
a 19 MB file compressed to under 8 MB in two passes and a file already under the target reported as
a note rather than a failure; a video muted; a tagged MP4 and a tagged MP3 stripped; a fast cut and
a precise cut of the same range, under names that tell them apart; a switch to another tool and
back, which has to find the queue where it was left; a two-second GIF at 15 fps bounded to
480 px on its longest side; a six-second clip at 2x and at 0.5x; two matching clips joined by
stream copy and a third, mismatched one joined by re-encoding; an SRT converted to WebVTT and
shifted by a second and a half; a 640x360 clip resized to 240p and turned a quarter clockwise; a
3x3 contact sheet and a PNG of the frame at 0:02; an MP3 copied as MP3 and converted to FLAC; a
-24 dB tone normalised to -14 LUFS and measured there; the SRT track of an MKV extracted as
SRT and as WebVTT; an SRT burned onto a black video and the bottom third measured lighting up
where the cue is, then an MKV's own track burned in; an MP3 compressed to Opus and to MP3; stereo
made from a mono MP3 and the vocals cut from a stereo MP4; and a waveform and a spectrogram
drawn as PNGs. Every media download is checked with `ffprobe`.

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
  passes, and slower again for VP8. The multithreaded core would need cross-origin isolation, which
  is a decision the catalogue asks to be made deliberately.
- WebM output is VP8, because `libvpx-vp9` traps in the pinned core (see
  [The video tools](#the-video-tools-and-the-output-ceiling)). A VP9 source is still copied rather
  than re-encoded, which is the case where VP9 in a WebM was actually wanted.
- A fast cut's row reports the range the file really covers, measured from the finished output, but
  the cut still lands on the keyframe at or before the marker. Snapping the marker to keyframes up
  front would mean a pass over the source looking for them.
- The source preview on the trimmer and GIF maker only appears for containers the browser itself
  can play (MP4, WebM, MOV); an MKV or AVI is trimmed by timecode and, on the trimmer, by the
  waveform.
- A join by stream copy needs every clip to match exactly: codec and profile, frame size and pixel
  format, frame rate, rotation and audio layout. A mix of sources is re-encoded to H.264 at the
  first clip's size instead, and the summary says which difference caused it.
- Slow motion repeats frames rather than inventing them, so it is smooth at half speed and visibly
  steppy at a quarter. Frame interpolation (`minterpolate`) exists and is far too slow on one
  WebAssembly thread to offer.
- The subtitle converter keeps italics, bold and underline and drops everything else: fonts,
  colours, positions, karaoke timing. SRT cannot express them and a file that depended on them
  would not look the same anywhere else.
- Subtitle extraction reads text tracks only. Blu-ray and DVD subtitles are bitmaps, and turning
  them into text is OCR, which is a different tool; they are refused with a reason.
- Burned-in subtitles are set in DejaVu Sans, the one font the site ships, which covers Latin,
  Greek and Cyrillic and not Chinese, Japanese, Korean or Arabic; a font for those is tens of
  megabytes and would need its own download step. An ASS file's own fonts are replaced by it.
- Vocal removal is a centre cut, not a separation model: it takes out whatever is identical in
  both channels, which on many mixes includes the bass and the drums, and does nothing to mono.
- Cancelling terminates the ffmpeg worker, since ffmpeg blocks its worker while running and cannot
  be interrupted cooperatively. See [Cancelling one format](#cancelling-one-format) for why that is
  survivable. The engine restarts on the next job; the core is already cached, so this costs a
  WebAssembly instantiation, not a 31 MB download.
