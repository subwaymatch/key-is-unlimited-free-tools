/**
 * Runs the merge plans and the speed plan through a real ffmpeg.
 *
 * Like plans.integration.test.ts: the unit tests pin the argument strings,
 * this checks that ffmpeg accepts them and writes what the plan claims. The
 * concat demuxer's list file, the concat filter graph and the atempo chain
 * are exactly the kind of thing that parses in a test and fails in a run.
 *
 * Skipped when ffmpeg is not installed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { mergeBlocker, mergePlan, type MergeClip } from "@/lib/engine/merge";
import { parseProbeOutput } from "@/lib/engine/probe";
import { trimArgs } from "@/lib/engine/trim";
import type { MergePlan, TrimRange } from "@/lib/engine/types";
import { speedFormat } from "@/lib/engine/video";

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

const dir = join(tmpdir(), "key-is-merge-plans");

function fixture(name: string, args: string[]): string {
  const path = join(dir, name);
  if (!existsSync(path)) execFileSync("ffmpeg", ["-y", "-v", "error", ...args, path]);
  return path;
}

function probe(path: string) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path], { encoding: "utf8" });
  return parseProbeOutput(result.stderr.split("\n"));
}

interface Probed {
  format: { duration: string };
  streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string }>;
}

function ffprobe(path: string): Probed {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], {
      encoding: "utf8",
    }),
  );
}

const seconds = (probed: Probed) => Number(probed.format.duration);
const stream = (probed: Probed, type: string) =>
  probed.streams.find((entry) => entry.codec_type === type);

function clipFor(path: string): MergeClip {
  return {
    fileName: path.split("/").pop()!,
    fileBytes: statSync(path).size,
    probe: probe(path),
    // The plan names inputs by the path the engine mounted; here that is the
    // real path, which is all the concat list needs.
    inputPath: path,
  };
}

let counter = 0;

/** Runs a merge plan the way FFmpegEngine.runMerge does. */
function runMerge(plan: MergePlan): { output: string; probed: Probed } {
  for (const file of plan.scratchFiles ?? []) {
    // The engine writes the list at "/merge.txt" in MEMFS; on disk it goes in
    // the temp dir, so the argument that names it is rewritten to match.
    writeFileSync(join(dir, "merge.txt"), file.contents);
  }
  const inputArgs = plan.inputArgs.map((arg) => (arg === "/merge.txt" ? join(dir, "merge.txt") : arg));
  const output = join(dir, `merged-${(counter += 1)}.${plan.extension}`);
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-v", "error", ...inputArgs, ...plan.args, output],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return { output, probed: ffprobe(output) };
}

describe.skipIf(!hasFfmpeg)("merging and re-timing against a real ffmpeg", () => {
  let a: string;
  let b: string;
  let small: string;
  let silent: string;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    const matching = (name: string, tone: number) => [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-f", "lavfi", "-i", `sine=frequency=${tone}:sample_rate=48000`,
      "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-profile:v", "high", "-g", "25",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ];
    a = fixture("a.mp4", matching("a", 440));
    b = fixture("b.mp4", matching("b", 660));
    small = fixture("small.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100",
      "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-ac", "1",
    ]);
    silent = fixture("silent.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ]);
  });

  it("copies matching clips through the concat demuxer", () => {
    const clips = [clipFor(a), clipFor(b)];
    expect(mergeBlocker(clips)).toBeNull();
    const plan = mergePlan(clips);
    expect(plan.mode).toBe("copy");
    const { probed } = runMerge(plan);
    expect(stream(probed, "video")?.codec_name).toBe("h264");
    expect(stream(probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(probed)).toBeCloseTo(4, 0);
  });

  it("re-encodes mismatched clips onto the first clip's frame, padding silence", () => {
    const clips = [clipFor(a), clipFor(small), clipFor(silent)];
    expect(mergeBlocker(clips)).toBeNull();
    const plan = mergePlan(clips);
    expect(plan.mode).toBe("encode");
    const { probed } = runMerge(plan);
    const video = stream(probed, "video");
    expect(video?.codec_name).toBe("h264");
    expect(video?.width).toBe(320);
    expect(video?.height).toBe(180);
    expect(video?.r_frame_rate).toBe("25/1");
    expect(stream(probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(probed)).toBeCloseTo(4, 0);
  });

  it("re-encodes on request, and joins silent clips without audio", () => {
    const forced = mergePlan([clipFor(a), clipFor(b)], { mode: "encode" });
    expect(forced.mode).toBe("encode");
    expect(seconds(runMerge(forced).probed)).toBeCloseTo(4, 0);

    const muted = mergePlan([clipFor(silent), clipFor(silent)]);
    expect(muted.mode).toBe("copy");
    const { probed } = runMerge(muted);
    expect(stream(probed, "audio")).toBeUndefined();
    expect(seconds(probed)).toBeCloseTo(2, 0);
  });

  /** Runs a single-input plan the way FFmpegEngine.runExtract does, with limitInput. */
  function runSpeed(factor: number, keepAudio: boolean, trim: TrimRange | null = null) {
    const format = speedFormat({ factor, keepAudio });
    const info = probe(a);
    const context = { trim, fileBytes: statSync(a).size, sourceExtension: "mp4" };
    expect(format.blocker?.(info, context)).toBeNull();
    const plan = format.plan(info, context);
    const { input: seek, output: length } = trimArgs(trim);
    const output = join(dir, `speed-${(counter += 1)}.${plan.extension}`);
    const result = spawnSync(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-v", "error",
        ...seek,
        ...(plan.limitInput ? length : []),
        "-i", a,
        ...plan.args,
        ...(plan.limitInput ? [] : length),
        output,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return ffprobe(output);
  }

  it("halves the length at 2x and doubles it at 0.5x, keeping the frame rate", () => {
    const fast = runSpeed(2, true);
    expect(seconds(fast)).toBeCloseTo(1, 0);
    expect(stream(fast, "video")?.r_frame_rate).toBe("25/1");
    expect(stream(fast, "audio")?.codec_name).toBe("aac");

    const slow = runSpeed(0.5, true);
    expect(seconds(slow)).toBeCloseTo(4, 0);
    expect(stream(slow, "video")?.r_frame_rate).toBe("25/1");
  });

  it("chains atempo past the filter's single-step range", () => {
    expect(seconds(runSpeed(4, true))).toBeCloseTo(0.5, 1);
    expect(seconds(runSpeed(0.25, false))).toBeCloseTo(8, 0);
  });

  it("re-times a range without cutting a slow-down short", () => {
    // 0.5x of a one-second range is two seconds of output: an output-side -t
    // would have stopped it at one.
    const probed = runSpeed(0.5, true, { startSeconds: 0.5, endSeconds: 1.5 });
    expect(seconds(probed)).toBeCloseTo(2, 0);
    expect(stream(probed, "audio")).toBeDefined();
  });
});
