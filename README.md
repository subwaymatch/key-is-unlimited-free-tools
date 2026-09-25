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
| `/add-chapters` | Write a typed chapter list into a video or audio file, so players show its parts by name | The list as an ffmetadata file written into the core and mapped in with `-map_chapters`, every stream copied |
| `/merge-subtitles` | Two languages in one subtitle file: the second at the top of the picture, or both folded into one cue | Plain TypeScript again: the cues of both files stacked with a position tag, or the overlapping pairs joined |
| `/split-chapters` | A podcast, audiobook or video cut into one file per chapter, named after it | One stream-copy format per chapter, from the probe's chapter list: `-ss` before the input, `-t` after, the piece titled after its chapter |
| `/extract-audio-tracks` | Every audio track of a film or recording as its own file, named by its language | One stream-copy format per track, `-map 0:a:N` into the container the codec belongs in |
| `/add-audio` | Music or a voiceover under a video, in place of its sound or mixed under it, fitted or looped to the picture | The audio file written into the core as a second input, `apad` or `-stream_loop -1` and `-shortest`, `amix` for the mix; the picture copied |
| `/sync-audio` | A video's sound moved earlier or later to line up with the picture | The file read twice, `-itsoffset` on whichever read has to start later, every stream copied |
| `/loop-video` | A clip played two, three or ten times over, or a short one run out to a minute, ten or an hour | `-stream_loop` before the input with every stream copied; a length is an endless loop cut by `-t` |
| `/gif-to-video` | An animated GIF as an MP4 or WebM, played once or several times over | `fps` to a steady rate, `scale` to even edges, `format=yuv420p`, one H.264 or VP8 encode; `-stream_loop` for the repeats |
| `/split-video` | A long video every ten minutes, or into four equal parts, without re-encoding | The chapter splitter's shape with the cuts worked out from the length: one stream-copy format per piece |
| `/trim-audio` | A range cut out of an MP3, WAV or any audio file, in its own format or another | The extractor's catalogue insisting on a range; the file's own format is a stream copy cut on a codec frame |
| `/change-volume` | A recording turned up or down by a number of decibels, or as loud as it can go without clipping | `volume`, or `volumedetect` in a pass of its own and the gain worked out from the peak it found |
| `/change-audio-speed` | A lecture at 1.5x or an interview at half speed, pitch kept | The video speed tool's `atempo` chain on the sound alone, written back in the file's own format |
| `/add-fade` | A fade in, a fade out or both, for a recording or a video's sound and picture | `afade`, and `fade` with one H.264 encode when the picture goes too |
| `/split-audio` | A long recording every ten minutes, or into equal parts, without re-encoding | The same equal-parts splitter as `/split-video`, pointed at audio files |
| `/edit-tags` | Title, artist, album, year, genre, track, comment and a cover picture | `-metadata` under ffmpeg's generic names with every stream copied; the cover a second input with `-disposition attached_pic` |
| `/audio-to-video` | An MP3 as an MP4 for YouTube: a colour, a picture or a waveform under it | A `color` source, a looped image or `showwaves` as the picture, `-tune stillimage` at 5 fps for a still, the sound copied where the MP4 holds it |
| `/add-subtitles` | An SRT, VTT or ASS file inside an MP4, MOV, MKV or WebM as a track that can be switched off | The file written into the core as a second input and mapped in as MOV text, SRT, ASS or WebVTT by container, with everything else copied |
| `/convert-image` | Any picture the browser opens, out as JPEG, PNG or WebP | The browser's own decoder and canvas encoder; no library, no WebAssembly |
| `/compress-image` | A photo under a size you choose | Bisection on the encoder's quality, and a smaller frame only when the lowest quality is still too large |
| `/resize-image` | A picture scaled down to a longest side or a fraction, never enlarged | Drawn in halves down to the size, in the format it came in |
| `/remove-image-metadata` | What a photo says about itself, and a copy without it | JPEG, PNG and WebP taken apart by chunk and written back without the metadata ones; the orientation tag kept |
| `/images-to-pdf` | Pictures into one PDF, a page each | pdf-lib embedding an upright JPEG or PNG as it is, the rest drawn again by the browser |
| `/merge-pdf` | Several PDFs as one | pdf-lib copying every page across |
| `/split-pdf` | One PDF per page, every N pages, or the ranges typed | Print-dialog ranges parsed and each copied out as its own document |
| `/rotate-pdf` | Pages turned a quarter or a half | The page's rotation set, nothing re-drawn |
| `/delete-pdf-pages` | Pages taken out by number or range | The page list edited |
| `/add-page-numbers` | A number on every page, plain or N of M | Helvetica, one of the fonts every viewer carries, drawn at the position asked |
| `/checksum` | SHA-256, SHA-1, MD5 or CRC-32 of a file of any size, checked against a pasted one | The algorithms written to take the file a chunk at a time, so the heap stays flat |
| `/create-zip` | Files packed into one ZIP | fflate streaming each file in and deflating what is not already compressed |
| `/extract-zip` | Every file inside a ZIP, a click away | fflate streaming the archive in |
| `/merge-audio` | Several recordings joined into one file | The concat demuxer with the sound copied when the files match; `aresample` and `aformat` into the concat filter and one encode when they do not |
| `/add-watermark` | A logo or a line of text on every frame of a video, at a corner or the centre, at a size and an opacity | `scale2ref` and `overlay` with the picture's alpha scaled, or `drawtext` in the font the site ships; one H.264 encode, the sound copied |
| `/extract-frames` | A frame every second, ten seconds or minute as JPEG or PNG, or one frame at a time | One seek-and-grab format per frame: `-ss` before the input, `-frames:v 1`, named by its time |
| `/crop-image` | A picture cut to 1:1, 4:5, 16:9, 9:16, 4:3 or 3:2 about its centre | The crop in the canvas, in the format it came in |
| `/watermark-image` | A logo or a line of text on a photo, at a corner or the centre | Drawn on the canvas at a fraction of the picture's width, with the opacity set |
| `/favicon` | Every size a site needs from one picture: the ICO, the PNGs and the tags | Drawn square at 16, 32 and 48 for the ICO written by hand, at 180, 192 and 512 for the PNGs; no library |
| `/image-to-base64` | A picture as a data URL, an `<img>` tag and a CSS rule, ready to paste | Base64 of the file as it is, capped at 2 MB where the snippet stops being useful |
| `/pdf-to-images` | Every page of a PDF as a JPEG or PNG at 72, 150 or 300 dpi | PDF.js drawing each page to a canvas, the canvas encoded |
| `/compress-pdf` | A scanned PDF made smaller by redrawing every page as a picture | PDF.js drawing at a chosen dpi, the JPEGs rebuilt into a PDF by pdf-lib at the page's own size |
| `/pdf-to-text` | The text of a PDF as a text file, a page at a time | PDF.js reading the text layer in order, with line breaks where the text moves down |
| `/watermark-pdf` | A word across every page, diagonal and faint, or a footer line | Helvetica drawn by pdf-lib with a rotation and an opacity |
| `/pdf-metadata` | What a PDF says about itself, cleared or rewritten | pdf-lib reading the Info dictionary and the XMP stream, and emptying both or writing new values |
| `/find-duplicates` | The files in a drop that are the same file, and how much space the copies take | Sizes first, then SHA-256 of the files sharing a size, grouped |
| `/extract-pdf-pages` | The pages named, in the order named, as a new PDF | Print-dialog ranges parsed and the pages copied out in that order by pdf-lib |
| `/reorder-pdf-pages` | A PDF reversed, or its pages in the order typed with the rest following | The same copy, in an order worked out from the ranges; the identity order reported rather than written |
| `/flatten-pdf` | A filled form's fields drawn into its pages, and annotations taken off | pdf-lib's `flatten`, the page arrays rewritten without what it deleted; `Annots` and `AcroForm` dropped when annotations go |
| `/pdf-booklet` | Two or four pages a sheet, or booklet order for folding | Pages embedded as forms and drawn into cells, turned by their own `/Rotate`; a saddle-stitch order padded to a multiple of four |
| `/convert-csv` | CSV or TSV to JSON, JSON Lines, TSV or the other delimiter, any size | A streaming state-machine parser fed by a streaming decoder; the delimiter and encoding read off the first 64 KB |
| `/json-to-csv` | An array, an API response's list or JSON Lines as a spreadsheet-ready CSV | `JSON.parse`, the records found, nested objects flattened to dotted names, the columns in first-seen order |
| `/format-json` | A JSON file indented, minified or key-sorted, or told where it broke | `JSON.parse` and `JSON.stringify`; a scan of the grammar finds the line and column when the engine's message gives none |
| `/clean-notebook` | An .ipynb without outputs, execution counts and scratch metadata | The cells edited and the notebook written as nbformat writes it: one-space indent, sorted keys |
| `/convert-text-file` | A text file's encoding and line endings shown, and rewritten | Byte-order marks, a fatal UTF-8 decode and a zero-byte pattern to name the encoding; `TextDecoder`, and UTF-16 written by hand |
| `/encrypt-file` | A file sealed with a passphrase, and opened again here | PBKDF2-SHA-256 to an AES-256-GCM key, the file in 1 MB blocks each with its own nonce and tag, the header as associated data |
| `/compare-files` | A unified diff of two text files, or where two binaries differ | Patience diff over unique lines with Myers in the gaps, written as `diff -u` writes it |
| `/merge-images` | Pictures side by side, stacked or in a grid, as one picture | Every picture scaled to the row's height, the column's width or the grid's cell, drawn on one canvas |
| `/extract-colours` | The colours a picture is made of, as swatches and hex codes | Median cut over a 200-pixel sample, the boxes' averages and shares; the strip drawn on a canvas |
| `/rotate-image` | A quarter turn either way, a half turn, a mirror or a flip, in bulk | One `setTransform` on the canvas, on the picture as its orientation tag shows it |
| `/pad-image` | A picture fitted to 1:1, 4:5, 16:9 or 9:16 without cropping | The smallest frame of the shape around the picture, on white, black, nothing or the picture drawn tiny and back up as a blur |
| `/adjust-image` | Black and white, sepia, negative, lighter, darker, more or less contrast | One pass over the pixels of an `ImageData` |
| `/svg-to-png` | An SVG as a PNG, JPEG or WebP at a chosen width | The root's size set from its viewBox, the browser's own renderer through an `Image`, drawn to a canvas |
| `/resize-pdf-pages` | Every page on A4, Letter, A5, A3, Legal or Tabloid, fitted and centred | Each page embedded as a form and drawn into the paper by pdf-lib, turned by its own `/Rotate` |
| `/crop-pdf` | Margins trimmed to the content, or millimetres off each edge | PDF.js draws each page small to find the ink; pdf-lib sets the page boxes through the page's turn |
| `/extract-pdf-images` | Every picture placed in a PDF as a file of its own | PDF.js's operator list, each image object drawn to a canvas from its bitmap or its raw bytes |
| `/csv-to-excel` | A CSV as an .xlsx, numbers typed, leading zeros kept | The five XML parts of a workbook written by hand, every cell inline, zipped by fflate |
| `/excel-to-csv` | Every sheet of an .xlsx as a CSV, dates as dates | The workbook unzipped and its XML read cell by cell; a number in a date style turned back into one |
| `/profile-csv` | Every column's type, empties, range, distinct values and commonest values | One streamed pass, distinct values counted to a cap |
| `/clean-csv` | Cells trimmed, duplicate rows removed, empty rows and columns dropped | The rows in memory, each step counted |
| `/identify-file` | What a file is from its first bytes, whatever its name | A hundred signatures, the ZIP's entry names for Office and EPUB, the first lines of a text file |
| `/split-file` | A file in numbered pieces of a chosen size | `Blob.slice`, which copies nothing, named .001, .002 the way `split` names them |
| `/join-files` | The pieces back together, in number order | One `Blob` of the pieces sorted by their numbers |
| `/extract-tar` | Every file in a .tar, .tar.gz, .tgz or .gz | A block-by-block TAR reader fed by fflate's streaming gunzip; long names and pax headers honoured |
| `/round-image` | Corners rounded or the whole cut to a circle, with a border | A rounded path clipped on the canvas, drawn with arcs; the border stroked just inside the edge |
| `/split-image` | A picture cut into a grid of numbered tiles, square if asked | Every edge on a whole pixel, the crop for square tiles centred; one canvas per tile |
| `/compare-images` | Where two pictures differ, pixel by pixel | Both drawn at their own size, every channel compared against a tolerance; the first faded, the changes red |
| `/make-transparent` | One colour keyed out to a PNG or WebP | A flood fill from the edges, or every pixel, within a distance on every channel; the pixels just past it faded |
| `/remove-blank-pages` | A scan's empty pages found and removed | Each page drawn at 50 dpi by PDF.js and its dark pixels counted; pdf-lib removes the ones under the threshold |
| `/collate-scans` | Fronts and backs from two scanner passes interleaved | The second file's pages read from its end, one after each of the first's, copied by pdf-lib |
| `/split-pdf-by-size` | A PDF in pieces that each fit under a size | The longest run of pages that saves under the limit, found by writing candidates in a bisection |
| `/add-image-to-pdf` | A logo, a signature or a stamp on chosen pages | The picture embedded once and drawn on each page, placed on the page as shown and turned with its `/Rotate` |
| `/compare-pdfs` | The lines of text that changed between two PDFs | PDF.js reads the text off every page of each, and the file comparer's diff runs over the two |
| `/add-pdf-bookmarks` | A typed table of contents written as the PDF's outline | The outline's linked dictionaries written with pdf-lib's low-level objects; `PageMode` set to open on it |
| `/merge-csv` | Several CSVs as one, columns matched by name | Every file read whole, its header mapped onto the first file's columns and new ones appended |
| `/split-csv` | A CSV in files of so many rows, header on each | The rows sliced after the parser has read them, so a quoted line break never cuts a row |
| `/sort-csv` | Rows in order by a column | A stable sort by a number, a natural-order collator or a plain one, empty cells last |
| `/csv-to-markdown` | A CSV as a Markdown or HTML table | Cells escaped, columns padded to their widest cell, numeric columns aligned right |
| `/csv-to-sql` | CREATE TABLE and INSERTs for a CSV | A type inferred per column from its filled cells, identifiers cleaned and quoted, literals escaped per dialect |
| `/excel-to-json` | Every sheet of an .xlsx as JSON records | The workbook reader's rows keyed by their header, typed the way the CSV converter types them |
| `/json-to-excel` | JSON records as an .xlsx | The JSON-to-CSV flattening into rows, written by the workbook writer |
| `/subtitles-to-text` | A subtitle file as a transcript | The subtitle parser's cues, markup stripped, run into paragraphs at pauses or written one to a line |
| `/sort-lines` | A text file's lines sorted, deduplicated, reversed or shuffled | A collator with numeric order, a stable sort, and a Fisher-Yates shuffle |
| `/rename-files` | Files renamed by a pattern, back as a ZIP | The pattern's tokens filled per file, names made unique, the files packed unchanged under the new names |
| `/create-tar` | Files packed into a .tar or .tar.gz | A ustar header written by hand per file, GNU long-name entries where needed, fflate's streaming gzip on the way out |
| `/protect-pdf` | A PDF that opens only with a password, printing and copying optional | Every string and stream encrypted with AES-256 under a random key, the key sealed by revision 6's iterated hash, through Web Crypto |
| `/unlock-pdf` | A PDF's known password taken off, or its print and copy lock lifted | RC4 at 40 and 128 bits, AES-128 and AES-256 decrypted on pdf-lib's objects, encrypted object streams recovered and re-parsed |
| `/pdf-form-data` | What was typed into one filled form or fifty, as a CSV and JSON | pdf-lib's form fields, check boxes as Yes and No; an XFA form's datasets packet read by path |
| `/epub-to-text` | An e-book as one text or Markdown file, in reading order | The container, the package file's spine, and each chapter's XHTML walked for its blocks |
| `/extract-email` | A saved .eml's attachments, its text and its HTML as a page | A MIME parser: boundaries, base64 and quoted-printable, RFC 2047 words and RFC 2231 names, any charset |
| `/open-msg` | An Outlook .msg read without Outlook, and written as an .eml | A compound-file reader, the MAPI property streams, compressed RTF, and a MIME writer |
| `/sqlite-to-csv` | Every table of a SQLite database as CSV, JSON or a workbook | The file format walked page by page: B-trees, overflow chains, WITHOUT ROWID, no SQL |
| `/join-csv` | Columns from one CSV added to the matching rows of another | A key index on the second file, one row per match, left, inner or full |
| `/compare-csv` | The rows added, removed and changed between two versions | Rows matched on a key, cells compared by column name and written old -> new |
| `/pivot-csv` | Counts, sums or averages by group, spread across a column, with totals | One pass of accumulators per cell, numbers read with thousands separators and currency signs |
| `/anonymize-csv` | Names, e-mails, phones and ID numbers replaced before sharing | Columns found by header and by value shape, then stand-ins, masks, salted hashes or removal |
| `/format-xml` | XML indented or minified, or its break found by line and column | A tokenizer that keeps each node's spelling beside its meaning; mixed content left as it was |
| `/xml-to-json` | XML as JSON and JSON as XML | Attributes as @keys, text as #text, repeats as arrays, and the same convention run backwards |
| `/convert-gps` | GPX, KML, GeoJSON, TCX and CSV turned into each other | One model of tracks, waypoints and areas; distance by haversine and climb with a 3 m threshold |
| `/trim-gps-track` | A track with its start and end cut off, so it does not show a home | Every point inside a circle round each end, and round places named, removed; times and heights optional |
| `/sanitize-har` | A browser's network log with its cookies, tokens and passwords removed | Headers, parameters and JSON fields named like credentials replaced, cookies always, JWTs anywhere |
| `/inspect-certificate` | What a certificate, chain or CSR says, with its fingerprints | A DER reader and RFC 5280's fields, extensions named, checked against Node's own parser |
| `/find-secrets` | API keys, tokens and private keys left in files or a ZIP | Each provider's key shape matched exactly, with line and column, the report redacted |
| `/optimize-svg` | An SVG made smaller and safe to put on a page | Editor namespaces, metadata and unused ids removed, numbers rounded, scripts and handlers stripped |
| `/passport-photo` | Passport and visa photos laid out on a 4x6 print, A4 or Letter | The photo cut to size at 300 dpi and packed as tightly as the sheet allows, the JPEG told its dpi |
| `/markdown-to-html` | A README or notes as a styled page, or bare HTML to paste | CommonMark's blocks and inlines plus GitHub's tables, task lists and anchors; scripts and javascript: links removed |
| `/notebook-to-html` | A Jupyter notebook as one page anyone can open, outputs and all | Each output's richest MIME type a static page can show, pictures embedded, tracebacks stripped of colour codes |
| `/yaml-to-json` | YAML as JSON and JSON as YAML, broken YAML located by line | A YAML 1.2 core-schema parser: block and flow styles, block scalars, anchors and merge keys, several documents |
| `/decode-jwt` | A JWT's header and claims read, its expiry checked and its signature verified | base64url and JSON, then Web Crypto's HMAC, RSA, RSA-PSS, ECDSA and Ed25519 against a secret, PEM, certificate or JWK set |
| `/create-qr-code` | QR codes for links, text and Wi-Fi, one or hundreds, as PNG or SVG | An ISO 18004 encoder: the densest mode, the smallest version, Reed-Solomon blocks interleaved, the best of eight masks |
| `/read-qr-code` | What the QR codes in a screenshot or photo say, before opening them | A local-threshold binarizer, finder patterns found and checked three ways, perspective from the finders' own edges |
| `/search-files` | A word or regular expression found across many files and ZIPs, grep style | Each file streamed and decoded in pieces, lines matched with context kept either side, output as grep's format and a CSV |
| `/analyze-log` | A log summarised: levels, time span, recurring errors, and web traffic | Access-log, JSON, syslog and timestamped lines parsed as a stream; messages grouped once numbers and ids are masked |
| `/decode-protobuf` | A protobuf message field by field, or with names from its .proto | The wire format read as protoc --decode_raw prints it; a .proto parser for names, enums, maps and packed fields |
| `/inspect-wasm` | A .wasm module's imports, exports, memory, sections and toolchain | The binary format's sections walked, the name, producers and target_features sections read, then WebAssembly.validate |
| `/inspect-git-bundle` | A git bundle's refs, commits and the files at its tip, without git | A packfile reader: every zlib stream inflated by a decoder that reports where it ended, deltas applied, ids recomputed |
| `/inspect-font` | A font's names, licence, languages, blocks and features, with a specimen | The sfnt tables read (WOFF inflated), coverage from the cmap, the specimen drawn by FontFace |
| `/convert-3d-model` | STL, OBJ, PLY, glTF and 3MF turned into each other, upright and in the right units | Readers and writers for each format into one welded mesh; glTF node and 3MF build transforms applied |
| `/repair-3d-model` | Whether a model will print: watertight, holes, inside-out faces, volume and weight | Edges counted for holes, non-manifold joins and flipped faces; repair welds, reorients shells and fills holes |
| `/redact-pdf` | Names, e-mails and numbers blacked out of a PDF and removed from it | Matches found in PDF.js's text; each affected page redrawn as a picture with the boxes and rebuilt by pdf-lib |
| `/check-pdf-redaction` | Whether a redacted PDF still has text under its black boxes | Dark filled rectangles read from each page's operator list, redaction marks from its annotations, text compared |
| `/compare-pdfs-visually` | Two versions of a PDF compared as they look, removals red and additions green | Both drawn at 110 dpi by PDF.js and compared pixel by pixel; changed pages written to a PDF by pdf-lib |
| `/edit-epub-metadata` | An e-book's title, authors, series, description and cover changed | Only the managed elements of the package file rewritten; the archive rebuilt with mimetype first and stored |

Every media tool is one configuration of the same machinery: a catalogue of formats in
`lib/engine/`, a page shell in `components/ToolApp.tsx`, and an entry in the registry in
`lib/tools.ts` that puts it on the index, in the header and footer, in the related-tools block and
in the sitemap. Adding a tool is a registry entry, a catalogue and a page. Three tools have a
shape of their own and share only the frame: the merger, which is one job over several files
rather than one job per file, and the subtitle converter and the subtitle merger, which never
load ffmpeg at all.

The image, PDF, data and file tools load no WebAssembly either: they are the browser's own
canvas, two small pure-JavaScript libraries and some arithmetic, on a second, smaller queue
(`lib/plainQueue.ts`) with two shells of its own, one for a job per file and one for many files
into one. The three tools that draw or read a PDF's pages add PDF.js, pulled in on first use.
See [Tools with no engine at all](#tools-with-no-engine-at-all).

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
[The class worker](#the-class-worker) below), and `scripts/copy-pdfjs-assets.mjs`, which does the
same for PDF.js's worker and data files into `public/pdfjs/<version>/` against the version pinned
in `lib/pdf/render.ts`.

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
  tools/MergeAudioApp.tsx       the same shell pointed at audio files, on a store of its own
  tools/ConvertSubtitlesApp.tsx the subtitle converter: files parsed on arrival, outputs derived live
  tools/MergeSubtitlesApp.tsx   the subtitle merger: one second-language file, every first-language file merged with it
  tools/SplitPartsApp.tsx       the equal-parts splitter, which serves the video route and the audio route
  PlainToolApp.tsx   the page every no-engine tool is built from: a job per file, a card per job
  CombineApp.tsx     the page for a no-engine tool that makes one thing of several files: a list to order, a button, one result
  ui/FileField.tsx   a file chooser inside a settings panel, for the tools that take a second file
  FileCard.tsx       a file in the queue: outputs, progress, preview, clip panel
  *.module.css       plain CSS modules; no utility-class framework
lib/useConversionQueue.ts   sequential job runner, progress + cancellation, per-tool options
lib/useMergeQueue.ts        the merger's store: clips read as they arrive, joined on request; one slot per tool
lib/engineState.ts   the one engine's load state, shared by the queue and the merger
lib/toolFeatures.ts  what a tool's cards offer: clip panel, silence detection, whole-file chips
lib/mediaTypes.ts    the cheap first pass: is this even a media file, and what an input accepts
lib/persist.ts       remembering a tool's settings between visits, without a hydration mismatch
lib/subtitles/       SRT, WebVTT and ASS parsers and writers, retiming and merging; no WebAssembly
lib/download.ts      hands a text output to the browser as a file, for the tools with no engine
lib/chosenFile.ts    a second file read whole for a scratch file: its bytes, a key, its image type
lib/plainQueue.ts    the queue for the tools with no engine: one job per file, and one job over many
lib/images/
  canvas.ts          pictures through the browser's decoder and canvas encoder; the size and quality arithmetic
  metadata.ts        Exif read, and JPEG, PNG and WebP metadata stripped by chunk without re-encoding
  run.ts             the image tools' shared steps: decode, draw, encode, name
  edit.ts            crops to a shape, a mark drawn on a picture, the ICO writer, the favicon and Base64 snippets
lib/hash/digest.ts   SHA-256, SHA-1, MD5 and CRC-32 a chunk at a time
lib/hash/duplicates.ts  files grouped by size and then by digest, and what the copies cost
lib/pdf/
  ranges.ts          print-dialog page ranges
  pages.ts           merge, split, rotate, remove, number, stamp, metadata, pictures to pages, through pdf-lib
  render.ts          PDF.js, for drawing a page and reading its text; opened on first use
  files.ts           taking a PDF, reading it, naming the result
lib/zip/archive.ts   ZIPs written and read through fflate, streamed
public/fonts/        DejaVu Sans, the one font the burn-in and watermark tools have, with its licence
public/pdfjs/        PDF.js's worker, fonts, CMaps and decoders, copied in at build time (gitignored)
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
  chapters.ts        chapter markers from a typed list: parsed, written as ffmetadata, mapped in with every stream copied
  split.ts           one stream-copy format per chapter, for cutting a file at its markers
  tracks.ts          one stream-copy format per audio track, into the container its codec belongs in
  soundtrack.ts      audio added under a video, replacing or mixed; the sound moved to fix sync; where a re-encoded soundtrack lands
  level.ts           volume by decibels or to the peak, and fades; the sound re-encoded, the picture copied or faded with it
  tempo.ts           the atempo chain on the sound alone
  loop.ts            a file repeated a number of times or out to a length, every stream copied
  animated.ts        an animated GIF as an MP4 or WebM
  softsubs.ts        a subtitle file muxed in as a track, as whatever the container wants
  tags.ts            title, artist and the rest, and a cover, with every stream copied
  pieces.ts          one stream-copy format per equal part, from the length and a rule
  visualize.ts       an audio file under a colour, an image or a waveform, as an MP4
  cut.ts             the extractor's catalogue insisting on a range, for the audio trimmer
  merge.ts           the merger's decision - copy or re-encode, and why - and both command lines, for video and for audio alone
  watermark.ts       a picture or a line of text over every frame: the overlay graph and the drawtext filter
  frames.ts          one frame at a time, at an interval: the seek, the grab and the name
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
background, drawn to the file's own peak: `showwavespic` plots absolute amplitude, so a recording
that peaks at -18 dBFS would otherwise fill an eighth of the height, and a first `volumedetect`
pass supplies the gain the second one draws with. The spectrogram is `showspectrumpic` with its
legend. All of them write an audio file
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

Merging two languages is the same library again. The second language's file is chosen once and
every first-language file dropped is merged with it, in one of two layouts. Stacked keeps every
cue of both files with its own timing and puts the second language at the top of the picture, as
`{\an8}` in SRT and ASS and `line:0` in WebVTT, which the common players honour. Combined folds a
first-language cue and a second-language cue that overlap by at least half into one two-line cue,
for players that show a single region; cues that merely touch stay apart, and a second-language
cue with nothing to sit under is kept on its own, so no line of either file is lost. The parsers
read a position from either format on the way in, so a stacked file converts back without losing
which line was on top.

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

### Chapters

The chapter tool is the one plan that reads the "Output options" switch itself. Its chapters are
metadata, so the engine's stripping arguments, appended last, would take them straight back out;
the plan says it has handled the switch, maps the source's global tags in or leaves them out as
the switch asks (global only: a bare `-map_metadata -1` takes the chapter titles with it), and
takes its chapters from a second input, an ffmetadata file written into the core for the run the
way the burn-in tool's font is. The list is typed, one chapter a line, in the forms people paste
from a video description - `1:23 Title`, `[01:23] Title`, `1:23 - Title`, `83 Title` - and each
chapter runs to the next, the last to the end of the file, which is why the plan needs the probed
length; a chapter at or past the end is left out and the row says so. Every stream is copied, so
writing chapters into a two-hour film takes as long as reading it. MP4, MOV, M4A, MKV, WebM, MP3
and Ogg carry chapters; WAV and FLAC have nowhere to put them, and the format says so rather than
writing a file whose chapters nothing will read. The probe reads the chapters a file already has,
the card lists them, and a new list replaces them.

Splitting at chapters is the reverse, and the first tool whose outputs come from the file rather
than from a catalogue or a panel: a file has as many pieces as it has chapters, which is not known
until it has been read. The queue has an option for that, `formatsForFile`: such a file arrives
with no outputs, is opened regardless, and gets its outputs from the probe, each labelled by what
the format says of it - "Chapter 3: The first part" rather than "Chapter 3". Every piece is a
stream copy of its range, seeking before the input the way the fast cut does, with the file's
chapter list left out of it and the piece titled after its chapter unless tags are being stripped.
The extractor of every audio track is the same shape: one copy per track, named by the track's
language, into the container its codec belongs in; the probe now reads a track's language and
title along with its codec.

### Soundtracks, levels and loops

Adding audio to a video is the first tool to take a second media file. The video is mounted and
read in place as always; the audio file is read whole in the browser and written into the core as
a scratch file, the way the burn-in tool's font is, which is why it is capped at 200 MB where the
video has no cap. The picture is copied; the new track is encoded into whatever the container
takes (AAC, or Opus for a WebM), padded with `apad` when it is shorter than the picture and cut
by `-shortest` when it is longer, or looped without end by `-stream_loop -1` and cut the same
way. Mixing keeps the original at its level and runs the new track through `volume` into `amix`
with `duration=first` and `normalize=0`, so the original is not halved by the mix. A silent video
asked for a mix gets the track outright, and the row says so.

Fixing sync is a pure stream copy that reads the file twice. `-itsoffset` delays one input, and
which input depends on the sign: sound that has to come later is the second read delayed; sound
that has to come earlier is the *picture* delayed, which is the same relative shift with every
timestamp still positive. The MP4 muxer writes the offset as an edit list and Matroska as a start
time, and the integration test reads both back to within a frame. A drift - in step at the start
and out by the end - is a different fault, and the page says so.

Volume is one filter, except for "as loud as possible", which is `volumedetect` in an analysis
pass and the gain worked out from the peak it printed, through the same `refine` hook the loudness
normaliser uses; the file lands with its loudest sample at -1 dBFS, the most gain it can take
without clipping. Fades are `afade` on the sound and, when the picture goes too, `fade` on a
re-encoded picture, both measured from the range's length since the seek is before the input.
The audio speed tool is the video one's `atempo` chain alone. All of these write an audio file
back in its own format and copy a video's picture, through one helper that decides where a
re-encoded soundtrack lands: the source's container when it holds the picture and AAC, a WebM
with Opus, an MP4 when the picture fits, and Matroska otherwise.

The loop is `-stream_loop` with every stream copied; ffmpeg reads the input again from the start
and carries the timestamps on, so the seam is wherever the file itself begins and ends. A loop to
a length is `-stream_loop -1` cut by `-t`. The GIF converter is the same trick pointed at a GIF,
which is a video stream to ffmpeg: a GIF's MIME type says image, so `looksLikeMedia` now names it
as media, and the plan steadies a slow frame rate to 30, makes the edges even and forces 4:2:0,
the three things a GIF needs that a camera clip does not. The equal-parts splitter is the chapter
splitter with the cuts worked out from the length and a rule instead of read from the file, still
one stream-copy format per piece, still labelled by its range once the file has been read.

### Tags, subtitle tracks and audio as video

The tag editor is the second plan that reads the "Output options" switch itself: off, the file's
tags stay and the typed ones are written over them; on, the file is cleared first and only the
typed ones remain. It is also the one tool where the switch starts off, and it keeps the switch
under a key of its own: on by default it would throw away the album and the year of a file
someone only meant to retitle, and the switch is otherwise one setting shared and remembered
across every tool. ffmpeg maps the generic names onto whatever the format uses, so the plan speaks
in `title`, `artist`, `album_artist`, `date`, `genre`, `track` and `comment` and the muxer
translates to ID3 frames, iTunes atoms or Vorbis comments. A cover is a second input mapped in
with `-disposition:v:0 attached_pic`, which the MP3, MP4 and FLAC muxers all turn into a picture
block; an MP3 also gets the picture's ID3 type set and is written as ID3v2.3, which Windows and
older players read where 2.4 they do not. Ogg, WAV and video files have no place for a cover and
say so. A file's own cover, when no new one is chosen, is a video stream and rides along.

Adding subtitles as a track is the soft version of burning in, and costs a stream copy rather
than an encode. The subtitle file is read in the browser into cues, as the burn-in tool reads it,
and written for ffmpeg as whatever the video's container wants: an SRT fed to `-c:s mov_text` for
MP4 and MOV, the SRT or the ASS file's own text copied for Matroska, WebVTT for WebM. The new
track is mapped first among the subtitles so its language, its name and its default flag can be
set on `s:0`; MP4 and MOV name a track by its handler and Matroska by a title, so the plan sets
whichever the container reads. Text tracks the video already carries ride along; an image-based
one cannot travel with a text track into a container that only takes text, and is left out with
a note on the row.

Audio to video exists because the sites people want to put a recording on only take video. The
picture is a `color` source, an image looped with `-loop 1` and fitted into the frame with black
bars, or `showwaves` drawn from the sound; the sound is copied where the MP4 holds it (MP3, AAC)
and made AAC otherwise; `-shortest` ends the picture with the sound. A still is written at 5
frames a second with `-tune stillimage`, which every player and upload form accepts and keeps an
hour of podcast to a few minutes of encoding on one WebAssembly thread; the waveform runs at 25
and costs about real time.

### Watermarks, frames and audio joined

A watermark is a second input, like a cover or a backdrop: the logo is written into the core
and `scale2ref` sizes it against the video's own width, so the same setting gives the same
proportion on a phone clip and a 4K one, then `colorchannelmixer=aa=` sets its opacity and
`overlay` puts it at a corner or the centre with the margin in the same fraction. A line of text
is `drawtext` in DejaVu Sans, the font the burn-in tool already ships, read from a text file
written into the core so a quote or a colon in the caption cannot break the filter. Either way
the picture is encoded once and the sound copied. The image tool does the same on the canvas.

Frames are one seek-and-grab per frame rather than one `fps` run: `-ss` before the input jumps
to the keyframe and decodes forward from there, `-frames:v 1` takes one picture, and the format
is named by its time. The interval decides how many frames a file yields and the tool caps it at
64 per run, since a frame a second from an hour of video is more than anyone wanted in a
downloads list; the card says how many were skipped and the interval can be widened.

Joining audio reuses the merger whole: the same store, the same list to order, the same decision
between copying and re-encoding. The files match when they share a codec, sample rate and
channel layout, and the concat demuxer copies them with `-vn` and `-c copy`. When they do not, an
`aresample` to 48 kHz and `aformat` to a common layout in front of the concat filter make them
joinable, and the result is encoded into the first file's own format. The store is one slot per
tool, so the audio joiner and the video joiner each keep their own list.

### Tools with no engine at all

The catalogue's second tier is tools that need no WebAssembly: plain TypeScript, the browser's
own facilities, and at most a small pure-JavaScript library. They cost nothing they do not
already have - no CDN pin, no checksum, no class-worker path, no memory ceiling of their own -
which is why the image, PDF and file tools came before a second runtime. They run on a queue of
their own, `lib/plainQueue.ts`: the conversion queue's shape without the engine, a function of
one file and the settings run one file at a time in a module-level store keyed by tool, so a
visit to another page and a press of Back finds the work where it was left. `PlainToolApp` is the
page for a job per file; `CombineApp` is the page for many files into one thing, with a list to
order and one result.

The image tools are the canvas. Every browser decodes JPEG, PNG, WebP, GIF and BMP, most decode
AVIF and Safari decodes HEIC; `createImageBitmap` with `imageOrientation: "from-image"` gives the
picture the right way up, the picture is drawn in halves down to the size asked for so every step
averages the pixels it drops, and `toBlob` or `convertToBlob` writes JPEG, PNG or WebP (Safari
writes no WebP, and the panel says so). What comes out carries no metadata and no colour profile.
Compressing to a size is bisection on the quality between 0.4 and 0.95, checking the ends first
so a picture already small enough costs one encode, and a smaller frame only when the lowest
quality is still too large, shrunk by the square root of the ratio since bytes go with pixels.

Removing metadata is the one image tool that never decodes. A JPEG, a PNG and a WebP are each a
sequence of chunks, and the chunks that carry metadata - Exif, XMP, IPTC, comments, PNG text and
time, the multi-picture extension - are left out of the copy while the picture's own chunks are
copied byte for byte; the JFIF header, the ICC profile and the Adobe marker stay because the
picture needs them. The Exif block is read first, from its TIFF structure, for the card: camera,
lens, exposure, the moment, the software, the serial number and the GPS position. One tag is put
back: orientation, as a minimal Exif block carrying only that, since dropping it turns every
portrait photo on its side. HEIC, AVIF and GIF cannot be stripped without decoding and are
pointed at the converter.

The checksums are SHA-256, SHA-1, MD5 and CRC-32 written to take the file a chunk at a time,
because the Web Crypto API hashes a buffer and a buffer is the whole file in memory; the file is
read in 8 MB slices and every algorithm asked for is fed in one pass, at a few hundred megabytes
a second, with the heap flat however large the file. They are tested against Node's own digests
at every awkward length and chunk size. A pasted hash is matched against the results whatever
its case and whatever prefix it was pasted with.

PDFs go through pdf-lib, chosen for its MIT licence where Ghostscript and MuPDF are AGPL (section
2.2 of the catalogue), loaded on first use so no other page pays for it. Merging copies pages
across; splitting copies each range out as its own document, with the ranges parsed the way a
print dialog takes them ("1-3, 5, 8-"); rotating sets the page's rotation rather than re-drawing;
removing edits the page list; numbering draws Helvetica, which every viewer carries, at the
position asked. Pictures become pages with an upright JPEG or PNG embedded as it is and anything
else drawn again by the browser. A password-protected PDF is refused with a reason. Stamping a
word across the page and rewriting the Info dictionary are pdf-lib too: the stamp is Helvetica
drawn with a rotation and an opacity, and clearing metadata empties the Info dictionary and drops
the catalog's XMP stream, which is where a viewer reads the title and author from.

Drawing a page and reading its text is beyond pdf-lib, which writes PDFs and does not render
them, so the three tools that need it - pages to pictures, the scan compressor and the text
extractor - use PDF.js, Mozilla's Apache-2.0 renderer and the one every Firefox carries. It is
plain JavaScript with a worker and a directory of data files (CMaps for CJK text, the fourteen
standard fonts, an OpenJPEG decoder for JPEG 2000, ICC profiles), so
`scripts/copy-pdfjs-assets.mjs` copies those into `public/pdfjs/<version>/` at build time the
way the ffmpeg worker is, asserts the version pinned in `lib/pdf/render.ts`, and the routes that
use it import the library on first use so no other page pays for it. It is the legacy build and
the legacy worker, not the modern pair: the modern build is written for the current release of
each browser and used a Map method a year-old Chromium did not have, which the browser run found
as a failed card on the first document; the legacy build carries the polyfills and supports
browsers about two years back, which is the promise the rest of the site makes. A page is rendered to an
`OffscreenCanvas` at 72, 150 or 300 dpi and encoded by the canvas; text comes back in reading
order with a line break where the text moves down. The render loop is driven from a
`MessageChannel` rather than from PDF.js's own `requestAnimationFrame`: PDF.js draws a page in
slices and asks for the next one through a frame, which Chrome does not run for a minimized
window or a background tab, so a card sat at "Drawing page 1 of 5" for as long as the tab was
hidden. `RenderTask.onContinue` is the library's own hook for supplying the tick, and a posted
message is an ordinary task - not a frame, and not a timer with the one-second floor Chrome puts
on those in the background. The scan compressor redraws every page at a
chosen dpi as a JPEG and rebuilds the document at each page's own size in points, which is the
right tool for a scan and the wrong one for a document that is already text, so a result no
smaller than the source is reported as a note rather than written.

Finding duplicates is the checksum tool run over a drop: files are grouped by size first, since
two files of different sizes cannot be the same, and only the files sharing a size are hashed,
with SHA-256, so a folder of large videos costs one read of the few that could match.

ZIPs go through fflate, also MIT and also streamed: each file is read in 4 MB slices and deflated
as it arrives, with formats that are already compressed stored as they are, and an archive is
read the same way, its entries unpacked into blobs. fflate writes and reads classic ZIP only, so
anything past 4 GB is refused with a reason rather than corrupted. A file that does not start
with the ZIP signature is refused too, since fflate would otherwise skip quietly past it and
report an empty archive.

The fourth batch stays on the same footing: no new runtime and no new dependency. Four more PDF
tools are pdf-lib again. Extracting and reordering are the split tool's range parser and one
copy of the pages in the order worked out, with the identity order reported rather than
written. Flattening is pdf-lib's own `flatten`, which draws each field's appearance into its
page and deletes the field, plus a pass that rewrites the page's annotation array without the
references `flatten` leaves dangling, so a count afterwards is honest; removing annotations
drops `Annots` from every page and `AcroForm` from the catalog. The booklet maker embeds every
page as a form object and draws it into a cell on a new sheet, scaled only when a named sheet
size asks for it, and turned by the page's own `/Rotate` entry, since an embedded page is the
unrotated content and a page a phone scanned sideways would otherwise land sideways;
`lib/pdf/impose.ts` works out the saddle-stitch order (last with first, second with
second-to-last, and so on inward, padded to a multiple of four) and the geometry, and is tested
without a PDF in sight.

The data tools are plain TypeScript. The CSV parser is a state machine that takes the file a
chunk at a time and carries what it was in the middle of - a quoted field, an escaped quote, a
CRLF - from one push to the next, so a multi-gigabyte export is read without ever being one
string; the delimiter is the candidate that appears the same number of times on each of the
first lines outside quotes, and the encoding comes from the same detector the text-file tool
uses. Values become numbers and booleans only where JSON would give them back unchanged, so
"007" and a sixteen-digit card number stay text. JSON to CSV flattens nested objects into
dotted names and finds the records in an API response's one list; the formatter is
`JSON.parse` and `JSON.stringify`, with a small scan of the grammar to name the line and column
when the engine's message names only the token, which V8's does for most errors. The notebook
cleaner is `nbstripout` in the browser: outputs emptied, counts nulled, the metadata front ends
write for themselves dropped, and the file written as nbformat writes it, one-space indent and
sorted keys, so the only lines that change are the ones stripped.

The text-file tool names an encoding from the bytes: a byte-order mark, a fatal UTF-8 decode
that forgives a sequence the 64 KB sample cut in half, zero bytes in every other position for
UTF-16 without a mark, and Windows-1252 for the rest, said to be a guess. `TextDecoder` reads
anything with a name; UTF-16 out is written by hand, since `TextEncoder` writes only UTF-8.
Comparing two files is patience diff: the lines unique to both files are matched by their
longest common ordering and only the gaps between are handed to Myers' algorithm, with a gap
too costly to diff written off as replaced, and the result written as `diff -u` writes it,
hunks, context and the no-newline marker included.

Encrypting a file uses nothing written here: PBKDF2 with SHA-256 and a random salt derives an
AES-256-GCM key from the passphrase, and the file is sealed in 1 MB blocks the way the streaming
constructions in Tink and age do it - each block's nonce is a random prefix, the block's number
and a flag on the last, and the 40-byte header is bound to every block as associated data - so
a block cannot be changed, dropped, repeated or swapped without the check failing, and a
multi-gigabyte file is never decrypted into memory whole. The format is this site's own, which
the page says plainly: a file sealed here is opened here. The two image tools are the canvas
again: the merger lays every picture at a row's height, a column's width or a grid's cell and
draws them on one canvas, scaling the whole down when it would pass the 16,384-pixel side a
browser allows; the palette is median cut over a 200-pixel sample of the picture, with
transparent pixels left out and the boxes' averages and shares as the swatches.

The fifth batch is more of the same, and the last of what the canvas, pdf-lib, PDF.js and
fflate can do without a new runtime. Turning a picture is one `setTransform` on the canvas,
worked out for the five turns and checked on the corners; padding to a shape is the crop tool's
opposite, the smallest frame of the shape around the whole picture, with the blurred-background
look made by drawing the picture at a twenty-fourth of its size and back up again, which every
browser smooths into a blur and needs no `filter` support; the adjustments are one pass over an
`ImageData`. An SVG is drawn by the browser itself: the root's width and height are set from its
own size or viewBox, the text goes through an `Image` and onto a canvas, and what comes out is
what a page would show, fonts and all, without anything the SVG references by URL.

Resizing PDF pages reuses the booklet maker's embed-and-draw: each page becomes a form object
drawn into the paper size asked for, scaled to fit inside a margin, turned by its own `/Rotate`,
centred. Cropping sets the page boxes rather than redrawing, which is what a viewer's own crop
does; the interesting part is the turn, since a page stored with a quarter turn shows its left
edge at the top, and `unrotatedInsets` maps what comes off each shown edge onto the stored
ones, tested for every rotation. Trimming to the content draws each page at 36 dpi with PDF.js
and finds the box around every pixel darker than a threshold that lets a scan's grey paper
through. Extracting images walks PDF.js's operator list for the paint-image operators and takes
each image object once: a browser-decoded `ImageBitmap` drawn straight to a canvas, or raw bytes
in one of PDF.js's three layouts expanded to RGBA, the one-bit layout with its rows padded to a
byte. PDF.js hands its bytes to a worker, which detaches the buffer, so a tool that also needs
pdf-lib to save the same document gives PDF.js a copy.

An .xlsx is a ZIP of XML, and the two spreadsheet tools write and read the handful of parts
that matter without a library: the writer puts every cell inline, typed as a number or a boolean
where JSON would give it back unchanged and as text otherwise, so leading zeros survive; the
reader takes the shared-strings table, inline strings, numbers, booleans and errors, and turns
a number whose cell style is a date format - a built-in id or a custom code with day, month,
year, hour or second in it - back into a date, through Excel's phantom 29th of February 1900
and the 1904 system both. The profiler is one streamed pass with distinct values counted to a
cap of twenty thousand; the cleaner holds the rows and counts every change it makes.

Identifying a file is a table of about a hundred signatures with their offsets - a TAR says
"ustar" at byte 257, an ISO says "CD001" at 32769 - with a closer look where several formats
share one: a ZIP's entry names, read from both ends of the file, say Word, Excel, PowerPoint,
EPUB, JAR or APK, an `ftyp` brand says MP4, MOV, M4A, HEIC or AVIF, a RIFF form says WebP, WAV
or AVI. What matches nothing and has no zero bytes is text, and its first lines say what sort.
Splitting is `Blob.slice`, which copies nothing, and joining is one `Blob` of the pieces sorted
by the numbers in their names, with a missing or repeated number said. The TAR reader takes the
archive block by block as it arrives, holding one file's bytes at a time, honours GNU long-name
entries and pax path records, skips what a browser cannot hold, and is fed by fflate's
streaming gunzip for a .tar.gz; a .gz whose first inflated block is not a TAR header is one
plain file, and comes back as that.

The sixth batch is built from the same parts again, most of it arithmetic over what the earlier
batches already read. Rounding corners is a path of four arcs clipped on the canvas, with the
border stroked just inside it; tiling is a grid of whole-pixel edges with the crop for square
tiles centred; comparing two pictures is one pass over both `ImageData`s with a tolerance, the
first faded to grey and every changed pixel painted red; keying a colour out is a flood fill from
the picture's edges, or a plain pass, over pixels within a distance on every channel, with the
pixels just past the distance faded rather than cut. The blank-page remover draws each page at
50 dpi through the same PDF.js path the crop tool uses and counts the pixels darker than a
threshold that lets scanner haze through; collating is an order worked out from two page counts
and copied by pdf-lib; splitting by size writes candidate runs of pages and bisects on the count,
since a shared font or picture is written once per piece and no sum of pages predicts the file.
Stamping a picture places it on the page as its viewer shows it and turns the anchor back into
the page's own coordinates, the crop tool's inset mapping run the other way, tested for every
rotation. Bookmarks are the one thing pdf-lib has no API for, and an outline turns out to be a
linked list of dictionaries - title, parent, previous, next, first and last child, a destination -
written with its low-level objects and hung off the catalog with `PageMode` set to open on it.

The table tools all read a CSV whole through the streaming parser and then work on rows: merging
maps each file's header onto the first file's columns by name and appends what is new; splitting
slices rows the parser has already read, so a quoted line break never cuts one; sorting is a stable
sort by a number, a natural-order collator or a plain one, with empty cells last; the Markdown
and HTML writers escape and pad; the SQL writer infers a type per column from its filled cells,
cleans and quotes the identifiers, and escapes the literals the way each dialect wants. Excel to
JSON and JSON to Excel are the workbook reader and writer joined to the CSV tools' record and
flattening code. The transcript is the subtitle parser's cues with the markup stripped and the
gaps read: two seconds, or most of a second after a full stop, starts a paragraph. Renaming fills
a pattern's tokens per file, makes the names unique, and packs the files unchanged under the new
names, since a browser cannot rename a file where it sits; the TAR writer is the reader's mirror,
a ustar header per file with GNU long-name entries where the name fits neither the field nor the
prefix, fed through fflate's streaming gzip when asked.

The seventh batch keeps to the same rule - no new runtime and no new dependency - and leans on
the one thing the earlier batches did not have: a way to read XML. `lib/text/xml.ts` is a small
tokenizer that keeps each node's raw spelling beside its meaning, says a broken file's line and
column, and writes the tree back indented or minified with mixed content and `xml:space` left
alone. The formatter, the JSON converter, the SVG optimiser, the GPS converter, the e-book reader
and the XFA form reader are all built on it.

Protecting a PDF is the first tool here that writes cryptography into someone else's format.
pdf-lib neither writes nor reads encryption, so every string and stream of every object is
encrypted on pdf-lib's own objects with AES-256-CBC and a random IV each, and an `/Encrypt`
dictionary is written for revision 6, the handler of PDF 2.0: a random file key, sealed under the
user password and again under an owner password made at random, by algorithm 2.B's iterated
SHA-256/384/512 over AES-128 rounds. Everything comes from Web Crypto; Web Crypto insists on
padding, so the unpadded decryptions the handler needs append a block that decrypts to a whole
block of padding. Unlocking reads every revision in use, RC4 at 40 and 128 bits (with MD5 from the
checksum tool and RC4 written here), AES-128 and AES-256, with either password, and a file whose
only lock is on printing opens with none. Object streams are the awkward part: pdf-lib cannot
inflate an encrypted one and keeps it as an invalid object, so the stream is taken back out of
that, decrypted with its own object key and handed to pdf-lib's object-stream parser. Both are
tested against files qpdf wrote in every revision, embedded as base64, and against PDF.js opening
the protected output; qpdf accepted the output too when it was written.

The readers of other people's formats are written from their specifications. An .eml is MIME:
boundaries, base64 and quoted-printable, RFC 2047's encoded words and RFC 2231's continued
parameters, the file read as Latin-1 so an 8-bit body survives to be decoded in its own charset.
An Outlook .msg is a compound file - a FAT, a mini stream and a red-black tree of directory
entries - holding MAPI properties as streams named for their id and type; `lib/documents/cfb.ts`
reads the container and `msg.ts` the message, its recipients, its attachments and any message
attached to it, and writes the whole as an .eml. Compressed RTF is expanded when that is all a
message has, checked against the example in its specification. A SQLite database is read page by
page: the schema table on page 1, each table's B-tree, records with their serial types, overflow
chains, WITHOUT ROWID tables in primary-key order, and columns added after a table was made; the
tests build their databases with Node's own SQLite. A certificate is DER walked by hand, its
extensions named, and checked field by field against Node's `X509Certificate`.

The CSV tools reuse the streaming reader: joining indexes the second file by its key and writes a
row per match; comparing matches rows on a key and compares cells by column name; the pivot keeps
an accumulator per cell and computes the totals from the rows rather than from the cells; the
anonymiser finds columns by header and by the shape of their values - a card number passes Luhn,
a phone has at least seven digits and some punctuation - and its stand-ins stay consistent across
the file so the table still joins. The HAR sanitiser, the secret scanner and the GPS trimmer are
the privacy tools this site is best placed for, since the file in question is exactly the one
that should not be uploaded to have it cleaned. The passport sheet packs photos as tightly as the
sheet allows, butting them together when that fits more, and writes 300 dpi into the JPEG's JFIF
header so it prints at its true size.

The eighth batch starts with text formats and QR codes, still with no new runtime and no new
dependency. `lib/text/markdown.ts` renders Markdown line by line into blocks and then runs each
block's text through an inline pass that sets code spans and links aside before anything is
taken for emphasis; headings get the anchors GitHub gives them, so links to sections keep working,
and raw HTML passes through with its scripts, handlers and `javascript:` links removed. The
notebook converter reuses it for Markdown cells and picks each output's richest MIME type a page
opened from disk can show: a PNG or SVG chart, a pandas table's HTML, Markdown, LaTeX as text,
then plain text, with an interactive plot's script-only HTML falling back to the picture or text
saved beside it. `lib/data/yaml.ts` is a YAML 1.2 core-schema parser - block and flow
collections, plain, quoted and block scalars with chomping, anchors, aliases, `<<` merge keys,
tags and several documents - checked against PyYAML where the two schemas agree; the writer
quotes any string an older YAML 1.1 reader would take for a boolean, a number or null.

The JWT decoder reads without a key, as anyone can, and verifies with one: HMAC for the HS
algorithms, and RSA, RSA-PSS, ECDSA and Ed25519 for the rest through Web Crypto, with the key given
as a PEM public key, a PKCS #1 key (wrapped into the SubjectPublicKeyInfo Web Crypto imports), a
certificate (its key found in the DER) or a JWK set, where the key whose `kid` matches is used.
The tests sign with Node's own crypto, and one ES256 token was signed by openssl against a
certificate.

The QR tools are written from ISO/IEC 18004. The encoder picks the densest mode the text allows,
the smallest version that holds it, splits the codewords into the standard's blocks with
Reed-Solomon correction over GF(256), interleaves them, and scores all eight masks by the
standard's penalty rules. zxing-cpp read back all 264 codes it made across versions 1 to 40
and all four levels, and the tests hold a symbol it draws module for module as segno does. The
reader binarizes by a threshold that
follows each 8 x 8 block's neighbourhood, scans rows for the 1:1:3:1:1 runs of a finder pattern
and checks each down its column and along its diagonal, then tries every three finders that
could be one code's corners. A code seen at an angle is sampled through a projective transform:
the bottom-right alignment pattern fixes the fourth corner when there is one, and otherwise the
finders' own squares - their outer edges fitted as lines from rays cast out of each centre - say
which way the code's edges run, so the top-right finder's right side and the bottom-left
finder's bottom side meet at the missing corner. A version block read at the wrong grid size
names the right one. On a set of 116 generated pictures - every level and scale, turned,
warped, blurred with noise and a lighting gradient, inverted, several to a picture - it reads
115, against zxing-cpp's 116; the one it misses is a version 1 code blurred until its finder
merges with the modules beside it.

The developer inspectors read formats no browser tool usually opens. The file search streams
each file through a `TextDecoder` and keeps only matching lines and their context, so a log of
several gigabytes is searched in a tab; files inside ZIPs are searched too. The log analyser
reads the same way, tries each line as an access log, JSON, syslog and a timestamped line in
turn, treats indented and untimed lines as the entry above (a stack trace), and groups messages
once what varies between them is masked. The protobuf decoder's raw output is byte for byte what
`protoc --decode_raw` printed for a message written by protobuf's Python runtime, and with the
`.proto` file its JSON matches protobuf's own JSON printer. The WebAssembly inspector's import and
export lists match `WebAssembly.Module.imports` and `exports` for real modules - PDF.js's
Rust and Emscripten builds - and it guesses the toolchain from the producers section or the shape
of the imports.

The git bundle reader needed a decompressor that says where a stream ended: a packfile is zlib
streams laid end to end with nothing between them, and fflate does not report how much input it
used. `lib/zip/inflate.ts` is a table-driven DEFLATE decoder that does, checked against Node's
zlib at every level, stored and fixed blocks included, on streams placed back to back. The pack
reader applies offset and reference deltas, recomputes every object's SHA-1 so ids match git's,
and reports the deltas a thin bundle cannot resolve; its tests use bundles git 2.43 wrote. The font
inspector reads TrueType, OpenType, collections and WOFF, whose tables it inflates with the same
decoder; its names, glyph count, cmap size, features and scripts match what fontTools reads from
DejaVu Sans. WOFF2 needs Brotli and is recognised but not read, though the browser still draws
its specimen.

One fix to shared code came out of this batch: the drop zone prefetches the ~31 MB ffmpeg core
when a pointer rests on it, which is right on an engine tool and wasted on the tools that never
load ffmpeg. The plain-queue shells and the two subtitle tools now turn that off.

The 3D tools read STL (binary and ASCII), OBJ, PLY (ASCII and binary), glTF 2.0 (a .glb or a
.gltf with embedded buffers) and 3MF into one mesh and write any of them back. glTF's node
hierarchy and 3MF's build and component transforms are applied, so parts land where the file put
them; a mirroring transform has its triangles turned back. The 3MF reader scans the model XML with
targeted patterns rather than building a tree, since a printable model can have millions of
vertices, and follows the production extension's separate object files. Reading trimesh's own
files gives trimesh's volume, area and bounds to the last digit, and every file written here loads
in trimesh with the same numbers. The checker counts every edge: once is a hole, three times is
non-manifold, twice in the same direction is a flipped face. Repair welds vertices, drops
degenerate and duplicate triangles, walks each shell turning triangles to agree with their
neighbours, fills each hole with a fan from its centre, and turns any shell whose volume is
negative the right way out. The preview is a z-buffered software rasteriser, the same code in the
tests and the page.

Redaction is the tool this site is most suited to, since the file in question is exactly one that
should not be uploaded. Words, and details found by their shape (e-mail addresses, phone numbers,
card numbers checked by their Luhn digit, ID numbers, IBANs), are found in the text PDF.js reads
from each page, joined across text items, and mapped back to rectangles. Every page with a match
is drawn with the boxes painted in and replaces the original page, so the text underneath no
longer exists; the other pages are copied untouched, and document properties, bookmarks and
attachments are not carried over. The checker reads each page's operator list, tracking the
transform and fill colour, collects the dark filled rectangles and the redaction and dark
annotations, and reports the characters of text that fall under them. The visual comparison draws
both versions' pages and colours ink only in the first red and ink only in the second green. The
EPUB editor rewrites only the elements it manages in the package file's metadata, keeps the rest
byte for byte, and writes series both the way calibre does and the way EPUB 3 does.

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

The header is sticky: the mark and wordmark, an "All tools" menu on Base UI's Navigation Menu
grouped by category with a count per group, the name of the tool in use, and the promise in three
words at the far end. The plain row of links the menu replaced wrapped to three lines once the
catalogue passed a dozen tools. The menu's content is kept mounted, so every link is in the
server-rendered HTML for a crawler, and the footer carries the same list as plain anchors either
way; the current tool's link is marked `aria-current="page"` in the menu and named beside it.

The index (`components/ToolIndex.tsx`) puts a search box over the catalogue. Typing filters the
cards as the letters land, every word typed has to appear somewhere in a tool's name, tagline,
slug, category or what it accepts, and the categories left empty are hidden; `/` focuses the box
from anywhere on the page. The cards are in the server-rendered HTML in full, so a crawler and a
visitor without JavaScript get the whole catalogue either way. Under the search, a row of chips
jumps to each category, and every tool page opens with a breadcrumb back to its category.

### Styling

Plain CSS modules, one per component, plus `app/globals.css` for the palette, the type scale and
a small reset. Colours are CSS custom properties on `:root` with a `prefers-color-scheme`
override, so the theme follows the OS setting with no flash and no JavaScript. There is no
utility-class framework and no PostCSS config.

The palette is drawn from the mark: the three blues of its faces, with the deepest one on every
primary action and link in light mode and the lightest one taking that job in dark mode, each
chosen because it is the one of the three that reads at better than 4.5:1 on its background. The
page is a cool grey tinted towards the same blue; cards are a step lighter with a hairline and a
soft shadow; the panels, tags and logs inside a card are a step darker again. Every category has
a hue of its own, used only on the icon tile a tool carries, so a page of a hundred cards can be
scanned by colour, and the index's category headings carry a small isometric illustration in the
mark's own three blues (`public/illustrations/`).

The type is Inter, self-hosted by `next/font`, with the letter-spacing tightened a touch at body
size and more at the two display sizes. Seven sizes cover the whole site; nothing sets a font
size to a literal value.

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
node scripts/verify-plain-tools.mjs                         # the PDF, data, file and image tools of the fourth, fifth and sixth batches, no ffmpeg needed
node scripts/verify-plain-tools-2.mjs                       # the seventh batch: PDF passwords and forms, e-mail, e-books, SQLite, CSV, XML, GPS, HAR, certificates, secrets, SVG, passport photos
node scripts/verify-large-file.mjs                          # >2 GiB input
```

The unit tests include the conversion queue itself, driven through a fake engine behind the
engine interface, so every cancel, retry and re-queue transition is pinned without ffmpeg in the
loop, and every format's argument strings. `tests/plans.integration.test.ts` and
`tests/merge.integration.test.ts` then run each video plan, the speed plan and both merge plans
through whatever ffmpeg is on `PATH` and check the result with ffprobe, so a filter that does not
parse fails in seconds rather than in a browser; they are skipped where ffmpeg is absent.
`tests/picture-audio-captions.integration.test.ts` does the same for the resize, rotate, frame,
sheet, loudness, subtitle, burn-in, audio compression, channel, waveform, chapter, chapter-split and
audio-track plans, running the
loudness plan's two passes the way the engine does and measuring the result with `ebur128`, and
writing a plan's scratch files where that ffmpeg can read them. `tests/soundtrack.integration.test.ts`
covers the batch after that - audio added, looped and mixed under a video, the sound moved each
way and read back from the edit list, a peak lift measured with `volumedetect`, fades measured
quiet at both ends, a loop three times over and out to a minute, a GIF to MP4 and WebM, a subtitle
file muxed into an MP4, an MKV and a WebM, tags and covers into an MP3 and a FLAC, equal parts,
an MP3 under a colour, an image and a waveform, a range cut out by copy, a logo and a line of
text drawn over a video, single frames at an interval, and MP3s joined by copy and unlike files
by re-encoding. The subtitle library
is pure and its tests round-trip every format. The no-engine tools are tested without a browser
where they can be: the metadata stripper against synthetic JPEG, PNG and WebP files carrying a
hand-built Exif block, the digests against Node's own at every awkward length and chunk size,
the page ranges, the size and quality arithmetic, the PDF operations against documents pdf-lib
makes in Node, the archives round-tripped through fflate, the crop, mark and ICO arithmetic, the
duplicate grouping, and both plain queues through fake runners. The fourth batch's modules are
tested the same way: the CSV parser with the chunk boundary in every position of a file with
quotes, escaped quotes and line breaks inside fields; the JSON error scanner and the
formatter; the notebook cleaner; the encoding detector on byte-order marks, cut sequences and
markless UTF-16; the diff by applying its edits to random inputs and checking the unified text
against `diff -u`'s form; the sealer round-tripped at every chunk boundary and then flipped,
swapped, shortened and given the wrong passphrase; the composition and palette arithmetic; and
the booklet order, the imposition geometry and the page order, flatten and form summary against
documents pdf-lib makes in Node. The fifth batch adds the turn matrices checked on the corners,
the padding and adjustment arithmetic, the SVG size reader, the page-resize plan and the crop
insets for every rotation, the content-bounds scan and PDF.js's three pixel layouts, a workbook
written and read back through fflate plus a sheet written the way Excel writes one, the
profiler and the cleaner, the signature table on a few dozen byte patterns, the piece naming and
ordering, and a TAR built in Node with a long name and a pax header read back in every chunk
size, gzipped and plain. The sixth batch adds the rounding, tiling, diff and keying arithmetic on
hand-built pixel arrays, the ink share and blank thresholds, the collation order for equal and
unequal counts, the size bisection against a fake writer and a real document, the stamp placement
for every rotation, the outline parser on numbered and contents-page lines and the outline written
and walked back with pdf-lib, the table merge, split, sort and record code, the Markdown, HTML and
SQL writers, the transcript styles, the line sorter, the rename patterns, and a TAR written and
read back through the reader, gzipped and plain. The seventh batch adds the XML tokenizer's errors,
formatting and JSON round trips; PDF encryption against qpdf's files in five revisions and against
PDF.js; the form reader on pdf-lib forms and an XFA packet; the EPUB reader on nested lists and a
broken chapter; the MIME parser on encoded words, continued parameters and 8-bit bodies; the
compound-file and .msg readers on files written by a test writer that olefile read back; SQLite
databases written by SQLite itself; the join, comparison, pivot and anonymiser; every GPS format
round-tripped and the privacy trim; the HAR sanitiser; certificates against Node's parser; the
secret patterns; the SVG cleaner; and the passport layout. The canvas and PDF.js's renderer
only exist in a browser, and the pages built on them are driven through Chromium by hand-run
scripts before a release.
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
made from a mono MP3 and the vocals cut from a stereo MP4; a waveform and a spectrogram drawn as
PNGs; a chapter list written into a tagged MP4 and into an MP3 shorter than the list; a French
SRT merged under an English one, stacked and then combined; a three-chapter MP4 split into three
pieces and a file without chapters refused; and the French track of a two-language MKV extracted
as an M4A with its language tag. Every media download is checked with `ffprobe`.

`verify-plain-tools.mjs` drives Chromium through the fourth batch with fixtures it makes in
Node - PDFs through pdf-lib, PNGs written by hand - and needs no ffmpeg: pages 5 and 1
extracted and checked by their widths, a document reversed and page 3 moved to the front, a
form with a text field and a check box flattened and a plain document reported instead, five
pages laid out as a booklet and as two per A4 sheet, with the booklet's first and third sides
rendered through the PDF-to-images page so the blank, the upright digit and the page stored
sideways can be looked at; a CSV with quoted commas, escaped quotes and a line break in a field
read back as JSON and TSV, an API response's list as CSV with dotted names, a minified file
formatted and a broken one located by line and column, a notebook stripped, a Windows-1252 CRLF
file rewritten as UTF-8 LF, a 2.5 MB file encrypted, decrypted back to the same bytes and
refused with the wrong passphrase, two texts diffed, two PNGs merged into one of the right
size, and a half-red, half-blue picture's palette read as two colours at half each. The fifth
batch's cases follow in the same run, with the PNGs that come back decoded in the script so a
pixel can be checked: a picture turned right, padded square on white with the picture in the
middle, and greyed to the grey of its brightness; an SVG drawn at 512 wide with its shapes
where they should be; the five odd pages put on A4; a document trimmed to its content and
then cropped 50 mm off the top, with the page stored sideways losing the 50 mm off its stored
left; a PNG and a JPEG placed in a PDF and taken out again at their stored sizes and colours;
a CSV written as a workbook and its cells read out of the ZIP, and a hand-written workbook
with shared strings and a date style read back as two CSVs with the dates as dates; a CSV
profiled and a messy one cleaned; a PNG called .jpg named for what it is; a 2.5 MB file split
into 1 MB pieces, the pieces dropped out of order and joined back to the same bytes; and a
.tar.gz and a plain .gz unpacked. The sixth batch's cases follow: a picture rounded and cut to a
circle with see-through corners, cut into nine square tiles, compared with a half-changed copy
and the changed half found red, and a red square keyed out of its white background; four pages
with two blank ones cut to two, fronts and reversed backs collated into the right order, six heavy
pages split under 0.4 MB with the pages adding up, a picture stamped on the last page only, two
one-line-different PDFs diffed, and three bookmarks written and counted back; two CSVs with
different headers merged, a CSV split every two rows with the header on both pieces, sorted by
a column descending, written as a Markdown table and as SQL, a workbook read as JSON and an API
response written as a workbook, an SRT run into paragraphs, and a word list sorted; and two
files renamed by number into a ZIP and packed into a .tar.gz that is read back block by block.

`verify-plain-tools-2.mjs` drives the seventh batch the same way, with fixtures it makes itself: a
PDF protected with copying forbidden, refused by PDF.js without the password and read with it,
then unlocked back and refused with the wrong one; two filled forms read into one CSV; an EPUB's
chapters in spine order; an .eml's attachment byte for byte; an Outlook message's recipients,
attachments and inline picture, and the .eml made from it; a SQLite database's two tables; two
CSVs joined and compared, one pivoted and one anonymised; a feed formatted and a broken file
located; XML to JSON and back; a GPX ride as GeoJSON and KML and a line trimmed 200 m at each end;
a HAR with no secret left; a certificate chain and a DER written from a PEM; a GitHub token and
an AWS key found in a config file; an Inkscape SVG cleaned to one element; and a passport sheet
measured at 1800 x 1200 and 300 dpi, then laid out on A4 as a PDF. It bundles two TypeScript test
fixtures with esbuild, which Vite brings in, and needs Node 22 for `node:sqlite`.

`verify-plain-tools-3.mjs` drives the eighth batch: a README rendered with and without a table
of contents and its script gone; a notebook with a chart embedded, then as results only; two
Kubernetes documents with an anchor and a merge key as JSON, and JSON back to YAML that parses as
the same data; the JWT example verified, an expired RS256 token verified against its PEM key and
refused against another key from a JWK set; a link, a Wi-Fi network and three lines made into QR
codes whose downloaded PNGs are decoded again from their pixels; a picture holding two codes
read back with the link and the Wi-Fi password spelled out; TODO found across two files and a
ZIP; a gzipped application log and an access log summarised; a protobuf message decoded raw and
then with its .proto; PDF.js's colour module identified as Rust with wasm-bindgen; a bundle made
by git opened with its commit ids matching git's and its tip saved as a ZIP; and DejaVu Sans read
with a specimen drawn in it; an STL cube converted to 3MF and glTF, and a box with its bottom
missing found and repaired to a watertight 8000 mm3; a PDF redacted with its details gone from the
text, then checked beside one whose box hid nothing; two versions of a PDF compared to the one
changed page; and an EPUB's title, authors and series changed and read back. It needs git on the
PATH for the bundle.

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
  would not look the same anywhere else. The exception is ASS or SSA written back as ASS, which
  keeps the source's own `[Script Info]`, styles and override tags and rewrites only the times.
- Subtitle extraction reads text tracks only. Blu-ray and DVD subtitles are bitmaps, and turning
  them into text is OCR, which is a different tool; they are refused with a reason.
- Burned-in subtitles are set in DejaVu Sans, the one font the site ships, which covers Latin,
  Greek, Cyrillic, Hebrew, Arabic, Armenian and Georgian, and not Chinese, Japanese, Korean, Thai
  or the Indic scripts; a font for those is tens of megabytes and would need its own download
  step. A file the font cannot draw is flagged in the panel before anything is encoded, since
  finding out afterwards costs a full re-encode; `/add-subtitles` is the way round it, because a
  text track keeps the text and the player supplies the font. An ASS file's own fonts are
  replaced by it.
- The subtitle merger's combined layout pairs cues by overlap, so it is right when both files were
  timed to the same cut of the video and wrong when one runs early or late; shift that one with
  the converter first. The stacked layout's position tag is honoured by VLC, mpv, the browsers and
  most players, and a player that ignores it shows both languages at the bottom.
- Chapter markers go only where the container has a place for them: MP4, MOV, M4A, MKV, WebM, MP3
  and Ogg. WAV and FLAC have none and are refused with a reason rather than converted. An MP4
  carries them twice over - a Nero `chpl` list, which may start after 0:00, and a QuickTime text
  track, which covers the file from the start whatever the list says - so a first chapter that
  starts later is given an opening chapter over the gap, unless the panel says to leave it.
- A video split at its chapters is cut by stream copy, so each piece starts on the keyframe before
  its chapter and can begin a few seconds early; the sound is cut to the frame. Each row reports
  the range its file really holds, measured from the finished piece, so a card never claims a
  range the file does not have. `/split-video` additionally offers a cut on the frame, which
  re-encodes every piece to H.264 in an MP4 and is as slow as any encode; the chapter splitter
  does not, and the precise cut on the trimmer is the way to do it one chapter at a time.
- The track extractor copies; a track in a codec no container of its own will hold (TrueHD, DTS)
  comes out in a Matroska audio file, which fewer players open. Extract it and drop it on the
  audio converter for an M4A or MP3.
- Vocal removal is a centre cut, not a separation model: it takes out whatever is identical in
  both channels, which on many mixes includes the bass and the drums, and does nothing to mono.
- The audio file added to a video, a cover picture and a backdrop image are read whole into
  memory and written into the core, so they are capped (200 MB, 10 MB and 20 MB); the video or
  audio file in the queue is mounted and has no such cap.
- The sync fix moves the sound by one fixed amount. Sound that drifts - in step at the start and
  out by the end - runs at a different rate from the picture, and needs a stretch this does not do.
- A loop's seam is wherever the file itself begins and ends; the loop copies the streams and
  cannot smooth it. To loop part of a file, cut that part out with the trimmer first.
- A cover picture goes only where the format has a place for one: MP3, M4A and FLAC. Ogg and WAV
  have none and are refused; Matroska's attachments are a different mechanism and not written.
- Subtitles added as a track go into MP4 and MOV as MOV text, which keeps italics and little else
  of an ASS file's styling; an MKV keeps the ASS as it is. A container with no place for a text
  track, such as AVI, comes back as an MKV.
- A still backdrop under audio is written at 5 frames a second. Every player and upload form
  tested accepts it; a site that insists on 24 or more wants the waveform, which runs at 25.
- Which picture formats can be opened is the browser's decision: HEIC opens in Safari and nowhere
  else, TIFF in Safari only, and Safari writes no WebP. A picture that comes out of the canvas
  carries no colour profile, so a photo in a wide-gamut profile is converted to sRGB.
- Metadata removal without re-encoding covers JPEG, PNG and WebP. HEIC, AVIF and GIF are pointed
  at the converter, which writes no metadata at all.
- PDFs and ZIPs are worked on in memory, since pdf-lib and fflate build their output there; a
  multi-gigabyte one needs that much room in the browser. ZIPs are classic ZIP, up to 4 GB per
  file and in all: ZIP64 is neither written nor read. Password-protected PDFs and ZIPs are refused.
  "Download all" writes one of these archives rather than firing a download per file, which is
  what made Chrome ask whether the site may save several at once.
- Merging or splitting PDFs copies pages, not documents: bookmarks and form fields do not carry
  over, and fonts and images do.
- Compressing a PDF redraws every page as a picture, so the text of the result cannot be selected
  or searched, and a document that is mostly text comes out larger, not smaller; the tool says so
  and writes nothing. Shrinking a text PDF without rasterising it is a different tool that needs
  a PDF library with an object-level optimiser, which none of the permissively licensed ones has.
- Text extraction reads the text layer PDF.js finds. A scanned PDF has none and comes back empty
  per page; turning the picture into text is OCR, which is not built.
- A watermark's text and a PDF stamp are set in DejaVu Sans and Helvetica respectively, which
  cover Latin, Greek and Cyrillic; other scripts need a font the site does not ship.
- Frames are grabbed at most 64 at a time, and each is a seek from the start of the file, so a
  frame a second over a long video takes a while; the card says how many were skipped.
- Joining audio files by copy needs the same codec, sample rate and channel layout; anything else
  is resampled to 48 kHz and re-encoded into the first file's format, and the summary says why.
- The favicon writer squares a picture about its centre; a wide logo is cropped, not padded.
  Transparency is kept everywhere but `apple-touch-icon.png`, which is painted onto a colour
  because iOS composites nothing behind a home-screen icon and a transparent logo lands on black.
- Cancelling terminates the ffmpeg worker, since ffmpeg blocks its worker while running and cannot
  be interrupted cooperatively. See [Cancelling one format](#cancelling-one-format) for why that is
  survivable. The engine restarts on the next job; the core is already cached, so this costs a
  WebAssembly instantiation, not a 31 MB download.
