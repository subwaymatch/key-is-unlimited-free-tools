#!/usr/bin/env node
/*
 * Draws a tool's featured image, and normalises it into a shippable asset.
 *
 *   OPENAI_API_KEY=... node scripts/generate-tool-images.mjs            # only the missing ones
 *   OPENAI_API_KEY=... node scripts/generate-tool-images.mjs --force    # redraw everything
 *   OPENAI_API_KEY=... node scripts/generate-tool-images.mjs crop-image # redraw one, or a few
 *
 * The output is `public/tool-images/<slug>.webp`: 1200x800, transparent, and
 * the same 3D isometric blue as the key.is mark, so one asset serves both the
 * light and the dark theme without a second file or a `prefers-color-scheme`
 * swap.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 *   1. The background really has to be transparent. A white plate behind the
 *      drawing would be invisible in the light theme and a glaring slab in the
 *      dark one, and the model will happily add a glow, a shadow or a gradient
 *      wash unless it is told not to at some length. That is what most of
 *      STYLE, in scripts/tool-image-prompts.mjs, is doing.
 *   2. The model frames each drawing differently - one comes back as a wide
 *      thin band, the next as a tall block - and a grid of cards is where that
 *      shows. So nothing is shipped as it arrives: `normalise` finds the real
 *      ink in the frame, scales it to fill a fixed box, and centres it. That
 *      is what makes seventeen separate generations look like one set.
 *
 * Generation is not reproducible: the same prompt draws something different
 * every time. The images are committed for that reason, and this script is
 * here to add the next tool's image in the same style rather than to rebuild
 * the existing ones.
 */

import { mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { PROMPTS, STYLE } from "./tool-image-prompts.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(repoRoot, "public", "tool-images");

/**
 * The model, which is picked rather than defaulted.
 *
 * OpenAI publishes GPT Image 2.5 as two named variants, `-flare` and
 * `-sunburst`, with no plain `gpt-image-2.5` alias. They draw this prompt
 * near-identically; flare is the one the shipped set was drawn with, and
 * mixing the two across a set is the kind of thing that shows up as a subtle
 * inconsistency later.
 */
const MODEL = "gpt-image-2.5-flare";

/** The only landscape size the image API offers, and the frame the prompt is written for. */
const SOURCE_SIZE = "1536x1024";

/** What lands in `public/`. 3:2, so a card can reserve the space with one aspect-ratio rule. */
const WIDTH = 1200;
const HEIGHT = 800;

/** Empty space kept around the drawing, so nothing touches the edge of a card. */
const PADDING = 40;

/**
 * Alpha below this counts as background when the drawing is measured.
 *
 * Anti-aliased edges fade to nothing over a pixel or two, and the model
 * sometimes leaves a near-invisible haze well beyond the drawing. Measuring
 * from zero would take the haze for ink and leave every image scaled slightly
 * differently, which is exactly the inconsistency the normalising pass exists
 * to remove.
 */
const ALPHA_FLOOR = 8;

async function draw(slug, apiKey) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${PROMPTS[slug]}. ${STYLE}`,
      size: SOURCE_SIZE,
      // "low" is enough for flat-shaded geometry with no texture or lighting to
      // resolve, and it is the cheapest tier - which matters at sixty-three tools.
      quality: "low",
      background: "transparent",
      // PNG, not WebP, because this is the intermediate: it is cropped and
      // rescaled below, and a lossy source would have its artefacts baked in.
      output_format: "png",
      n: 1,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${slug}: ${JSON.stringify(body.error ?? body).slice(0, 400)}`);
  }
  return Buffer.from(body.data[0].b64_json, "base64");
}

/**
 * The bounding box of everything that is not background.
 *
 * sharp's own `trim` works from a corner pixel's colour, which is the wrong
 * question here - the corner is transparent in every one of these, and what
 * matters is where the drawing actually starts. So the alpha channel is read
 * directly.
 */
async function contentBox(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] < ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) throw new Error("the generated image is entirely transparent");
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Crops to the drawing, scales it to fill the frame, and centres it. */
async function normalise(png, file) {
  const inner = await sharp(png)
    .extract(await contentBox(png))
    .resize({
      width: WIDTH - PADDING * 2,
      height: HEIGHT - PADDING * 2,
      // "inside" keeps the aspect ratio and fits the longer side, so a wide
      // drawing spans the frame and a tall one fills its height. Both end up
      // with the same visual weight, which is the point.
      fit: "inside",
      withoutEnlargement: false,
      kernel: "lanczos3",
    })
    .toBuffer({ resolveWithObject: true });

  await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: inner.data,
        top: Math.round((HEIGHT - inner.info.height) / 2),
        left: Math.round((WIDTH - inner.info.width) / 2),
      },
    ])
    // alphaQuality is kept high on purpose: the edges are the drawing here,
    // and a soft alpha channel reads as a dirty halo against the dark theme.
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(file);
}

export function imagePath(slug) {
  return resolve(OUT_DIR, `${slug}.webp`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const named = args.filter((arg) => !arg.startsWith("--"));

  const unknown = named.filter((slug) => !(slug in PROMPTS));
  if (unknown.length > 0) {
    throw new Error(
      `No prompt for ${unknown.join(", ")}. Add one to PROMPTS in scripts/tool-image-prompts.mjs, ` +
        "and set image: true on the tool in lib/tools.ts.",
    );
  }

  const wanted = named.length > 0 ? named : Object.keys(PROMPTS);
  const todo = force || named.length > 0 ? wanted : wanted.filter((slug) => !existsSync(imagePath(slug)));

  if (todo.length === 0) {
    console.log(`Nothing to draw: all ${wanted.length} images already exist. Pass --force to redraw them.`);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Drawing ${todo.length} image(s) with ${MODEL}.`);

  // Four at a time: enough to keep the run short, low enough not to trip the
  // image API's rate limit on an ordinary account.
  const CONCURRENCY = 4;
  const failures = [];

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(
      todo.slice(i, i + CONCURRENCY).map(async (slug) => {
        try {
          const file = imagePath(slug);
          await normalise(await draw(slug, apiKey), file);
          const { size } = await stat(file);
          console.log(`  ${slug}.webp  ${(size / 1024).toFixed(0)} KiB`);
        } catch (error) {
          failures.push(`${slug}: ${error.message}`);
        }
      }),
    );
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} image(s) failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nWrote ${todo.length} image(s) to public/tool-images/.`);
}

// Importing this module for its PROMPTS (which the tests do) must not draw anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
