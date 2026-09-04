/**
 * Copies @ffmpeg/ffmpeg's ESM class worker into public/ffmpeg/<version>/ so it
 * can be loaded from a same-origin URL.
 *
 * Why: FFmpeg.load() spawns its worker with
 *   new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
 * which webpack and Turbopack rewrite differently (and sometimes break).
 * Passing an explicit `classWorkerURL` avoids depending on that behaviour, but
 * the worker is an ES module that relative-imports ./const.js and ./errors.js,
 * so the sibling modules have to be copied alongside it.
 *
 * The files land in a directory named after the package version because
 * public/_headers caches everything under /ffmpeg/ as immutable for a year.
 * The worker imports its siblings by bare relative path, so a cache-buster on
 * the worker URL alone would leave a freshly fetched worker running against
 * siblings cached from the previous version; a new directory moves every URL.
 *
 * Also asserts that the versions, size and checksums pinned in
 * lib/engine/constants.ts still match what is installed, so a dependency bump
 * can't silently desync the CDN core URL, the worker path, or the integrity
 * check the core loader performs at runtime.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => {
  console.error(`\n[copy-ffmpeg-worker] ${msg}\n`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const constants = readFileSync(join(root, "lib/engine/constants.ts"), "utf8");

/** Reads `export const NAME = "value";` or `export const NAME = 1_234;` out of constants.ts. */
const constant = (name) => {
  const match = constants.match(new RegExp(`export const ${name} =\\s*(?:"([^"]+)"|([\\d_]+))`));
  if (!match) fail(`could not find ${name} in lib/engine/constants.ts`);
  return match[1] ?? match[2].replace(/_/g, "");
};

for (const [dep, name] of [
  ["@ffmpeg/ffmpeg", "FFMPEG_VERSION"],
  ["@ffmpeg/core", "CORE_VERSION"],
]) {
  const pinned = pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep];
  const declared = constant(name);
  if (pinned !== declared) {
    fail(
      `version drift: package.json pins ${dep}@${pinned} but ` +
        `lib/engine/constants.ts declares ${name} = "${declared}". ` +
        `Update both so the CDN core URL and worker path stay correct.`,
    );
  }
}

// The core is fetched from a CDN at runtime and refused unless it matches these
// pins, so they must describe the build that is actually installed.
const coreDist = join(root, "node_modules/@ffmpeg/core/dist/esm");
for (const [file, hashName, sizeName] of [
  ["ffmpeg-core.wasm", "CORE_WASM_SHA256", "CORE_WASM_BYTES"],
  ["ffmpeg-core.js", "CORE_JS_SHA256", null],
]) {
  let bytes;
  try {
    bytes = readFileSync(join(coreDist, file));
  } catch {
    fail(`missing ${join(coreDist, file)} — run \`npm install\` first.`);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== constant(hashName)) {
    fail(
      `checksum drift: ${file} in node_modules hashes to ${sha256} but ` +
        `lib/engine/constants.ts declares ${hashName} = "${constant(hashName)}". ` +
        `Update the pin after a deliberate @ffmpeg/core upgrade; the app refuses a core that does not match it.`,
    );
  }
  if (sizeName && String(bytes.length) !== constant(sizeName)) {
    fail(
      `size drift: ${file} is ${bytes.length} bytes but lib/engine/constants.ts ` +
        `declares ${sizeName} = ${constant(sizeName)}. The download progress bar is measured against it.`,
    );
  }
}

const source = join(root, "node_modules/@ffmpeg/ffmpeg/dist/esm");
const publicRoot = join(root, "public/ffmpeg");
const destination = join(publicRoot, constant("FFMPEG_VERSION"));

let files;
try {
  files = readdirSync(source).filter((f) => f.endsWith(".js"));
} catch {
  fail(`missing ${source} — run \`npm install\` first.`);
}
if (!files.includes("worker.js")) fail(`no worker.js in ${source}`);

// Clear every previous version, so the export only ever ships the one in use.
rmSync(publicRoot, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const file of files) {
  writeFileSync(join(destination, file), readFileSync(join(source, file)));
}

console.log(
  `[copy-ffmpeg-worker] copied ${files.length} files to public/ffmpeg/${constant("FFMPEG_VERSION")}/ ` +
    `and verified the pinned core checksums`,
);
