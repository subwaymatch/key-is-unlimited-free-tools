import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  TOOLS,
  findTool,
  liveTools,
  liveToolsByCategory,
  relatedTools,
  requireTool,
  toolPath,
} from "@/lib/tools";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * The registry is the single source of truth for routing, navigation and the
 * sitemap, so the invariants that keep those honest are asserted here rather
 * than left to review.
 */
describe("the tool registry", () => {
  it("has a unique slug for every tool", () => {
    const slugs = TOOLS.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses lowercase hyphenated slugs", () => {
    for (const tool of TOOLS) {
      expect(tool.slug, tool.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("gives every tool a category with a label and a display position", () => {
    for (const tool of TOOLS) {
      expect(CATEGORY_LABELS[tool.category], tool.slug).toBeTruthy();
      expect(CATEGORY_ORDER, tool.slug).toContain(tool.category);
    }
  });

  it("keeps taglines short enough for a card", () => {
    for (const tool of TOOLS) {
      expect(tool.tagline.length, `${tool.slug}: ${tool.tagline}`).toBeLessThanOrEqual(90);
    }
  });

  it("gives every tool a description long enough to serve as a meta description", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.slug).toBeGreaterThan(tool.tagline.length);
    }
  });
});

describe("live tools", () => {
  /*
   * The failure this guards against is a one-word registry edit: flipping a
   * tool to "live" without adding its page ships a link to a 404 in the header,
   * the footer, the index and the sitemap at once.
   */
  it("each have a page at app/<slug>/page.tsx", () => {
    for (const tool of liveTools()) {
      const page = resolve(repoRoot, "app", tool.slug, "page.tsx");
      expect(existsSync(page), `${tool.slug} is live but ${page} does not exist`).toBe(true);
    }
  });

  it("excludes planned tools from everything that renders", () => {
    const planned = TOOLS.filter((tool) => tool.status === "planned");
    expect(planned.length, "this test is vacuous without a planned tool").toBeGreaterThan(0);

    const rendered = [
      ...liveTools(),
      ...liveToolsByCategory().flatMap((group) => group.tools),
      ...TOOLS.flatMap((tool) => relatedTools(tool.slug)),
    ].map((tool) => tool.slug);

    for (const tool of planned) {
      expect(rendered, tool.slug).not.toContain(tool.slug);
    }
  });

  it("groups only categories that have something in them", () => {
    for (const group of liveToolsByCategory()) {
      expect(group.tools.length, group.category).toBeGreaterThan(0);
    }
  });

  it("keeps the group order stable", () => {
    const categories = liveToolsByCategory().map((group) => group.category);
    const expected = CATEGORY_ORDER.filter((category) => categories.includes(category));
    expect(categories).toEqual(expected);
  });
});

describe("requireTool", () => {
  it("returns a live tool", () => {
    expect(requireTool("extract-audio").slug).toBe("extract-audio");
  });

  it("throws for an unknown slug, so a typo fails the build", () => {
    expect(() => requireTool("no-such-tool")).toThrow(/No tool registered/);
  });

  it("throws for a planned tool, so a page cannot outrun its registry entry", () => {
    const planned = TOOLS.find((tool) => tool.status === "planned");
    expect(planned).toBeDefined();
    expect(() => requireTool(planned!.slug)).toThrow(/still marked as planned/);
  });
});

describe("relatedTools", () => {
  it("never includes the tool being shown", () => {
    for (const tool of liveTools()) {
      expect(relatedTools(tool.slug).map((related) => related.slug)).not.toContain(tool.slug);
    }
  });

  it("puts same-category tools first", () => {
    const current = { category: "audio" as const };
    const related = relatedTools("extract-audio");
    const firstOther = related.findIndex((tool) => tool.category !== current.category);
    if (firstOther === -1) return; // nothing outside the category yet
    const afterwards = related.slice(firstOther);
    expect(afterwards.every((tool) => tool.category !== current.category)).toBe(true);
  });

  it("respects the limit", () => {
    expect(relatedTools("extract-audio", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("toolPath", () => {
  it("builds a root-relative path", () => {
    expect(toolPath(requireTool("extract-audio"))).toBe("/extract-audio");
  });
});

describe("findTool", () => {
  it("returns undefined rather than throwing for an unknown slug", () => {
    expect(findTool("no-such-tool")).toBeUndefined();
  });
});
