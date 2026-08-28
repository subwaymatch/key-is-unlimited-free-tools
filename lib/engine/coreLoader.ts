/**
 * Downloads the ffmpeg core and hands back same-origin blob URLs.
 *
 * `@ffmpeg/util`'s `toBlobURL` does the same job, but silently — and this is a
 * ~31 MiB download that would otherwise be an unexplained pause the first time
 * someone drops a file. Fetching it by hand gives a real byte-level progress
 * bar for the UI.
 *
 * The blob URLs matter for a second reason: the core is served cross-origin
 * from a CDN, and a worker cannot be spawned from a cross-origin script URL.
 * Re-serving the bytes through a same-origin `blob:` URL sidesteps that.
 */
import {
  CORE_APPROX_BYTES,
  CORE_JS_URL,
  CORE_WASM_URL,
  CORE_VERSION,
} from "./constants";
import { ExtractionError } from "./types";

export interface CoreDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
  ratio: number | null;
}

export interface CoreUrls {
  coreURL: string;
  wasmURL: string;
}

async function fetchAsBlobUrl(
  url: string,
  mimeType: string,
  onProgress: (receivedBytes: number, totalBytes: number) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new ExtractionError(
      "Could not download the ffmpeg core.",
      "Check your network connection — the ~31 MB core is fetched from a CDN the first time you convert a file.",
      { cause },
    );
  }

  if (!response.ok) {
    throw new ExtractionError(
      `Downloading the ffmpeg core failed (HTTP ${response.status}).`,
      "The CDN may be unreachable from this network.",
    );
  }

  const declaredLength = Number(response.headers.get("Content-Length"));
  const totalBytes = Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : 0;

  // Without a readable stream (or a body at all) there is nothing to report on;
  // fall back to a plain buffered read.
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength);
    return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    onProgress(receivedBytes, totalBytes);
  }

  onProgress(receivedBytes, receivedBytes);
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mimeType }));
}

let cached: Promise<CoreUrls> | null = null;

/**
 * Fetches (once per page load) the core JS and wasm as blob URLs.
 *
 * Repeat visits are served from the browser's HTTP cache: jsDelivr sends
 * `immutable` on these version-pinned files.
 */
export function loadCoreUrls(
  onProgress?: (progress: CoreDownloadProgress) => void,
): Promise<CoreUrls> {
  if (cached) {
    // Still report completion so a second caller's UI does not stall at 0%.
    onProgress?.({ receivedBytes: 1, totalBytes: 1, ratio: 1 });
    return cached;
  }

  cached = (async () => {
    // The wasm is ~99% of the bytes, so its progress is the progress.
    const report = (received: number, total: number) => {
      const totalBytes = total || CORE_APPROX_BYTES;
      onProgress?.({
        receivedBytes: received,
        totalBytes,
        ratio: totalBytes > 0 ? Math.min(1, received / totalBytes) : null,
      });
    };

    const wasmURL = await fetchAsBlobUrl(CORE_WASM_URL, "application/wasm", report);
    const coreURL = await fetchAsBlobUrl(CORE_JS_URL, "text/javascript", () => {});
    return { coreURL, wasmURL };
  })();

  // A failed download must not poison every later attempt.
  cached.catch(() => {
    cached = null;
  });

  return cached;
}

export const CORE_LABEL = `@ffmpeg/core@${CORE_VERSION}`;
