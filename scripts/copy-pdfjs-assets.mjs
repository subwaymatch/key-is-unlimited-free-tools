/**
 * Copies PDF.js's worker and its font and character-map data into
 * public/pdfjs/<version>/ so they load from a same-origin URL.
 *
 * PDF.js parses and renders in a worker it spawns from a URL, and reads
 * the standard fourteen fonts and the CJK character maps from directories
 * it is pointed at; a static export has no build step that would bundle
 * those, so they are copied here the way the ffmpeg class worker is, into a
 * directory named after the version so the immutable cache in
 * public/_headers never serves a stale worker against a fresh library.
 *
 * Also asserts that the version pinned in package.json is the one
 * lib/pdf/render.ts expects, so a dependency bump cannot leave the two apart.
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`\n[copy-pdfjs-assets] ${message}\n`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pinned = pkg.dependencies?.["pdfjs-dist"] ?? pkg.devDependencies?.["pdfjs-dist"];
const source = readFileSync(join(root, "lib/pdf/render.ts"), "utf8");
const declared = source.match(/export const PDFJS_VERSION = "([^"]+)"/)?.[1];
if (!declared) fail("could not find PDFJS_VERSION in lib/pdf/render.ts");
if (pinned !== declared) {
  fail(`version drift: package.json pins pdfjs-dist@${pinned} but lib/pdf/render.ts declares "${declared}". Update both.`);
}
const installed = JSON.parse(readFileSync(join(root, "node_modules/pdfjs-dist/package.json"), "utf8")).version;
if (installed !== declared) fail(`pdfjs-dist ${installed} is installed but ${declared} is declared. Run npm install.`);

const from = join(root, "node_modules/pdfjs-dist");
const to = join(root, "public/pdfjs", declared);
rmSync(join(root, "public/pdfjs"), { recursive: true, force: true });
mkdirSync(to, { recursive: true });
// The legacy worker, to match the legacy build lib/pdf/render.ts imports.
cpSync(join(from, "legacy/build/pdf.worker.min.mjs"), join(to, "pdf.worker.min.mjs"));
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(from, directory), join(to, directory), { recursive: true });
}
console.log(`[copy-pdfjs-assets] copied PDF.js ${declared} worker, cmaps, standard fonts, wasm and iccs to public/pdfjs/${declared}/`);
