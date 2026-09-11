import { describe, expect, it } from "vitest";

import {
  audioTargetFor,
  formatLufs,
  isLoudnormLine,
  LOUDNESS_PRESETS,
  loudnormApplyFilter,
  loudnormMeasureFilter,
  normalizeFormat,
  parseLoudnormOutput,
  parseLufs,
} from "@/lib/engine/audio";
import type { AudioStreamInfo, PlanContext, ProbeResult, VideoStreamInfo } from "@/lib/engine/types";

function probe(
  video: Partial<VideoStreamInfo> | null = null,
  audio: Partial<AudioStreamInfo> | null = {},
  durationSeconds: number | null = 600,
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
        codec: "mp3",
        profile: null,
        sampleRate: 44_100,
        channels: 2,
        channelLayout: "stereo",
        bitrateKbps: 192,
        ...audio,
      }
    : null;
  return {
    durationSeconds,
    bitrateKbps: 192,
    audioStreams: audioStream ? [audioStream] : [],
    audio: audioStream,
    videoStreams: videoStream ? [videoStream] : [],
    video: videoStream,
    hasVideo: videoStream !== null,
    subtitleStreams: [],
    formatName: "mp3",
    log: [],
  };
}

const context = (fileBytes = 10_000_000): PlanContext => ({ trim: null, fileBytes });
const joined = (args: string[]) => args.join(" ");

const PRINTOUT = [
  "[Parsed_loudnorm_0 @ 0x5b4a8] ",
  "{",
  '\t"input_i" : "-27.10",',
  '\t"input_tp" : "-4.70",',
  '\t"input_lra" : "17.60",',
  '\t"input_thresh" : "-37.30",',
  '\t"output_i" : "-14.20",',
  '\t"output_tp" : "-1.00",',
  '\t"output_lra" : "11.00",',
  '\t"output_thresh" : "-24.50",',
  '\t"normalization_type" : "dynamic",',
  '\t"target_offset" : "0.20"',
  "}",
];

describe("loudnorm printout", () => {
  it("keeps only the lines the second pass needs", () => {
    const kept = PRINTOUT.filter(isLoudnormLine);
    expect(kept).toHaveLength(5);
    expect(kept.some((line) => line.includes("output_i"))).toBe(false);
  });

  it("reads the measurement back", () => {
    expect(parseLoudnormOutput(PRINTOUT.filter(isLoudnormLine))).toEqual({
      inputI: -27.1,
      inputTp: -4.7,
      inputLra: 17.6,
      inputThresh: -37.3,
      targetOffset: 0.2,
    });
  });

  it("gives up on a silent file, which loudnorm reports as -inf", () => {
    const silent = PRINTOUT.map((line) => line.replace('"-27.10"', '"-inf"'));
    expect(parseLoudnormOutput(silent)).toBeNull();
    expect(parseLoudnormOutput([])).toBeNull();
  });
});

describe("loudnorm filters", () => {
  const settings = { lufs: -14, truePeak: -1 };

  it("measures with a printout and applies with the measurement, linearly", () => {
    expect(loudnormMeasureFilter(settings)).toBe("loudnorm=I=-14:TP=-1:LRA=11:print_format=json");
    const measured = parseLoudnormOutput(PRINTOUT)!;
    expect(loudnormApplyFilter(settings, measured)).toBe(
      "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-27.1:measured_TP=-4.7:measured_LRA=17.6:measured_thresh=-37.3:offset=0.2:linear=true",
    );
  });

  it("falls back to the dynamic mode without a measurement", () => {
    expect(loudnormApplyFilter(settings, null)).toBe("loudnorm=I=-14:TP=-1:LRA=11");
  });
});

describe("audioTargetFor", () => {
  it("keeps a file in its own format where the core can encode it", () => {
    expect(audioTargetFor("mp3").extension).toBe("mp3");
    expect(audioTargetFor("flac").extension).toBe("flac");
    expect(audioTargetFor("pcm_s24le").extension).toBe("wav");
    expect(audioTargetFor("opus").extension).toBe("opus");
    expect(audioTargetFor("vorbis").extension).toBe("ogg");
    expect(audioTargetFor("aac").extension).toBe("m4a");
  });

  it("sends anything else to AAC in an M4A", () => {
    expect(audioTargetFor("ac3").extension).toBe("m4a");
    expect(audioTargetFor("wmav2").extension).toBe("m4a");
    expect(audioTargetFor(null).extension).toBe("m4a");
  });
});

describe("the normaliser", () => {
  const format = normalizeFormat({ lufs: -14, truePeak: -1 });

  it("bakes the target into the id and the filename", () => {
    expect(format.id).toBe("normalize-14lufs-1tp");
    expect(format.label).toBe("-14 LUFS");
    expect(normalizeFormat({ lufs: -16.5, truePeak: -1 }).label).toBe("-16.5 LUFS");
    expect(format.plan(probe(), context()).fileSuffix).toBe("-14lufs");
  });

  it("measures in an analysis pass and writes the final pass from the printout", () => {
    const plan = format.plan(probe(), context());
    expect(plan.analysisPasses).toHaveLength(1);
    expect(joined(plan.analysisPasses![0])).toContain("-af loudnorm=I=-14:TP=-1:LRA=11:print_format=json");
    expect(joined(plan.analysisPasses![0])).toContain("-map 0:a:0 -vn");
    expect(plan.refine).toBeDefined();
    const refined = plan.refine!.args(PRINTOUT.filter(plan.refine!.keep));
    expect(joined(refined)).toContain("measured_I=-27.1");
    expect(joined(refined)).toContain("linear=true");
    // Without a printout the dynamic mode still produces a file.
    expect(joined(plan.refine!.args([]))).toContain("-af loudnorm=I=-14:TP=-1:LRA=11 ");
  });

  it("keeps the source's sample rate: loudnorm would otherwise write 192 kHz", () => {
    expect(joined(format.plan(probe(), context()).args)).toContain("-ar 44100");
    expect(joined(format.plan(probe(null, { sampleRate: null }), context()).args)).toContain("-ar 48000");
  });

  it("writes an audio file back in its own format", () => {
    const mp3 = format.plan(probe(), context());
    expect(mp3.extension).toBe("mp3");
    expect(mp3.kind).toBe("audio");
    expect(joined(mp3.args)).toContain("-c:a libmp3lame");
    const flac = format.plan(probe(null, { codec: "flac" }), context());
    expect(flac.extension).toBe("flac");
    expect(joined(flac.args)).toContain("-c:a flac");
  });

  it("copies the picture of a video and normalises its soundtrack as AAC", () => {
    const plan = format.plan(probe({}, { codec: "aac" }), context());
    expect(plan.kind).toBe("video");
    expect(plan.extension).toBe("mp4");
    expect(joined(plan.args)).toContain("-c:v copy");
    expect(joined(plan.args)).toContain("-c:a aac -b:a 192k");
    expect(plan.args).toContain("+faststart");
    // A VP9 WebM cannot hold AAC, so the copy goes to Matroska.
    expect(format.plan(probe({ codec: "vp9" }, { codec: "opus" }), context()).extension).toBe("mkv");
  });

  it("refuses a file with no audio, and a video copy past the ceiling", () => {
    expect(format.blocker!(probe(null, null), context())?.message).toMatch(/no audio/);
    expect(format.blocker!(probe({}, {}), context(3 * 1024 ** 3))?.message).toMatch(/would be about 3\.0 GB/);
    expect(format.blocker!(probe(), context())).toBeNull();
  });

  it("guards a long WAV the way the extractor does", () => {
    const long = probe(null, { codec: "pcm_s16le", sampleRate: 48_000 }, 4 * 3600);
    expect(format.blocker!(long, context())?.message).toMatch(/WAV would be about/);
  });
});

describe("LUFS targets", () => {
  it("has a preset for each platform, with a label that says the number", () => {
    for (const preset of LOUDNESS_PRESETS) {
      expect(preset.label).toBe(formatLufs(preset.lufs));
      expect(preset.lufs).toBeLessThan(0);
      expect(preset.truePeak).toBeLessThanOrEqual(-1);
    }
  });

  it("reads a typed target to a tenth, within the range", () => {
    expect(parseLufs(-14)).toBe(-14);
    expect(parseLufs(-16.55)).toBe(-16.5);
    expect(parseLufs(-40)).toBe(-40);
    expect(parseLufs(-5)).toBe(-5);
    expect(parseLufs(0)).toBeNull();
    expect(parseLufs(-41)).toBeNull();
    expect(parseLufs(Number.NaN)).toBeNull();
  });
});
