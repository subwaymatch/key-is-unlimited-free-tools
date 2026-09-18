import Image from "next/image";

import { TOOL_IMAGE_HEIGHT, TOOL_IMAGE_WIDTH, toolImage } from "@/lib/tools";
import type { ToolMeta } from "@/lib/tools";

interface ToolImageProps {
  tool: ToolMeta;
  className?: string;
  /**
   * True for the one image above the fold on a tool page, false for the
   * dozens further down an index. Everything else loads lazily, which is what
   * keeps the index's cost roughly one image rather than sixty.
   */
  priority?: boolean;
}

/**
 * A tool's featured image, or nothing when it has none yet.
 *
 * The drawings are transparent WebP in the mark's own blues (see
 * `scripts/generate-tool-images.mjs`), so one file serves the light theme and
 * the dark one. There is no `prefers-color-scheme` swap and no second asset to
 * keep in step.
 *
 * `alt` is deliberately empty. Every place one of these appears, the tool's
 * name is already next to it as real text - the card heading, or the page's
 * `h1` - so a screen reader reading a description of the drawing would be
 * announcing the same thing twice. An empty alt is what marks an image as
 * decorative and takes it out of the accessibility tree; it is not a missing
 * alt, and it is the correct one here.
 *
 * `next/image` is used rather than a bare `img` for the width, height and lazy
 * loading it writes for us. The export sets `images: { unoptimized: true }`, so
 * this resolves to a plain `<img>` pointing at the file in `public/` with no
 * optimiser in the path - which is the whole point of a site that is nothing
 * but static assets.
 */
export function ToolImage({ tool, className, priority = false }: ToolImageProps) {
  const src = toolImage(tool);
  if (!src) return null;

  return (
    <Image
      src={src}
      alt=""
      width={TOOL_IMAGE_WIDTH}
      height={TOOL_IMAGE_HEIGHT}
      className={className}
      priority={priority}
      // A card is at most ~24rem wide and the page header's image at most
      // ~14rem, both well under the intrinsic 1200px, so the browser never
      // needs the file at full size on a one-times display.
      sizes="(min-width: 640px) 24rem, 100vw"
    />
  );
}
