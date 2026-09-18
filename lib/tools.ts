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
  | "copies";

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
  /**
   * Whether this tool has a featured image at `/tool-images/<slug>.webp`.
   *
   * A flag rather than a path, because there is only ever one place an image
   * can live and one name it can have; see `toolImage`. Absent means the tool
   * has none yet, and every surface that shows one degrades to the text-only
   * card it already had.
   *
   * The images are drawn by `scripts/generate-tool-images.mjs`, which holds the
   * prompt for each one. A test asserts the two lists match and that the file
   * is actually on disk, so a flag cannot outrun its image or the other way
   * round.
   */
  image?: boolean;
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
    image: true,
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
 * The intrinsic size of every featured image, which is the same for all of
 * them by construction: `scripts/generate-tool-images.mjs` crops and re-centres
 * each drawing into this exact box.
 *
 * Stated here so the markup can give the browser a width and a height and
 * reserve the space before the file arrives. Without them a grid of cards
 * jumps as each image lands, which is the layout shift Core Web Vitals
 * measures and a visitor feels.
 */
export const TOOL_IMAGE_WIDTH = 1200;
export const TOOL_IMAGE_HEIGHT = 800;

/**
 * Where a tool's featured image lives, or nothing if it has none yet.
 *
 * Only seventeen of the tools are drawn so far, so every caller has to handle
 * the absent case; returning undefined rather than a path to a missing file is
 * what makes that impossible to forget.
 */
export function toolImage(tool: ToolMeta): string | undefined {
  return tool.image ? `/tool-images/${tool.slug}.webp` : undefined;
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
