import type { Metadata } from "next";

import { AudioExtractorApp } from "@/components/AudioExtractorApp";
import { RelatedTools } from "@/components/RelatedTools";
import { requireTool, toolPath } from "@/lib/tools";

import styles from "./page.module.css";

const tool = requireTool("extract-audio");

export const metadata: Metadata = {
  title: tool.name,
  description: tool.description,
  alternates: { canonical: toolPath(tool) },
};

/**
 * The app itself is a client component, but it is safe to prerender: nothing in
 * its module graph touches Worker, WebAssembly or the File API at import time.
 * `@ffmpeg/ffmpeg` (which resolves to a throwing stub under Node) is pulled in
 * dynamically, in the browser, only once a conversion actually starts.
 */
export default function Page() {
  return (
    <>
      <AudioExtractorApp />
      <div className={styles.below}>
        <RelatedTools slug={tool.slug} />
      </div>
    </>
  );
}
