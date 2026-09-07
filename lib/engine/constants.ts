/**
 * Pinned ffmpeg.wasm versions and asset locations.
 *
 * These constants are checked against package.json by
 * `scripts/copy-ffmpeg-worker.mjs`, which runs before `dev` and `build`. A
 * version bump in package.json that is not mirrored here fails the build.
 */

/** Must match the `@ffmpeg/ffmpeg` version in package.json. */
export const FFMPEG_VERSION = "0.12.15";

/** Must match the `@ffmpeg/core` version in package.json. */
export const CORE_VERSION = "0.12.10";

/**
 * Where the ffmpeg core (~31 MiB wasm) is fetched from at runtime.
 *
 * It cannot ship as a Cloudflare static asset: both Workers static assets and
 * Pages enforce a hard 25 MiB per-file limit, and ffmpeg-core.wasm is ~30.7 MiB.
 *
 * jsDelivr serves it with `access-control-allow-origin: *` and a long
 * `immutable` cache lifetime, so the download is a one-time cost per browser.
 * To self-host instead, mirror the two files below to an R2 bucket on a custom
 * domain (egress is free), give the bucket a CORS policy, and point this at it
 * with NEXT_PUBLIC_FFMPEG_CORE_BASE_URL.
 *
 * The ESM build is required, not the UMD one. @ffmpeg/ffmpeg's class worker is
 * a module worker, so `importScripts` is unavailable and it falls back to
 * `(await import(coreURL)).default` - which is undefined for the UMD bundle,
 * and the assignment then clobbers the global the UMD script had just set,
 * surfacing as "failed to import ffmpeg-core.js".
 */
export const CORE_BASE_URL =
  process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL ??
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

export const CORE_JS_URL = `${CORE_BASE_URL}/ffmpeg-core.js`;
export const CORE_WASM_URL = `${CORE_BASE_URL}/ffmpeg-core.wasm`;

/**
 * Path of the same-origin class worker copied into public/ at build time.
 *
 * The version is a path segment rather than a query string because the worker
 * is an ES module that imports its siblings (`./const.js`, `./errors.js`) by
 * bare relative path, and `public/_headers` marks everything under /ffmpeg/ as
 * immutable for a year. A `?v=` on the worker alone would fetch a new worker
 * after an upgrade and run it against siblings still cached from the old one;
 * a versioned directory changes every URL at once.
 */
export const CLASS_WORKER_PATH = `/ffmpeg/${FFMPEG_VERSION}/worker.js`;

/**
 * Absolute URL of `@ffmpeg/ffmpeg`'s class worker.
 *
 * `FFmpeg.load()` spawns its worker with
 * `new Worker(new URL(classWorkerURL, import.meta.url), { type: "module" })`.
 * Next.js chunks are not ES modules, so webpack substitutes a build-time
 * `file:///...` literal for `import.meta.url`; a root-relative path resolved
 * against that base becomes `file:///ffmpeg/worker.js` and the Worker
 * constructor throws a SecurityError. Handing it an already-absolute URL makes
 * the base irrelevant.
 *
 * Assumes the app is served from the root of its origin, which is how it
 * deploys to Cloudflare Workers static assets. Under a basePath, prefix it.
 */
export function getClassWorkerUrl(): string {
  return new URL(CLASS_WORKER_PATH, window.location.origin).href;
}

/**
 * Exact size and SHA-256 of the pinned core files, as published to npm.
 *
 * The size drives the download progress bar. CDNs serve the wasm compressed,
 * so the Content-Length header describes the compressed body while the stream
 * yields decompressed bytes; a ratio built from the header reaches 100% about a
 * third of the way through. The pinned size is the one total that is right in
 * every configuration.
 *
 * The digests are checked after download, before the core is handed to the
 * worker. Everything the app promises about privacy rests on the core being
 * the build it claims to be, and the JS half runs with this page's origin, so
 * a CDN serving something else has to be refused rather than executed.
 *
 * `scripts/copy-ffmpeg-worker.mjs` asserts all three against node_modules, so
 * a version bump that forgets to update them fails the build.
 */
export const CORE_WASM_BYTES = 32_232_419;
export const CORE_WASM_SHA256 =
  "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7";
export const CORE_JS_SHA256 =
  "67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3";
