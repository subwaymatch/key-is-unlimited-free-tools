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

export type ToolCategory = "video" | "audio" | "subtitles" | "images" | "documents" | "data";

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
  | "tracks";

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
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  video: "Video",
  audio: "Audio",
  subtitles: "Subtitles",
  images: "Images",
  documents: "Documents",
  data: "Data",
};

/** Display order for category groupings. */
export const CATEGORY_ORDER: readonly ToolCategory[] = [
  "video",
  "audio",
  "subtitles",
  "images",
  "documents",
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
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any browser",
    browserRequirements: "Requires WebAssembly",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  };
}
