import { describe, expect, it } from "vitest";

import {
  isQuarterTurn,
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

  it("does not surface the Emscripten runtime's own trap output", () => {
    // What a wasm trap actually leaves in the log. "Aborted()" under an error
    // that already explained itself reads as a second, cryptic failure.
    const reason = summarizeFailure([
      "/input/source.mp4: Invalid data found when processing input",
      "Aborted()",
    ]);

    expect(reason).toBe("/input/source.mp4: Invalid data found when processing input");
  });

  it("returns null when the trap is the only thing in the log", () => {
    expect(summarizeFailure(["Aborted(native code called abort())"])).toBeNull();
  });
});

describe("isQuarterTurn", () => {
  it("is true for the rotations that swap width and height", () => {
    expect(isQuarterTurn(90)).toBe(true);
    expect(isQuarterTurn(-90)).toBe(true);
    expect(isQuarterTurn(270)).toBe(true);
    expect(isQuarterTurn(-270)).toBe(true);
  });

  it("is false for upright, upside down and unknown", () => {
    expect(isQuarterTurn(0)).toBe(false);
    expect(isQuarterTurn(180)).toBe(false);
    expect(isQuarterTurn(-180)).toBe(false);
    expect(isQuarterTurn(null)).toBe(false);
  });
});

describe("video streams", () => {
  it("reads codec, profile, pixel format, size, frame rate and bitrate", () => {
    const { video, videoStreams, bitrateKbps } = parseProbeOutput(MP4_PROBE);

    expect(videoStreams).toHaveLength(1);
    expect(video).toEqual({
      codec: "h264",
      profile: "High",
      pixelFormat: "yuv420p",
      width: 1920,
      height: 1080,
      fps: 23.98,
      bitrateKbps: 4522,
      rotationDegrees: null,
    });
    expect(bitrateKbps).toBe(4721);
  });

  it("does not mistake the fourcc tag for a frame size", () => {
    // "0x31637661" would read as 0 by 31637661 to a naive pattern.
    expect(parseProbeOutput(MP4_PROBE).video?.width).toBe(1920);
  });

  it("reads a 10-bit HEVC stream without a bitrate or a tag", () => {
    const { video } = parseProbeOutput(MKV_MULTI_AUDIO);

    expect(video).toEqual({
      codec: "hevc",
      profile: "Main 10",
      pixelFormat: "yuv420p10le",
      width: 3840,
      height: 2160,
      fps: 23.98,
      bitrateKbps: null,
      rotationDegrees: null,
    });
  });

  it("attaches a display rotation to the stream it was printed under", () => {
    const { video, videoStreams } = parseProbeOutput([
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/input/source.mov':",
      "  Duration: 00:00:04.00, start: 0.000000, bitrate: 2000 kb/s",
      "  Stream #0:0(und): Video: h264 (High), yuv420p, 1280x720, 30 fps, 30 tbr, 15360 tbn",
      "    Metadata:",
      "      handler_name    : VideoHandler",
      "    Side data:",
      "      displaymatrix: rotation of -90.00 degrees",
      "  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s",
    ]);

    expect(videoStreams).toHaveLength(1);
    expect(video?.rotationDegrees).toBe(-90);
    // The coded size is what ffmpeg printed; the rotation is what makes it a
    // portrait clip, and describeVideo is what swaps them for display.
    expect(video?.width).toBe(1280);
    expect(video?.height).toBe(720);
  });

  it("does not attach a rotation to a later audio stream", () => {
    const { video, audio } = parseProbeOutput([
      "  Stream #0:0: Video: h264, yuv420p, 1280x720, 30 fps",
      "  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s",
      "    Side data:",
      "      displaymatrix: rotation of 90.00 degrees",
    ]);

    expect(video?.rotationDegrees).toBeNull();
    expect(audio?.codec).toBe("aac");
  });

  it("reads Matroska's unbracketed aspect ratio line", () => {
    const { video } = parseProbeOutput([
      "Input #0, matroska,webm, from '/input/source.webm':",
      "  Duration: 00:00:10.00, start: 0.000000, bitrate: 1200 kb/s",
      "  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv, bt709), 1280x720, SAR 1:1 DAR 16:9, 30 fps, 30 tbr, 1k tbn (default)",
    ]);

    expect(video).toMatchObject({ codec: "vp9", profile: "Profile 0", width: 1280, height: 720, fps: 30 });
  });

  it("leaves cover art out of the video streams", () => {
    const { video, videoStreams, hasVideo } = parseProbeOutput([
      "Input #0, mp3, from '/input/source.mp3':",
      "  Duration: 00:03:00.00, start: 0.000000, bitrate: 320 kb/s",
      "  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s",
      "  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)",
    ]);

    expect(hasVideo).toBe(false);
    expect(videoStreams).toHaveLength(0);
    expect(video).toBeNull();
  });

  it("falls back to tbr when no fps is printed", () => {
    const { video } = parseProbeOutput([
      "Input #0, avi, from '/input/source.avi':",
      "  Stream #0:0: Video: mpeg4 (Simple Profile) (XVID / 0x44495658), yuv420p, 640x480 [SAR 1:1 DAR 4:3], 25 tbr, 25 tbn",
    ]);

    expect(video).toMatchObject({ codec: "mpeg4", width: 640, height: 480, fps: 25 });
  });
});

describe("subtitle streams", () => {
  it("reads each track's codec and language, and a title from its metadata", () => {
    const result = parseProbeOutput([
      "Input #0, matroska,webm, from '/input/source.mkv':",
      "  Duration: 00:24:03.10, start: 0.000000, bitrate: 8123 kb/s",
      "  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 23.98 fps",
      "  Stream #0:1(jpn): Audio: aac (LC), 48000 Hz, stereo, fltp (default)",
      "  Stream #0:2(eng): Subtitle: subrip (default)",
      "    Metadata:",
      "      title           : English (SDH)",
      "  Stream #0:3(spa): Subtitle: ass",
      "  Stream #0:4(und): Subtitle: hdmv_pgs_subtitle",
      "  Stream #0:5[0x3](eng): Subtitle: mov_text (tx3g / 0x67337874), 0 kb/s",
    ]);
    expect(result.subtitleStreams).toEqual([
      { codec: "subrip", language: "eng", title: "English (SDH)" },
      { codec: "ass", language: "spa", title: null },
      { codec: "hdmv_pgs_subtitle", language: null, title: null },
      { codec: "mov_text", language: "eng", title: null },
    ]);
    // The tracks do not disturb the counts the other tools rely on.
    expect(result.audioStreams).toHaveLength(1);
    expect(result.videoStreams).toHaveLength(1);
  });

  it("finds the subtitle track in the multi-audio MKV fixture", () => {
    expect(parseProbeOutput(MKV_MULTI_AUDIO).subtitleStreams).toEqual([
      { codec: "subrip", language: "eng", title: null },
    ]);
  });

  it("does not take an audio stream's title for a subtitle's", () => {
    const result = parseProbeOutput([
      "  Stream #0:0(eng): Subtitle: subrip",
      "  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp",
      "    Metadata:",
      "      title           : Commentary",
    ]);
    expect(result.subtitleStreams[0].title).toBeNull();
  });
});
