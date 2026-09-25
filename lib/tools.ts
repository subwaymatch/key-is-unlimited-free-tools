/*
 * The tool registry: the single source of truth for what this site offers.
 *
 * The index, the header, the footer, the related-tools block, every page's
 * metadata and the sitemap all derive from this array. Adding a tool is one
 * entry here plus one `app/<slug>/page.tsx`, and it appears everywhere at once.
 * That is what keeps "every page links to every tool" true without anyone
 * having to remember to update six files.
 *
 * See section 7.1 of
 * agent-outputs/browser-tool-catalogue-and-build-order.md.
 */

import type { Metadata } from "next";

import { SITE_NAME, SITE_URL } from "./site";

export type ToolCategory = "video" | "audio" | "subtitles" | "images" | "documents" | "files" | "data";

/*
 * Icon keys, resolved to lucide components by components/ToolIcon.tsx.
 *
 * Kept as plain strings so this module stays data only: app/sitemap.ts imports
 * it, and a sitemap has no business pulling React components into its graph.
 */
export type ToolIconName =
  | "audio"
  | "compress"
  | "convert"
  | "trim"
  | "gif"
  | "mute"
  | "clean"
  | "speed"
  | "merge"
  | "subtitles"
  | "transcribe"
  | "music"
  | "loudness"
  | "resize"
  | "rotate"
  | "thumbnails"
  | "captions"
  | "burn"
  | "channels"
  | "waveform"
  | "chapters"
  | "bilingual"
  | "split"
  | "tracks"
  | "addaudio"
  | "volume"
  | "sync"
  | "softsubs"
  | "loop"
  | "film"
  | "tags"
  | "cut"
  | "parts"
  | "clapper"
  | "fade"
  | "tempo"
  | "picture"
  | "shrinkpicture"
  | "hidden"
  | "imagepdf"
  | "deletepages"
  | "numbers"
  | "checksum"
  | "archive"
  | "unarchive"
  | "stamp"
  | "frames"
  | "crop"
  | "favicon"
  | "code"
  | "text"
  | "erase"
  | "copies"
  | "pages"
  | "reorder"
  | "flatten"
  | "booklet"
  | "table"
  | "spreadsheet"
  | "braces"
  | "notebook"
  | "textfile"
  | "lock"
  | "diff"
  | "collage"
  | "palette"
  | "turn"
  | "frame"
  | "contrast"
  | "shapes"
  | "proportions"
  | "pictures"
  | "sheet"
  | "grid"
  | "chart"
  | "sparkles"
  | "scansearch"
  | "combine"
  | "package"
  | "squircle"
  | "tiles"
  | "compare"
  | "bucket"
  | "blankpages"
  | "collate"
  | "filestack"
  | "imageplus"
  | "difftext"
  | "bookmark"
  | "rows"
  | "rowsplit"
  | "sortaz"
  | "tableprops"
  | "database"
  | "textquote"
  | "updown"
  | "folderpen"
  | "packageplus"
  | "filelock"
  | "unlock"
  | "clipboard"
  | "book"
  | "mailopen"
  | "inbox"
  | "databasezap"
  | "link"
  | "comparearrows"
  | "sigma"
  | "mask"
  | "codexml"
  | "brackets"
  | "route"
  | "mappinoff"
  | "network"
  | "filebadge"
  | "keyround"
  | "pentool"
  | "idcard"
  | "filecode"
  | "notebooktext"
  | "listtree"
  | "ticket"
  | "qrcode"
  | "scanqr";

export interface ToolMeta {
  /** URL segment. Verb-object, lowercase, hyphenated, and permanent once shipped. */
  slug: string;
  /** Sentence-case name, used as the page title and the card heading. */
  name: string;
  /** One line for the index card. Kept short enough not to wrap twice. */
  tagline: string;
  /** Longer sentence for the meta description and the page lead. */
  description: string;
  category: ToolCategory;
  icon: ToolIconName;
  /** What the drop zone takes, shown on the index card. */
  accepts: string;
  /**
   * Only "live" tools are rendered anywhere. Planned entries live here so the
   * build order is visible in code, but they are never linked: a dead link is
   * worse than an absent one, for visitors and crawlers alike.
   */
  status: "live" | "planned";
  /**
   * What runs the tool: ffmpeg compiled to WebAssembly, or the browser's own
   * JavaScript with no runtime to download. Says which requirement the page's
   * structured data states. Defaults to "ffmpeg", which most tools are.
   */
  engine?: "ffmpeg" | "browser";
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  video: "Video",
  audio: "Audio",
  subtitles: "Subtitles",
  images: "Images",
  documents: "Documents",
  files: "Files",
  data: "Data",
};

/**
 * One line under each category heading on the index: what the group is for,
 * in the terms someone scanning a hundred cards is thinking in.
 */
export const CATEGORY_BLURBS: Record<ToolCategory, string> = {
  video: "Convert, compress, cut, join and fix video, however large the file.",
  audio: "Extract, convert, clean up and reshape sound, whole or clipped.",
  subtitles: "Convert, merge, extract and burn in captions.",
  images: "Resize, convert, crop, clean and combine pictures, in bulk.",
  documents: "Merge, split, lock and tidy PDFs, and open e-mails and e-books.",
  files: "Hash, zip, split and seal files, and check them for secrets.",
  data: "CSV, JSON, XML, Excel, SQLite and GPS files, converted and cleaned.",
};

/** Display order for category groupings. */
export const CATEGORY_ORDER: readonly ToolCategory[] = [
  "video",
  "audio",
  "subtitles",
  "images",
  "documents",
  "files",
  "data",
];

export const TOOLS: readonly ToolMeta[] = [
  {
    slug: "extract-audio",
    name: "Extract audio from video",
    tagline: "Pull the audio track out of any video, without uploading it.",
    description:
      "Pull the audio track out of any video, entirely in your browser. Files never leave your device, and multi-gigabyte videos are supported.",
    category: "audio",
    icon: "audio",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "convert-video",
    name: "Convert video",
    tagline: "Turn MOV, MKV, AVI or WebM into an MP4 that plays anywhere.",
    description:
      "Convert a video to an MP4, WebM or MKV that plays anywhere, entirely in your browser. Streams that already fit are copied rather than re-encoded, and nothing is uploaded, whatever the file size.",
    category: "video",
    icon: "convert",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "compress-video",
    name: "Compress video",
    tagline: "Shrink a video to a target size for email, chat or upload.",
    description:
      "Compress a video to a size you choose - 8 MB, 25 MB, 100 MB or your own number - entirely in your browser. Nothing is uploaded, so there is no cap on the file you start from.",
    category: "video",
    icon: "compress",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "trim-video",
    name: "Trim video",
    tagline: "Cut a range out of a video, instantly or frame-accurately.",
    description:
      "Cut a range out of a video entirely in your browser: an instant lossless cut at the nearest keyframe, or a frame-accurate one that re-encodes. Nothing is uploaded, however large the file.",
    category: "video",
    icon: "trim",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "video-to-gif",
    name: "Video to GIF",
    tagline: "Turn a clip into a looping GIF with a proper palette.",
    description:
      "Turn part of a video into a looping GIF entirely in your browser, with a palette generated from the clip itself. Choose the frame rate and width; nothing is uploaded.",
    category: "video",
    icon: "gif",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "remove-audio",
    name: "Remove audio from video",
    tagline: "Mute a video by dropping its audio track, without re-encoding.",
    description:
      "Remove the audio track from a video entirely in your browser. The video stream is copied as it is, so it takes seconds and loses nothing, whatever the file size.",
    category: "video",
    icon: "mute",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "remove-metadata",
    name: "Remove metadata",
    tagline: "Strip titles, dates, location and other tags from a video or audio file.",
    description:
      "Strip the metadata from a video or audio file entirely in your browser: titles, tags, dates, location, chapters and data tracks, with the streams copied untouched. Nothing is uploaded.",
    category: "video",
    icon: "clean",
    accepts: "Video and audio files",
    status: "live",
  },
  {
    slug: "change-speed",
    name: "Change video speed",
    tagline: "Speed a video up or slow it down, audio pitch-corrected.",
    description:
      "Speed a video up or slow it down entirely in your browser, with the audio kept in step and pitch-corrected. Nothing is uploaded.",
    category: "video",
    icon: "speed",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "merge-videos",
    name: "Merge videos",
    tagline: "Join several clips into one file, without re-encoding when they match.",
    description:
      "Join several videos into one entirely in your browser, copying the streams when the clips match and re-encoding only when they do not. Nothing is uploaded.",
    category: "video",
    icon: "merge",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "convert-subtitles",
    name: "Convert subtitles",
    tagline: "Turn SRT, VTT and ASS files into each other, and fix their timing.",
    description:
      "Convert subtitle files between SRT, VTT and ASS entirely in your browser, and shift or stretch their timing. Plain text in, plain text out; nothing is uploaded.",
    category: "subtitles",
    icon: "subtitles",
    accepts: "Subtitle files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "resize-video",
    name: "Resize video",
    tagline: "Scale a video down, or crop it square or vertical for social feeds.",
    description:
      "Resize a video to 1080p, 720p or half size, or crop it to 16:9, 9:16, 1:1 or 4:5, entirely in your browser. Never enlarged, audio copied untouched, nothing uploaded.",
    category: "video",
    icon: "resize",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "rotate-video",
    name: "Rotate video",
    tagline: "Turn a sideways or upside-down video the right way up, or mirror it.",
    description:
      "Rotate a video by a quarter or half turn, or flip it, entirely in your browser. The turn is written into the frames so every player shows it the right way up. Nothing is uploaded.",
    category: "video",
    icon: "rotate",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "video-thumbnails",
    name: "Video thumbnails",
    tagline: "A contact sheet of frames from a video, or one frame as an image.",
    description:
      "Make a contact sheet of frames spread evenly across a video, or save a single frame as a JPEG or PNG, entirely in your browser. Nothing is uploaded, however large the file.",
    category: "video",
    icon: "thumbnails",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "convert-audio",
    name: "Convert audio",
    tagline: "WAV, FLAC, M4A, OGG or a video's soundtrack to MP3, and back again.",
    description:
      "Convert audio files between MP3, M4A, WAV, FLAC and Opus entirely in your browser, whole or clipped to a range. A file already in the target format is copied rather than re-encoded. Nothing is uploaded.",
    category: "audio",
    icon: "music",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "normalize-audio",
    name: "Normalize audio loudness",
    tagline: "Bring a file to -14 LUFS for streaming, -16 for podcasts, or your own target.",
    description:
      "Normalize the loudness of an audio file or a video's soundtrack to a platform target - Spotify, YouTube, Apple, broadcast - entirely in your browser, measured and corrected in two passes. Nothing is uploaded.",
    category: "audio",
    icon: "loudness",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "extract-subtitles",
    name: "Extract subtitles",
    tagline: "Pull the subtitle tracks out of an MKV or MP4 as SRT or WebVTT files.",
    description:
      "Extract the subtitle tracks stored in a video file as SRT or WebVTT, one file per track, entirely in your browser and without touching the video. Nothing is uploaded, however large the file.",
    category: "subtitles",
    icon: "captions",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "burn-subtitles",
    name: "Burn subtitles into video",
    tagline: "Draw an SRT, VTT or ASS file, or the video's own track, into the picture.",
    description:
      "Burn subtitles into a video entirely in your browser: an SRT, WebVTT or ASS file, or a subtitle track the video already carries, drawn into every frame so they show in any player. Nothing is uploaded.",
    category: "subtitles",
    icon: "burn",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "compress-audio",
    name: "Compress audio",
    tagline: "Shrink a recording: Opus for speech, AAC or MP3 for music, or under a size.",
    description:
      "Compress an audio file or a video's soundtrack entirely in your browser: Opus for speech at a tenth of the size, AAC or MP3 for music, or a bitrate worked out to land under a size you choose. Nothing is uploaded.",
    category: "audio",
    icon: "compress",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "audio-channels",
    name: "Split audio channels",
    tagline: "Mono, left or right only, sides swapped, or the vocals cut from a song.",
    description:
      "Take a recording apart by channel entirely in your browser: mix to mono, keep the left or the right side, swap them, make mono play on both sides, or cancel the centre of a stereo mix to remove vocals. Nothing is uploaded.",
    category: "audio",
    icon: "channels",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "audio-waveform",
    name: "Audio waveform image",
    tagline: "A waveform PNG on a transparent background, or a spectrogram.",
    description:
      "Draw the waveform of an audio file or a video's soundtrack as a PNG on a transparent background, or a spectrogram of frequency against time, entirely in your browser. Nothing is uploaded.",
    category: "audio",
    icon: "waveform",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "add-chapters",
    name: "Add chapter markers",
    tagline: "Type a list of times and titles and write them into a podcast or video.",
    description:
      "Add chapter markers to an audio or video file entirely in your browser: type the times and titles, and they are written into the MP4, M4A, MKV or MP3 with every stream copied untouched. Nothing is uploaded.",
    category: "audio",
    icon: "chapters",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "merge-subtitles",
    name: "Merge subtitles (dual language)",
    tagline: "Two languages in one subtitle file, stacked or folded into one cue.",
    description:
      "Merge two subtitle files into one bilingual file entirely in your browser: the second language at the top of the picture, or both languages in one cue for players that show a single line. Nothing is uploaded.",
    category: "subtitles",
    icon: "bilingual",
    accepts: "Subtitle files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "split-chapters",
    name: "Split by chapters",
    tagline: "Cut a podcast, audiobook or video into one file per chapter, without re-encoding.",
    description:
      "Split an audio or video file at its chapter markers entirely in your browser: one file per chapter, named after it, with every stream copied untouched. Nothing is uploaded.",
    category: "audio",
    icon: "split",
    accepts: "Audio and video files with chapters",
    status: "live",
  },
  {
    slug: "extract-audio-tracks",
    name: "Extract every audio track",
    tagline: "Pull each language, commentary or music track out of a video as its own file.",
    description:
      "Extract every audio track from an MKV, MP4 or MOV entirely in your browser: each language or commentary track comes out as its own file, copied without re-encoding and named by its language. Nothing is uploaded.",
    category: "audio",
    icon: "tracks",
    accepts: "Video and audio files",
    status: "live",
  },
  {
    slug: "add-audio",
    name: "Add audio to video",
    tagline: "Put music or a voiceover under a video, in place of its sound or mixed with it.",
    description:
      "Add an audio file to a video entirely in your browser: music, a voiceover or a new soundtrack, in place of the original sound or mixed under it, padded, cut or looped to the picture. The picture is copied untouched. Nothing is uploaded.",
    category: "video",
    icon: "addaudio",
    accepts: "Video files, plus an audio file",
    status: "live",
  },
  {
    slug: "sync-audio",
    name: "Fix audio sync",
    tagline: "Move a video's sound earlier or later to line it up with the picture.",
    description:
      "Fix a video whose sound runs ahead of or behind the picture entirely in your browser: shift the audio by any number of milliseconds with every stream copied, so it takes seconds however long the film. Nothing is uploaded.",
    category: "video",
    icon: "sync",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "loop-video",
    name: "Loop video",
    tagline: "Repeat a clip a number of times, or run it out to an hour, without re-encoding.",
    description:
      "Loop a video or an audio file entirely in your browser: play it two, three or ten times over, or repeat a short clip until it is a minute, ten minutes or an hour long, with every stream copied. Nothing is uploaded.",
    category: "video",
    icon: "loop",
    accepts: "Video and audio files",
    status: "live",
  },
  {
    slug: "gif-to-video",
    name: "GIF to MP4",
    tagline: "Turn an animated GIF into an MP4 or WebM that plays anywhere and weighs a fraction.",
    description:
      "Convert an animated GIF to an MP4 or a WebM entirely in your browser, at a fraction of the size, with the animation played once or several times over. Nothing is uploaded.",
    category: "video",
    icon: "film",
    accepts: "GIF files",
    status: "live",
  },
  {
    slug: "split-video",
    name: "Split video into parts",
    tagline: "Cut a long video every ten minutes, or into four equal parts, without re-encoding.",
    description:
      "Split a video into equal parts entirely in your browser: every minute, five, ten or thirty, or into two, three or ten pieces of the same length, each cut by stream copy so a long recording comes apart in seconds. Nothing is uploaded.",
    category: "video",
    icon: "parts",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "trim-audio",
    name: "Trim audio",
    tagline: "Cut a range out of an MP3, WAV, M4A or any audio file, without re-encoding.",
    description:
      "Trim an audio file entirely in your browser: set the start and the end on the waveform and cut, in the file's own format without re-encoding, or as MP3, M4A, WAV, FLAC or Opus. Nothing is uploaded.",
    category: "audio",
    icon: "cut",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "change-volume",
    name: "Change volume",
    tagline: "Make a recording louder or quieter, or as loud as it can go without clipping.",
    description:
      "Turn an audio file or a video's sound up or down by any number of decibels entirely in your browser, or lift it as loud as it can go without clipping. Audio comes back in its own format; a video keeps its picture copied. Nothing is uploaded.",
    category: "audio",
    icon: "volume",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "change-audio-speed",
    name: "Change audio speed",
    tagline: "Play a lecture at 1.5x or slow an interview to half, with the pitch kept.",
    description:
      "Speed up or slow down an audio file entirely in your browser, from half speed to three times, with the pitch kept so voices still sound like themselves. Written back in the file's own format. Nothing is uploaded.",
    category: "audio",
    icon: "tempo",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "add-fade",
    name: "Fade in and out",
    tagline: "A gentle start and finish for a recording, or a video's sound and picture.",
    description:
      "Add a fade in and a fade out to an audio file, or to a video's sound and picture, entirely in your browser: half a second to ten, at either end or both. Nothing is uploaded.",
    category: "audio",
    icon: "fade",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "split-audio",
    name: "Split audio into parts",
    tagline: "Cut a long recording every ten minutes, or into equal parts, without re-encoding.",
    description:
      "Split an audio file into equal parts entirely in your browser: every minute, five, ten or thirty, or into two, three or ten pieces of the same length, each copied without re-encoding. Nothing is uploaded.",
    category: "audio",
    icon: "parts",
    accepts: "Audio files",
    status: "live",
  },
  {
    slug: "edit-tags",
    name: "Edit audio tags",
    tagline: "Title, artist, album, year, genre, track and a cover picture, written without re-encoding.",
    description:
      "Edit the tags of an MP3, M4A, FLAC or Ogg file entirely in your browser: title, artist, album, year, genre, track number and comment, plus a cover picture, all written with the audio copied untouched. Nothing is uploaded.",
    category: "audio",
    icon: "tags",
    accepts: "Audio and video files",
    status: "live",
  },
  {
    slug: "audio-to-video",
    name: "Audio to video",
    tagline: "Turn an MP3 into an MP4 for YouTube: a colour, a picture or a waveform under it.",
    description:
      "Turn an audio file into a video entirely in your browser, for the sites that only take video: the sound under a plain colour, a picture you choose or a moving waveform, as an MP4 that YouTube and every feed accept. Nothing is uploaded.",
    category: "audio",
    icon: "clapper",
    accepts: "Audio files, plus an optional image",
    status: "live",
  },
  {
    slug: "add-subtitles",
    name: "Add subtitles to video",
    tagline: "Put an SRT or VTT file into an MP4 or MKV as a track that can be switched on and off.",
    description:
      "Add a subtitle file to a video as a track of its own entirely in your browser: an SRT, WebVTT or ASS file written into the MP4, MOV, MKV or WebM with the picture and sound copied untouched, tagged with its language, switchable in any player. Nothing is uploaded.",
    category: "subtitles",
    icon: "softsubs",
    accepts: "Video files, plus a subtitle file",
    status: "live",
  },
  {
    slug: "convert-image",
    name: "Convert image",
    tagline: "HEIC, AVIF, PNG, WebP or anything else to JPEG, PNG or WebP, in bulk.",
    description:
      "Convert pictures between JPEG, PNG and WebP entirely in your browser, from any format it can open, including HEIC and AVIF where it can, at a quality you choose. Metadata is left behind. Nothing is uploaded.",
    category: "images",
    icon: "picture",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "compress-image",
    name: "Compress image",
    tagline: "Shrink a photo to under 200 KB, 500 KB, 1 MB or any size you choose.",
    description:
      "Compress a picture to a size you choose - 200 KB, 500 KB, 1 MB or your own number - entirely in your browser, by finding the highest quality that fits and scaling the picture down only when it has to. Nothing is uploaded.",
    category: "images",
    icon: "shrinkpicture",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "resize-image",
    name: "Resize image",
    tagline: "Scale pictures down to a longest side or a fraction, never enlarged, in bulk.",
    description:
      "Resize pictures entirely in your browser: to a longest side of 1920, 1280, 1024 or 800 pixels, to half or a quarter, or to a number you type, never enlarged, in the format they came in. Nothing is uploaded.",
    category: "images",
    icon: "resize",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "remove-image-metadata",
    name: "Remove image metadata (EXIF)",
    tagline: "See what a photo says about where and how it was taken, and strip it losslessly.",
    description:
      "See the EXIF metadata a photo carries - camera, date, location, serial number - and remove it entirely in your browser, without re-encoding the picture, from JPEG, PNG and WebP files. Nothing is uploaded.",
    category: "images",
    icon: "hidden",
    accepts: "JPEG, PNG and WebP files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "images-to-pdf",
    name: "Images to PDF",
    tagline: "Photos and scans into one PDF, a page each, in the order you choose.",
    description:
      "Turn pictures into one PDF entirely in your browser: a page per picture, on A4, Letter or a page the picture's own size, in the order you put them. JPEGs and PNGs go in as they are. Nothing is uploaded.",
    category: "documents",
    icon: "imagepdf",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "merge-pdf",
    name: "Merge PDFs",
    tagline: "Join several PDFs into one, in the order you choose.",
    description:
      "Merge PDF files into one entirely in your browser: put them in order, press the button, and every page of each comes out in one document with nothing re-drawn. Nothing is uploaded.",
    category: "documents",
    icon: "merge",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    tagline: "Every page as its own PDF, every N pages, or the ranges you type.",
    description:
      "Split a PDF entirely in your browser: into one file per page, into pieces of a set number of pages, or into the page ranges you type, the way a print dialog takes them. Nothing is uploaded.",
    category: "documents",
    icon: "split",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "rotate-pdf",
    name: "Rotate PDF pages",
    tagline: "Turn every page, or just the ones you name, a quarter or half turn.",
    description:
      "Rotate the pages of a PDF entirely in your browser: all of them or the ones you name, by 90 degrees either way or 180, with nothing re-drawn. Nothing is uploaded.",
    category: "documents",
    icon: "rotate",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "delete-pdf-pages",
    name: "Delete PDF pages",
    tagline: "Take pages out of a PDF by number or range.",
    description:
      "Delete pages from a PDF entirely in your browser: type the pages or ranges to remove, the way a print dialog takes them, and get the document back without them. Nothing is uploaded.",
    category: "documents",
    icon: "deletepages",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "add-page-numbers",
    name: "Add page numbers to PDF",
    tagline: "Number every page, at the bottom or the top, plain or as N of M.",
    description:
      "Add page numbers to a PDF entirely in your browser: at the bottom or the top, centred or to one side, as a plain number or as N of M, starting from any number. Nothing is uploaded.",
    category: "documents",
    icon: "numbers",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "checksum",
    name: "File checksum",
    tagline: "SHA-256, SHA-1, MD5 or CRC-32 of any file, however large, and a check against one.",
    description:
      "Compute the SHA-256, SHA-1, MD5 or CRC-32 checksum of a file of any size entirely in your browser, streamed from disk with the memory flat, and compare it with the one a download page printed. Nothing is uploaded.",
    category: "files",
    icon: "checksum",
    accepts: "Any file",
    status: "live",
    engine: "browser",
  },
  {
    slug: "create-zip",
    name: "Create ZIP",
    tagline: "Pack files into one ZIP archive, compressed where that helps.",
    description:
      "Put files into a ZIP archive entirely in your browser: each is read in pieces and compressed as it goes, with formats that are already compressed stored as they are. Nothing is uploaded.",
    category: "files",
    icon: "archive",
    accepts: "Any files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "extract-zip",
    name: "Extract ZIP",
    tagline: "Open a ZIP archive and save any of the files inside, or all of them.",
    description:
      "Unpack a ZIP archive entirely in your browser: every file inside listed with its size, each one a click away, or all of them at once. Nothing is uploaded, and nothing is installed.",
    category: "files",
    icon: "unarchive",
    accepts: "ZIP files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "merge-audio",
    name: "Merge audio files",
    tagline: "Join MP3s or any recordings into one file, without re-encoding when they match.",
    description:
      "Join several audio files into one entirely in your browser: copied without re-encoding when they share a format, otherwise decoded and joined into the first file's format. Nothing is uploaded.",
    category: "audio",
    icon: "merge",
    accepts: "Audio files",
    status: "live",
  },
  {
    slug: "add-watermark",
    name: "Add watermark to video",
    tagline: "A logo in a corner or a line of text over every frame, at the size and opacity you choose.",
    description:
      "Add a watermark to a video entirely in your browser: a logo or picture in a corner, or a line of text, at a size, opacity and position you choose, drawn over every frame in one encode. Nothing is uploaded.",
    category: "video",
    icon: "stamp",
    accepts: "Video files, plus a picture",
    status: "live",
  },
  {
    slug: "extract-frames",
    name: "Extract frames from video",
    tagline: "A picture every second, every ten seconds or every minute, as JPEG or PNG.",
    description:
      "Extract frames from a video entirely in your browser: one picture every second, every few seconds or every minute, each as a JPEG or a lossless PNG named by its moment. Nothing is uploaded, however large the file.",
    category: "video",
    icon: "frames",
    accepts: "Video files",
    status: "live",
  },
  {
    slug: "crop-image",
    name: "Crop image",
    tagline: "Square, 4:5, 16:9, 9:16 and the rest, centred, in bulk.",
    description:
      "Crop pictures to a shape entirely in your browser: square for a profile, 4:5 and 9:16 for a feed or a story, 16:9 for a thumbnail, 3:2 and 4:3 for a print, centred on the picture, as many at once as you like. Nothing is uploaded.",
    category: "images",
    icon: "crop",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "watermark-image",
    name: "Watermark images",
    tagline: "A logo or a line of text on every photo, in the corner you choose, in bulk.",
    description:
      "Put a watermark on pictures entirely in your browser: a logo or a line of text in a corner or the centre, at the size and opacity you choose, on as many photos at once as you like. Nothing is uploaded.",
    category: "images",
    icon: "stamp",
    accepts: "Image files, plus a logo",
    status: "live",
    engine: "browser",
  },
  {
    slug: "favicon",
    name: "Favicon generator",
    tagline: "A favicon.ico and every icon size a site needs, from one picture.",
    description:
      "Make a favicon.ico with 16, 32 and 48 pixel entries, an Apple touch icon and the 192 and 512 pixel icons a web app manifest wants, from any picture, entirely in your browser, with the lines to paste into your page. Nothing is uploaded.",
    category: "images",
    icon: "favicon",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "image-to-base64",
    name: "Image to Base64",
    tagline: "A picture as a data URI, with the HTML and CSS to paste it into.",
    description:
      "Turn a picture into a Base64 data URI entirely in your browser, with the img tag and the CSS rule ready to copy, for an icon or a small graphic that has to live inside a page or a stylesheet. Nothing is uploaded.",
    category: "images",
    icon: "code",
    accepts: "Image files up to 10 MB",
    status: "live",
    engine: "browser",
  },
  {
    slug: "pdf-to-images",
    name: "PDF to images",
    tagline: "Every page as a JPEG or PNG, at screen or print resolution.",
    description:
      "Turn the pages of a PDF into pictures entirely in your browser: each page as a JPEG or a PNG at 72, 150 or 300 dpi, drawn by the same engine Firefox reads PDFs with. Nothing is uploaded.",
    category: "documents",
    icon: "frames",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    tagline: "Shrink a scanned or picture-heavy PDF by redrawing its pages at a lower resolution.",
    description:
      "Compress a PDF entirely in your browser by redrawing every page as a JPEG at screen, e-book or print resolution: a scan or a photo-heavy document shrinks several times over. Text becomes a picture of text, and the page says so. Nothing is uploaded.",
    category: "documents",
    icon: "compress",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "pdf-to-text",
    name: "PDF to text",
    tagline: "The text of a PDF as a plain text file, page by page.",
    description:
      "Pull the text out of a PDF as a plain text file entirely in your browser, page by page, in reading order as far as the document allows. A scan with no text in it says so. Nothing is uploaded.",
    category: "documents",
    icon: "text",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "watermark-pdf",
    name: "Watermark PDF",
    tagline: "CONFIDENTIAL, DRAFT or your own words across every page.",
    description:
      "Stamp a word or a line across every page of a PDF entirely in your browser: diagonally across the page, in the middle or at the foot, as faint or as bold as you like. Nothing is uploaded.",
    category: "documents",
    icon: "stamp",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "pdf-metadata",
    name: "Remove PDF metadata",
    tagline: "See who made a PDF and when, and strip it, or set a title and author of your own.",
    description:
      "See the metadata a PDF carries - title, author, the software that made it, when - and remove all of it, or set the title, author, subject and keywords you want, entirely in your browser with every page untouched. Nothing is uploaded.",
    category: "documents",
    icon: "erase",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "find-duplicates",
    name: "Find duplicate files",
    tagline: "Drop a folder's worth of files and see which are the same file twice.",
    description:
      "Find duplicate files entirely in your browser: drop any number of files and the ones that are byte-for-byte the same are grouped, with how much space the extra copies take. Only files that share a size are hashed. Nothing is uploaded.",
    category: "files",
    icon: "copies",
    accepts: "Any files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "extract-pdf-pages",
    name: "Extract PDF pages",
    tagline: "The pages you name, in the order you name them, as a new PDF.",
    description:
      "Extract pages from a PDF entirely in your browser: type the pages or ranges the way a print dialog takes them, and get a new document of just those pages, in that order, with nothing re-drawn. Nothing is uploaded.",
    category: "documents",
    icon: "pages",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "reorder-pdf-pages",
    name: "Reorder PDF pages",
    tagline: "Reverse a PDF, or put its pages in the order you type.",
    description:
      "Reorder the pages of a PDF entirely in your browser: reverse them, for a scan that went through backwards, or type the order you want, with the pages you do not name following in their own. Nothing is re-drawn, and nothing is uploaded.",
    category: "documents",
    icon: "reorder",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "flatten-pdf",
    name: "Flatten PDF",
    tagline: "Bake a filled form's fields into the pages, and take annotations off.",
    description:
      "Flatten a PDF form entirely in your browser: what was typed and ticked is drawn into the pages so it shows the same everywhere and cannot be edited, and comments, highlights, stamps and links can be removed too. Nothing is uploaded.",
    category: "documents",
    icon: "flatten",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "pdf-booklet",
    name: "PDF booklet and pages per sheet",
    tagline: "Two or four pages on each sheet, or a booklet that folds in half.",
    description:
      "Lay a PDF's pages onto sheets entirely in your browser: two or four to a sheet to save paper, or paired in booklet order so double-sided sheets fold in half into a book with the pages in sequence. Nothing is uploaded.",
    category: "documents",
    icon: "booklet",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "convert-csv",
    name: "Convert CSV",
    tagline: "CSV or TSV to JSON, JSON Lines, tabs or the other delimiter, any size.",
    description:
      "Convert a CSV or TSV file to JSON, JSON Lines, tab-separated or CSV with another delimiter entirely in your browser: read in pieces, so a multi-gigabyte export works, with quoted fields handled and the delimiter and encoding worked out for you. Nothing is uploaded.",
    category: "data",
    icon: "table",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "json-to-csv",
    name: "JSON to CSV",
    tagline: "A JSON array, an API response or JSON Lines as a spreadsheet-ready CSV.",
    description:
      "Turn JSON into CSV or TSV entirely in your browser: an array of objects, an API response with a list inside it, or JSON Lines, with a column for every field and nested objects flattened into dotted names, ready to open in a spreadsheet. Nothing is uploaded.",
    category: "data",
    icon: "spreadsheet",
    accepts: "JSON and JSON Lines files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "format-json",
    name: "Format JSON",
    tagline: "Indent a JSON file for reading, minify it, sort its keys, or find where it broke.",
    description:
      "Format a JSON file entirely in your browser: indented by two spaces, four or a tab for reading, or minified to one line, with the keys sorted if you like, and a file that does not parse told where it broke by line and column. Nothing is uploaded.",
    category: "data",
    icon: "braces",
    accepts: "JSON files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "clean-notebook",
    name: "Clean Jupyter notebook",
    tagline: "Strip outputs, execution counts and scratch metadata from an .ipynb.",
    description:
      "Clean a Jupyter notebook entirely in your browser: outputs emptied, execution counts reset and the metadata front ends write for themselves dropped, leaving the code and text, a fraction of the size, ready to commit. Nothing is uploaded.",
    category: "data",
    icon: "notebook",
    accepts: "Jupyter notebook files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "convert-text-file",
    name: "Convert text encoding and line endings",
    tagline: "See a text file's encoding and line endings, and rewrite them.",
    description:
      "See what encoding and line endings a text file has and convert them entirely in your browser: to UTF-8 with or without a byte-order mark or to UTF-16, with LF or CRLF line endings, trailing spaces stripped and a final newline added if you like. Nothing is uploaded.",
    category: "files",
    icon: "textfile",
    accepts: "Text files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "encrypt-file",
    name: "Encrypt or decrypt a file",
    tagline: "Seal a file of any size with a passphrase, and open it again here.",
    description:
      "Encrypt a file with a passphrase entirely in your browser, with AES-256-GCM and a key derived by PBKDF2 from the browser's own Web Crypto, block by block so any size works and any change is caught; drop the result back with the passphrase to decrypt it. Nothing is uploaded.",
    category: "files",
    icon: "lock",
    accepts: "Any file",
    status: "live",
    engine: "browser",
  },
  {
    slug: "compare-files",
    name: "Compare two files",
    tagline: "A unified diff of two versions of a text file, or where two binaries differ.",
    description:
      "Compare two files entirely in your browser: a unified diff of the lines that changed between two versions of a text file, in the form patch and every code host read, or for binary files whether they match and where they first differ. Nothing is uploaded.",
    category: "files",
    icon: "diff",
    accepts: "Two files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "merge-images",
    name: "Merge images",
    tagline: "Pictures side by side, stacked, or in a grid, as one picture.",
    description:
      "Merge pictures into one entirely in your browser: side by side at the same height, one above another at the same width, or in a grid, with a gap and a background you choose, as JPEG, PNG or WebP. Nothing is uploaded.",
    category: "images",
    icon: "collage",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "extract-colours",
    name: "Extract colours from an image",
    tagline: "The colours a picture is made of, as swatches and hex codes.",
    description:
      "Extract the colour palette of a picture entirely in your browser: its five, eight or twelve main colours by share, as a strip of labelled swatches and as hex codes with CSS variables ready to paste. Nothing is uploaded.",
    category: "images",
    icon: "palette",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "rotate-image",
    name: "Rotate or flip image",
    tagline: "A quarter turn either way, upside down, mirrored or flipped, in bulk.",
    description:
      "Rotate pictures a quarter turn either way or a half, or mirror or flip them, entirely in your browser, as many at once as you like, in the format they came in. A photo that only looked upright by its orientation tag is written upright for good. Nothing is uploaded.",
    category: "images",
    icon: "turn",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "pad-image",
    name: "Fit image to a shape without cropping",
    tagline: "Square, 4:5 or 16:9 with the whole picture kept: bars, or a blurred background.",
    description:
      "Fit pictures to a shape without cropping entirely in your browser: square, 4:5, 16:9 or 9:16 with the whole picture in the middle and the rest white, black, transparent or a blurred blow-up of the picture itself, the way feeds show a photo of the wrong shape. Nothing is uploaded.",
    category: "images",
    icon: "frame",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "adjust-image",
    name: "Black and white, sepia and adjustments",
    tagline: "Grayscale, sepia, negative, lighter, darker, more or less contrast, in bulk.",
    description:
      "Make pictures black and white, sepia or negative, or a fifth lighter or darker, or give them more or less contrast, entirely in your browser, as many at once as you like, in the format they came in. Nothing is uploaded.",
    category: "images",
    icon: "contrast",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "svg-to-png",
    name: "SVG to PNG",
    tagline: "An SVG drawn as a PNG, JPEG or WebP at any width, on any background.",
    description:
      "Convert an SVG to a PNG, JPEG or WebP entirely in your browser, drawn at the width you choose on a transparent, white or black background by the browser's own renderer, the one that draws it on a page. Nothing is uploaded.",
    category: "images",
    icon: "shapes",
    accepts: "SVG files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "resize-pdf-pages",
    name: "Resize PDF pages",
    tagline: "Every page on A4, Letter, A5 or A3, scaled to fit and centred.",
    description:
      "Resize a PDF's pages entirely in your browser: every page drawn onto A4, Letter, A5, A3, Legal or Tabloid paper, scaled to fit and centred, so a document of odd or mixed page sizes prints as one. Nothing is uploaded.",
    category: "documents",
    icon: "proportions",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF margins",
    tagline: "White margins trimmed to the content, or millimetres off each edge.",
    description:
      "Crop the margins of a PDF entirely in your browser: each page trimmed to its own content, for reading a paper on a phone or an e-reader, or the millimetres you type taken off each edge of every page. Nothing is redrawn, and nothing is uploaded.",
    category: "documents",
    icon: "crop",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "extract-pdf-images",
    name: "Extract images from PDF",
    tagline: "Every picture placed in a PDF, as a PNG or JPEG of its own, page by page.",
    description:
      "Extract the images from a PDF entirely in your browser: every picture placed in it comes out as a PNG or JPEG of its own at the size it was stored, page by page, from a report's photos to a paper's figures. Nothing is uploaded.",
    category: "documents",
    icon: "pictures",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "csv-to-excel",
    name: "CSV to Excel",
    tagline: "A CSV or TSV as an .xlsx that opens as a proper table, accents and zeros intact.",
    description:
      "Convert a CSV or TSV to an Excel workbook entirely in your browser: an .xlsx that Excel, Numbers and Google Sheets open as a table without a wizard, with the delimiter and encoding worked out, numbers as numbers and leading zeros kept. Nothing is uploaded.",
    category: "data",
    icon: "sheet",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "excel-to-csv",
    name: "Excel to CSV",
    tagline: "Every sheet of an .xlsx as a CSV, with dates as dates.",
    description:
      "Convert an Excel workbook to CSV entirely in your browser: every sheet as a file of its own, with dates written as dates rather than the serial numbers Excel keeps underneath, ready for anything that reads plain text. Nothing is uploaded.",
    category: "data",
    icon: "grid",
    accepts: "Excel .xlsx files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "profile-csv",
    name: "Profile a CSV",
    tagline: "Every column's type, empties, range, distinct values and commonest values.",
    description:
      "Profile a CSV entirely in your browser before trusting it: every column's type, how many cells are empty, the range of the numbers, how many distinct values there are and which come up most, in one pass over a file of any size. Nothing is uploaded.",
    category: "data",
    icon: "chart",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "clean-csv",
    name: "Clean a CSV",
    tagline: "Trim cells, remove duplicate rows, drop empty rows and columns.",
    description:
      "Clean a CSV entirely in your browser: cells trimmed of stray spaces, duplicate rows removed, empty rows and empty columns dropped and every row made the same width, written back with the delimiter it came with. Nothing is uploaded.",
    category: "data",
    icon: "sparkles",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "identify-file",
    name: "Identify a file",
    tagline: "What a file really is, from its first bytes rather than its name.",
    description:
      "Identify a file entirely in your browser from its first bytes rather than its name - a hundred signatures for pictures, video, audio, documents, archives, fonts and programs, and the first lines of a text file - with a hex dump of the start for anything unknown. Nothing is uploaded.",
    category: "files",
    icon: "scansearch",
    accepts: "Any file",
    status: "live",
    engine: "browser",
  },
  {
    slug: "split-file",
    name: "Split a file into pieces",
    tagline: "A large file in numbered pieces of 10 MB, 25 MB, 100 MB or any size.",
    description:
      "Split a file into numbered pieces of a size you choose entirely in your browser, to send one at a time past an email, chat or upload limit and join again at the other end, here or with one command. Nothing is uploaded, and nothing is copied.",
    category: "files",
    icon: "parts",
    accepts: "Any file",
    status: "live",
    engine: "browser",
  },
  {
    slug: "join-files",
    name: "Join file pieces",
    tagline: "The numbered pieces of a split file back together, in order.",
    description:
      "Join the pieces of a split file back into one entirely in your browser: .001, .002, .part1 or .z01 pieces from any splitter, put in order by their numbers whatever order they arrived in, with a missing or repeated piece pointed out. Nothing is uploaded.",
    category: "files",
    icon: "combine",
    accepts: "The pieces of one file",
    status: "live",
    engine: "browser",
  },
  {
    slug: "extract-tar",
    name: "Extract TAR and GZ",
    tagline: "Every file inside a .tar, .tar.gz, .tgz or .gz, a click away.",
    description:
      "Unpack a .tar, a .tar.gz, a .tgz or a plain .gz entirely in your browser: every file inside listed and a click away, or all of them at once as a ZIP, the archive read and inflated a piece at a time so its size is no object. Nothing is uploaded, and nothing is installed.",
    category: "files",
    icon: "package",
    accepts: "TAR and gzip files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "round-image",
    name: "Round image corners",
    tagline: "Rounded corners or a circle, with a border, see-through around the edge, in bulk.",
    description:
      "Round the corners of pictures, or cut them to a circle for a profile picture, entirely in your browser, with a border in a colour you choose and the corners see-through in PNG or WebP, as many at once as you like. Nothing is uploaded.",
    category: "images",
    icon: "squircle",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "split-image",
    name: "Split image into tiles",
    tagline: "Nine squares for a profile grid, three across for a carousel, or any grid, numbered.",
    description:
      "Split a picture into tiles entirely in your browser: nine squares for a profile grid, three across for a carousel, halves, quarters or any grid up to ten by ten, numbered so they post or print in order, in the picture's own format. Nothing is uploaded.",
    category: "images",
    icon: "tiles",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "compare-images",
    name: "Compare two images",
    tagline: "Where two screenshots or two versions of a picture differ, pixel by pixel, in red.",
    description:
      "Compare two pictures entirely in your browser: every pixel that differs painted red over a faded copy of the first, with a count and the box the changes fall in, and a tolerance that ignores JPEG grain. Two screenshots, a design and its render, a photo before and after. Nothing is uploaded.",
    category: "images",
    icon: "compare",
    accepts: "Two image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "make-transparent",
    name: "Make a colour transparent",
    tagline: "A logo's white background, or any flat colour, made see-through as a PNG.",
    description:
      "Make one colour of a picture transparent entirely in your browser: a logo's white background, a scan's paper, a sticker's flat colour, keyed out to a PNG or WebP with a tolerance you choose, from the edges in or everywhere. Nothing is uploaded.",
    category: "images",
    icon: "bucket",
    accepts: "Image files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "remove-blank-pages",
    name: "Remove blank pages from PDF",
    tagline: "The empty pages a scanner adds, found by measuring their ink and taken out.",
    description:
      "Remove the blank pages from a scanned PDF entirely in your browser: every page is drawn and its ink measured, so the backs of single-sided sheets and the separator pages go, at a sensitivity you choose, and the card names the pages removed. Nothing is uploaded.",
    category: "documents",
    icon: "blankpages",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "collate-scans",
    name: "Collate double-sided scans",
    tagline: "The fronts and the backs from a single-sided scanner, interleaved into one PDF.",
    description:
      "Collate two scans of a double-sided stack into one PDF entirely in your browser: the fronts from one pass and the backs from the other, which come out last page first, interleaved into reading order. Nothing is uploaded.",
    category: "documents",
    icon: "collate",
    accepts: "Two PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "split-pdf-by-size",
    name: "Split PDF by size",
    tagline: "A PDF too large to attach, cut into PDFs that each fit under 10 MB, 25 MB or any limit.",
    description:
      "Split a PDF into pieces that each fit under a size entirely in your browser - 5 MB, 10 MB, 25 MB or a number you type - each a run of whole pages in order and a document that opens on its own, for the attachment limits of email and forms. Nothing is uploaded.",
    category: "documents",
    icon: "filestack",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "add-image-to-pdf",
    name: "Add an image to PDF pages",
    tagline: "A logo, a signature or a stamp on every page, the first, the last or the ones you name.",
    description:
      "Add a picture to a PDF's pages entirely in your browser: a logo, a scanned signature or a stamp placed at a corner or the centre of every page, the first, the last or the pages you name, at a size and opacity you choose, drawn into the page so it prints anywhere. Nothing is uploaded.",
    category: "documents",
    icon: "imageplus",
    accepts: "PDF files, plus a picture",
    status: "live",
    engine: "browser",
  },
  {
    slug: "compare-pdfs",
    name: "Compare two PDFs",
    tagline: "The lines of text that changed between two versions of a PDF, page by page.",
    description:
      "Compare two PDFs entirely in your browser: the text is read off every page of each and the lines that changed come out as a unified diff with a page marker at each change, for a contract before and after a redline or a paper and its revision. Nothing is uploaded.",
    category: "documents",
    icon: "difftext",
    accepts: "Two PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "add-pdf-bookmarks",
    name: "Add bookmarks to PDF",
    tagline: "A typed table of contents written into a PDF's side panel, nested if you like.",
    description:
      "Add bookmarks to a PDF entirely in your browser: type a table of contents as a page number and a title per line, indented to nest, and it is written into the document's outline, the list a viewer shows in its side panel and opens on. Nothing is uploaded.",
    category: "documents",
    icon: "bookmark",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "merge-csv",
    name: "Merge CSV files",
    tagline: "Several CSVs stacked into one, columns matched by name, the source file noted.",
    description:
      "Merge CSV files into one entirely in your browser: rows stacked in the order you put the files, headers matched by name so files whose columns differ in order still line up, a column a later file adds appended, and the file each row came from noted if you like. Nothing is uploaded.",
    category: "data",
    icon: "rows",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "split-csv",
    name: "Split CSV into files",
    tagline: "A large CSV in numbered files of 1,000, 10,000 or any number of rows, header on each.",
    description:
      "Split a CSV into files of so many rows entirely in your browser - 1,000, 10,000, 100,000 or a number you type - each with the header at the top so it opens and imports on its own, never cut inside a quoted cell. Nothing is uploaded.",
    category: "data",
    icon: "rowsplit",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "sort-csv",
    name: "Sort a CSV",
    tagline: "Rows in order by a column, as numbers or as text, header kept, empties last.",
    description:
      "Sort a CSV by a column entirely in your browser: name the column or its number and the rows come back in order, as numbers when they are numbers and as text otherwise, ascending or descending, the header kept at the top and empty cells last, for a file larger than a spreadsheet wants to open. Nothing is uploaded.",
    category: "data",
    icon: "sortaz",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "csv-to-markdown",
    name: "CSV to Markdown table",
    tagline: "A table for a README, an issue or a wiki, padded and aligned, or as HTML.",
    description:
      "Convert a CSV to a Markdown table entirely in your browser, ready to paste into a README, an issue, a pull request or a wiki, with the columns padded so it reads as a table in the source too and numbers aligned right, or to a plain HTML table for a page. Nothing is uploaded.",
    category: "data",
    icon: "tableprops",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "csv-to-sql",
    name: "CSV to SQL",
    tagline: "CREATE TABLE with types worked out, and INSERTs, for PostgreSQL, MySQL or SQLite.",
    description:
      "Convert a CSV to SQL entirely in your browser: a CREATE TABLE with a type worked out for every column and INSERT statements for the rows, names quoted and text escaped the way PostgreSQL, MySQL, SQLite or standard SQL want, ready to run. Nothing is uploaded.",
    category: "data",
    icon: "database",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "excel-to-json",
    name: "Excel to JSON",
    tagline: "Every sheet of an .xlsx as JSON records keyed by the header, or as JSON Lines.",
    description:
      "Convert an Excel workbook to JSON entirely in your browser: every sheet as an array of objects keyed by its header row, numbers as numbers and dates as dates, or as one object per line for tools that stream. Nothing is uploaded.",
    category: "data",
    icon: "braces",
    accepts: "Excel .xlsx files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "json-to-excel",
    name: "JSON to Excel",
    tagline: "A JSON array, an API response or JSON Lines as an .xlsx that opens as a table.",
    description:
      "Convert JSON to an Excel workbook entirely in your browser: an array of objects, an API response with a list inside it, or JSON Lines, as an .xlsx with a column for every field, nested objects flattened into dotted names and numbers as numbers, that opens as a table without a wizard. Nothing is uploaded.",
    category: "data",
    icon: "sheet",
    accepts: "JSON and JSON Lines files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "subtitles-to-text",
    name: "Subtitles to transcript",
    tagline: "The words of an SRT, VTT or ASS file as paragraphs, lines, timestamped notes or CSV.",
    description:
      "Turn a subtitle file into a transcript entirely in your browser: the words of an SRT, WebVTT or ASS file run into paragraphs where the speech pauses, one cue per line, with a timestamp before each cue for quoting, or as a CSV of start, end and text. Nothing is uploaded.",
    category: "data",
    icon: "textquote",
    accepts: "Subtitle files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "sort-lines",
    name: "Sort and dedupe lines",
    tagline: "A text file's lines sorted, reversed, shuffled or by length, with duplicates removed.",
    description:
      "Sort the lines of a text file entirely in your browser - A to Z with numbers in order, reversed, shuffled or by length - with duplicate and blank lines removed if you like, for a word list, a log, a list of names or addresses or URLs. Nothing is uploaded.",
    category: "data",
    icon: "updown",
    accepts: "Text files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "rename-files",
    name: "Rename files in bulk",
    tagline: "Files numbered, dated, found-and-replaced or re-cased by a pattern, back as a ZIP.",
    description:
      "Rename files in bulk entirely in your browser: numbered in order, dated, with a piece of the name found and replaced, in lower, upper or title case, by a pattern you choose, handed back as a ZIP with a list of what became what. Nothing is uploaded.",
    category: "files",
    icon: "folderpen",
    accepts: "Any files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "create-tar",
    name: "Create TAR or TAR.GZ",
    tagline: "Files packed into the .tar.gz a server, a Docker build or a Unix colleague expects.",
    description:
      "Pack files into a .tar.gz or a .tar entirely in your browser, written the way tar writes it, with each file read a piece at a time and gzipped on the way through, for a Linux server, a Docker build, a package or a Unix colleague. Nothing is uploaded.",
    category: "files",
    icon: "packageplus",
    accepts: "Any files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "protect-pdf",
    name: "Password-protect a PDF",
    tagline: "A PDF that asks for a password, encrypted with AES-256, printing and copying optional.",
    description:
      "Password-protect a PDF entirely in your browser: every page, picture and piece of text encrypted with AES-256 under a password you choose, the handler every current reader opens, with printing, copying and editing forbidden if you like. Nothing is uploaded, so the password and the document never leave your device.",
    category: "documents",
    icon: "filelock",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "unlock-pdf",
    name: "Unlock a PDF",
    tagline: "A PDF's password taken off, with the password, or its printing and copying lock lifted.",
    description:
      "Unlock a PDF entirely in your browser: give the password once and get a copy that opens without one, or drop a PDF that opens freely but will not print or copy and get one that does. Every standard encryption is read: RC4, AES-128 and AES-256. Nothing is uploaded.",
    category: "documents",
    icon: "unlock",
    accepts: "PDF files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "pdf-form-data",
    name: "Extract PDF form data",
    tagline: "What was typed into filled PDF forms, one row per form, as a spreadsheet.",
    description:
      "Extract the data from filled PDF forms entirely in your browser: drop one form or fifty and get a CSV and JSON with a row per form and a column per field, check boxes as Yes or No and choices as chosen, XFA forms included. Nothing is uploaded.",
    category: "documents",
    icon: "clipboard",
    accepts: "Filled PDF forms",
    status: "live",
    engine: "browser",
  },
  {
    slug: "epub-to-text",
    name: "EPUB to text",
    tagline: "An e-book's chapters as one text file in reading order, or as Markdown.",
    description:
      "Convert an EPUB to text entirely in your browser: every chapter in the book's own reading order as one plain text file with a blank line between paragraphs, or as Markdown with its headings, lists and emphasis kept, with the word count on the card. Nothing is uploaded.",
    category: "documents",
    icon: "book",
    accepts: "EPUB files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "extract-email",
    name: "Open an .eml e-mail",
    tagline: "A saved e-mail's attachments as files, its text, and its HTML as a page to open.",
    description:
      "Open an .eml file entirely in your browser: the attachments of a message saved from Gmail, Apple Mail, Thunderbird or Outlook as files of their own, its text, and its HTML as a web page with its pictures in place, every encoding and character set decoded. Nothing is uploaded.",
    category: "documents",
    icon: "mailopen",
    accepts: ".eml files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "open-msg",
    name: "Open an Outlook .msg",
    tagline: "An Outlook message read without Outlook: attachments, text, HTML, and an .eml.",
    description:
      "Open an Outlook .msg file entirely in your browser, without Outlook: its sender, recipients and date, its attachments as files, its text and HTML body, and the whole message as an .eml that Apple Mail, Thunderbird and every other mail program opens. Nothing is uploaded.",
    category: "documents",
    icon: "inbox",
    accepts: "Outlook .msg files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "sqlite-to-csv",
    name: "SQLite to CSV",
    tagline: "Every table of a .db or .sqlite file as CSV, JSON or a workbook, no SQL needed.",
    description:
      "Convert a SQLite database to CSV entirely in your browser: every table of an app's .db, .sqlite or .sqlite3 file as a CSV, a JSON file or a sheet of one Excel workbook, read straight from the file format with no database software. Nothing is uploaded.",
    category: "data",
    icon: "databasezap",
    accepts: "SQLite databases",
    status: "live",
    engine: "browser",
  },
  {
    slug: "join-csv",
    name: "Join two CSV files",
    tagline: "Columns from one CSV added to the matching rows of another, like VLOOKUP.",
    description:
      "Join two CSV files entirely in your browser: the rows of one matched to the rows of the other on a column they share, such as an ID or an e-mail, and the second file's columns added alongside, keeping every row of the first, only the matches, or everything. Nothing is uploaded.",
    category: "data",
    icon: "link",
    accepts: "Two CSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "compare-csv",
    name: "Compare two CSV files",
    tagline: "The rows added, removed and changed between two versions of a table.",
    description:
      "Compare two CSV files entirely in your browser: match the rows of two exports on a key column and get a report of every row added, removed or changed, with each changed cell written old -> new, or compare whole rows when there is no key. Nothing is uploaded.",
    category: "data",
    icon: "comparearrows",
    accepts: "Two CSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "pivot-csv",
    name: "Pivot table from CSV",
    tagline: "Rows grouped, counted, summed or averaged, and spread across a column, with totals.",
    description:
      "Make a pivot table from a CSV entirely in your browser: rows grouped by one column and counted, summed, averaged or reduced to their smallest, largest or distinct values, spread across the values of a second column if you like, with row and column totals. Nothing is uploaded.",
    category: "data",
    icon: "sigma",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "anonymize-csv",
    name: "Anonymize a CSV",
    tagline: "Names, e-mails, phones and ID numbers found and replaced before a table is shared.",
    description:
      "Anonymize a CSV entirely in your browser: the columns holding names, e-mail addresses, phone numbers, addresses, IP addresses, card and ID numbers and birth dates found by their headers and their values, then replaced with consistent stand-ins, masked, hashed or removed. Nothing is uploaded.",
    category: "data",
    icon: "mask",
    accepts: "CSV and TSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "format-xml",
    name: "Format XML",
    tagline: "XML indented or minified, or told the line and column where it breaks.",
    description:
      "Format XML entirely in your browser: a config, a feed, a sitemap or an export indented so it can be read, or minified to one line, with the text inside kept exactly as it was, or the line, column and reason given when the file is not well-formed. Nothing is uploaded.",
    category: "data",
    icon: "codexml",
    accepts: "XML files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "xml-to-json",
    name: "XML to JSON",
    tagline: "XML as JSON, or JSON as XML: attributes as @keys, repeats as arrays.",
    description:
      "Convert XML to JSON, or JSON to XML, entirely in your browser: attributes become keys starting with @, text beside them #text, and an element that repeats an array, the convention most converters share, with numbers and true or false typed if you like. Nothing is uploaded.",
    category: "data",
    icon: "brackets",
    accepts: "XML and JSON files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "convert-gps",
    name: "Convert GPX, KML and GeoJSON",
    tagline: "GPS tracks between GPX, KML, GeoJSON, TCX and CSV, with distance and climb.",
    description:
      "Convert GPS files entirely in your browser: GPX from Strava or a watch, KML from Google Earth, GeoJSON from a web map, Garmin's TCX and CSV turned into each other with their tracks, routes, waypoints, heights and times, and the distance, climb and time on the card. Nothing is uploaded.",
    category: "data",
    icon: "route",
    accepts: "GPX, KML, GeoJSON, TCX and CSV files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "trim-gps-track",
    name: "Hide home on a GPS track",
    tagline: "The start and end of a run or ride cut off, so sharing it does not share where you live.",
    description:
      "Trim a GPS track for privacy entirely in your browser: every point within a chosen distance of where a run, ride or walk starts and ends removed, the way Strava's privacy zones work, plus any place you name, with the times and heights dropped too if you like. Nothing is uploaded.",
    category: "data",
    icon: "mappinoff",
    accepts: "GPX, KML, GeoJSON and TCX files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "sanitize-har",
    name: "Sanitize a HAR file",
    tagline: "A browser's network log with the cookies, tokens and passwords taken out.",
    description:
      "Sanitize a HAR file entirely in your browser before sending it to a support desk: the cookies, Authorization headers, session tokens, API keys and passwords recorded in it replaced, with the requests, timings and sizes left for whoever is debugging. Nothing is uploaded, which is the only safe way to do it.",
    category: "files",
    icon: "network",
    accepts: "HAR files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "inspect-certificate",
    name: "Inspect a certificate",
    tagline: "Who a certificate is for, who issued it, the names it covers and when it expires.",
    description:
      "Inspect an SSL/TLS certificate entirely in your browser: the subject and issuer, the names it covers, its validity and days left, its key, its usages and its SHA-256 and SHA-1 fingerprints, from a .pem, .crt, .cer or .der, a whole chain, or a signing request, with the other encoding to download. Nothing is uploaded.",
    category: "files",
    icon: "filebadge",
    accepts: "Certificates and CSRs",
    status: "live",
    engine: "browser",
  },
  {
    slug: "find-secrets",
    name: "Find secrets in files",
    tagline: "API keys, tokens, private keys and passwords left in code, configs and logs.",
    description:
      "Find secrets in files entirely in your browser before sharing or publishing them: AWS, GitHub, Stripe, Google, OpenAI, Slack and more than twenty other providers' keys and tokens, private keys, database URLs with passwords and secrets assigned in code, with the line each is on, in text files or a whole ZIP. Nothing is uploaded.",
    category: "files",
    icon: "keyround",
    accepts: "Text files and ZIPs",
    status: "live",
    engine: "browser",
  },
  {
    slug: "optimize-svg",
    name: "Optimize SVG",
    tagline: "An SVG made smaller and safe for a page: editor data out, numbers rounded, scripts gone.",
    description:
      "Optimize an SVG entirely in your browser: the data Illustrator, Inkscape, Figma and Sketch leave behind taken out, numbers rounded, whitespace removed and unused ids dropped, and scripts, event handlers and javascript: links removed so it is safe to put on a page. Nothing is uploaded.",
    category: "images",
    icon: "pentool",
    accepts: "SVG files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "passport-photo",
    name: "Passport photo sheet",
    tagline: "A photo cut to 35 x 45 mm, 2 x 2 in and more, repeated on a 4 x 6 print to cut out.",
    description:
      "Make passport and visa photos to print entirely in your browser: a portrait cut to 35 x 45 mm, 2 x 2 in, 50 x 70 mm or 33 x 48 mm and repeated across a 4 x 6 in photo print, A4 or Letter at 300 dpi with lines to cut along, plus the single photo for an online application. Nothing is uploaded.",
    category: "images",
    icon: "idcard",
    accepts: "Photos",
    status: "live",
    engine: "browser",
  },
  {
    slug: "markdown-to-html",
    name: "Markdown to HTML",
    tagline: "A README or notes rendered as a clean web page, or as HTML to paste anywhere.",
    description:
      "Convert Markdown to HTML entirely in your browser: headings, lists, GitHub tables, task lists, code blocks and links rendered as a styled page that reads and prints well, with an optional table of contents, or as bare HTML to paste into a CMS. Nothing is uploaded.",
    category: "documents",
    icon: "filecode",
    accepts: "Markdown files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "notebook-to-html",
    name: "Notebook to HTML",
    tagline: "A Jupyter notebook as one web page, charts and tables included, no Jupyter needed.",
    description:
      "Convert a Jupyter notebook to HTML entirely in your browser: Markdown rendered, code in blocks and the saved outputs, tables, charts, printed lines and errors, laid out as one self-contained page anyone can open, with the code optional for a report. Nothing is uploaded.",
    category: "data",
    icon: "notebooktext",
    accepts: "Jupyter notebook files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "yaml-to-json",
    name: "YAML to JSON",
    tagline: "YAML to JSON and JSON to YAML, with the line where broken YAML goes wrong.",
    description:
      "Convert YAML to JSON and JSON to YAML entirely in your browser: Kubernetes manifests, CI workflows and config files read by the YAML 1.2 rules, anchors and merge keys expanded, several documents kept in order, and the line named when the file is broken. Nothing is uploaded.",
    category: "data",
    icon: "listtree",
    accepts: "YAML and JSON files",
    status: "live",
    engine: "browser",
  },
  {
    slug: "decode-jwt",
    name: "Decode a JWT",
    tagline: "What a JSON Web Token carries, when it expires, and whether its signature holds.",
    description:
      "Decode a JSON Web Token entirely in your browser: the header and every claim with dates as dates, whether it has expired, warnings about unsafe tokens, and the signature verified against a secret, a PEM public key, a certificate or a JWK set. Nothing is uploaded.",
    category: "files",
    icon: "ticket",
    accepts: "Pasted tokens",
    status: "live",
    engine: "browser",
  },
  {
    slug: "create-qr-code",
    name: "QR code generator",
    tagline: "QR codes for links, text and Wi-Fi, one or hundreds at once, as PNG or SVG.",
    description:
      "Make QR codes entirely in your browser: a link, any text or a Wi-Fi network phones join by scanning, with the error correction level, colours and quiet zone chosen, saved as a sharp PNG or scalable SVG, or hundreds from a list at once as a ZIP. Nothing is uploaded and the codes never expire.",
    category: "images",
    icon: "qrcode",
    accepts: "Typed text",
    status: "live",
    engine: "browser",
  },
  {
    slug: "read-qr-code",
    name: "Read a QR code",
    tagline: "What a QR code in a screenshot or photo says, before you open it.",
    description:
      "Read QR codes from screenshots and photos entirely in your browser: links shown with their real destination and warnings about disguised ones, Wi-Fi passwords, contact cards and two-factor secrets spelled out, several codes in one picture, codes at an angle or light on dark. Nothing is uploaded.",
    category: "images",
    icon: "scanqr",
    accepts: "Screenshots and photos",
    status: "live",
    engine: "browser",
  },
  {
    slug: "transcribe-video",
    name: "Transcribe video or audio",
    tagline: "Turn speech into subtitles with a model that runs in your browser.",
    description:
      "Turn the speech in a video or audio file into SRT, WebVTT or plain text subtitles entirely in your browser, with a speech-recognition model downloaded once and run locally. Nothing is uploaded.",
    category: "subtitles",
    icon: "transcribe",
    accepts: "Video and audio files",
    status: "planned",
  },
];

/** Every tool that actually has a page. The only list anything should render. */
export function liveTools(): ToolMeta[] {
  return TOOLS.filter((tool) => tool.status === "live");
}

export function findTool(slug: string): ToolMeta | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

/**
 * Look up a tool, throwing if it is missing or not live.
 *
 * Pages call this at module scope, so a typo or a page left behind after a
 * registry edit fails the build rather than shipping a broken route.
 */
export function requireTool(slug: string): ToolMeta {
  const tool = findTool(slug);
  if (!tool) throw new Error(`No tool registered with the slug "${slug}".`);
  if (tool.status !== "live") {
    throw new Error(`The tool "${slug}" has a page but is still marked as planned in lib/tools.ts.`);
  }
  return tool;
}

/**
 * Every live tool in the order the site shows them: by category, then by
 * registry order within a category.
 *
 * The header used to render plain registry order, which put "Extract audio"
 * first there and last on the index, under Audio. Two orders for one list of
 * seven links is a small thing that makes a site feel like two sites.
 */
export function liveToolsInDisplayOrder(): ToolMeta[] {
  return liveToolsByCategory().flatMap((group) => group.tools);
}

/** Live tools grouped for display, skipping categories that have none yet. */
export function liveToolsByCategory(): { category: ToolCategory; tools: ToolMeta[] }[] {
  const live = liveTools();
  return CATEGORY_ORDER.map((category) => ({
    category,
    tools: live.filter((tool) => tool.category === category),
  })).filter((group) => group.tools.length > 0);
}

/**
 * What to show under a tool: its own category first, then everything else.
 *
 * Someone who just finished one job is the visitor most likely to have another,
 * and the likeliest next job is a neighbouring one.
 */
export function relatedTools(slug: string, limit = 6): ToolMeta[] {
  const current = findTool(slug);
  const others = liveTools().filter((tool) => tool.slug !== slug);
  if (!current) return others.slice(0, limit);

  const sameCategory = others.filter((tool) => tool.category === current.category);
  const rest = others.filter((tool) => tool.category !== current.category);
  return [...sameCategory, ...rest].slice(0, limit);
}

export function toolPath(tool: ToolMeta): string {
  return `/${tool.slug}`;
}

/**
 * The page metadata for a tool, from its registry entry.
 *
 * `title` is bare because the root layout wraps it in the site template, so a
 * page stays responsible for naming itself and nothing repeats the site name
 * by hand.
 */
export function toolMetadata(slug: string): Metadata {
  const tool = requireTool(slug);
  const path = toolPath(tool);
  return {
    title: tool.name,
    description: tool.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      title: `${tool.name} | ${SITE_NAME}`,
      description: tool.description,
      siteName: SITE_NAME,
    },
    twitter: {
      card: "summary",
      title: `${tool.name} | ${SITE_NAME}`,
      description: tool.description,
    },
  };
}

/**
 * schema.org JSON-LD for one tool, as a `WebApplication`.
 *
 * Worth stating explicitly rather than leaving to inference: this is a free
 * browser application with no sign-up, and the two facts search engines
 * actually surface from this markup - the category and the price - are the two
 * a visitor most wants to know before clicking.
 */
export function toolJsonLd(slug: string): Record<string, unknown> {
  const tool = requireTool(slug);
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.name,
    url: `${SITE_URL}${toolPath(tool)}`,
    description: tool.description,
    applicationCategory:
      tool.category === "documents" || tool.category === "files" || tool.category === "data"
        ? "UtilitiesApplication"
        : "MultimediaApplication",
    operatingSystem: "Any browser",
    browserRequirements: (tool.engine ?? "ffmpeg") === "ffmpeg" ? "Requires WebAssembly" : "Requires JavaScript",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  };
}
