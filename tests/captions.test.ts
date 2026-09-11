import { describe, expect, it } from "vitest";

import {
  CAPTION_FORMATS,
  captionFormat,
  describeTrack,
  isBitmapSubtitle,
  MAX_SUBTITLE_TRACKS,
} from "@/lib/engine/captions";
import type { ProbeResult, SubtitleStreamInfo } from "@/lib/engine/types";

function probe(subtitleStreams: SubtitleStreamInfo[]): ProbeResult {
  return {
    durationSeconds: 100,
    bitrateKbps: 1000,
    audioStreams: [],
    audio: null,
    videoStreams: [],
    video: null,
    hasVideo: true,
    subtitleStreams,
    formatName: "matroska,webm",
    log: [],
  };
}

const context = { trim: null, fileBytes: 1000 };
const eng: SubtitleStreamInfo = { codec: "subrip", language: "eng", title: null };
const spa: SubtitleStreamInfo = { codec: "ass", language: "spa", title: "Spanish (forced)" };
const pgs: SubtitleStreamInfo = { codec: "hdmv_pgs_subtitle", language: "eng", title: null };

describe("captionFormat", () => {
  it("copies a track through the subtitle encoder into an SRT or a WebVTT file", () => {
    const srt = captionFormat(0, "srt");
    expect(srt.id).toBe("subtitles-1-srt");
    expect(srt.requiredEncoder).toBe("srt");
    const plan = srt.plan(probe([eng]), context);
    expect(plan.args.join(" ")).toBe("-map 0:s:0 -vn -an -dn -c:s srt -f srt");
    expect(plan.extension).toBe("srt");
    expect(plan.kind).toBe("text");
    expect(plan.fileSuffix).toBe("-eng");

    const vtt = captionFormat(1, "vtt").plan(probe([eng, spa]), context);
    expect(vtt.args.join(" ")).toBe("-map 0:s:1 -vn -an -dn -c:s webvtt -f webvtt");
    expect(vtt.extension).toBe("vtt");
    expect(vtt.fileSuffix).toBe("-spa");
  });

  it("names a track without a language by its number", () => {
    const plan = captionFormat(0, "srt").plan(probe([{ codec: "subrip", language: null, title: null }]), context);
    expect(plan.fileSuffix).toBe("-track1");
  });

  it("offers only the tracks the file has", () => {
    const two = probe([eng, spa]);
    expect(captionFormat(0, "srt").offer!(two, context)).toBe(true);
    expect(captionFormat(1, "srt").offer!(two, context)).toBe(true);
    expect(captionFormat(2, "srt").offer!(two, context)).toBe(false);
  });

  it("refuses a missing track and an image-based one, with a reason", () => {
    expect(captionFormat(2, "srt").blocker!(probe([eng]), context)?.message).toMatch(/no subtitle track 3/);
    const bitmap = captionFormat(0, "srt").blocker!(probe([pgs]), context);
    expect(bitmap?.message).toMatch(/image-based \(hdmv_pgs_subtitle\)/);
    expect(bitmap?.hint).toMatch(/OCR/);
    expect(captionFormat(0, "srt").blocker!(probe([eng]), context)).toBeNull();
  });
});

describe("the caption catalogue", () => {
  it("covers every track twice, SRT first", () => {
    expect(CAPTION_FORMATS).toHaveLength(MAX_SUBTITLE_TRACKS * 2);
    expect(CAPTION_FORMATS[0].id).toBe("subtitles-1-srt");
    expect(CAPTION_FORMATS[1].id).toBe("subtitles-1-vtt");
    expect(new Set(CAPTION_FORMATS.map((format) => format.id)).size).toBe(CAPTION_FORMATS.length);
  });

  it("knows which codecs are pictures", () => {
    expect(isBitmapSubtitle("hdmv_pgs_subtitle")).toBe(true);
    expect(isBitmapSubtitle("dvd_subtitle")).toBe(true);
    expect(isBitmapSubtitle("subrip")).toBe(false);
    expect(isBitmapSubtitle("mov_text")).toBe(false);
  });

  it("describes a track by what it has", () => {
    expect(describeTrack(eng, 0)).toBe("eng");
    expect(describeTrack(spa, 1)).toBe("Spanish (forced) (spa)");
    expect(describeTrack({ codec: "subrip", language: null, title: null }, 2)).toBe("track 3");
    expect(describeTrack(undefined, 0)).toBe("track 1");
  });
});
