import { describe, expect, it } from "vitest";

import {
  BURN_FONT_PATH,
  BURN_SUBTITLE_PATH,
  burnFileFormat,
  burnTrackFormat,
  subtitlesFilter,
  textFingerprint,
} from "@/lib/engine/burn";
import type { ProbeResult, SubtitleStreamInfo } from "@/lib/engine/types";

function probe(subtitleStreams: SubtitleStreamInfo[] = [], audio = true): ProbeResult {
  return {
    durationSeconds: 60,
    bitrateKbps: 3000,
    audioStreams: [],
    audio: audio
      ? { codec: "aac", profile: "LC", sampleRate: 48_000, channels: 2, channelLayout: "stereo", bitrateKbps: 128 }
      : null,
    videoStreams: [],
    video: {
      codec: "h264",
      profile: "High",
      pixelFormat: "yuv420p",
      width: 1280,
      height: 720,
      fps: 30,
      bitrateKbps: 2800,
      rotationDegrees: null,
    },
    hasVideo: true,
    subtitleStreams,
    formatName: "matroska,webm",
    log: [],
  };
}

const context = { trim: null, fileBytes: 20_000_000, sourceExtension: "mkv", inputPath: "/input/source.mkv" };
const font = new Uint8Array([0, 1, 2, 3]);
const joined = (args: string[]) => args.join(" ");

describe("subtitlesFilter", () => {
  it("names the file, the font directory and the family", () => {
    expect(subtitlesFilter("/subtitles.ass")).toBe(
      "subtitles=filename=/subtitles.ass:fontsdir=/fonts:force_style='FontName=DejaVu Sans'",
    );
  });

  it("picks a stream out of a container", () => {
    expect(subtitlesFilter("/input/source.mkv", 1)).toContain("filename=/input/source.mkv:si=1:");
  });
});

describe("burning a file", () => {
  const source = { name: "movie.srt", ass: "[Script Info]\nScriptType: v4.00+\n" };
  const format = burnFileFormat(source, font);

  it("writes the subtitles and the font into the core for the run", () => {
    const plan = format.plan(probe(), context);
    expect(plan.scratchFiles).toEqual([
      { path: BURN_SUBTITLE_PATH, contents: source.ass },
      { path: BURN_FONT_PATH, contents: font },
    ]);
    expect(joined(plan.args)).toContain(`-vf subtitles=filename=${BURN_SUBTITLE_PATH}:fontsdir=/fonts`);
    expect(joined(plan.args)).toContain("-c:v libx264");
    expect(joined(plan.args)).toContain("-c:a copy");
    expect(plan.extension).toBe("mkv");
    expect(plan.fileSuffix).toBe("-subtitled");
    expect(plan.kind).toBe("video");
  });

  it("is a different format for a different file", () => {
    expect(format.id).toBe(`burn-file-${textFingerprint(source.ass)}`);
    expect(burnFileFormat({ name: "other.srt", ass: "different" }, font).id).not.toBe(format.id);
    expect(format.label).toBe("Burn movie.srt");
  });

  it("guards the encode's size", () => {
    expect(format.blocker!(probe(), context)).toBeNull();
    const long = { ...probe(), durationSeconds: 8 * 3600, video: { ...probe().video!, width: 3840, height: 2160 } };
    expect(format.blocker!(long, context)?.message).toMatch(/subtitled video would be about/);
  });
});

describe("burning the file's own track", () => {
  const text: SubtitleStreamInfo = { codec: "subrip", language: "eng", title: null };
  const bitmap: SubtitleStreamInfo = { codec: "hdmv_pgs_subtitle", language: "eng", title: null };

  it("reads the track straight out of the mounted input", () => {
    const plan = burnTrackFormat(1, font).plan(probe([text, text]), context);
    expect(joined(plan.args)).toContain("-vf subtitles=filename=/input/source.mkv:si=1:fontsdir=/fonts");
    expect(plan.scratchFiles).toEqual([{ path: BURN_FONT_PATH, contents: font }]);
    expect(plan.fileSuffix).toBe("-subtitled-track2");
  });

  it("offers only the text tracks the file has", () => {
    const format = burnTrackFormat(0, font);
    expect(format.offer!(probe([text]), context)).toBe(true);
    expect(format.offer!(probe([bitmap]), context)).toBe(false);
    expect(format.offer!(probe([]), context)).toBe(false);
    expect(burnTrackFormat(1, font).offer!(probe([text]), context)).toBe(false);
  });

  it("refuses a missing or image-based track with a reason", () => {
    expect(burnTrackFormat(0, font).blocker!(probe([]), context)?.message).toMatch(/no subtitle track 1/);
    expect(burnTrackFormat(0, font).blocker!(probe([bitmap]), context)?.message).toMatch(/image-based/);
    expect(burnTrackFormat(0, font).blocker!(probe([text]), context)).toBeNull();
  });
});

describe("textFingerprint", () => {
  it("is stable and short", () => {
    expect(textFingerprint("abc")).toBe(textFingerprint("abc"));
    expect(textFingerprint("abc")).not.toBe(textFingerprint("abd"));
    expect(textFingerprint("abc").length).toBeLessThan(10);
  });
});
