import type { MetadataRoute } from "next";

import { SITE_NAME } from "@/lib/site";

/*
 * The web app manifest.
 *
 * Installing the site is not the point - there is no offline story yet,
 * because the 31 MB engine is fetched from a CDN and a service worker that
 * cached it would be a project of its own. What this buys today is the small
 * stuff a browser asks for and otherwise guesses at: a real name on a home
 * screen shortcut, a theme colour for the address bar, and a proper entry in
 * the "install" affordance rather than a bare URL.
 */
/** Required by `output: "export"`, exactly as for the sitemap. */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME}: free browser tools with no file size limit`,
    short_name: SITE_NAME,
    description:
      "Convert, compress and edit files entirely in your browser. Nothing is uploaded, so there is no file size limit and nothing to pay.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
