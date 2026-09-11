import { describe, expect, it } from "vitest";

import {
  assessMerge,
  concatGraph,
  concatList,
  displaySize,
  findMismatches,
  mergeBlocker,
  mergeCanvas,
  mergePlan,
  type MergeClip,
} from "@/lib/engine/merge";
import type { AudioStreamInfo, ProbeResult, VideoStreamInfo } from "@/lib/engine/types";

function probe(
  video: Partial<VideoStreamInfo> | null = {},
  audio: Partial<AudioStreamInfo> | null = {},
  durationSeconds: number | null = 10,
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
    chapters: [],
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    log: [],
  };
}

let counter = 0;
function clip(
  video: Partial<VideoStreamInfo> | null = {},
  audio: Partial<AudioStreamInfo> | null = {},
  durationSeconds: number | null = 10,
  fileName = `clip-${(counter += 1)}.mp4`,
): MergeClip {
  return {
    fileName,
    fileBytes: 10_000_000,
    probe: probe(video, audio, durationSeconds),
    inputPath: `/input/source-${counter}.mp4`,
  };
}

const joined = (args: string[]) => args.join(" ");

describe("findMismatches", () => {
  it("finds nothing to say about clips that match", () => {
    expect(findMismatches([clip(), clip(), clip()])).toEqual([]);
  });

  it("names the clip and what differs, against clip 1", () => {
    const mismatches = findMismatches([clip(), clip({ width: 1280, height: 720 })]);
    expect(mismatches).toEqual(["clip 2 is 1280x720 while clip 1 is 1920x1080"]);
  });

  it("catches every difference a stream copy cannot survive", () => {
    const mismatches = findMismatches([
      clip(),
      clip({ codec: "hevc" }),
      clip({ pixelFormat: "yuv420p10le" }),
      clip({ fps: 25 }),
      clip({}, null),
      clip({}, { codec: "mp3" }),
      clip({}, { sampleRate: 44_100 }),
      clip({}, { channelLayout: "mono", channels: 1 }),
      clip({ profile: "Main" }),
    ]);
    expect(mismatches).toEqual([
      "clip 2 is HEVC while clip 1 is H264",
      "clip 3 is yuv420p10le while clip 1 is yuv420p",
      "clip 4 runs at 25 fps while clip 1 runs at 30 fps",
      "clip 5 has no audio while clip 1 does",
      "clip 6's audio is MP3 while clip 1's is AAC",
      "clip 7's audio is 44100 Hz while clip 1's is 48000 Hz",
      "clip 8's audio is mono while clip 1's is stereo",
      "clip 9 is H264 Main while clip 1 is H264 High",
    ]);
  });

  it("tolerates a frame rate that differs by rounding", () => {
    expect(findMismatches([clip({ fps: 29.97 }), clip({ fps: 29.97 })])).toEqual([]);
    expect(findMismatches([clip({ fps: 30 }), clip({ fps: 29.97 })])).toHaveLength(1);
  });

  it("treats a rotated phone clip by the size a player shows", () => {
    // 1280x720 with a quarter turn is shown as 720x1280, so it matches a
    // clip coded that way round - but not by stream copy, which would keep
    // clip 1's rotation and show clip 2 on its side.
    const portrait = clip({ width: 720, height: 1280 });
    const rotated = clip({ width: 1280, height: 720, rotationDegrees: 90 });
    expect(displaySize(rotated.probe.video)).toEqual({ width: 720, height: 1280 });
    expect(findMismatches([portrait, rotated])).toEqual([
      "clip 2 is stored rotated differently from clip 1",
    ]);
    expect(findMismatches([rotated, clip({ width: 1280, height: 720, rotationDegrees: 90 })])).toEqual([]);
  });

  it("gives the benefit of the doubt where the probe could not read a field", () => {
    expect(findMismatches([clip({ pixelFormat: null }), clip()])).toEqual([]);
    expect(findMismatches([clip({ profile: null }), clip()])).toEqual([]);
  });
});

describe("assessMerge", () => {
  it("copies matching clips into the first clip's container", () => {
    const assessment = assessMerge([clip({}, {}, 10, "a.mov"), clip()]);
    expect(assessment.mode).toBe("copy");
    expect(assessment.container.extension).toBe("mov");
    expect(assessment.totalSeconds).toBe(20);
    expect(assessment.estimatedBytes).toBe(20_000_000);
    expect(assessment.canvas).toBeNull();
    expect(assessment.hasAudio).toBe(true);
  });

  it("re-encodes mismatched clips onto the first clip's frame", () => {
    const assessment = assessMerge([clip(), clip({ width: 1280, height: 720, fps: 25 })]);
    expect(assessment.mode).toBe("encode");
    expect(assessment.mismatches).toHaveLength(2);
    expect(assessment.container.extension).toBe("mp4");
    expect(assessment.canvas).toEqual({ width: 1920, height: 1080, fps: 30 });
  });

  it("re-encodes on request even when the clips match", () => {
    expect(assessMerge([clip(), clip()], { mode: "encode" }).mode).toBe("encode");
    expect(assessMerge([clip(), clip()], { mode: "encode" }).mismatches).toEqual([]);
  });

  it("keeps the audio when only some clips have it, padding the rest with silence", () => {
    const assessment = assessMerge([clip(), clip({}, null), clip()]);
    expect(assessment.mode).toBe("encode");
    expect(assessment.hasAudio).toBe(true);
    expect(assessment.silentClips).toEqual([2]);
  });

  it("drops the audio when a silent clip's length is unknown, since it cannot be padded", () => {
    const assessment = assessMerge([clip(), clip({}, null, null)]);
    expect(assessment.hasAudio).toBe(false);
    expect(assessment.silentClips).toEqual([]);
  });

  it("has no audio when no clip does", () => {
    const assessment = assessMerge([clip({}, null), clip({}, null)]);
    expect(assessment.mode).toBe("copy");
    expect(assessment.hasAudio).toBe(false);
  });

  it("cannot say how long or how big when a clip's length is unknown", () => {
    const assessment = assessMerge([clip(), clip({ fps: 25 }, {}, null)]);
    expect(assessment.totalSeconds).toBeNull();
    expect(assessment.estimatedBytes).toBeNull();
  });
});

describe("mergeCanvas", () => {
  it("takes the first clip's displayed size and rate, kept even", () => {
    expect(mergeCanvas(clip({ width: 1281, height: 721, fps: 29.97 }))).toEqual({
      width: 1280,
      height: 720,
      fps: 29.97,
    });
    expect(mergeCanvas(clip({ width: 1280, height: 720, rotationDegrees: -90 }))).toEqual({
      width: 720,
      height: 1280,
      fps: 30,
    });
  });

  it("falls back to 30 fps and gives up without a size", () => {
    expect(mergeCanvas(clip({ fps: null }))?.fps).toBe(30);
    expect(mergeCanvas(clip({ width: null }))).toBeNull();
    expect(mergeCanvas(undefined)).toBeNull();
  });
});

describe("mergeBlocker", () => {
  it("wants at least two clips", () => {
    expect(mergeBlocker([])?.message).toMatch(/at least two/);
    expect(mergeBlocker([clip()])?.message).toMatch(/at least two/);
    expect(mergeBlocker([clip(), clip()])).toBeNull();
  });

  it("needs a readable frame size on the first clip for a re-encode", () => {
    expect(mergeBlocker([clip({ width: null }), clip({ fps: 25 })])?.message).toMatch(
      /frame size is unknown/,
    );
    // For a copy nothing is scaled, so it does not matter.
    expect(mergeBlocker([clip({ width: null }), clip({ width: null })])).toBeNull();
  });

  it("refuses a join that would overflow the heap", () => {
    const big = { ...clip(), fileBytes: 1024 ** 3 };
    expect(mergeBlocker([big, big])?.message).toMatch(/joined video would be about 2\.0 GB/);
  });
});

describe("mergePlan", () => {
  it("copies through the concat demuxer with a list of the mounted paths", () => {
    const clips = [clip({}, {}, 10, "holiday.mp4"), clip()];
    const plan = mergePlan(clips);
    expect(plan.mode).toBe("copy");
    expect(joined(plan.inputArgs)).toBe("-f concat -safe 0 -i /merge.txt");
    expect(joined(plan.args)).toContain("-map 0:v:0 -map 0:a:0 -sn -dn -c copy");
    expect(plan.args).toContain("+faststart");
    expect(plan.scratchFiles).toEqual([
      {
        path: "/merge.txt",
        contents: `ffconcat version 1.0\nfile '${clips[0].inputPath}'\nfile '${clips[1].inputPath}'\n`,
      },
    ]);
    expect(plan.baseName).toBe("holiday-merged");
    expect(plan.extension).toBe("mp4");
    expect(plan.expectedSeconds).toBe(20);
  });

  it("leaves the audio unmapped when the clips have none", () => {
    const plan = mergePlan([clip({}, null), clip({}, null)]);
    expect(plan.args).not.toContain("0:a:0");
  });

  it("warns about a copied codec browsers will not play", () => {
    expect(mergePlan([clip({ codec: "mpeg4" }), clip({ codec: "mpeg4" })]).warning).toMatch(
      /Browsers cannot play/,
    );
  });

  it("re-encodes through the concat filter, one -i per clip", () => {
    const clips = [clip(), clip({ width: 1280, height: 720 })];
    const plan = mergePlan(clips);
    expect(plan.mode).toBe("encode");
    expect(joined(plan.inputArgs)).toBe(`-i ${clips[0].inputPath} -i ${clips[1].inputPath}`);
    expect(plan.scratchFiles).toBeUndefined();
    const graph = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:v:0]scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(graph).toContain("pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0]");
    expect(graph).toContain("[1:v:0]scale=1920:1080");
    expect(graph).toContain("[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]");
    expect(graph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]");
    expect(joined(plan.args)).toContain("-map [v] -map [a]");
    expect(joined(plan.args)).toContain("-c:v libx264");
    expect(joined(plan.args)).toContain("-c:a aac -b:a 160k");
    expect(plan.extension).toBe("mp4");
  });

  it("gives a silent clip silence of its own length", () => {
    const graph = concatGraph(
      [clip(), clip({}, null, 4.5)],
      { width: 640, height: 360, fps: 25 },
      true,
    );
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=4.5[a1]");
    expect(graph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]");
  });

  it("builds a video-only graph when there is no audio to carry", () => {
    const graph = concatGraph([clip({}, null), clip({}, null)], { width: 640, height: 360, fps: 25 }, false);
    expect(graph).not.toContain("[a0]");
    expect(graph).toContain("[v0][v1]concat=n=2:v=1:a=0[v]");
    const plan = mergePlan([clip({}, null), clip({ fps: 25 }, null)]);
    expect(plan.args).not.toContain("[a]");
    expect(plan.args).not.toContain("-c:a");
  });

  it("writes the list with one line per clip in order", () => {
    const list = concatList([clip(), clip()]);
    expect(list.split("\n").filter((line) => line.startsWith("file "))).toHaveLength(2);
    expect(list.startsWith("ffconcat version 1.0\n")).toBe(true);
  });
});
