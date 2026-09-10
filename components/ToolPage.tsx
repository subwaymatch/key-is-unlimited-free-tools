import type { ReactNode } from "react";

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
      {children}
      <div className={styles.below}>
        <RelatedTools slug={slug} />
      </div>
    </>
  );
}
