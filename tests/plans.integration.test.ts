/**
 * Runs every video plan through a real ffmpeg.
 *
 * The unit tests pin the argument strings; this checks that ffmpeg accepts
 * them and writes what the plan claims. It uses whatever ffmpeg is on PATH,
 * which is not the pinned WebAssembly core - scripts/verify-video-tools.mjs
 * covers that in a browser - but the command lines are the same, and a filter
 * that does not parse or a metadata specifier that is not one fails here in
 * seconds rather than in a browser run.
 *
 * Skipped when ffmpeg is not installed, so it costs CI nothing it lacks.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { parseProbeOutput } from "@/lib/engine/probe";
import { trimArgs } from "@/lib/engine/trim";
import type { OutputFormat, PlanContext, ProbeResult, TrimRange } from "@/lib/engine/types";
import {
  compressFormat,
  CONVERT_FORMATS,
  gifFormat,
  MUTE_FORMAT,
  STRIP_FORMAT,
  TRIM_FORMATS,
} from "@/lib/engine/video";

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

const dir = join(tmpdir(), "key-is-plans");

function fixture(name: string, args: string[]): string {
  const path = join(dir, name);
  if (!existsSync(path)) execFileSync("ffmpeg", ["-y", "-v", "error", ...args, path]);
  return path;
}

/** The probe the engine would have built: `ffmpeg -i` with no output. */
function probe(path: string): ProbeResult {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path], { encoding: "utf8" });
  return parseProbeOutput(result.stderr.split("\n"));
}

interface Probed {
  format: { duration: string; tags?: Record<string, string> };
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    tags?: Record<string, string>;
  }>;
}

function ffprobe(path: string): Probed {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], {
      encoding: "utf8",
    }),
  );
}

let counter = 0;

/**
 * Assembles the command line the way FFmpegEngine.runExtract does, runs every
 * pass, and returns the output path.
 */
function run(
  format: OutputFormat,
  input: string,
  trim: TrimRange | null = null,
): { output: string; probed: Probed } {
  const context: PlanContext = { trim, fileBytes: statSync(input).size };
  const blocker = format.blocker?.(probe(input), context);
  expect(blocker, `${format.id} was blocked: ${blocker?.message}`).toBeNull();

  const plan = format.plan(probe(input), context);
  const output = join(dir, `out-${(counter += 1)}-${format.id}.${plan.extension}`);
  const { input: seek, output: length } = trimArgs(trim);
  const passLog = plan.analysisPasses?.length ? ["-passlogfile", join(dir, "twopass")] : [];

  for (const [index, passArgs] of [...(plan.analysisPasses ?? []), plan.args].entries()) {
    const isFinal = index === (plan.analysisPasses?.length ?? 0);
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-v",
        "error",
        ...seek,
        ...(plan.inputArgs ?? []),
        "-i",
        input,
        ...passArgs,
        ...passLog,
        ...length,
        ...(isFinal ? [output] : ["-f", "null", "-"]),
      ],
      { encoding: "utf8" },
    );
    expect(result.status, `${format.id} pass ${index + 1}: ${result.stderr}`).toBe(0);
  }

  return { output, probed: ffprobe(output) };
}

const seconds = (probed: Probed) => Number(probed.format.duration);
const stream = (probed: Probed, type: string) =>
  probed.streams.find((entry) => entry.codec_type === type);

describe.skipIf(!hasFfmpeg)("video plans against a real ffmpeg", () => {
  let tagged: string;
  let big: string;
  let avi: string;
  let music: string;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    // Noisy enough that x264 really spends 4 Mbps on it, so a 1 MB target is
    // a real compression rather than a refusal.
    big = fixture("noisy.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25,noise=alls=40:allf=t",
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
      "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-b:v", "4M", "-minrate", "4M", "-maxrate", "4M", "-bufsize", "1M",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ]);
    tagged = fixture("tagged.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-g", "25", "-keyint_min", "25",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
      "-metadata", "title=Holiday", "-metadata:s:v:0", "handler_name=Camera",
    ]);
    avi = fixture("legacy.avi", [
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100",
      "-t", "2", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "mp2", "-b:a", "128k", "-ac", "2",
    ]);
    music = fixture("music.mp3", [
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-metadata", "title=Song",
    ]);
  });

  it("probes the fixtures the way the engine would", () => {
    const info = probe(tagged);
    expect(info.video).toMatchObject({ codec: "h264", width: 320, height: 180, fps: 25 });
    expect(info.audio?.codec).toBe("aac");
    expect(info.durationSeconds).toBeCloseTo(4, 0);
  });

  it("converts to MP4 by copying what fits and encoding what does not", () => {
    const mp4 = CONVERT_FORMATS.find((format) => format.id === "mp4")!;

    const copied = run(mp4, tagged);
    expect(stream(copied.probed, "video")?.codec_name).toBe("h264");
    expect(stream(copied.probed, "audio")?.codec_name).toBe("aac");

    const encoded = run(mp4, avi);
    expect(stream(encoded.probed, "video")?.codec_name).toBe("h264");
    expect(stream(encoded.probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(encoded.probed)).toBeCloseTo(2, 0);
  });

  it("remuxes into MKV", () => {
    const mkv = CONVERT_FORMATS.find((format) => format.id === "mkv")!;
    const { probed } = run(mkv, avi);
    expect(stream(probed, "video")?.codec_name).toBe("mpeg4");
    expect(stream(probed, "audio")?.codec_name).toBe("mp2");
  });

  it("compresses to a target size in two passes", () => {
    const target = 1_000_000;
    expect(statSync(big).size).toBeGreaterThan(target);
    const { output, probed } = run(compressFormat({ targetBytes: target, resolution: "auto", twoPass: true }), big);
    expect(statSync(output).size).toBeLessThan(target);
    expect(statSync(output).size).toBeGreaterThan(target / 2);
    expect(stream(probed, "video")?.codec_name).toBe("h264");
    expect(stream(probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(probed)).toBeCloseTo(4, 0);
    expect(existsSync(join(dir, "twopass-0.log"))).toBe(true);
  });

  it("compresses in one pass with a resolution cap, without enlarging", () => {
    const { output, probed } = run(compressFormat({ targetBytes: 1_000_000, resolution: 360, twoPass: false }), big);
    expect(statSync(output).size).toBeLessThan(1_000_000);
    expect(stream(probed, "video")?.height).toBe(180);
  });

  it("drops the audio", () => {
    const { probed } = run(MUTE_FORMAT, tagged);
    expect(stream(probed, "audio")).toBeUndefined();
    expect(stream(probed, "video")?.codec_name).toBe("h264");
  });

  it("makes a GIF of a range at the chosen size and rate", () => {
    const { probed } = run(gifFormat({ fps: 10, width: 160 }), tagged, { startSeconds: 0, endSeconds: 1 });
    const video = stream(probed, "video");
    expect(video?.codec_name).toBe("gif");
    expect(video?.width).toBe(160);
    expect(video?.r_frame_rate).toBe("10/1");
    expect(seconds(probed)).toBeCloseTo(1, 0);
  });

  it("cuts fast on a keyframe and precisely on a frame", () => {
    const fast = run(TRIM_FORMATS[0], tagged, { startSeconds: 1, endSeconds: 3 });
    expect(seconds(fast.probed)).toBeCloseTo(2, 0);
    expect(stream(fast.probed, "video")?.codec_name).toBe("h264");

    const precise = run(TRIM_FORMATS[1], tagged, { startSeconds: 1, endSeconds: 3 });
    expect(seconds(precise.probed)).toBeCloseTo(2, 1);
    expect(stream(precise.probed, "audio")?.codec_name).toBe("aac");
  });

  it("strips every tag from a video and from an audio file", () => {
    const before = ffprobe(tagged);
    expect(before.format.tags?.title).toBe("Holiday");
    // MP4 keeps a stream's name in its handler box, which is where ffprobe
    // reads it back from; a stream "title" would not survive the muxer.
    expect(stream(before, "video")?.tags?.handler_name).toBe("Camera");

    const video = run(STRIP_FORMAT, tagged);
    expect(video.probed.format.tags?.title).toBeUndefined();
    expect(stream(video.probed, "video")?.tags?.handler_name ?? "").not.toBe("Camera");
    expect(video.probed.format.tags?.encoder ?? "").not.toMatch(/Lavf/);

    const audio = run(STRIP_FORMAT, music);
    expect(audio.output.endsWith(".mp3")).toBe(true);
    expect(audio.probed.format.tags?.title).toBeUndefined();
  });
});
