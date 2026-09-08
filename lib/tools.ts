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
  | "subtitles";

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
    status: "planned",
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
    status: "planned",
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
  return {
    title: tool.name,
    description: tool.description,
    alternates: { canonical: toolPath(tool) },
  };
}
