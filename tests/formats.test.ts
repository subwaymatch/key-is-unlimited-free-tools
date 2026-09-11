import { describe, expect, it } from "vitest";

import {
  copyTargetForCodec,
  estimateOutputBytes,
  findFormatBlocker,
  getFormat,
  isFormatAvailable,
  MAX_SAFE_OUTPUT_BYTES,
  OUTPUT_FORMATS,
} from "@/lib/engine/formats";
import type { AudioStreamInfo, ProbeResult } from "@/lib/engine/types";

function probe(
  audio: Partial<AudioStreamInfo> | null,
  durationSeconds: number | null = 600,
): ProbeResult {
  const stream: AudioStreamInfo | null = audio
    ? {
        codec: "aac",
        profile: null,
        sampleRate: 48000,
        channels: 2,
        channelLayout: "stereo",
        bitrateKbps: 192,
        ...audio,
      }
    : null;

  const video = {
    codec: "h264",
    profile: "High",
    pixelFormat: "yuv420p",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateKbps: 4500,
    rotationDegrees: null,
  };

  return {
    durationSeconds,
    bitrateKbps: 4700,
    audioStreams: stream ? [stream] : [],
    audio: stream,
    videoStreams: [video],
    video,
    hasVideo: true,
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    log: [],
  };
}

describe("copyTargetForCodec", () => {
  it("picks the natural container for common codecs", () => {
    expect(copyTargetForCodec("aac").extension).toBe("m4a");
    expect(copyTargetForCodec("mp3").extension).toBe("mp3");
    expect(copyTargetForCodec("opus").extension).toBe("opus");
    expect(copyTargetForCodec("vorbis").extension).toBe("ogg");
    expect(copyTargetForCodec("flac").extension).toBe("flac");
    expect(copyTargetForCodec("ac3").extension).toBe("ac3");
  });

  it("routes the PCM flavours WAV can hold to WAV", () => {
    for (const codec of ["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8", "pcm_alaw"]) {
      expect(copyTargetForCodec(codec).extension, codec).toBe("wav");
    }
  });

  it("sends big-endian PCM to Matroska, since the WAV muxer rejects it", () => {
    // What older QuickTime files carry; a copy into WAV fails at mux time.
    for (const codec of ["pcm_s16be", "pcm_s24be", "pcm_f32be", "pcm_u16le"]) {
      expect(copyTargetForCodec(codec).extension, codec).toBe("mka");
    }
  });

  it("falls back to Matroska for anything it does not know", () => {
    expect(copyTargetForCodec("truehd").extension).toBe("mka");
    expect(copyTargetForCodec(null).extension).toBe("mka");
  });

  it("is case-insensitive", () => {
    expect(copyTargetForCodec("AAC").extension).toBe("m4a");
  });
});

describe("format plans", () => {
  it("always drops video, subtitles and data, and picks one audio stream", () => {
    for (const format of OUTPUT_FORMATS) {
      const { args } = format.plan(probe({}));
      expect(args.slice(0, 5)).toEqual(["-map", "0:a:0", "-vn", "-sn", "-dn"]);
    }
  });

  it("stream-copies the original track without re-encoding", () => {
    const plan = getFormat("original").plan(probe({ codec: "opus" }));

    expect(plan.args).toContain("copy");
    expect(plan.args).not.toContain("libopus");
    expect(plan.mode).toBe("copy");
    expect(plan.extension).toBe("opus");
  });

  it("copies rather than re-encodes when the source is already AAC", () => {
    const plan = getFormat("m4a").plan(probe({ codec: "aac" }));

    expect(plan.mode).toBe("copy");
    expect(plan.args).toContain("copy");
    expect(plan.args).not.toContain("aac");
  });

  it("re-encodes ALAC for the M4A format, which promises AAC in its name", () => {
    // The lossless copy of an ALAC track is what "Original" is for.
    expect(getFormat("m4a").plan(probe({ codec: "alac" })).mode).toBe("encode");
    expect(getFormat("original").plan(probe({ codec: "alac" }))).toMatchObject({
      mode: "copy",
      extension: "m4a",
    });
  });

  it("puts the moov atom up front for every MP4 output, copies included", () => {
    expect(getFormat("original").plan(probe({ codec: "aac" })).args).toContain("+faststart");
    expect(getFormat("m4a").plan(probe({ codec: "vorbis" })).args).toContain("+faststart");
    // Other containers have no such flag to set.
    expect(getFormat("original").plan(probe({ codec: "flac" })).args).not.toContain("-movflags");
  });

  it("re-encodes to AAC when the source codec cannot live in an MP4", () => {
    const plan = getFormat("m4a").plan(probe({ codec: "vorbis" }));

    expect(plan.mode).toBe("encode");
    expect(plan.args).toContain("aac");
    expect(plan.args).toContain("192k");
    expect(plan.extension).toBe("m4a");
  });

  it("uses the expected encoder for each lossy format", () => {
    expect(getFormat("mp3").plan(probe({})).args).toContain("libmp3lame");
    expect(getFormat("opus").plan(probe({})).args).toContain("opus");
    expect(getFormat("flac").plan(probe({})).args).toContain("flac");
    expect(getFormat("wav").plan(probe({})).args).toContain("pcm_s16le");
  });

  /*
   * libopus traps with "memory access out of bounds" on every invocation in
   * @ffmpeg/core 0.12.10, so Opus goes through ffmpeg's own encoder instead.
   * That encoder is experimental, so the strictness flag is what makes it run
   * at all: drop it and every Opus job fails.
   */
  it("encodes Opus with the native encoder, not libopus", () => {
    const { args } = getFormat("opus").plan(probe({}));

    expect(args).not.toContain("libopus");
    expect(args.join(" ")).toContain("-c:a opus");
    expect(args).toContain("-strict");
    expect(args).toContain("-2");
    expect(getFormat("opus").requiredEncoder).toBe("opus");
  });

  it("rejects an unknown format id", () => {
    expect(() => getFormat("aiff")).toThrow(/Unknown output format/);
  });
});

describe("estimateOutputBytes", () => {
  it("sizes uncompressed PCM from the stream parameters", () => {
    // 60s * 48000 Hz * 2ch * 2 bytes = 11.52 MB
    const estimate = estimateOutputBytes("wav", probe({}, 60));

    expect(estimate).toBeGreaterThan(11_500_000);
    expect(estimate).toBeLessThan(11_600_000);
  });

  it("scales with channel count", () => {
    const stereo = estimateOutputBytes("wav", probe({ channels: 2 }, 60))!;
    const surround = estimateOutputBytes("wav", probe({ channels: 6 }, 60))!;

    expect(surround / stereo).toBeCloseTo(3, 1);
  });

  it("does not guess at compressed formats", () => {
    expect(estimateOutputBytes("mp3", probe({}))).toBeNull();
    expect(estimateOutputBytes("flac", probe({}))).toBeNull();
    expect(estimateOutputBytes("original", probe({}))).toBeNull();
  });

  it("returns null when the duration is unknown or zero", () => {
    expect(estimateOutputBytes("wav", probe({}, null))).toBeNull();
    expect(estimateOutputBytes("wav", probe({}, 0))).toBeNull();
  });
});

describe("trimmed output estimates", () => {
  it("scales the WAV estimate down to the length of the clip", () => {
    const full = estimateOutputBytes("wav", probe({}, 600));
    const half = estimateOutputBytes("wav", probe({}, 600), {
      startSeconds: 0,
      endSeconds: 300,
    });
    expect(half).toBeCloseTo(full! / 2, -2);
  });

  it("lets a trim rescue a WAV that would otherwise be refused", () => {
    // Six hours of 48 kHz stereo is far past the in-memory output ceiling.
    const long = probe({}, 6 * 3600);
    expect(findFormatBlocker("wav", long)).not.toBeNull();
    expect(
      findFormatBlocker("wav", long, { startSeconds: 0, endSeconds: 600 }),
    ).toBeNull();
  });
});

describe("findFormatBlocker", () => {
  it("allows a WAV that fits in the engine's output budget", () => {
    // Two hours of 48 kHz stereo is about 1.4 GB.
    expect(findFormatBlocker("wav", probe({}, 2 * 3600))).toBeNull();
  });

  it("blocks a WAV that would exceed the in-memory output ceiling", () => {
    const blocker = findFormatBlocker("wav", probe({}, 6 * 3600));

    expect(blocker).not.toBeNull();
    expect(blocker!.message).toMatch(/WAV would be about/);
    expect(blocker!.hint).toMatch(/FLAC/);
  });

  it("blocks earlier for surround audio, which grows faster", () => {
    const duration = 2 * 3600;

    expect(findFormatBlocker("wav", probe({ channels: 2 }, duration))).toBeNull();
    expect(findFormatBlocker("wav", probe({ channels: 6 }, duration))).not.toBeNull();
  });

  it("never blocks compressed formats, however long the file", () => {
    for (const id of ["original", "m4a", "mp3", "opus", "flac"] as const) {
      expect(findFormatBlocker(id, probe({}, 24 * 3600))).toBeNull();
    }
  });

  it("keeps the ceiling below the engine's 2 GB heap", () => {
    expect(MAX_SAFE_OUTPUT_BYTES).toBeLessThan(2 * 1024 ** 3);
  });
});

describe("copying rather than re-encoding to the same codec", () => {
  const probeWith = (codec: string) => probe({ codec });

  it("copies an MP3 source into MP3", () => {
    const plan = getFormat("mp3").plan(probeWith("mp3"));
    expect(plan.mode).toBe("copy");
    expect(plan.args).toContain("copy");
    expect(plan.args).not.toContain("libmp3lame");
  });

  it("copies an Opus source into Opus", () => {
    const plan = getFormat("opus").plan(probeWith("opus"));
    expect(plan.mode).toBe("copy");
    expect(plan.args).not.toContain("-strict");
  });

  it("copies FLAC and 16-bit PCM too", () => {
    expect(getFormat("flac").plan(probeWith("flac")).mode).toBe("copy");
    expect(getFormat("wav").plan(probeWith("pcm_s16le")).mode).toBe("copy");
  });

  it("still encodes when the source codec is something else", () => {
    expect(getFormat("mp3").plan(probeWith("aac")).mode).toBe("encode");
    expect(getFormat("opus").plan(probeWith("aac")).mode).toBe("encode");
    expect(getFormat("flac").plan(probeWith("aac")).mode).toBe("encode");
    expect(getFormat("wav").plan(probeWith("aac")).mode).toBe("encode");
  });
});

describe("output names", () => {
  it("distinguishes Original from the format that would produce the same file", () => {
    // Both are a stream copy of an AAC track into an .m4a; without a suffix
    // they would be two downloads under one name.
    const original = getFormat("original").plan(probe({ codec: "aac" }));
    const m4a = getFormat("m4a").plan(probe({ codec: "aac" }));
    expect(original.extension).toBe(m4a.extension);
    expect(original.fileSuffix).toBe("-original");
    expect(m4a.fileSuffix).toBeUndefined();
  });
});

describe("isFormatAvailable", () => {
  const capabilities = { encoders: new Set(["aac", "flac"]), supportsWorkerFs: true };

  it("offers everything until the core has reported what it ships", () => {
    for (const format of OUTPUT_FORMATS) {
      expect(isFormatAvailable(format, null)).toBe(true);
    }
  });

  it("greys out formats whose encoder the loaded core lacks", () => {
    expect(isFormatAvailable(getFormat("m4a"), capabilities)).toBe(true);
    expect(isFormatAvailable(getFormat("flac"), capabilities)).toBe(true);
    expect(isFormatAvailable(getFormat("mp3"), capabilities)).toBe(false);
    expect(isFormatAvailable(getFormat("wav"), capabilities)).toBe(false);
  });

  it("never needs an encoder for a stream copy", () => {
    expect(isFormatAvailable(getFormat("original"), { ...capabilities, encoders: new Set() })).toBe(
      true,
    );
  });
});
