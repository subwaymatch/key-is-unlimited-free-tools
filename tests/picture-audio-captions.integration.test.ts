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
import { dirname, join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  channelFormat,
  compressAudioFormat,
  normalizeFormat,
  spectrogramFormat,
  waveformFormat,
} from "@/lib/engine/audio";
import { BURN_FONT_DIR, BURN_FONT_NAME, burnFileFormat, burnTrackFormat } from "@/lib/engine/burn";
import { captionFormat } from "@/lib/engine/captions";
import { chaptersFormat } from "@/lib/engine/chapters";
import { frameFormat, resizeFormat, rotateFormat, sheetFormat } from "@/lib/engine/picture";
import { parseProbeOutput } from "@/lib/engine/probe";
import { trimArgs } from "@/lib/engine/trim";
import type { FormatPlan, OutputFormat, PlanContext, ProbeResult, TrimRange } from "@/lib/engine/types";
import { parseSrt, toAss } from "@/lib/subtitles";

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
  format: { duration: string; format_name?: string; tags?: Record<string, string> };
  chapters?: Array<{ start_time: string; end_time: string; tags?: { title?: string } }>;
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    sample_rate?: string;
    channels?: number;
    pix_fmt?: string;
  }>;
}

function ffprobe(path: string): Probed {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", path], {
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

/**
 * Brightest pixel in the bottom third of the frame at a moment, from
 * signalstats.
 *
 * Limited-range black is 16 and white text is 235, so a glyph anywhere in the
 * band is unmistakable however small it is. It is how a burn is checked
 * without reading the text back.
 */
function bottomLuma(path: string, atSeconds: number): number {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-ss", String(atSeconds), "-i", path, "-frames:v", "1",
      "-vf", "crop=iw:ih/3:0:2*ih/3,signalstats,metadata=print", "-f", "null", "-",
    ],
    { encoding: "utf8" },
  );
  const match = result.stderr.match(/lavfi\.signalstats\.YMAX=(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`signalstats printed no YAVG:\n${result.stderr.slice(-800)}`);
  return Number(match[1]);
}

let counter = 0;

/**
 * Writes a plan's scratch files where this ffmpeg can read them, and points
 * the arguments at them: the engine writes "/fonts/..." into MEMFS, which is
 * not a place on this disk.
 */
function materialize(plan: FormatPlan): string[] {
  const scratchDir = join(dir, "scratch");
  const replacements: [string, string][] = [];
  for (const file of plan.scratchFiles ?? []) {
    const target = join(scratchDir, file.path.replace(/^\//, ""));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents);
    replacements.push([file.path, target]);
  }
  replacements.push([BURN_FONT_DIR, join(scratchDir, BURN_FONT_DIR.replace(/^\//, ""))]);
  // Longest paths first, so "/fonts/x.ttf" is not half-rewritten by "/fonts".
  replacements.sort((a, b) => b[0].length - a[0].length);
  return plan.args.map((arg) => {
    let out = arg;
    for (const [from, to] of replacements) out = out.split(from).join(to);
    return out;
  });
}

/**
 * Assembles and runs the command lines the way FFmpegEngine.runExtract does,
 * analysis passes included, feeding a refining plan what its first pass printed.
 */
function run(
  format: OutputFormat,
  input: string,
  trim: TrimRange | null = null,
  extra: Partial<PlanContext> = {},
): { output: string; probed: Probed } {
  const context: PlanContext = {
    trim,
    fileBytes: statSync(input).size,
    sourceExtension: input.split(".").pop()?.toLowerCase() ?? null,
    inputPath: input,
    ...extra,
  };
  const info = probe(input);
  const blocker = format.blocker?.(info, context) ?? null;
  expect(blocker, `${format.id} was blocked: ${blocker?.message}`).toBeNull();

  const plan = format.plan(info, context);
  const args = materialize(plan);
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
  const finalArgs = plan.refine ? plan.refine.args(kept) : args;
  exec(finalArgs, [output]);

  return { output, probed: ffprobe(output) };
}

const stream = (probed: Probed, type: string) =>
  probed.streams.find((entry) => entry.codec_type === type);

describe.skipIf(!hasFfmpeg)("picture, loudness and subtitle plans against a real ffmpeg", () => {
  let video: string;
  let quiet: string;
  let tagged: string;
  let subbed: string;
  let black: string;
  let srt: string;
  const font = new Uint8Array(readFileSync(join(process.cwd(), "public", "fonts", "DejaVuSans.ttf")));

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
    // Tagged, so the chapter tool's own handling of the strip switch shows.
    tagged = fixture("tagged.mp3", [
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "6", "-c:a", "libmp3lame", "-b:a", "128k", "-metadata", "title=Song",
    ]);
    srt = join(dir, "sample.srt");
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
    // Pure black, so anything drawn on it shows up in the numbers.
    black = fixture("black.mp4", [
      "-f", "lavfi", "-i", "color=c=black:s=320x180:r=25",
      "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
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

  it("burns a subtitle file into the picture with the shipped font", () => {
    const cues = parseSrt(readFileSync(srt, "utf8")).cues;
    const source = { name: "sample.srt", ass: toAss(cues, { fontName: BURN_FONT_NAME, fontSize: 64 }) };
    const { output, probed } = run(burnFileFormat(source, font), black);
    expect(stream(probed, "video")?.codec_name).toBe("h264");
    expect(Number(probed.format.duration)).toBeCloseTo(4, 0);
    // White text on screen at 1 s; at 3.8 s nothing is showing.
    expect(bottomLuma(black, 1)).toBeLessThan(20);
    expect(bottomLuma(output, 1)).toBeGreaterThan(200);
    expect(bottomLuma(output, 3.8)).toBeLessThan(20);
  });

  it("burns one of the file's own tracks straight from the input", () => {
    const { probed } = run(burnTrackFormat(0, font), subbed);
    expect(stream(probed, "video")?.codec_name).toBe("h264");
    expect(stream(probed, "subtitle")).toBeUndefined();
    expect(Number(probed.format.duration)).toBeCloseTo(4, 0);
  });

  it("compresses audio to a preset and to a size", () => {
    const voice = run(compressAudioFormat({ presetId: "voice-tiny", targetBytes: null }), video);
    expect(voice.output.endsWith(".opus")).toBe(true);
    expect(stream(voice.probed, "audio")?.codec_name).toBe("opus");
    expect(stream(voice.probed, "audio")?.channels).toBe(1);

    // 60 KB over six seconds is 76 kbps: AAC, and under the size.
    const sized = run(compressAudioFormat({ presetId: null, targetBytes: 60_000 }), quiet);
    expect(sized.output.endsWith(".m4a")).toBe(true);
    expect(stream(sized.probed, "audio")?.codec_name).toBe("aac");
    expect(statSync(sized.output).size).toBeLessThan(60_000);
  });

  it("takes a recording apart by channel, in its own format", () => {
    const left = run(channelFormat("left"), video);
    expect(left.output.endsWith(".m4a")).toBe(true);
    expect(stream(left.probed, "audio")?.channels).toBe(1);
    const karaoke = run(channelFormat("karaoke"), video);
    expect(stream(karaoke.probed, "audio")?.channels).toBe(2);
    const stereo = run(channelFormat("stereo"), quiet);
    expect(stereo.output.endsWith(".mp3")).toBe(true);
    expect(stream(stereo.probed, "audio")?.channels).toBe(2);
  });

  it("draws a waveform and a spectrogram as PNGs", () => {
    const wave = run(waveformFormat({ width: 800, height: 200, tone: "dark" }), quiet);
    expect(stream(wave.probed, "video")?.codec_name).toBe("png");
    expect(stream(wave.probed, "video")?.width).toBe(800);
    expect(stream(wave.probed, "video")?.height).toBe(200);
    expect(stream(wave.probed, "video")?.pix_fmt).toBe("rgba");
    const spectrum = run(spectrogramFormat({ width: 800, height: 200, tone: "dark" }), quiet);
    expect(stream(spectrum.probed, "video")?.codec_name).toBe("png");
    expect(stream(spectrum.probed, "video")?.width).toBeGreaterThanOrEqual(800);
  });

  it("writes a chapter list into an MP4 and an MP3, keeping or stripping the tags as asked", () => {
    const titles = (probed: Probed) => probed.chapters?.map((chapter) => chapter.tags?.title);
    const mp4 = run(chaptersFormat("0:00 Intro\n1.5 Middle\n0:03 End\n0:10 Past the end"), video);
    expect(mp4.output.endsWith(".mp4")).toBe(true);
    expect(stream(mp4.probed, "video")?.codec_name).toBe("h264");
    expect(stream(mp4.probed, "audio")?.codec_name).toBe("aac");
    expect(titles(mp4.probed)).toEqual(["Intro", "Middle", "End"]);
    expect(mp4.probed.chapters?.map((chapter) => Number(chapter.start_time))).toEqual([0, 1.5, 3]);
    expect(Number(mp4.probed.chapters?.[2].end_time)).toBeCloseTo(4, 1);

    const kept = run(chaptersFormat("0 One\n2 Two"), tagged);
    expect(kept.output.endsWith(".mp3")).toBe(true);
    expect(stream(kept.probed, "audio")?.codec_name).toBe("mp3");
    expect(titles(kept.probed)).toEqual(["One", "Two"]);
    expect(kept.probed.format.tags?.title).toBe("Song");

    // The plan strips the tags itself: the engine's own stripping would take the chapters too.
    const stripped = run(chaptersFormat("0 One\n2 Two"), tagged, null, { stripMetadata: true });
    expect(titles(stripped.probed)).toEqual(["One", "Two"]);
    expect(stripped.probed.format.tags?.title).toBeUndefined();
  });
});
