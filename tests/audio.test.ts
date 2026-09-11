import { describe, expect, it } from "vitest";

import {
  audioBudget,
  audioTargetFor,
  CHANNEL_FORMATS,
  channelFormat,
  compressAudioFormat,
  formatLufs,
  isLoudnormLine,
  LOUDNESS_PRESETS,
  loudnormApplyFilter,
  loudnormMeasureFilter,
  normalizeFormat,
  parseLoudnormOutput,
  parseLufs,
  spectrogramFormat,
  waveformFormat,
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
        language: null,
        title: null,
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
    chapters: [],
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

describe("the audio compressor", () => {
  it("encodes a preset's codec at its rate, folding speech to mono", () => {
    const voice = compressAudioFormat({ presetId: "voice-tiny", targetBytes: null });
    expect(voice.id).toBe("compress-audio-voice-tiny");
    const plan = voice.plan(probe(), context());
    expect(joined(plan.args)).toContain("-c:a opus -strict -2 -b:a 24k -ac 1");
    expect(plan.extension).toBe("opus");
    expect(plan.fileSuffix).toBe("-voice-tiny");
    expect(voice.requiredEncoder).toBe("opus");

    const music = compressAudioFormat({ presetId: "music", targetBytes: null }).plan(probe(), context());
    expect(joined(music.args)).toContain("-c:a libmp3lame -b:a 128k");
    expect(music.extension).toBe("mp3");

    const aac = compressAudioFormat({ presetId: "music-small", targetBytes: null }).plan(probe(null, { channels: 6 }), context());
    expect(joined(aac.args)).toContain("-c:a aac -b:a 96k -ac 2");
    expect(aac.extension).toBe("m4a");
  });

  it("works a bitrate out from a size and the length", () => {
    // 5 MB over ten minutes is about 63 kbps: Opus, stereo.
    expect(audioBudget(5_000_000, 600)).toEqual({ kbps: 63, codec: "opus", mono: false });
    // 1 MB over ten minutes is 12 kbps: Opus, mono, just allowed.
    expect(audioBudget(1_000_000, 600)).toEqual({ kbps: 12, codec: "opus", mono: true });
    // 20 MB over ten minutes is 253 kbps: AAC.
    expect(audioBudget(20_000_000, 600)?.codec).toBe("aac");
    expect(audioBudget(500_000, 600)).toBeNull();
    expect(audioBudget(5_000_000, 0)).toBeNull();
  });

  it("bakes a size target into the format and refuses what cannot be done", () => {
    const format = compressAudioFormat({ presetId: null, targetBytes: 5_000_000 });
    expect(format.id).toBe("compress-audio-5mb");
    expect(format.label).toBe("5 MB");
    const plan = format.plan(probe(), context(50_000_000));
    expect(joined(plan.args)).toContain("-b:a 63k");
    expect(plan.extension).toBe("opus");
    expect(plan.fileSuffix).toBe("-5mb");

    expect(format.blocker!(probe(), context(4_000_000))?.severity).toBe("info");
    expect(format.offer!(probe(), context(4_000_000))).toBe(false);
    expect(format.offer!(probe(), context(50_000_000))).toBe(true);
    expect(format.blocker!(probe(null, {}, null), context(50_000_000))?.message).toMatch(/length is unknown/);
    expect(compressAudioFormat({ presetId: null, targetBytes: 200_000 }).blocker!(probe(), context(50_000_000))?.message).toMatch(/too small/);
    expect(format.blocker!(probe(null, null), context(50_000_000))?.message).toMatch(/no audio/);
  });
});

describe("channel operations", () => {
  it("offers what applies to the file's channels", () => {
    const stereo = probe(null, { channels: 2, channelLayout: "stereo" });
    const mono = probe(null, { channels: 1, channelLayout: "mono" });
    const surround = probe(null, { channels: 6, channelLayout: "5.1" });
    const offered = (info: ProbeResult) =>
      CHANNEL_FORMATS.filter((format) => format.offer!(info, context())).map((format) => format.id);
    expect(offered(stereo)).toEqual([
      "channels-mono",
      "channels-left",
      "channels-right",
      "channels-swap",
      "channels-karaoke",
    ]);
    expect(offered(mono)).toEqual(["channels-stereo"]);
    expect(offered(surround)).toEqual(["channels-mono", "channels-left", "channels-right"]);
  });

  it("writes each operation back in the source's own format", () => {
    const left = channelFormat("left").plan(probe(), context());
    expect(joined(left.args)).toContain("-af pan=mono|c0=c0 -c:a libmp3lame");
    expect(left.extension).toBe("mp3");
    expect(left.fileSuffix).toBe("-left");
    expect(joined(channelFormat("mono").plan(probe(null, { codec: "flac" }), context()).args)).toContain("-ac 1 -c:a flac");
    expect(joined(channelFormat("swap").plan(probe(), context()).args)).toContain("pan=stereo|c0=c1|c1=c0");
    expect(joined(channelFormat("karaoke").plan(probe(), context()).args)).toContain(
      "pan=stereo|c0=0.5*c0-0.5*c1|c1=0.5*c0-0.5*c1",
    );
  });

  it("refuses an operation that does not apply, with a reason", () => {
    const mono = probe(null, { channels: 1, channelLayout: "mono" });
    expect(channelFormat("left").blocker!(mono, context())?.message).toMatch(/does not apply to a mono file/);
    expect(channelFormat("stereo").blocker!(probe(), context())?.hint).toMatch(/more than one channel/);
    expect(channelFormat("mono").blocker!(probe(null, null), context())?.message).toMatch(/no audio/);
  });
});

describe("pictures of audio", () => {
  it("draws a mono waveform in the chosen ink as one transparent PNG", () => {
    const format = waveformFormat({ width: 1200, height: 300, tone: "dark" });
    expect(format.id).toBe("waveform-1200x300-dark");
    const plan = format.plan(probe(), context());
    const graph = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(graph).toBe("[0:a:0]aformat=channel_layouts=mono,showwavespic=s=1200x300:colors=0x171717[v]");
    expect(joined(plan.args)).toContain("-map [v] -frames:v 1 -c:v png -f image2 -update 1");
    expect(plan.extension).toBe("png");
    expect(plan.kind).toBe("image");
    expect(waveformFormat({ width: 800, height: 200, tone: "light" }).plan(probe(), context()).args[1]).toContain("0xfafafa");
  });

  it("draws a spectrogram with its legend", () => {
    const plan = spectrogramFormat({ width: 1920, height: 480, tone: "dark" }).plan(probe(), context());
    expect(plan.args[1]).toBe("[0:a:0]showspectrumpic=s=1920x480:legend=1[v]");
    expect(plan.fileSuffix).toBe("-spectrogram");
  });

  it("needs audio to draw", () => {
    expect(waveformFormat({ width: 1200, height: 300, tone: "dark" }).blocker!(probe(null, null), context())?.message).toMatch(/no audio/);
    expect(spectrogramFormat({ width: 1200, height: 300, tone: "dark" }).blocker!(probe(), context())).toBeNull();
  });
});
