/**
 * Copies @ffmpeg/ffmpeg's ESM class worker into public/ffmpeg/ so it can be
 * loaded from a same-origin URL.
 *
 * Why: FFmpeg.load() spawns its worker with
 *   new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
 * which webpack and Turbopack rewrite differently (and sometimes break).
 * Passing an explicit `classWorkerURL` avoids depending on that behaviour, but
 * the worker is an ES module that relative-imports ./const.js and ./errors.js,
 * so the sibling modules have to be copied alongside it.
 *
 * Also asserts that the pinned versions in lib/engine/constants.ts still match
 * package.json, so a dependency bump can't silently desync the CDN core URL or
 * the worker cache-buster.
 */
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

/** Reads `export const NAME = "value";` out of constants.ts. */
const constant = (name) => {
  const match = constants.match(new RegExp(`export const ${name} = "([^"]+)"`));
  if (!match) fail(`could not find ${name} in lib/engine/constants.ts`);
  return match[1];
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
        `Update both so the CDN core URL and worker cache-buster stay correct.`,
    );
  }
}

const source = join(root, "node_modules/@ffmpeg/ffmpeg/dist/esm");
const destination = join(root, "public/ffmpeg");

let files;
try {
  files = readdirSync(source).filter((f) => f.endsWith(".js"));
} catch {
  fail(`missing ${source} — run \`npm install\` first.`);
}
if (!files.includes("worker.js")) fail(`no worker.js in ${source}`);

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const file of files) {
  writeFileSync(join(destination, file), readFileSync(join(source, file)));
}

console.log(
  `[copy-ffmpeg-worker] copied ${files.length} files to public/ffmpeg/ ` +
    `(@ffmpeg/ffmpeg@${constant("FFMPEG_VERSION")})`,
);
