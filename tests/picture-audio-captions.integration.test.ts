/**
 * Runs the resize, rotate, still-frame, loudness and subtitle plans through
 * a real ffmpeg, like plans.integration.test.ts does for the first batch.
 *
 * The loudness check is the one that matters most: the two passes are only
 * worth their cost if the second lands on the number, and that can only be
 * measured, so the output is run through ebur128 and read back.
 *
 * Skipped when ffmpeg is not installed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { normalizeFormat } from "@/lib/engine/audio";
import { captionFormat } from "@/lib/engine/captions";
import { frameFormat, resizeFormat, rotateFormat, sheetFormat } from "@/lib/engine/picture";
import { parseProbeOutput } from "@/lib/engine/probe";
import { trimArgs } from "@/lib/engine/trim";
import type { OutputFormat, PlanContext, ProbeResult, TrimRange } from "@/lib/engine/types";

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

const dir = join(tmpdir(), "key-is-more-plans");

function fixture(name: string, args: string[]): string {
  const path = join(dir, name);
  if (!existsSync(path)) execFileSync("ffmpeg", ["-y", "-v", "error", ...args, path]);
  return path;
}

function probe(path: string): ProbeResult {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path], { encoding: "utf8" });
  return parseProbeOutput(result.stderr.split("\n"));
}

interface Probed {
  format: { duration: string; format_name?: string };
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    sample_rate?: string;
  }>;
}

function ffprobe(path: string): Probed {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], {
      encoding: "utf8",
    }),
  );
}

/** Integrated loudness of a file, in LUFS, as ebur128 measures it. */
function integratedLoudness(path: string): number {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const match = result.stderr.match(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)?.pop()?.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`ebur128 printed no integrated loudness:\n${result.stderr.slice(-800)}`);
  return Number(match[1]);
}

let counter = 0;

/**
 * Assembles and runs the command lines the way FFmpegEngine.runExtract does,
 * analysis passes included, feeding a refining plan what its first pass printed.
 */
function run(
  format: OutputFormat,
  input: string,
  trim: TrimRange | null = null,
): { output: string; probed: Probed } {
  const context: PlanContext = {
    trim,
    fileBytes: statSync(input).size,
    sourceExtension: input.split(".").pop()?.toLowerCase() ?? null,
  };
  const info = probe(input);
  const blocker = format.blocker?.(info, context) ?? null;
  expect(blocker, `${format.id} was blocked: ${blocker?.message}`).toBeNull();

  const plan = format.plan(info, context);
  const output = join(dir, `out-${(counter += 1)}-${format.id}.${plan.extension}`);
  const { input: seek, output: length } = trimArgs(trim);
  const kept: string[] = [];

  const exec = (passArgs: string[], target: string[]) => {
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        ...seek,
        ...(plan.limitInput ? length : []),
        ...(plan.inputArgs ?? []),
        "-i",
        input,
        ...passArgs,
        ...(plan.limitInput ? [] : length),
        ...target,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, `${format.id}: ${result.stderr.slice(-1500)}`).toBe(0);
    return result.stderr.split("\n");
  };

  for (const passArgs of plan.analysisPasses ?? []) {
    const lines = exec(passArgs, ["-f", "null", "-"]);
    if (plan.refine) kept.push(...lines.filter(plan.refine.keep));
  }
  const finalArgs = plan.refine ? plan.refine.args(kept) : plan.args;
  exec(finalArgs, [output]);

  return { output, probed: ffprobe(output) };
}

const stream = (probed: Probed, type: string) =>
  probed.streams.find((entry) => entry.codec_type === type);

describe.skipIf(!hasFfmpeg)("picture, loudness and subtitle plans against a real ffmpeg", () => {
  let video: string;
  let quiet: string;
  let subbed: string;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    video = fixture("clip.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ]);
    // A quiet tone, so the normaliser has real work to do.
    quiet = fixture("quiet.mp3", [
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "6", "-af", "volume=-24dB", "-c:a", "libmp3lame", "-b:a", "128k",
    ]);
    const srt = join(dir, "sample.srt");
    writeFileSync(
      srt,
      "1\n00:00:00,500 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,200 --> 00:00:03,500\n<i>Second</i> cue\n",
    );
    subbed = fixture("subbed.mkv", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-i", srt,
      "-t", "4", "-map", "0:v", "-map", "1:s",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:s", "srt", "-metadata:s:s:0", "language=eng",
    ]);
  });

  it("resizes to a height, and crops to a shape, without enlarging", () => {
    const small = run(resizeFormat({ target: 240, aspect: "keep" }), video);
    expect(stream(small.probed, "video")?.height).toBe(240);
    expect(stream(small.probed, "video")?.width).toBe(426);
    expect(stream(small.probed, "audio")?.codec_name).toBe("aac");

    const vertical = run(resizeFormat({ target: 720, aspect: "9:16" }), video);
    expect(stream(vertical.probed, "video")?.width).toBe(202);
    expect(stream(vertical.probed, "video")?.height).toBe(360);

    const half = run(resizeFormat({ target: "half", aspect: "keep" }), video);
    expect(stream(half.probed, "video")?.width).toBe(320);
    expect(stream(half.probed, "video")?.height).toBe(180);
  });

  it("rotates and flips", () => {
    const turned = run(rotateFormat("cw"), video);
    expect(stream(turned.probed, "video")?.width).toBe(360);
    expect(stream(turned.probed, "video")?.height).toBe(640);
    const upside = run(rotateFormat("180"), video);
    expect(stream(upside.probed, "video")?.width).toBe(640);
    expect(Number(upside.probed.format.duration)).toBeCloseTo(4, 0);
  });

  it("writes one frame as JPEG and PNG, at the start marker", () => {
    const jpg = run(frameFormat("jpg"), video, { startSeconds: 2, endSeconds: null });
    expect(stream(jpg.probed, "video")?.codec_name).toBe("mjpeg");
    expect(stream(jpg.probed, "video")?.width).toBe(640);
    const png = run(frameFormat("png"), video);
    expect(stream(png.probed, "video")?.codec_name).toBe("png");
    expect(stream(png.probed, "video")?.height).toBe(360);
  });

  it("tiles a contact sheet of the right size", () => {
    const { probed } = run(sheetFormat({ frames: 9, width: 160 }), video);
    // 3x3 tiles of 160x90, 4 px between and around them.
    expect(stream(probed, "video")?.width).toBe(496);
    expect(stream(probed, "video")?.height).toBe(286);
    expect(stream(probed, "video")?.codec_name).toBe("mjpeg");
  });

  it("brings a quiet file to the target loudness in two passes, in its own format", () => {
    expect(integratedLoudness(quiet)).toBeLessThan(-30);
    const { output, probed } = run(normalizeFormat({ lufs: -16, truePeak: -1 }), quiet);
    expect(output.endsWith(".mp3")).toBe(true);
    expect(stream(probed, "audio")?.codec_name).toBe("mp3");
    expect(stream(probed, "audio")?.sample_rate).toBe("44100");
    expect(integratedLoudness(output)).toBeCloseTo(-16, 0);
  });

  it("normalises a video's soundtrack while copying its picture", () => {
    const { probed, output } = run(normalizeFormat({ lufs: -14, truePeak: -1 }), video);
    expect(stream(probed, "video")?.codec_name).toBe("h264");
    expect(stream(probed, "audio")?.codec_name).toBe("aac");
    expect(Math.abs(integratedLoudness(output) + 14)).toBeLessThan(1.5);
  });

  it("extracts a subtitle track as SRT and as WebVTT", () => {
    const info = probe(subbed);
    expect(info.subtitleStreams).toEqual([{ codec: "subrip", language: "eng", title: null }]);

    const srt = run(captionFormat(0, "srt"), subbed);
    expect(srt.output.endsWith(".srt")).toBe(true);
    const srtText = readFileSync(srt.output, "utf8");
    expect(srtText).toContain("00:00:00,500 --> 00:00:02,000");
    expect(srtText).toContain("Hello there.");

    const vtt = run(captionFormat(0, "vtt"), subbed);
    const vttText = readFileSync(vtt.output, "utf8");
    expect(vttText.startsWith("WEBVTT")).toBe(true);
    expect(vttText).toContain("<i>Second</i> cue");
  });
});
