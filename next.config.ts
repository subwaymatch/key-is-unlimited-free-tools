import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything runs in the browser, so the app ships as a static export and is
  // served from Cloudflare Workers static assets (no Worker script, no SSR).
  output: "export",
  images: { unoptimized: true },
  // NOTE: `headers()` is not supported with `output: "export"`. Production
  // headers live in `public/_headers`, which Cloudflare applies to static assets.
};

export default nextConfig;
