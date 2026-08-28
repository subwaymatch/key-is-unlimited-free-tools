import { describe, expect, it } from "vitest";

import {
  parseChannelCount,
  parseEncoders,
  parseProbeOutput,
  parseTimestamp,
  summarizeFailure,
} from "@/lib/engine/probe";

/** Trimmed from a real `ffmpeg -hide_banner -i movie.mp4` run. */
const MP4_PROBE = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/input/source.mp4':",
  "  Metadata:",
  "    major_brand     : isom",
  "  Duration: 01:42:19.35, start: 0.000000, bitrate: 4721 kb/s",
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 4522 kb/s, 23.98 fps, 23.98 tbr, 24k tbn (default)",
  "  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)",
  "At least one output file must be specified",
];

const MKV_MULTI_AUDIO = [
  "Input #0, matroska,webm, from '/input/source.mkv':",
  "  Duration: 00:24:03.10, start: 0.000000, bitrate: 8123 kb/s",
  "  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv), 3840x2160, 23.98 fps",
  "  Stream #0:1(jpn): Audio: flac, 48000 Hz, 5.1(side), s32 (24 bit) (default)",
  "  Stream #0:2(eng): Audio: opus, 48000 Hz, stereo, fltp",
  "  Stream #0:3(eng): Subtitle: subrip",
];

describe("parseTimestamp", () => {
  it("converts an ffmpeg timestamp to seconds", () => {
    expect(parseTimestamp("00:00:10.05")).toBeCloseTo(10.05);
    expect(parseTimestamp("01:42:19.35")).toBeCloseTo(6139.35);
    expect(parseTimestamp("10:00:00.00")).toBe(36000);
  });

  it("rejects anything that is not a timestamp", () => {
    expect(parseTimestamp("N/A")).toBeNull();
    expect(parseTimestamp("1:2:3")).toBeNull();
  });
});

describe("parseChannelCount", () => {
  it("maps named layouts", () => {
    expect(parseChannelCount("mono")).toBe(1);
    expect(parseChannelCount("stereo")).toBe(2);
    expect(parseChannelCount("5.1")).toBe(6);
    expect(parseChannelCount("7.1")).toBe(8);
  });

  it("ignores the parenthetical variant suffix", () => {
    expect(parseChannelCount("5.1(side)")).toBe(6);
    expect(parseChannelCount("quad(side)")).toBe(4);
  });

  it("reads explicit channel counts", () => {
    expect(parseChannelCount("16 channels")).toBe(16);
    expect(parseChannelCount("3 channels")).toBe(3);
  });

  it("returns null for anything unrecognised", () => {
    expect(parseChannelCount("fltp")).toBeNull();
    expect(parseChannelCount(null)).toBeNull();
  });
});

describe("parseProbeOutput", () => {
  it("extracts duration, container and the audio stream", () => {
    const result = parseProbeOutput(MP4_PROBE);

    expect(result.durationSeconds).toBeCloseTo(6139.35);
    expect(result.formatName).toBe("mov,mp4,m4a,3gp,3g2,mj2");
    expect(result.hasVideo).toBe(true);
    expect(result.audio).toEqual({
      codec: "aac",
      profile: "LC",
      sampleRate: 48000,
      channels: 2,
      channelLayout: "stereo",
      bitrateKbps: 192,
    });
  });

  it("keeps every audio stream but extracts the first", () => {
    const result = parseProbeOutput(MKV_MULTI_AUDIO);

    expect(result.audioStreams).toHaveLength(2);
    expect(result.audio?.codec).toBe("flac");
    expect(result.audio?.channels).toBe(6);
    expect(result.audioStreams[1].codec).toBe("opus");
  });

  it("does not mistake the fourcc tag for a codec profile", () => {
    const result = parseProbeOutput([
      "  Stream #0:1: Audio: ac3 (ac-3 / 0x332D6361), 48000 Hz, 5.1(side), fltp, 448 kb/s",
    ]);

    expect(result.audio?.codec).toBe("ac3");
    expect(result.audio?.profile).toBeNull();
  });

  it("reports no audio for a silent file", () => {
    const result = parseProbeOutput([
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/input/source.mp4':",
      "  Duration: 00:00:30.00, start: 0.000000, bitrate: 1000 kb/s",
      "  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 30 fps",
    ]);

    expect(result.audio).toBeNull();
    expect(result.audioStreams).toHaveLength(0);
    expect(result.hasVideo).toBe(true);
  });

  it("does not count embedded cover art as video", () => {
    const result = parseProbeOutput([
      "Input #0, mp3, from '/input/source.mp3':",
      "  Duration: 00:03:20.00, start: 0.000000, bitrate: 320 kb/s",
      "  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s",
      "  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 600x600 (attached pic)",
    ]);

    expect(result.hasVideo).toBe(false);
    expect(result.audio?.codec).toBe("mp3");
  });

  it("survives a duration ffmpeg could not determine", () => {
    const result = parseProbeOutput([
      "Input #0, matroska,webm, from '/input/source.mkv':",
      "  Duration: N/A, start: 0.000000, bitrate: N/A",
      "  Stream #0:0: Audio: opus, 48000 Hz, stereo, fltp",
    ]);

    expect(result.durationSeconds).toBeNull();
    expect(result.audio?.codec).toBe("opus");
  });
});

describe("parseEncoders", () => {
  const ENCODERS_OUTPUT = [
    "Encoders:",
    " V..... = Video",
    " A..... = Audio",
    " ------",
    " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC",
    " A....D aac                  AAC (Advanced Audio Coding)",
    " A....D libmp3lame           libmp3lame MP3 (MPEG audio layer 3)",
    " A....D libopus              libopus Opus",
    " A....D flac                 FLAC (Free Lossless Audio Codec)",
    " A....D pcm_s16le            PCM signed 16-bit little-endian",
  ];

  it("collects encoder names from the table body", () => {
    const encoders = parseEncoders(ENCODERS_OUTPUT);

    expect(encoders.has("aac")).toBe(true);
    expect(encoders.has("libmp3lame")).toBe(true);
    expect(encoders.has("libopus")).toBe(true);
    expect(encoders.has("flac")).toBe(true);
    expect(encoders.has("pcm_s16le")).toBe(true);
    expect(encoders.has("libx264")).toBe(true);
  });

  it("ignores the legend above the separator", () => {
    const encoders = parseEncoders(ENCODERS_OUTPUT);

    expect(encoders.has("=")).toBe(false);
    expect(encoders.has("Video")).toBe(false);
    expect(encoders.size).toBe(6);
  });
});

describe("summarizeFailure", () => {
  it("surfaces the actionable last line", () => {
    const reason = summarizeFailure([
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/input/source.mp4':",
      "  Duration: 00:10:00.00, start: 0.000000, bitrate: 1000 kb/s",
      "  Stream #0:0: Video: h264, yuv420p, 1280x720",
      "Unknown encoder 'libopus'",
    ]);

    expect(reason).toBe("Unknown encoder 'libopus'");
  });

  it("skips banner and stream noise", () => {
    const reason = summarizeFailure([
      "ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers",
      "  configuration: --enable-gpl",
      "/input/source.mp4: Invalid data found when processing input",
      "  Stream #0:0: Video: h264",
    ]);

    expect(reason).toBe("/input/source.mp4: Invalid data found when processing input");
  });

  it("returns null when there is nothing but noise", () => {
    expect(summarizeFailure(["ffmpeg version 6.0", "  configuration: --enable-gpl"])).toBeNull();
  });
});
