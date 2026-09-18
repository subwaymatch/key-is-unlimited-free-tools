import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PROMPTS } from "../scripts/tool-image-prompts.mjs";
import { TOOLS, TOOL_IMAGE_HEIGHT, TOOL_IMAGE_WIDTH, liveTools, toolImage } from "@/lib/tools";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_DIR = resolve(repoRoot, "public", "tool-images");

const drawn = TOOLS.filter((tool) => tool.image);

/*
 * A featured image is three things that have to agree: a flag in the registry,
 * a prompt in scripts/tool-image-prompts.mjs, and a file in public/. Any two
 * of them without the third is a silent failure - a card reserving space for
 * an image that 404s, or an image nothing ever renders - so all three are
 * checked against each other here rather than by eye.
 */
describe("featured images", () => {
  it("has a file on disk for every tool flagged with one", () => {
    for (const tool of drawn) {
      const file = resolve(IMAGE_DIR, `${tool.slug}.webp`);
      expect(existsSync(file), `${tool.slug} is flagged image: true but ${file} does not exist`).toBe(
        true,
      );
    }
  });

  it("has nothing in public/tool-images that no tool claims", () => {
    const claimed = new Set(drawn.map((tool) => tool.slug));
    for (const entry of readdirSync(IMAGE_DIR)) {
      expect(entry, `${entry} is not a .webp`).toMatch(/\.webp$/);
      const slug = entry.replace(/\.webp$/, "");
      expect(claimed, `${entry} has no tool flagged image: true`).toContain(slug);
    }
  });

  it("has a prompt for every flagged tool, and flags every tool with a prompt", () => {
    expect(Object.keys(PROMPTS).sort()).toEqual(drawn.map((tool) => tool.slug).sort());
  });

  it("only flags live tools, since a planned one is never rendered", () => {
    const live = new Set(liveTools().map((tool) => tool.slug));
    for (const tool of drawn) {
      expect(live, `${tool.slug} is flagged image: true but is not live`).toContain(tool.slug);
    }
  });

  /*
   * The declared size is what the markup uses to reserve space before the file
   * arrives, so a drawing that came out a different shape would show up as
   * layout shift rather than as anything obviously broken. The dimensions are
   * read straight out of the WebP header: a lossy WebP is a RIFF container
   * whose VP8 chunk carries the 14-bit width and height at a fixed offset.
   */
  it("ships every image at the size the markup declares", () => {
    for (const tool of drawn) {
      const bytes = readFileSync(resolve(IMAGE_DIR, `${tool.slug}.webp`));
      expect(bytes.subarray(0, 4).toString("ascii"), tool.slug).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii"), tool.slug).toBe("WEBP");
      // "VP8X" is the extended form, which is what an alpha channel needs.
      expect(bytes.subarray(12, 16).toString("ascii"), tool.slug).toBe("VP8X");
      // In a VP8X chunk the canvas size is stored minus one, little-endian,
      // three bytes each, starting at offset 24.
      const width = bytes.readUIntLE(24, 3) + 1;
      const height = bytes.readUIntLE(27, 3) + 1;
      expect([width, height], tool.slug).toEqual([TOOL_IMAGE_WIDTH, TOOL_IMAGE_HEIGHT]);
    }
  });

  it("keeps every image small enough to sit on a card without a loading spinner", () => {
    for (const tool of drawn) {
      const { length } = readFileSync(resolve(IMAGE_DIR, `${tool.slug}.webp`));
      expect(length / 1024, `${tool.slug}.webp`).toBeLessThan(150);
    }
  });
});

describe("toolImage", () => {
  it("returns the public path for a tool that has one", () => {
    expect(toolImage(drawn[0])).toBe(`/tool-images/${drawn[0].slug}.webp`);
  });

  it("returns undefined for a tool that has none, so a caller has to handle it", () => {
    const undrawn = TOOLS.find((tool) => !tool.image);
    expect(undrawn, "this test is vacuous once every tool is drawn").toBeDefined();
    expect(toolImage(undrawn!)).toBeUndefined();
  });
});
