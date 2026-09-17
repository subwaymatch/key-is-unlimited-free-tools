import { describe, expect, it } from "vitest";

import { BURN_FONT_PATH } from "@/lib/engine/burn";
import { describeFrame, describeYield, frameAtFormat, frameFormatIds, frameFormats, frameTimes, MAX_FRAMES, parseInterval } from "@/lib/engine/frames";
import { DEFAULT_WATERMARK_SETTINGS, imageWatermarkFormat, imageWatermarkGraph, overlayPosition, textPosition, textWatermarkFilter, textWatermarkFormat } from "@/lib/engine/watermark";

import { context, joined, probe } from "./fixtures";

const logo = { name: "logo.png", bytes: new Uint8Array([137, 80]), mimeType: "image/png", key: "logo-2-1" };
const font = new Uint8Array([1, 2, 3]);

describe("video watermark", () => {
  it("places the mark by corner in the filters' own variables", () => {
    expect(overlayPosition("bottom-right", 0.03)).toEqual({ x: "main_w-overlay_w-main_w*0.03", y: "main_h-overlay_h-main_w*0.03" });
    expect(overlayPosition("center", 0.03)).toEqual({ x: "(main_w-overlay_w)/2", y: "(main_h-overlay_h)/2" });
    expect(textPosition("top-left", 0.03)).toEqual({ x: "w*0.03", y: "w*0.03" });
    expect(textPosition("bottom-left", 0.03)).toEqual({ x: "w*0.03", y: "h-th-w*0.03" });
  });

  it("lays a picture over every frame, scaled against the frame and made translucent", () => {
    expect(imageWatermarkGraph(DEFAULT_WATERMARK_SETTINGS)).toBe(
      "[1:v]format=rgba,colorchannelmixer=aa=0.7[mark];[mark][0:v:0]scale2ref=w='iw*0.2':h='ow/mdar'[scaled][base];[base][scaled]overlay=x='main_w-overlay_w-main_w*0.03':y='main_h-overlay_h-main_w*0.03':format=auto[v]",
    );
    const format = imageWatermarkFormat(logo, DEFAULT_WATERMARK_SETTINGS);
    expect(format.id).toBe("watermark-image-logo-2-1-bottom-right-0.2-0.7");
    const plan = format.plan(probe(), context());
    expect(joined(plan.args)).toBe(
      `-i /watermark/mark.png -filter_complex ${imageWatermarkGraph(DEFAULT_WATERMARK_SETTINGS)} -map [v] -map 0:a:0? -sn -dn -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 -c:a copy -movflags +faststart`,
    );
    expect(plan.scratchFiles).toEqual([{ path: "/watermark/mark.png", contents: logo.bytes }]);
    expect(plan.kind).toBe("video");
    expect(plan.fileSuffix).toBe("-watermarked");
  });

  it("draws text from a file with the shipped font", () => {
    expect(textWatermarkFilter({ ...DEFAULT_WATERMARK_SETTINGS, position: "top-right" })).toBe(
      `drawtext=fontfile=${BURN_FONT_PATH}:textfile=/watermark/text.txt:fontsize=h*0.05:fontcolor=white@0.7:borderw=2:bordercolor=black@0.7:x='w-tw-w*0.03':y='w*0.03'`,
    );
    const plan = textWatermarkFormat("(c) Someone\n2024", font, DEFAULT_WATERMARK_SETTINGS).plan(probe(), context({ sourceExtension: "mkv" }));
    expect(joined(plan.args)).toContain("-vf drawtext=fontfile=");
    expect(plan.scratchFiles).toEqual([
      { path: BURN_FONT_PATH, contents: font },
      { path: "/watermark/text.txt", contents: "(c) Someone 2024" },
    ]);
    expect(plan.extension).toBe("mkv");
  });

  it("refuses a file with no picture and empty text", () => {
    expect(imageWatermarkFormat(logo, DEFAULT_WATERMARK_SETTINGS).blocker?.(probe({ video: null }), context())?.message).toMatch(/no picture/);
    expect(textWatermarkFormat("  ", font, DEFAULT_WATERMARK_SETTINGS).blocker?.(probe(), context())?.message).toMatch(/no text/);
    expect(textWatermarkFormat("x", font, DEFAULT_WATERMARK_SETTINGS).blocker?.(probe(), context())).toBeNull();
  });
});

describe("frames every so many seconds", () => {
  it("places the moments from the start to the end, capped", () => {
    expect(frameTimes(12, 5)).toEqual([0, 5, 10]);
    expect(frameTimes(10, 5)).toEqual([0, 5]);
    expect(frameTimes(null, 5)).toEqual([]);
    expect(frameTimes(1000, 1)).toHaveLength(MAX_FRAMES);
    expect(parseInterval(2.55)).toBe(2.6);
    expect(parseInterval(0)).toBeNull();
    expect(describeFrame([0, 5, 10], 2)).toBe("Frame 3 at 0:10");
    expect(describeYield(12, 5)).toBe("3 frames");
    expect(describeYield(1000, 1)).toBe("64 frames, the first 1:04 of the file");
    expect(describeYield(null, 5)).toBeNull();
  });

  it("seeks to each moment and writes one frame, named by it", () => {
    const settings = { everySeconds: 5, image: "jpg" as const };
    expect(frameFormats(settings)).toHaveLength(MAX_FRAMES);
    expect(frameFormatIds(settings)(probe({ durationSeconds: 12 }))).toEqual(["frame-1", "frame-2", "frame-3"]);
    const third = frameAtFormat(2, settings);
    expect(third.describe?.(probe({ durationSeconds: 12 }))).toBe("Frame 3 at 0:10");
    expect(third.offer?.(probe({ durationSeconds: 12 }), context())).toBe(true);
    expect(frameAtFormat(3, settings).offer?.(probe({ durationSeconds: 12 }), context())).toBe(false);
    const plan = third.plan(probe({ durationSeconds: 12 }), context());
    expect(plan.inputArgs).toEqual(["-ss", "10.000"]);
    expect(joined(plan.args)).toBe("-map 0:v:0 -an -sn -dn -frames:v 1 -c:v mjpeg -q:v 2 -f image2 -update 1");
    expect(plan.fileSuffix).toBe("-frame-03-at-10s");
    expect(plan.omitRangeSuffix).toBe(true);
    const first = frameAtFormat(0, { everySeconds: 5, image: "png" }).plan(probe({ durationSeconds: 12 }), context());
    expect(first.inputArgs).toEqual([]);
    expect(joined(first.args)).toContain("-c:v png");
  });

  it("refuses what cannot be placed", () => {
    const settings = { everySeconds: 5, image: "jpg" as const };
    expect(frameAtFormat(0, settings).blocker?.(probe({ video: null }), context())?.message).toMatch(/no picture/);
    expect(frameAtFormat(0, settings).blocker?.(probe({ durationSeconds: null }), context())?.message).toMatch(/length is unknown/);
    expect(frameAtFormat(5, settings).blocker?.(probe({ durationSeconds: 12 }), context())?.message).toBe("This file has no frame 6 at that interval.");
    expect(frameAtFormat(1, settings).blocker?.(probe({ durationSeconds: 12 }), context())).toBeNull();
  });
});
