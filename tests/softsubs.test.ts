import { describe, expect, it } from "vitest";

import { isLanguageCode, subtitleCodecFor, subtitleTrackContainer, subtitleTrackFormat, type SubtitleTrackSource } from "@/lib/engine/softsubs";
import { MKV, MP4, WEBM } from "@/lib/engine/video";
import type { Cue } from "@/lib/subtitles";

import { AAC, context, H264, joined, probe } from "./fixtures";

const cues: Cue[] = [
  { start: 1, end: 2.5, text: "Hello there." },
  { start: 3, end: 4, text: "<i>Second</i> cue" },
];
const srt: SubtitleTrackSource = { name: "film.srt", cues, ass: null };
const ass: SubtitleTrackSource = { name: "film.ass", cues, ass: "[Script Info]\nTitle: x\n" };

describe("a subtitle track", () => {
  it("validates a language code", () => {
    expect(isLanguageCode("eng")).toBe(true);
    expect(isLanguageCode("en")).toBe(false);
    expect(isLanguageCode("ENG")).toBe(false);
  });

  it("writes the file as whatever the container wants", () => {
    expect(subtitleCodecFor(MP4, srt)).toMatchObject({ encoder: "mov_text", scratch: { path: "/track/subtitles.srt" } });
    expect(subtitleCodecFor(MKV, srt)).toMatchObject({ encoder: "copy", scratch: { path: "/track/subtitles.srt" } });
    expect(subtitleCodecFor(MKV, ass)).toMatchObject({ encoder: "copy", scratch: { path: "/track/subtitles.ass", contents: ass.ass } });
    expect(subtitleCodecFor(WEBM, ass)).toMatchObject({ encoder: "webvtt", scratch: { path: "/track/subtitles.srt" } });
    expect(String(subtitleCodecFor(MP4, srt).scratch.contents)).toContain("00:00:01,000 --> 00:00:02,500");
  });

  it("keeps the source container where it holds a text track", () => {
    expect(subtitleTrackContainer(probe(), context())).toBe(MP4);
    expect(subtitleTrackContainer(probe(), context({ sourceExtension: "mkv" }))).toBe(MKV);
    expect(subtitleTrackContainer(probe({ video: { ...H264, codec: "vp9" }, audio: { ...AAC, codec: "opus" } }), context({ sourceExtension: "webm" }))).toBe(WEBM);
    // An AVI has nowhere for a text track; Matroska takes it.
    expect(subtitleTrackContainer(probe({ video: { ...H264, codec: "mpeg4" }, audio: { ...AAC, codec: "mp2" } }), context({ sourceExtension: "avi" }))).toBe(MKV);
  });

  it("adds the track first among the subtitles, tagged and marked default, with everything else copied", () => {
    const format = subtitleTrackFormat(srt, { language: "eng", title: "English (SDH)", makeDefault: true });
    expect(format.id).toMatch(/^subtitle-track-[0-9a-z]+-eng-[0-9a-z]+-default$/);
    const plan = format.plan(probe(), context());
    expect(joined(plan.args)).toBe(
      "-i /track/subtitles.srt -map 0:v:0 -map 0:a? -map 1:0 -dn -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=eng -metadata:s:s:0 handler_name=English (SDH) -disposition:s:0 default -movflags +faststart",
    );
    expect(plan.scratchFiles?.[0].path).toBe("/track/subtitles.srt");
    expect(plan.mode).toBe("copy");
    expect(plan.kind).toBe("video");
    expect(plan.fileSuffix).toBe("-subtitled-eng");
  });

  it("keeps the file's own text tracks and drops them when one is a bitmap", () => {
    const withText = probe({ subtitleStreams: [{ codec: "mov_text", language: "spa", title: null }] });
    const kept = subtitleTrackFormat(srt, { language: "eng", title: "Named", makeDefault: false }).plan(withText, context({ sourceExtension: "mkv" }));
    expect(joined(kept.args)).toContain("-map 1:0 -map 0:s -dn");
    expect(joined(kept.args)).toContain("-c:s copy -metadata:s:s:0 language=eng -metadata:s:s:0 title=Named");
    expect(joined(kept.args)).toContain("-disposition:s:0 0");
    expect(kept.warning).toBeUndefined();

    const withBitmap = probe({ subtitleStreams: [{ codec: "hdmv_pgs_subtitle", language: "eng", title: null }] });
    const dropped = subtitleTrackFormat(srt, { language: "xx", title: "", makeDefault: false }).plan(withBitmap, context({ sourceExtension: "mkv" }));
    expect(joined(dropped.args)).not.toContain("-map 0:s");
    expect(joined(dropped.args)).toContain("-c:s copy -metadata:s:s:0 language=und");
    expect(dropped.warning).toMatch(/image-based/);
  });

  it("refuses a file with no picture and a subtitle file with nothing in it", () => {
    const format = subtitleTrackFormat(srt, { language: "eng", title: "", makeDefault: true });
    expect(format.blocker?.(probe({ video: null }), context())?.message).toMatch(/no picture/);
    expect(subtitleTrackFormat({ ...srt, cues: [] }, { language: "eng", title: "", makeDefault: true }).blocker?.(probe(), context())?.message).toMatch(/no cues/);
    expect(format.blocker?.(probe(), context())).toBeNull();
  });
});
