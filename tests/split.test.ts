import { describe, expect, it } from "vitest";

import {
  CHAPTER_FORMATS,
  chapterFormat,
  chapterFormatIds,
  describeChapter,
  MAX_CHAPTERS,
  slugify,
} from "@/lib/engine/split";
import { formatSeconds } from "@/lib/engine/trim";
import type { ChapterInfo, PlanContext, ProbeResult } from "@/lib/engine/types";

const AUDIO = {
  codec: "mp3",
  profile: null,
  sampleRate: 44_100,
  channels: 2,
  channelLayout: "stereo",
  bitrateKbps: 128,
  language: null,
  title: null,
};

const VIDEO = {
  codec: "h264",
  profile: "High",
  pixelFormat: "yuv420p",
  width: 1280,
  height: 720,
  fps: 25,
  bitrateKbps: 2000,
  rotationDegrees: null,
};

const CHAPTERS: ChapterInfo[] = [
  { startSeconds: 0, endSeconds: 90.5, title: "Intro" },
  { startSeconds: 90.5, endSeconds: 200, title: "The First Part!" },
  { startSeconds: 200, endSeconds: 3600, title: null },
];

function probe(video = false, chapters = CHAPTERS, durationSeconds: number | null = 3600): ProbeResult {
  return {
    durationSeconds,
    bitrateKbps: 128,
    audioStreams: [AUDIO],
    audio: AUDIO,
    videoStreams: video ? [VIDEO] : [],
    video: video ? VIDEO : null,
    hasVideo: video,
    subtitleStreams: [],
    chapters,
    formatName: video ? "mov,mp4,m4a,3gp,3g2,mj2" : "mp3",
    log: [],
  };
}

function context(sourceExtension = "mp3", stripMetadata = false): PlanContext {
  return { trim: null, fileBytes: 50_000_000, sourceExtension, stripMetadata };
}

const joined = (args: string[]) => args.join(" ");

describe("chapter pieces", () => {
  it("offers a format per chapter the file has, labelled by its title", () => {
    expect(CHAPTER_FORMATS).toHaveLength(MAX_CHAPTERS);
    expect(chapterFormatIds(probe())).toEqual(["chapter-1", "chapter-2", "chapter-3"]);
    expect(chapterFormat(2).offer?.(probe(), context())).toBe(true);
    expect(chapterFormat(3).offer?.(probe(), context())).toBe(false);
    expect(chapterFormat(1).describe?.(probe())).toBe("Chapter 2: The First Part!");
    expect(chapterFormat(2).describe?.(probe())).toBe("Chapter 3");
    expect(describeChapter(undefined, 4)).toBe("Chapter 5");
  });

  it("cuts a chapter by stream copy, seeking before the input and titling the piece", () => {
    const plan = chapterFormat(1).plan(probe(), context());
    expect(plan.inputArgs).toEqual(["-ss", formatSeconds(90.5)]);
    expect(joined(plan.args)).toBe(
      `-map 0:a:0 -vn -sn -dn -t ${formatSeconds(109.5)} -c copy -avoid_negative_ts make_zero -map_chapters -1 -metadata title=The First Part! -metadata track=2/3`,
    );
    expect(plan.extension).toBe("mp3");
    expect(plan.mode).toBe("copy");
    expect(plan.kind).toBe("audio");
    expect(plan.fileSuffix).toBe("-02-the-first-part");
    expect(plan.durationFactor).toBeCloseTo(109.5 / 3600, 6);
    expect(plan.warning).toBeUndefined();
  });

  it("starts at zero without a seek, numbers an untitled chapter, and keeps a video's container", () => {
    const first = chapterFormat(0).plan(probe(true), context("mp4"));
    expect(first.inputArgs).toEqual([]);
    expect(joined(first.args)).toContain("-map 0:v:0 -map 0:a? -map 0:s? -dn -t");
    expect(joined(first.args)).toContain("-metadata title=Intro -metadata track=1/3 -movflags +faststart");
    expect(first.extension).toBe("mp4");
    expect(first.kind).toBe("video");
    expect(first.fileSuffix).toBe("-01-intro");
    expect(first.warning).toBeUndefined();

    const third = chapterFormat(2).plan(probe(true), context("mp4"));
    expect(joined(third.args)).toContain("-metadata title=Chapter 3 -metadata track=3/3");
    expect(third.fileSuffix).toBe("-03");
  });

  it("leaves the piece untitled when the tags are being stripped", () => {
    const plan = chapterFormat(0).plan(probe(), context("mp3", true));
    expect(joined(plan.args)).not.toContain("-metadata");
    expect(joined(plan.args)).toContain("-map_chapters -1");
  });

  it("runs a chapter with no end to the end of the file", () => {
    const open = probe(false, [{ startSeconds: 10, endSeconds: 0, title: "Open" }], 100);
    expect(chapterFormat(0).blocker?.(open, context())).toBeNull();
    expect(chapterFormat(0).plan(open, context()).args).toContain(formatSeconds(90));
  });

  it("refuses what cannot be cut, with the reason", () => {
    expect(chapterFormat(5).blocker?.(probe(), context())?.message).toBe("This file has no chapter 6.");
    const empty = probe(false, [{ startSeconds: 50, endSeconds: 50, title: "Empty" }], 100);
    expect(chapterFormat(0).blocker?.(empty, context())?.message).toMatch(/no length/);
    const late = probe(false, [{ startSeconds: 500, endSeconds: 600, title: "Late" }], 100);
    expect(chapterFormat(0).blocker?.(late, context())?.message).toMatch(/past the end/);
    // 4 GB over an hour: the last chapter is 3.8 GB of it, over the output ceiling.
    const huge = chapterFormat(2).blocker?.(probe(), { ...context(), fileBytes: 4_000_000_000 });
    expect(huge?.message).toMatch(/^This chapter would be about/);
    // The first is 90 seconds of it, which is fine.
    expect(chapterFormat(0).blocker?.(probe(), { ...context(), fileBytes: 4_000_000_000 })).toBeNull();
  });
});

describe("slugify", () => {
  it("makes a filename piece from a title", () => {
    expect(slugify("The First Part!")).toBe("the-first-part");
    expect(slugify("  ---  ")).toBe("");
    expect(slugify("Part one, in which a great many things happen at once")).toBe(
      "part-one-in-which-a-great-many-things",
    );
    expect(slugify("x".repeat(60))).toBe("x".repeat(40));
  });
});
