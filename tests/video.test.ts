import { describe, expect, it } from "vitest";

import { MAX_SAFE_OUTPUT_BYTES } from "@/lib/engine/formats";
import {
  autoHeight,
  compressBudget,
  compressFormat,
  containerFor,
  CONVERT_FORMATS,
  DEFAULT_COMPRESS_SETTINGS,
  estimateCopyBytes,
  estimateEncodedBytes,
  estimateGifBytes,
  fitFilter,
  formatMegabytes,
  gifFormat,
  isBrowserSafeH264,
  MIN_TARGET_MEGABYTES,
  MUTE_FORMAT,
  atempoChain,
  formatSpeed,
  parseSpeedFactor,
  planFor,
  playbackWarning,
  speedFilters,
  speedFormat,
  STRIP_FORMAT,
  targetBytesFromMegabytes,
  TRIM_FORMATS,
} from "@/lib/engine/video";
import type {
  AudioStreamInfo,
  OutputFormat,
  PlanContext,
  ProbeResult,
  VideoStreamInfo,
} from "@/lib/engine/types";

function probe(
  video: Partial<VideoStreamInfo> | null = {},
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

const context = (fileBytes = 100_000_000, trim: PlanContext["trim"] = null): PlanContext => ({
  trim,
  fileBytes,
});

const find = (id: string, formats: readonly OutputFormat[]) => {
  const format = formats.find((entry) => entry.id === id);
  if (!format) throw new Error(`no format ${id}`);
  return format;
};

const joined = (args: string[]) => args.join(" ");

describe("containerFor", () => {
  it("puts browser codecs in MP4", () => {
    expect(containerFor("h264", "aac").extension).toBe("mp4");
    expect(containerFor("hevc", null).extension).toBe("mp4");
    expect(containerFor("h264", "mp3").extension).toBe("mp4");
  });

  it("puts the WebM codecs in WebM", () => {
    expect(containerFor("vp9", "opus").extension).toBe("webm");
    expect(containerFor("vp8", null).extension).toBe("webm");
  });

  it("keeps editing codecs in MOV", () => {
    expect(containerFor("prores", "pcm_s16le").extension).toBe("mov");
  });

  it("falls back to Matroska for anything the tidy containers cannot hold", () => {
    expect(containerFor("h264", "vorbis").extension).toBe("mkv");
    expect(containerFor("vp9", "aac").extension).toBe("mkv");
    expect(containerFor("mpeg2video", "mp2").extension).toBe("mkv");
  });

  it("uses the audio catalogue's container when there is no video", () => {
    expect(containerFor(null, "mp3").extension).toBe("mp3");
    expect(containerFor(null, "aac").extension).toBe("m4a");
  });

  it("is case-insensitive", () => {
    expect(containerFor("H264", "AAC").extension).toBe("mp4");
  });
});

describe("isBrowserSafeH264", () => {
  const h264 = (pixelFormat: string | null) => ({ ...probe()!.video!, pixelFormat });

  it("accepts 8-bit 4:2:0, which every decoder takes", () => {
    expect(isBrowserSafeH264(h264("yuv420p"))).toBe(true);
    expect(isBrowserSafeH264(h264("yuvj420p"))).toBe(true);
    expect(isBrowserSafeH264(h264(null))).toBe(true);
  });

  it("refuses 10-bit and 4:4:4, which browsers do not", () => {
    expect(isBrowserSafeH264(h264("yuv420p10le"))).toBe(false);
    expect(isBrowserSafeH264(h264("yuv444p"))).toBe(false);
  });

  it("refuses anything that is not H.264 at all", () => {
    expect(isBrowserSafeH264({ ...h264("yuv420p"), codec: "hevc" })).toBe(false);
  });
});

describe("the converter", () => {
  const mp4 = find("mp4", CONVERT_FORMATS);
  const webm = find("webm", CONVERT_FORMATS);
  const mkv = find("mkv", CONVERT_FORMATS);

  it("copies both streams when the source is already H.264 and AAC", () => {
    const plan = planFor(mp4, probe());
    expect(plan.mode).toBe("copy");
    expect(joined(plan.args)).toContain("-c:v copy");
    expect(joined(plan.args)).toContain("-c:a copy");
    expect(plan.args).toContain("+faststart");
    expect(plan.extension).toBe("mp4");
    expect(plan.kind).toBe("video");
  });

  it("encodes the video and copies the audio for an HEVC phone clip", () => {
    const plan = planFor(mp4, probe({ codec: "hevc" }));
    expect(plan.mode).toBe("encode");
    expect(joined(plan.args)).toContain("-c:v libx264");
    expect(joined(plan.args)).toContain("-pix_fmt yuv420p");
    expect(joined(plan.args)).toContain("-c:a copy");
  });

  it("re-encodes 10-bit H.264, which is H.264 a browser cannot play", () => {
    expect(planFor(mp4, probe({ pixelFormat: "yuv420p10le" })).mode).toBe("encode");
  });

  it("encodes PCM camera audio to AAC while copying the video", () => {
    const plan = planFor(mp4, probe({}, { codec: "pcm_s16le" }));
    expect(joined(plan.args)).toContain("-c:v copy");
    expect(joined(plan.args)).toContain("-c:a aac");
  });

  it("takes the audio track only if there is one", () => {
    const plan = planFor(mp4, probe({}, null));
    expect(plan.args).toContain("0:a:0?");
    expect(plan.args).not.toContain("-c:a");
    expect(plan.mode).toBe("copy");
  });

  it("copies VP8 and VP9 into WebM rather than re-encoding them", () => {
    expect(planFor(webm, probe({ codec: "vp9" }, { codec: "opus" })).mode).toBe("copy");
    expect(planFor(webm, probe({ codec: "vp8" }, { codec: "vorbis" })).mode).toBe("copy");
  });

  it("encodes VP8, never VP9: libvpx-vp9 traps in this core", () => {
    const encoded = planFor(webm, probe());
    expect(encoded.mode).toBe("encode");
    expect(joined(encoded.args)).toContain("-c:v libvpx");
    expect(encoded.args).not.toContain("libvpx-vp9");
    expect(webm.requiredEncoder).toBe("libvpx");
    expect(webm.label).toContain("VP8");
    // ffmpeg's own Opus encoder; libopus traps in this core too.
    expect(joined(encoded.args)).toContain("-c:a opus -strict -2");
    expect(encoded.args).not.toContain("libopus");
  });

  it("sizes the VP8 bitrate to the picture", () => {
    const big = joined(planFor(webm, probe({ width: 1920, height: 1080 })).args);
    const small = joined(planFor(webm, probe({ width: 640, height: 360 })).args);
    const rate = (args: string) => Number(args.match(/-b:v (\d+)k/)![1]);
    expect(rate(big)).toBeGreaterThan(rate(small) * 4);
    // Bounded at both ends, so neither extreme is absurd.
    expect(rate(big)).toBeLessThanOrEqual(8000);
    expect(rate(joined(planFor(webm, probe({ width: 160, height: 120 })).args))).toBe(200);
  });

  it("remuxes every stream into MKV without touching it", () => {
    const plan = planFor(mkv, probe({ codec: "mpeg2video" }, { codec: "mp2" }));
    expect(plan.mode).toBe("copy");
    expect(joined(plan.args)).toContain("-c copy");
    expect(plan.args).toContain("0:a?");
    expect(mkv.requiredEncoder).toBeNull();
  });

  it("refuses a stream copy that would overflow the heap, and offers a way out", () => {
    const blocker = mp4.blocker!(probe(), context(3 * 1024 ** 3));
    expect(blocker?.message).toMatch(/would be about 3\.0 GB/);
    expect(blocker?.hint).toMatch(/Trim/);
    // A range brings the same file back under the ceiling.
    expect(
      mp4.blocker!(probe(), context(3 * 1024 ** 3, { startSeconds: 0, endSeconds: 60 })),
    ).toBeNull();
  });

  it("sizes an encode from the frame, not from the file", () => {
    // A 4K ProRes file is huge on disk, but its H.264 encode is not.
    const prores = probe({ codec: "prores", width: 3840, height: 2160, fps: 30 }, null, 300);
    expect(mp4.blocker!(prores, context(20 * 1024 ** 3))).toBeNull();
    // Three hours of 4K, on the other hand, would not fit.
    const long = probe({ codec: "prores", width: 3840, height: 2160, fps: 30 }, null, 3 * 3600);
    expect(mp4.blocker!(long, context(20 * 1024 ** 3))?.message).toMatch(/MP4 would be about/);
  });
});

describe("estimates", () => {
  it("scales a copy to the range being kept", () => {
    expect(estimateCopyBytes(probe(null, {}, 600), context(600_000_000))).toBe(600_000_000);
    expect(
      estimateCopyBytes(probe(null, {}, 600), context(600_000_000, { startSeconds: 0, endSeconds: 60 })),
    ).toBe(60_000_000);
    // Unknown length: assume the whole file.
    expect(estimateCopyBytes(probe(null, {}, null), context(600_000_000))).toBe(600_000_000);
  });

  it("estimates an encode from pixels, frames and seconds", () => {
    // 1920*1080*30*60*0.07 bits + 160 kbps audio, in bytes.
    const estimate = estimateEncodedBytes(probe({}, {}, 60), context(), 160);
    expect(estimate).toBeGreaterThan(30_000_000);
    expect(estimate).toBeLessThan(35_000_000);
    expect(estimateEncodedBytes(probe({ width: null }, {}, 60), context(), 160)).toBeNull();
  });
});

describe("the compressor's budget", () => {
  it("splits the bytes over the length into video and audio", () => {
    // 25 MB over 60 s is about 3.2 Mbps; audio gets 128 of it.
    const budget = compressBudget(25_000_000, 60, true)!;
    expect(budget.audioKbps).toBe(128);
    expect(budget.videoKbps).toBeGreaterThan(3000);
    expect(budget.videoKbps).toBeLessThan(3200);
  });

  it("gives speech-grade audio rates as the budget tightens", () => {
    expect(compressBudget(8_000_000, 120, true)!.audioKbps).toBe(64);
    expect(compressBudget(8_000_000, 240, true)!.audioKbps).toBe(48);
    expect(compressBudget(8_000_000, 60, false)!.audioKbps).toBe(0);
  });

  it("leaves a wider margin for a single pass", () => {
    expect(compressBudget(25_000_000, 60, true, false)!.totalKbps).toBeLessThan(
      compressBudget(25_000_000, 60, true, true)!.totalKbps,
    );
  });

  it("gives up when the video would be a smear", () => {
    expect(compressBudget(1_000_000, 3600, true)).toBeNull();
    expect(compressBudget(0, 60, true)).toBeNull();
    expect(compressBudget(25_000_000, 0, true)).toBeNull();
  });
});

describe("autoHeight", () => {
  it("picks the tallest frame the bitrate can fill", () => {
    expect(autoHeight(8000, 30)).toBe(1440);
    expect(autoHeight(4000, 30)).toBe(1080);
    expect(autoHeight(1500, 30)).toBe(720);
    expect(autoHeight(400, 30)).toBe(360);
  });

  it("never goes below the smallest height", () => {
    expect(autoHeight(50, 30)).toBe(240);
  });

  it("allows more pixels at a lower frame rate", () => {
    expect(autoHeight(1500, 15)).toBeGreaterThan(autoHeight(1500, 60));
  });
});

describe("fitFilter", () => {
  it("boxes landscape and portrait video alike without enlarging either", () => {
    const filter = fitFilter(720);
    expect(filter).toContain("min(iw,1280)");
    expect(filter).toContain("min(ih,720)");
    expect(filter).toContain("min(iw,720)");
    expect(filter).toContain("min(ih,1280)");
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("force_divisible_by=2");
  });
});

describe("the compressor", () => {
  const settings = { ...DEFAULT_COMPRESS_SETTINGS, targetBytes: 25_000_000 };

  it("bakes its settings into the id, so two targets are two outputs", () => {
    expect(compressFormat(settings).id).toBe("compress-25mb-auto-2pass");
    expect(compressFormat({ ...settings, targetBytes: 8_000_000, twoPass: false }).id).toBe(
      "compress-8mb-auto-1pass",
    );
    expect(compressFormat({ ...settings, resolution: 720 }).id).toBe("compress-25mb-720p-2pass");
  });

  it("runs an analysis pass and then encodes at the computed bitrate", () => {
    const plan = compressFormat(settings).plan(probe({}, {}, 60), context(500_000_000));
    expect(plan.analysisPasses).toHaveLength(1);
    expect(plan.analysisPasses![0]).toContain("-pass");
    expect(plan.analysisPasses![0]).toContain("1");
    expect(plan.analysisPasses![0]).toContain("-an");
    expect(joined(plan.args)).toContain("-pass 2");
    expect(joined(plan.args)).toMatch(/-b:v 3\d{3}k/);
    expect(joined(plan.args)).toContain("-c:a aac -b:a 128k");
    expect(plan.args).toContain("+faststart");
    expect(plan.fileSuffix).toBe("-25mb");
    expect(plan.kind).toBe("video");
  });

  it("does without the analysis pass in single-pass mode", () => {
    const plan = compressFormat({ ...settings, twoPass: false }).plan(
      probe({}, {}, 60),
      context(500_000_000),
    );
    expect(plan.analysisPasses).toBeUndefined();
    expect(plan.args).not.toContain("-pass");
    // A single pass is capped at its own bitrate; two passes may go 1.5x over it.
    const rate = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
    expect(rate(plan.args, "-maxrate")).toBe(rate(plan.args, "-b:v"));
    const twoPass = compressFormat(settings).plan(probe({}, {}, 60), context(500_000_000));
    expect(rate(twoPass.args, "-maxrate")).not.toBe(rate(twoPass.args, "-b:v"));
  });

  it("sizes the bitrate to the clip rather than the file", () => {
    const whole = compressFormat(settings).plan(probe({}, {}, 600), context(500_000_000));
    const clip = compressFormat(settings).plan(
      probe({}, {}, 600),
      context(500_000_000, { startSeconds: 0, endSeconds: 60 }),
    );
    const bitrate = (plan: { args: string[] }) =>
      Number(plan.args[plan.args.indexOf("-b:v") + 1].replace("k", ""));
    expect(bitrate(clip)).toBeGreaterThan(bitrate(whole) * 5);
  });

  it("downscales when the bitrate cannot fill the frame", () => {
    // 8 MB over ten minutes is about 100 kbps: a small picture, cleanly.
    const plan = compressFormat({ ...settings, targetBytes: 8_000_000 }).plan(
      probe({}, {}, 600),
      context(500_000_000),
    );
    expect(joined(plan.args)).toContain("-vf scale=");
    expect(joined(plan.args)).toContain("240");
    // Plenty of bitrate: the frame stays as it is.
    const roomy = compressFormat({ ...settings, targetBytes: 250_000_000 }).plan(
      probe({}, {}, 60),
      context(500_000_000),
    );
    expect(roomy.args).not.toContain("-vf");
  });

  it("caps the height when asked to, and never scales in source mode", () => {
    const capped = compressFormat({ ...settings, resolution: 480 }).plan(
      probe({}, {}, 60),
      context(500_000_000),
    );
    expect(joined(capped.args)).toContain("min(ih,480)");
    // A cap the frame already fits under is not applied at all.
    const under = compressFormat({ ...settings, resolution: 1080 }).plan(
      probe({ width: 1280, height: 720 }, {}, 60),
      context(500_000_000),
    );
    expect(under.args).not.toContain("-vf");
    // Portrait video is measured by its long side, like landscape.
    const portrait = compressFormat({ ...settings, resolution: 1080 }).plan(
      probe({ width: 1080, height: 1920 }, {}, 60),
      context(500_000_000),
    );
    expect(portrait.args).not.toContain("-vf");
    const source = compressFormat({ ...settings, resolution: "source" }).plan(
      probe({}, {}, 600),
      context(500_000_000),
    );
    expect(source.args).not.toContain("-vf");
  });

  it("copies AAC audio that already fits the budget", () => {
    const plan = compressFormat(settings).plan(
      probe({}, { codec: "aac", bitrateKbps: 96 }, 60),
      context(500_000_000),
    );
    expect(joined(plan.args)).toContain("-c:a copy");
  });

  it("downmixes surround audio to stereo when it has to encode it", () => {
    const plan = compressFormat(settings).plan(
      probe({}, { codec: "ac3", channels: 6 }, 60),
      context(500_000_000),
    );
    expect(joined(plan.args)).toContain("-ac 2");
  });

  it("refuses a file that is already under the target", () => {
    const blocker = compressFormat(settings).blocker!(probe({}, {}, 60), context(20_000_000));
    expect(blocker?.message).toMatch(/already under 25 MB/);
    expect(blocker?.hint).toMatch(/20 MB/);
  });

  it("refuses a target too small for the length", () => {
    const blocker = compressFormat({ ...settings, targetBytes: 1_000_000 }).blocker!(
      probe({}, {}, 3600),
      context(5_000_000_000),
    );
    expect(blocker?.message).toMatch(/too small/);
    expect(blocker?.hint).toMatch(/shorter range/);
  });

  it("refuses a file whose length is unknown", () => {
    expect(
      compressFormat(settings).blocker!(probe({}, {}, null), context(500_000_000))?.message,
    ).toMatch(/length is unknown/);
  });

  it("refuses a target the heap cannot hold", () => {
    expect(
      compressFormat({ ...settings, targetBytes: MAX_SAFE_OUTPUT_BYTES + 1 }).blocker!(
        probe({}, {}, 3600),
        context(5_000_000_000),
      )?.message,
    ).toMatch(/more than ffmpeg.wasm can hold/);
  });

  it("passes an ordinary job", () => {
    expect(compressFormat(settings).blocker!(probe({}, {}, 60), context(500_000_000))).toBeNull();
  });
});

describe("removing audio", () => {
  it("copies the video stream alone into its natural container", () => {
    const plan = planFor(MUTE_FORMAT, probe());
    expect(plan.mode).toBe("copy");
    expect(plan.args).toContain("-an");
    expect(joined(plan.args)).toContain("-c:v copy");
    expect(plan.args).not.toContain("0:a:0?");
    expect(plan.extension).toBe("mp4");
    expect(plan.fileSuffix).toBe("-muted");
    expect(planFor(MUTE_FORMAT, probe({ codec: "vp9" })).extension).toBe("webm");
  });
});

describe("keeping the source container", () => {
  it("leaves a MOV a MOV rather than making it an MP4", () => {
    // Both probe as "mov,mp4,m4a,3gp,3g2,mj2", so the extension is the only
    // thing that can tell them apart - and turning one into the other is a
    // second change nobody asked the mute or metadata tool to make.
    expect(containerFor("h264", "aac", "mov").extension).toBe("mov");
    expect(containerFor("h264", "aac", "mp4").extension).toBe("mp4");
    expect(containerFor("h264", "aac", null).extension).toBe("mp4");
  });

  it("leaves an MKV an MKV", () => {
    expect(containerFor("h264", "aac", "mkv").extension).toBe("mkv");
    expect(containerFor("vp9", "opus", "webm").extension).toBe("webm");
  });

  it("moves on when the source container cannot hold the streams", () => {
    // A WebM has no way to carry H.264 and AAC, whatever the file was called.
    expect(containerFor("h264", "aac", "webm").extension).toBe("mp4");
    // QuickTime carries raw PCM, which an MP4 does not.
    expect(containerFor("prores", "pcm_s16le", "mov").extension).toBe("mov");
  });

  it("carries the source extension through the tools that copy streams", () => {
    expect(planFor(MUTE_FORMAT, probe(), 0, "mov").extension).toBe("mov");
    expect(planFor(STRIP_FORMAT, probe(), 0, "mkv").extension).toBe("mkv");
    expect(planFor(find("trim-copy", TRIM_FORMATS), probe(), 0, "mov").extension).toBe("mov");
  });
});

describe("playbackWarning", () => {
  it("warns about video no browser will play", () => {
    // An AVI's MPEG-4 Part 2 remuxes into a perfectly valid MP4 that Chrome
    // and Firefox render as a black frame.
    expect(playbackWarning("mpeg4")).toMatch(/Browsers cannot play/);
    expect(playbackWarning("wmv3")).toMatch(/Browsers cannot play/);
    expect(planFor(MUTE_FORMAT, probe({ codec: "mpeg4" })).warning).toMatch(/MPEG4/);
  });

  it("says nothing about codecs that do play, HEVC included", () => {
    expect(playbackWarning("h264")).toBeUndefined();
    expect(playbackWarning("vp9")).toBeUndefined();
    // Safari plays HEVC; a warning that is wrong for a platform is worse than
    // none.
    expect(playbackWarning("hevc")).toBeUndefined();
    expect(playbackWarning(null)).toBeUndefined();
    expect(planFor(MUTE_FORMAT, probe()).warning).toBeUndefined();
  });
});

describe("target sizes", () => {
  it("never rounds a typed size up", () => {
    // 2.5 used to become 3 MB, which fails a 2.5 MB limit.
    expect(targetBytesFromMegabytes(2.5)).toBe(2_500_000);
    expect(formatMegabytes(targetBytesFromMegabytes(2.5)!)).toBe("2.5");
    expect(targetBytesFromMegabytes(2.59)).toBe(2_500_000);
  });

  it("refuses sizes that cannot start a job", () => {
    expect(targetBytesFromMegabytes(0)).toBeNull();
    expect(targetBytesFromMegabytes(-4)).toBeNull();
    expect(targetBytesFromMegabytes(Number.NaN)).toBeNull();
    expect(targetBytesFromMegabytes(MIN_TARGET_MEGABYTES / 2)).toBeNull();
  });

  it("labels whole numbers without a decimal point", () => {
    expect(formatMegabytes(25_000_000)).toBe("25");
    expect(formatMegabytes(8_000_000)).toBe("8");
  });

  it("carries the decimal into the label, the id and the filename", () => {
    const format = compressFormat({ ...DEFAULT_COMPRESS_SETTINGS, targetBytes: 2_500_000 });
    expect(format.label).toBe("2.5 MB");
    expect(format.id).toContain("2.5mb");
    expect(planFor(format, probe()).fileSuffix).toBe("-2.5mb");
  });
});

describe("a file that is already small enough", () => {
  const format = compressFormat({ ...DEFAULT_COMPRESS_SETTINGS, targetBytes: 25_000_000 });

  it("is a note, not a failure, and not worth retrying", () => {
    const blocker = format.blocker!(probe(), context(5_000_000));
    expect(blocker?.message).toMatch(/already under 25 MB/);
    expect(blocker?.severity).toBe("info");
    expect(blocker?.retryable).toBe(false);
    expect(blocker?.hint).toMatch(/smaller size/);
  });

  it("is not offered as a chip, while the smaller sizes are", () => {
    const small = context(5_000_000);
    expect(format.offer!(probe(), small)).toBe(false);
    const smaller = compressFormat({ ...DEFAULT_COMPRESS_SETTINGS, targetBytes: 2_000_000 });
    expect(smaller.offer!(probe(), small)).toBe(true);
  });

  it("offers every preset for a file larger than all of them", () => {
    const huge = context(500_000_000);
    expect(format.offer!(probe(), huge)).toBe(true);
  });
});

describe("video to GIF", () => {
  const settings = { fps: 15, width: 480 };

  it("generates and applies the palette in one pass", () => {
    const plan = planFor(gifFormat(settings), probe());
    const graph = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("fps=15");
    // A box, not a width: the longest side is what 480 bounds.
    expect(graph).toContain("scale=w=min(iw\\,480):h=min(ih\\,480)");
    expect(graph).toContain("force_original_aspect_ratio=decrease");
    expect(graph).toContain("palettegen");
    expect(graph).toContain("paletteuse");
    expect(joined(plan.args)).toContain("-map [out]");
    expect(plan.extension).toBe("gif");
    expect(plan.kind).toBe("image");
    expect(gifFormat(settings).requiredEncoder).toBe("gif");
  });

  it("bounds the longest side, whichever way the phone was held", () => {
    const landscape = estimateGifBytes(probe({ width: 1280, height: 720 }, {}, 10), context(), settings)!;
    const portrait = estimateGifBytes(probe({ width: 720, height: 1280 }, {}, 10), context(), settings)!;
    // 480x270 and 270x480: the same amount of picture either way round. The
    // old width-only limit made the portrait clip 480x854, three times larger.
    expect(portrait).toBe(landscape);
  });

  it("keeps the source width when asked to", () => {
    const plan = planFor(gifFormat({ fps: 10, width: null }), probe());
    expect(plan.args[plan.args.indexOf("-filter_complex") + 1]).not.toContain(",scale=");
    expect(gifFormat({ fps: 10, width: null }).id).toBe("gif-10fps-source");
  });

  it("estimates the size from the scaled frame", () => {
    const ten = estimateGifBytes(probe({}, {}, 10), context(), settings)!;
    // 480x270 at 15 fps for 10 s, at 0.4 bytes per pixel.
    expect(ten).toBeCloseTo(480 * 270 * 15 * 10 * 0.4, -3);
    // Never enlarged: a 320-wide source stays 320 wide.
    const small = estimateGifBytes(probe({ width: 320, height: 180 }, {}, 10), context(), settings)!;
    expect(small).toBeLessThan(ten / 2);
  });

  it("refuses a GIF the heap could not hold, and passes a clip of it", () => {
    const long = probe({}, {}, 3 * 3600);
    expect(gifFormat(settings).blocker!(long, context())?.message).toMatch(/GIF would be about/);
    expect(
      gifFormat(settings).blocker!(long, context(0, { startSeconds: 0, endSeconds: 10 })),
    ).toBeNull();
  });
});

describe("trim output naming", () => {
  it("gives the fast and the precise cut different filenames", () => {
    // Both used to download as "clip-3s-5s.mp4" and overwrite each other.
    const fast = planFor(find("trim-copy", TRIM_FORMATS), probe());
    const precise = planFor(find("trim-precise", TRIM_FORMATS), probe());
    expect(fast.fileSuffix).toBe("-fast");
    expect(precise.fileSuffix).toBe("-precise");
    expect(fast.fileSuffix).not.toBe(precise.fileSuffix);
  });

  it("asks the engine to measure what the fast cut really covers", () => {
    expect(planFor(find("trim-copy", TRIM_FORMATS), probe()).verifyDuration).toBe(true);
    // A re-encode lands on the frame, so there is nothing to measure.
    expect(planFor(find("trim-precise", TRIM_FORMATS), probe()).verifyDuration).toBeUndefined();
  });
});

describe("trimming", () => {
  const fast = find("trim-copy", TRIM_FORMATS);
  const precise = find("trim-precise", TRIM_FORMATS);
  const range = { startSeconds: 10, endSeconds: 20 };

  it("insists on a range", () => {
    expect(fast.blocker!(probe(), context())?.message).toMatch(/Set a start or end marker/);
    expect(precise.blocker!(probe(), context())?.message).toMatch(/Set a start or end marker/);
    expect(fast.blocker!(probe(), context(1_000_000, range))).toBeNull();
    expect(precise.blocker!(probe(), context(1_000_000, range))).toBeNull();
  });

  it("copies both streams for a fast cut, and zeroes the timestamps", () => {
    const plan = planFor(fast, probe());
    expect(plan.mode).toBe("copy");
    expect(joined(plan.args)).toContain("-c copy");
    expect(joined(plan.args)).toContain("-avoid_negative_ts make_zero");
    expect(plan.extension).toBe("mp4");
    expect(planFor(fast, probe({ codec: "h264" }, { codec: "vorbis" })).extension).toBe("mkv");
  });

  it("re-encodes both streams for a precise cut, always into MP4", () => {
    const plan = planFor(precise, probe({ codec: "vp9" }, { codec: "opus" }));
    expect(plan.mode).toBe("encode");
    expect(joined(plan.args)).toContain("-c:v libx264");
    expect(joined(plan.args)).toContain("-crf 18");
    expect(joined(plan.args)).toContain("-c:a aac");
    expect(plan.extension).toBe("mp4");
  });
});

describe("removing metadata", () => {
  it("copies the streams and drops every tag, chapter and data track", () => {
    const plan = planFor(STRIP_FORMAT, probe());
    expect(plan.mode).toBe("copy");
    expect(joined(plan.args)).toContain("-map_metadata -1");
    expect(joined(plan.args)).toContain("-map_metadata:s -1");
    expect(joined(plan.args)).toContain("-map_chapters -1");
    expect(joined(plan.args)).toContain("-c copy");
    expect(plan.args).toContain("-sn");
    expect(plan.args).toContain("-dn");
    expect(joined(plan.args)).toContain("-fflags +bitexact");
    expect(plan.fileSuffix).toBe("-clean");
    expect(plan.kind).toBe("video");
  });

  it("works on an audio file too, in its own container", () => {
    const plan = planFor(STRIP_FORMAT, probe(null, { codec: "mp3" }));
    expect(plan.args).not.toContain("0:v:0");
    expect(plan.extension).toBe("mp3");
    expect(plan.kind).toBe("audio");
  });
});

describe("atempoChain", () => {
  it("keeps every step inside the range the filter has always accepted", () => {
    for (const factor of [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8, 100]) {
      const steps = atempoChain(factor);
      for (const step of steps) {
        expect(step, `${factor}x`).toBeGreaterThanOrEqual(0.5);
        expect(step, `${factor}x`).toBeLessThanOrEqual(2);
      }
      expect(steps.reduce((product, step) => product * step, 1)).toBeCloseTo(factor, 3);
    }
  });

  it("uses one step where one will do", () => {
    expect(atempoChain(2)).toEqual([2]);
    expect(atempoChain(0.5)).toEqual([0.5]);
    expect(atempoChain(1.5)).toEqual([1.5]);
  });

  it("chains doublings and halvings beyond it", () => {
    expect(atempoChain(4)).toEqual([2, 2]);
    expect(atempoChain(3)).toEqual([2, 1.5]);
    expect(atempoChain(0.25)).toEqual([0.5, 0.5]);
  });
});

describe("speedFilters", () => {
  it("re-times the video and holds the source frame rate", () => {
    const filters = speedFilters(2, probe({ fps: 29.97 })!.video);
    expect(filters.video).toBe("setpts=(PTS-STARTPTS)/2,fps=29.97");
    expect(filters.audio).toBe("atempo=2");
  });

  it("falls back to 30 fps when the source does not say", () => {
    expect(speedFilters(0.5, probe({ fps: null })!.video).video).toBe(
      "setpts=(PTS-STARTPTS)/0.5,fps=30",
    );
    expect(speedFilters(0.5, null).video).toContain("fps=30");
  });

  it("chains atempo for the speeds one step cannot reach", () => {
    expect(speedFilters(4, null).audio).toBe("atempo=2,atempo=2");
    expect(speedFilters(0.25, null).audio).toBe("atempo=0.5,atempo=0.5");
  });
});

describe("the speed changer", () => {
  const twice = speedFormat({ factor: 2, keepAudio: true });

  it("bakes the speed and the audio choice into the id, the label and the filename", () => {
    expect(twice.id).toBe("speed-2x-audio");
    expect(twice.label).toBe("2x");
    expect(speedFormat({ factor: 0.5, keepAudio: false }).id).toBe("speed-0.5x-silent");
    expect(planFor(twice, probe()).fileSuffix).toBe("-2x");
    expect(planFor(speedFormat({ factor: 1.25, keepAudio: true }), probe()).fileSuffix).toBe(
      "-1.25x",
    );
  });

  it("re-encodes both streams with the filters, into an MP4", () => {
    const plan = planFor(twice, probe());
    expect(plan.mode).toBe("encode");
    expect(plan.extension).toBe("mp4");
    expect(plan.kind).toBe("video");
    expect(joined(plan.args)).toContain("-vf setpts=(PTS-STARTPTS)/2,fps=30");
    expect(joined(plan.args)).toContain("-af atempo=2");
    expect(joined(plan.args)).toContain("-c:v libx264");
    expect(joined(plan.args)).toContain("-c:a aac -b:a 192k");
    expect(plan.args).toContain("+faststart");
    expect(twice.requiredEncoder).toBe("libx264");
  });

  it("tells the engine the output runs on its own clock", () => {
    // Half as long at 2x, twice as long at 0.5x: progress and the range limit
    // both have to follow the output, not the input.
    expect(planFor(twice, probe()).durationFactor).toBe(0.5);
    expect(planFor(speedFormat({ factor: 0.5, keepAudio: true }), probe()).durationFactor).toBe(
      2,
    );
    expect(planFor(twice, probe()).limitInput).toBe(true);
  });

  it("drops the audio when asked to, and when there is none", () => {
    const silent = planFor(speedFormat({ factor: 2, keepAudio: false }), probe());
    expect(silent.args).toContain("-an");
    expect(silent.args).not.toContain("-af");
    expect(silent.args).not.toContain("-c:a");
    // Keeping the audio of a file that has none is not an error.
    const noAudio = planFor(twice, probe({}, null));
    expect(noAudio.args).toContain("-an");
    expect(noAudio.args).not.toContain("0:a:0");
  });

  it("sizes the output by its own length", () => {
    // An hour of 1080p is about 2 GB of H.264; at 2x it is half that: fine.
    const long = probe({}, {}, 3600);
    expect(twice.blocker!(long, context(20 * 1024 ** 3))).toBeNull();
    // The same hour at quarter speed is four hours of output: not fine.
    const slow = speedFormat({ factor: 0.25, keepAudio: true });
    expect(slow.blocker!(long, context(20 * 1024 ** 3))?.message).toMatch(/re-timed video/);
    // A range brings it back.
    expect(
      slow.blocker!(long, context(20 * 1024 ** 3, { startSeconds: 0, endSeconds: 60 })),
    ).toBeNull();
  });
});

describe("speed factors", () => {
  it("accepts the range the tool takes and rounds to two decimals", () => {
    expect(parseSpeedFactor(2)).toBe(2);
    expect(parseSpeedFactor(1.333)).toBe(1.33);
    expect(parseSpeedFactor(0.1)).toBe(0.1);
    expect(parseSpeedFactor(100)).toBe(100);
  });

  it("refuses what is not a speed", () => {
    expect(parseSpeedFactor(0)).toBeNull();
    expect(parseSpeedFactor(-2)).toBeNull();
    expect(parseSpeedFactor(0.04)).toBeNull();
    expect(parseSpeedFactor(101)).toBeNull();
    expect(parseSpeedFactor(Number.NaN)).toBeNull();
  });

  it("labels speeds without trailing zeros", () => {
    expect(formatSpeed(2)).toBe("2x");
    expect(formatSpeed(0.5)).toBe("0.5x");
    expect(formatSpeed(1.25)).toBe("1.25x");
    expect(formatSpeed(1.5)).toBe("1.5x");
  });
});
