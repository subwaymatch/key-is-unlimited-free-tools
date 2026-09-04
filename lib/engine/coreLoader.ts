/**
 * Downloads the ffmpeg core, verifies it, and hands back same-origin blob URLs.
 *
 * `@ffmpeg/util`'s `toBlobURL` does the same job, but silently — and this is a
 * ~31 MiB download that would otherwise be an unexplained pause the first time
 * someone drops a file. Fetching it by hand gives a real byte-level progress
 * bar for the UI.
 *
 * It also gives a place to check what arrived. The core comes from a CDN, and
 * the JS half of it runs as a worker on this page's origin, so the bytes are
 * hashed and compared against the pins in constants.ts before the worker ever
 * sees them. `fetch`'s own `integrity` option would do the same check, but it
 * buffers the whole response before resolving, which would take the progress
 * bar with it.
 *
 * The blob URLs matter for a second reason: the core is served cross-origin
 * from a CDN, and a worker cannot be spawned from a cross-origin script URL.
 * Re-serving the bytes through a same-origin `blob:` URL sidesteps that.
 */
import {
  CORE_JS_SHA256,
  CORE_JS_URL,
  CORE_VERSION,
  CORE_WASM_BYTES,
  CORE_WASM_SHA256,
  CORE_WASM_URL,
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

/**
 * Hex SHA-256 of `bytes`, or null where SubtleCrypto is unavailable.
 *
 * Browsers only expose it in secure contexts. Production is HTTPS and `next
 * dev` is localhost, so the null case is a developer testing over a LAN
 * address, where refusing to run at all would be more hindrance than help.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Streams a download into memory, reporting progress against `expectedBytes`.
 *
 * The response's own Content-Length is deliberately not used as the total:
 * CDNs serve the wasm compressed, and the header then describes the compressed
 * body while the stream yields decompressed bytes. The pinned size is the only
 * total that is right whoever serves the file.
 */
async function downloadBytes(
  url: string,
  expectedBytes: number,
  onProgress: (receivedBytes: number, totalBytes: number) => void,
): Promise<Uint8Array> {
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

  // Without a readable stream (or a body at all) there is nothing to report on;
  // fall back to a plain buffered read.
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress(buffer.byteLength, buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    onProgress(receivedBytes, Math.max(expectedBytes, receivedBytes));
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  onProgress(receivedBytes, receivedBytes);
  return bytes;
}

async function fetchVerifiedBlobUrl(
  url: string,
  mimeType: string,
  expectedSha256: string,
  expectedBytes: number,
  onProgress: (receivedBytes: number, totalBytes: number) => void,
): Promise<string> {
  const bytes = await downloadBytes(url, expectedBytes, onProgress);

  const actual = await sha256Hex(bytes);
  if (actual === null) {
    console.warn(
      `[ffmpeg] SubtleCrypto is unavailable in this context, so ${url} could not be verified against its pinned checksum.`,
    );
  } else if (actual !== expectedSha256) {
    throw new ExtractionError(
      "The downloaded ffmpeg core does not match its pinned checksum.",
      "The file served for this build differs from the one the app was built against, so it will not be run. Try again later; if it keeps happening, self-host the core (see the README).",
    );
  }

  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
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
    onProgress?.({ receivedBytes: CORE_WASM_BYTES, totalBytes: CORE_WASM_BYTES, ratio: 1 });
    return cached;
  }

  cached = (async () => {
    // The wasm is ~99% of the bytes, so its progress is the progress.
    const report = (receivedBytes: number, totalBytes: number) => {
      onProgress?.({
        receivedBytes,
        totalBytes,
        ratio: totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : null,
      });
    };

    const wasmURL = await fetchVerifiedBlobUrl(
      CORE_WASM_URL,
      "application/wasm",
      CORE_WASM_SHA256,
      CORE_WASM_BYTES,
      report,
    );
    const coreURL = await fetchVerifiedBlobUrl(
      CORE_JS_URL,
      "text/javascript",
      CORE_JS_SHA256,
      0,
      () => {},
    );
    return { coreURL, wasmURL };
  })();

  // A failed download must not poison every later attempt.
  cached.catch(() => {
    cached = null;
  });

  return cached;
}

export const CORE_LABEL = `@ffmpeg/core@${CORE_VERSION}`;
