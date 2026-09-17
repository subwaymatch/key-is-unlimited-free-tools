import { describe, expect, it } from "vitest";

import { DEFAULT_GIF_VIDEO_SETTINGS, gifOutputFps, gifVideoFilter, gifVideoFormat } from "@/lib/engine/animated";
import { describeLoop, LOOP_FORMATS, loopCount, loopFormat, parseLoopTimes } from "@/lib/engine/loop";

import { context, H264, joined, MP3, probe } from "./fixtures";

describe("loop", () => {
  it("describes and counts a target", () => {
    expect(describeLoop({ kind: "times", times: 3 })).toBe("3 times over");
    expect(describeLoop({ kind: "seconds", seconds: 3600 })).toBe("to 1 hour");
    expect(describeLoop({ kind: "seconds", seconds: 90 })).toBe("to 90 seconds");
    expect(loopCount({ kind: "times", times: 4 }, null)).toBe(4);
    expect(loopCount({ kind: "seconds", seconds: 60 }, 10)).toBe(6);
    expect(loopCount({ kind: "seconds", seconds: 60 }, null)).toBeNull();
    expect(parseLoopTimes(3)).toBe(3);
    expect(parseLoopTimes(1)).toBeNull();
    expect(parseLoopTimes(2.5)).toBeNull();
    expect(LOOP_FORMATS.map((format) => format.id)).toEqual(["loop-2x", "loop-3x", "loop-4x", "loop-5x", "loop-10x", "loop-60s", "loop-600s", "loop-3600s"]);
  });

  it("repeats a video a number of times by stream copy, on the output's clock", () => {
    const format = loopFormat({ kind: "times", times: 3 });
    expect(format.label).toBe("3 times over");
    const plan = format.plan(probe(), context());
    expect(plan.inputArgs).toEqual(["-stream_loop", "2"]);
    expect(joined(plan.args)).toBe("-map 0:v:0 -map 0:a? -map 0:s? -dn -c copy -map_chapters -1 -movflags +faststart");
    expect(plan.mode).toBe("copy");
    expect(plan.kind).toBe("video");
    expect(plan.durationFactor).toBe(3);
    expect(plan.fileSuffix).toBe("-x3");
  });

  it("loops an audio file without end and cuts it at the length", () => {
    const plan = loopFormat({ kind: "seconds", seconds: 3600 }).plan(probe({ video: null, audio: MP3, durationSeconds: 8 }), context({ sourceExtension: "mp3" }));
    expect(plan.inputArgs).toEqual(["-stream_loop", "-1"]);
    expect(joined(plan.args)).toBe("-map 0:a:0 -vn -sn -dn -t 3600.000 -c copy -map_chapters -1");
    expect(plan.extension).toBe("mp3");
    expect(plan.kind).toBe("audio");
    expect(plan.durationFactor).toBe(450);
    expect(plan.fileSuffix).toBe("-3600s-loop");
  });

  it("refuses a length the file already has, an unknown length, and a loop past the ceiling", () => {
    const toMinute = loopFormat({ kind: "seconds", seconds: 60 });
    expect(toMinute.blocker?.(probe({ durationSeconds: 90 }), context())?.severity).toBe("info");
    expect(toMinute.blocker?.(probe({ durationSeconds: null }), context())?.message).toMatch(/length is unknown/);
    expect(toMinute.blocker?.(probe({ durationSeconds: 10 }), context({ fileBytes: 300_000_000 }))?.message).toMatch(/^The looped file would be about/);
    expect(loopFormat({ kind: "times", times: 2 }).blocker?.(probe({ durationSeconds: null }), context())).toBeNull();
    expect(loopFormat({ kind: "times", times: 10 }).blocker?.(probe(), context())?.message).toMatch(/^The looped file/);
  });
});

describe("GIF to video", () => {
  it("keeps a real frame rate and steadies a slow one", () => {
    expect(gifOutputFps(30)).toBe(30);
    expect(gifOutputFps(24)).toBe(24);
    expect(gifOutputFps(10)).toBe(30);
    expect(gifOutputFps(null)).toBe(30);
    expect(gifVideoFilter(12.5)).toBe("fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p");
  });

  it("encodes an MP4 with even edges, and a WebM in VP8", () => {
    const gif = probe({ video: { ...H264, codec: "gif", pixelFormat: "bgra", width: 481, height: 271, fps: 10 }, audio: null, durationSeconds: 2.4, formatName: "gif" });
    const mp4 = gifVideoFormat(DEFAULT_GIF_VIDEO_SETTINGS);
    expect(mp4.id).toBe("gif-mp4-x1");
    const plan = mp4.plan(gif, context({ sourceExtension: "gif" }));
    expect(plan.inputArgs).toEqual([]);
    expect(joined(plan.args)).toBe(
      "-map 0:v:0 -an -sn -dn -vf fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 -movflags +faststart",
    );
    expect(plan.extension).toBe("mp4");
    expect(plan.fileSuffix).toBe("");
    expect(plan.durationFactor).toBe(1);

    const webm = gifVideoFormat({ target: "webm", plays: 3 }).plan(gif, context({ sourceExtension: "gif" }));
    expect(webm.inputArgs).toEqual(["-stream_loop", "2"]);
    expect(joined(webm.args)).toContain("-c:v libvpx -b:v");
    expect(webm.extension).toBe("webm");
    expect(webm.fileSuffix).toBe("-x3");
    expect(webm.durationFactor).toBe(3);
  });

  it("refuses a still and a file with no picture", () => {
    const still = probe({ video: { ...H264, codec: "gif" }, audio: null, durationSeconds: 0.04 });
    expect(gifVideoFormat(DEFAULT_GIF_VIDEO_SETTINGS).blocker?.(still, context())?.message).toMatch(/single frame/);
    expect(gifVideoFormat(DEFAULT_GIF_VIDEO_SETTINGS).blocker?.(probe({ video: null }), context())?.message).toMatch(/no picture/);
    expect(gifVideoFormat(DEFAULT_GIF_VIDEO_SETTINGS).blocker?.(probe({ video: { ...H264, codec: "gif" }, audio: null, durationSeconds: 3 }), context())).toBeNull();
  });
});
