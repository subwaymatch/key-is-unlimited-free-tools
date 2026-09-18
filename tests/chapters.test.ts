import { describe, expect, it } from "vitest";

import { CHAPTERS_PATH, chaptersFormat, chaptersMetadata, LEAD_IN_TITLE, parseChapterList, withLeadIn } from "@/lib/engine/chapters";
import type { AudioStreamInfo, PlanContext, ProbeResult, VideoStreamInfo } from "@/lib/engine/types";

function probe(
  video: Partial<VideoStreamInfo> | null = null,
  audio: Partial<AudioStreamInfo> | null = {},
  durationSeconds: number | null = 200,
): ProbeResult {
  const videoStream: VideoStreamInfo | null = video
    ? { codec: "h264", profile: "High", pixelFormat: "yuv420p", width: 1280, height: 720, fps: 30, bitrateKbps: 2500, rotationDegrees: null, ...video }
    : null;
  const audioStream: AudioStreamInfo | null = audio
    ? { codec: "aac", profile: "LC", sampleRate: 48_000, channels: 2, channelLayout: "stereo", bitrateKbps: 128, language: null, title: null, ...audio }
    : null;
  return {
    durationSeconds,
    bitrateKbps: 128,
    audioStreams: audioStream ? [audioStream] : [],
    audio: audioStream,
    videoStreams: videoStream ? [videoStream] : [],
    video: videoStream,
    hasVideo: videoStream !== null,
    subtitleStreams: [],
    chapters: [],
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    log: [],
  };
}

const context = (sourceExtension: string | null = "m4a", stripMetadata = false): PlanContext => ({
  trim: null,
  fileBytes: 5_000_000,
  sourceExtension,
  stripMetadata,
});
const joined = (args: string[]) => args.join(" ");

const LIST = "0:00 Intro\n1:30.5 - Part one: the middle\n[1:02:03] Finale\n";

describe("parseChapterList", () => {
  it("reads a time and a title per line, in the forms people paste", () => {
    expect(parseChapterList(LIST).chapters).toEqual([
      { startSeconds: 0, title: "Intro" },
      { startSeconds: 90.5, title: "Part one: the middle" },
      { startSeconds: 3723, title: "Finale" },
    ]);
  });

  it("sorts, numbers the untitled, skips repeats and says what it skipped", () => {
    const parsed = parseChapterList("5:00\n0:00 Start\nnot a chapter\n5:00 Again\n\n");
    expect(parsed.chapters).toEqual([
      { startSeconds: 0, title: "Start" },
      { startSeconds: 300, title: "Chapter 2" },
    ]);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.warnings[0]).toMatch(/Line 3 does not start with a time/);
    expect(parsed.warnings[1]).toMatch(/Line 4 repeats the time 5:00/);
  });
});

describe("chaptersMetadata", () => {
  it("runs each chapter to the next, the last to the end, escaping what ffmetadata reads", () => {
    const text = chaptersMetadata(
      [
        { startSeconds: 0, title: "Intro" },
        { startSeconds: 90.5, title: "A=B; #1" },
        { startSeconds: 250, title: "Past the end" },
      ],
      200,
    );
    expect(text.startsWith(";FFMETADATA1\n")).toBe(true);
    expect(text).toContain("[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=90500\ntitle=Intro");
    expect(text).toContain("START=90500\nEND=200000\ntitle=A\\=B\\; \\#1");
    expect(text).not.toContain("Past the end");
  });
});

describe("the chapters format", () => {
  const format = chaptersFormat(LIST);

  it("copies every stream and takes its chapters from the metadata file", () => {
    const plan = format.plan(probe(), context());
    expect(joined(plan.args)).toBe(
      `-i ${CHAPTERS_PATH} -map 0:a:0 -vn -sn -dn -map_metadata:g 0 -map_chapters 1 -c copy -movflags +faststart`,
    );
    expect(plan.scratchFiles?.[0].path).toBe(CHAPTERS_PATH);
    expect(plan.scratchFiles?.[0].contents).toContain("title=Intro");
    expect(plan.extension).toBe("m4a");
    expect(plan.mode).toBe("copy");
    expect(plan.kind).toBe("audio");
    expect(plan.fileSuffix).toBe("-chapters");
    expect(plan.stripsMetadata).toBe(true);
    expect(format.label).toBe("3 chapters");
  });

  it("keeps a video's picture, sound and subtitles, and its container", () => {
    const plan = format.plan(probe({}, {}, 4000), context("mkv"));
    expect(joined(plan.args)).toContain("-map 0:v:0 -map 0:a? -map 0:s? -dn");
    expect(plan.extension).toBe("mkv");
    expect(plan.kind).toBe("video");
    expect(plan.warning).toBeUndefined();
  });

  it("strips the source's tags itself when asked, since the engine must not", () => {
    const plan = format.plan(probe(), context("m4a", true));
    expect(joined(plan.args)).toContain("-map_metadata:g -1 -map_chapters 1");
    expect(joined(plan.args)).toContain("-fflags +bitexact");
  });

  it("leaves out chapters past the end and says so", () => {
    const plan = format.plan(probe(null, {}, 100), context());
    expect(plan.scratchFiles?.[0].contents).not.toContain("Finale");
    expect(plan.warning).toMatch(/1 chapter starts at or after the end/);
  });

  it("refuses what cannot work, with the way out", () => {
    expect(chaptersFormat("").blocker!(probe(), context())?.message).toMatch(/no chapters to add/);
    expect(format.blocker!(probe(null, {}, null), context())?.message).toMatch(/length is unknown/);
    expect(format.blocker!(probe(null, { codec: "flac" }), context("flac"))?.message).toMatch(/FLAC file cannot carry chapters/);
    expect(format.blocker!(probe(null, { codec: "pcm_s16le" }), context("wav"))?.message).toMatch(/WAV file cannot carry chapters/);
    expect(chaptersFormat("10:00 Late").blocker!(probe(null, {}, 100), context())?.message).toMatch(/after the end/);
    expect(format.blocker!(probe(null, { codec: "mp3" }), context("mp3"))).toBeNull();
    expect(format.blocker!(probe(), context())).toBeNull();
  });
});

describe("the gap before the first chapter", () => {
  it("covers it with one chapter, and leaves a list that starts at zero alone", () => {
    expect(withLeadIn([{ startSeconds: 2, title: "Intro" }])).toEqual([
      { startSeconds: 0, title: LEAD_IN_TITLE },
      { startSeconds: 2, title: "Intro" },
    ]);
    const atZero = [{ startSeconds: 0, title: "Intro" }];
    expect(withLeadIn(atZero)).toEqual(atZero);
    expect(withLeadIn([])).toEqual([]);
  });

  it("writes it into an MP4's metadata, and says so", () => {
    const format = chaptersFormat("0:02 Intro\n0:04 Part two");
    const plan = format.plan(probe({ codec: "h264" }, {}, 6), context("mp4"));
    const written = String(plan.scratchFiles?.[0].contents);
    // The QuickTime chapter track covers the file from zero whatever the
    // list says, so the list is given something to put there.
    expect(written).toContain(`title=${LEAD_IN_TITLE}`);
    expect(written).toContain("START=0\nEND=2000");
    expect(written).toContain("START=2000\nEND=4000");
    expect(plan.warning).toMatch(/opening chapter/);
  });

  it("leaves the gap when asked, and warns instead", () => {
    const plan = chaptersFormat("0:02 Intro", false).plan(probe({ codec: "h264" }, {}, 6), context("mp4"));
    expect(String(plan.scratchFiles?.[0].contents)).not.toContain(`title=${LEAD_IN_TITLE}`);
    expect(plan.warning).toMatch(/QuickTime chapter track/);
  });

  it("leaves an MP3 alone: it has one chapter list, not two", () => {
    const plan = chaptersFormat("0:02 Intro").plan(probe(null, { codec: "mp3" }, 6), context("mp3"));
    expect(String(plan.scratchFiles?.[0].contents)).not.toContain(`title=${LEAD_IN_TITLE}`);
  });
});
