import { AudioExtractorApp } from "@/components/AudioExtractorApp";

/**
 * The app itself is a client component, but it is safe to prerender: nothing in
 * its module graph touches Worker, WebAssembly or the File API at import time.
 * `@ffmpeg/ffmpeg` (which resolves to a throwing stub under Node) is pulled in
 * dynamically, in the browser, only once a conversion actually starts.
 */
export default function Page() {
  return <AudioExtractorApp />;
}
