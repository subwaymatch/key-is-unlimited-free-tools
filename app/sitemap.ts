import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";
import { liveTools, toolPath } from "@/lib/tools";

/*
 * Derived from the registry, so a new tool is listed the moment it goes live.
 * Planned tools are excluded along with everything else that does not render.
 */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...liveTools().map((tool) => ({
      url: `${SITE_URL}${toolPath(tool)}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
