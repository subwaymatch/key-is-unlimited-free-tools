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

export type ToolCategory = "video" | "audio" | "subtitles" | "images" | "documents" | "data";

/*
 * Icon keys, resolved to lucide components by components/ToolIcon.tsx.
 *
 * Kept as plain strings so this module stays data only: app/sitemap.ts imports
 * it, and a sitemap has no business pulling React components into its graph.
 */
export type ToolIconName = "audio" | "compress" | "convert";

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
    slug: "compress-video",
    name: "Compress video",
    tagline: "Shrink a video to a target size for email, chat or upload.",
    description:
      "Compress a video to a size you choose, entirely in your browser. Nothing is uploaded, so there is no cap on the file you start from.",
    category: "video",
    icon: "compress",
    accepts: "Video files",
    status: "planned",
  },
  {
    slug: "convert-video",
    name: "Convert video",
    tagline: "Turn MOV, MKV, AVI or WebM into an MP4 that plays anywhere.",
    description:
      "Convert a video to a format that plays anywhere, entirely in your browser. Nothing is uploaded, whatever the file size.",
    category: "video",
    icon: "convert",
    accepts: "Video files",
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
