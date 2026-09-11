import type { ReactNode } from "react";

import { toolJsonLd } from "@/lib/tools";

import { RelatedTools } from "./RelatedTools";
import styles from "./ToolPage.module.css";

interface ToolPageProps {
  /** The tool being shown, so the related-tools block can leave it out. */
  slug: string;
  children: ReactNode;
}

/**
 * The page around a tool: the tool itself, then the rest of the catalogue.
 *
 * The app inside is a client component, but it is safe to prerender: nothing
 * in its module graph touches Worker, WebAssembly or the File API at import
 * time. `@ffmpeg/ffmpeg` (which resolves to a throwing stub under Node) is
 * pulled in dynamically, in the browser, only once a conversion starts.
 */
export function ToolPage({ slug, children }: ToolPageProps) {
  return (
    <>
      {/*
        * schema.org WebApplication markup. Server-rendered into the static
        * export, so it is in the HTML a crawler is handed rather than
        * something it has to run JavaScript to find. The content is built
        * from the registry, so it cannot drift from the page it describes.
        */}
      <script
        type="application/ld+json"
        // The object is ours and contains no user input; JSON.stringify of a
        // registry entry cannot produce a script-closing sequence.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(toolJsonLd(slug)) }}
      />
      {children}
      <div className={styles.below}>
        <RelatedTools slug={slug} />
      </div>
    </>
  );
}
