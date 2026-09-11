import { describe, expect, it } from "vitest";

import {
  ASPECT_CROPS,
  cropFilter,
  FRAME_FORMATS,
  frameFormat,
  resizeFormat,
  resizeScaleFilter,
  ROTATE_FORMATS,
  rotateFormat,
  sheetFormat,
  sheetLayout,
} from "@/lib/engine/picture";
import type { AudioStreamInfo, PlanContext, ProbeResult, VideoStreamInfo } from "@/lib/engine/types";

function probe(
  video: Partial<VideoStreamInfo> | null = {},
  audio: Partial<AudioStreamInfo> | null = {},
  durationSeconds: number | null = 60,
): ProbeResult {
  const videoStream: VideoStreamInfo | null = video
    ? {
        codec: "h264",
        profile: "High",
        pixelFormat: "yuv420p",
        width: 1920,
        height: 1080,
        fps: 30,
        bitrateKbps: 4500,
        rotationDegrees: null,
        ...video,
      }
    : null;
  const audioStream: AudioStreamInfo | null = audio
    ? {
        codec: "aac",
        profile: "LC",
        sampleRate: 48_000,
        channels: 2,
        channelLayout: "stereo",
        bitrateKbps: 192,
        ...audio,
      }
    : null;
  return {
    durationSeconds,
    bitrateKbps: 4700,
    audioStreams: audioStream ? [audioStream] : [],
    audio: audioStream,
    videoStreams: videoStream ? [videoStream] : [],
    video: videoStream,
    hasVideo: videoStream !== null,
    subtitleStreams: [],
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    log: [],
  };
}

const context = (
  trim: PlanContext["trim"] = null,
  sourceExtension: string | null = "mp4",
): PlanContext => ({ trim, fileBytes: 100_000_000, sourceExtension });
const joined = (args: string[]) => args.join(" ");

describe("cropFilter", () => {
  it("crops to the ratio from the centre, kept even, and not at all for keep", () => {
    expect(cropFilter("keep")).toBeNull();
    expect(cropFilter("16:9")).toBe("crop=w=floor(min(iw\\,ih*16/9)/2)*2:h=floor(min(ih\\,iw*9/16)/2)*2");
    expect(cropFilter("1:1")).toBe("crop=w=floor(min(iw\\,ih*1/1)/2)*2:h=floor(min(ih\\,iw*1/1)/2)*2");
    for (const aspect of ASPECT_CROPS) {
      if (aspect.id !== "keep") expect(cropFilter(aspect.id)).toContain("crop=");
    }
  });
});

describe("resizeScaleFilter", () => {
  it("boxes a height and halves or quarters by arithmetic, all even", () => {
    expect(resizeScaleFilter(720)).toContain("min(ih,720)");
    expect(resizeScaleFilter("half")).toBe("scale=trunc(iw/4)*2:trunc(ih/4)*2");
    expect(resizeScaleFilter("quarter")).toBe("scale=trunc(iw/8)*2:trunc(ih/8)*2");
  });
});

describe("the resizer", () => {
  it("crops then scales, encodes H.264, and copies audio the container keeps", () => {
    const format = resizeFormat({ target: 720, aspect: "9:16" });
    expect(format.id).toBe("resize-720-9x16");
    expect(format.label).toBe("720p, 9:16");
    const plan = format.plan(probe(), context());
    const filter = plan.args[plan.args.indexOf("-vf") + 1];
    expect(filter.startsWith("crop=")).toBe(true);
    expect(filter).toContain(",scale=");
    expect(joined(plan.args)).toContain("-c:v libx264");
    expect(joined(plan.args)).toContain("-c:a copy");
    expect(plan.extension).toBe("mp4");
    expect(plan.fileSuffix).toBe("-720p-9x16");
    expect(plan.kind).toBe("video");
  });

  it("keeps a MOV a MOV and moves a WebM to MP4, encoding audio the container cannot keep", () => {
    const format = resizeFormat({ target: 480, aspect: "keep" });
    expect(format.plan(probe(), context(null, "mov")).extension).toBe("mov");
    const fromWebm = format.plan(probe({ codec: "vp9" }, { codec: "opus" }), context(null, "webm"));
    expect(fromWebm.extension).toBe("mp4");
    expect(joined(fromWebm.args)).toContain("-c:a aac");
  });

  it("does not offer, and refuses as a note, a height the frame already fits", () => {
    const small = probe({ width: 1280, height: 720 });
    expect(resizeFormat({ target: 1080, aspect: "keep" }).offer!(small, context())).toBe(false);
    expect(resizeFormat({ target: 720, aspect: "keep" }).offer!(small, context())).toBe(false);
    expect(resizeFormat({ target: 480, aspect: "keep" }).offer!(small, context())).toBe(true);
    const blocker = resizeFormat({ target: 1080, aspect: "keep" }).blocker!(small, context());
    expect(blocker?.severity).toBe("info");
    expect(blocker?.message).toMatch(/already fits within 1080p/);
    // A crop changes the shape, so it is always worth offering.
    expect(resizeFormat({ target: 1080, aspect: "1:1" }).offer!(small, context())).toBe(true);
    expect(resizeFormat({ target: "half", aspect: "keep" }).offer!(small, context())).toBe(true);
  });

  it("names the fractions", () => {
    expect(resizeFormat({ target: "half", aspect: "keep" }).label).toBe("Half size");
    expect(resizeFormat({ target: "half", aspect: "keep" }).plan(probe(), context()).fileSuffix).toBe("-half");
  });
});

describe("the rotator", () => {
  it("offers five turns, each a filter and an encode", () => {
    expect(ROTATE_FORMATS.map((format) => format.id)).toEqual([
      "rotate-cw",
      "rotate-ccw",
      "rotate-180",
      "rotate-hflip",
      "rotate-vflip",
    ]);
    const plan = rotateFormat("cw").plan(probe(), context());
    expect(joined(plan.args)).toContain("-vf transpose=1");
    expect(joined(plan.args)).toContain("-c:v libx264");
    expect(plan.fileSuffix).toBe("-rotated-90");
    expect(joined(rotateFormat("ccw").plan(probe(), context()).args)).toContain("-vf transpose=2");
    expect(joined(rotateFormat("180").plan(probe(), context()).args)).toContain("-vf hflip,vflip");
    expect(rotateFormat("hflip").plan(probe(), context()).fileSuffix).toBe("-mirrored");
  });

  it("guards the encode's size", () => {
    const long = probe({ width: 3840, height: 2160 }, {}, 3 * 3600);
    expect(rotateFormat("cw").blocker!(long, context())?.message).toMatch(/rotated video would be about/);
    expect(rotateFormat("cw").blocker!(probe(), context())).toBeNull();
  });
});

describe("still frames", () => {
  it("writes one frame as JPEG or PNG through image2, named by its moment", () => {
    const jpg = frameFormat("jpg").plan(probe(), context());
    expect(joined(jpg.args)).toContain("-frames:v 1");
    expect(joined(jpg.args)).toContain("-c:v mjpeg");
    expect(joined(jpg.args)).toContain("-f image2 -update 1");
    expect(jpg.extension).toBe("jpg");
    expect(jpg.kind).toBe("image");
    expect(jpg.fileSuffix).toBe("-frame-at-0s");
    // The start marker names it; the range the card holds does not.
    const later = frameFormat("jpg").plan(probe(), context({ startSeconds: 90, endSeconds: null }));
    expect(later.fileSuffix).toBe("-frame-at-1m30s");
    expect(later.omitRangeSuffix).toBe(true);
    const png = frameFormat("png").plan(probe(), context());
    expect(joined(png.args)).toContain("-c:v png");
    expect(png.extension).toBe("png");
    expect(frameFormat("png").lossless).toBe(true);
    expect(FRAME_FORMATS).toHaveLength(2);
  });
});

describe("contact sheets", () => {
  it("lays frames out as near a square as they go", () => {
    expect(sheetLayout(9)).toEqual({ columns: 3, rows: 3 });
    expect(sheetLayout(12)).toEqual({ columns: 4, rows: 3 });
    expect(sheetLayout(20)).toEqual({ columns: 5, rows: 4 });
    expect(sheetLayout(4)).toEqual({ columns: 2, rows: 2 });
    expect(sheetLayout(1)).toEqual({ columns: 1, rows: 1 });
  });

  it("spaces the frames over the range and tiles them", () => {
    const format = sheetFormat({ frames: 9, width: 320 });
    expect(format.id).toBe("sheet-9-320");
    const whole = format.plan(probe({}, {}, 90), context());
    const filter = whole.args[whole.args.indexOf("-vf") + 1];
    // Nine frames over ninety seconds: one every ten.
    expect(filter).toContain("fps=0.100000");
    expect(filter).toContain("scale=320:-2");
    expect(filter).toContain("tile=3x3:padding=4:margin=4:color=black");
    expect(joined(whole.args)).toContain("-frames:v 1");
    expect(whole.kind).toBe("image");
    expect(whole.fileSuffix).toBe("-sheet-9");

    const clip = format.plan(probe({}, {}, 90), context({ startSeconds: 0, endSeconds: 18 }));
    expect(clip.args[clip.args.indexOf("-vf") + 1]).toContain("fps=0.500000");
  });

  it("refuses a file whose length is unknown, unless a range gives it one", () => {
    const format = sheetFormat({ frames: 9, width: 320 });
    expect(format.blocker!(probe({}, {}, null), context())?.message).toMatch(/length is unknown/);
    expect(format.blocker!(probe({}, {}, null), context({ startSeconds: 0, endSeconds: 30 }))).toBeNull();
    expect(format.blocker!(probe(), context())).toBeNull();
  });
});
