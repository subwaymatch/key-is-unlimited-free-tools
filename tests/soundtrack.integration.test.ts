/**
 * Runs the soundtrack, level, loop, subtitle-track, tag, equal-parts and
 * audio-to-video plans through a real ffmpeg, like the other integration
 * files do for the earlier tools.
 *
 * The checks that matter are the ones a unit test cannot make: that
 * `-itsoffset` on a second read of the file really moves the sound, that a
 * looped copy really is three times as long, that a cover really lands as an
 * attached picture, that a peak lift really stops just under full scale.
 *
 * Skipped when ffmpeg is not installed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { gifVideoFormat } from "@/lib/engine/animated";
import { TRIM_AUDIO_FORMATS } from "@/lib/engine/cut";
import { STRIP_METADATA_ARGS } from "@/lib/engine/ffmpegEngine";
import { fadeFormat, PEAK_TARGET_DB, volumeFormat } from "@/lib/engine/level";
import { loopFormat } from "@/lib/engine/loop";
import { pieceFormat } from "@/lib/engine/pieces";
import { parseProbeOutput } from "@/lib/engine/probe";
import { subtitleTrackFormat } from "@/lib/engine/softsubs";
import { addAudioFormat, syncFormat } from "@/lib/engine/soundtrack";
import { EMPTY_TAGS, tagsFormat } from "@/lib/engine/tags";
import { audioSpeedFormat } from "@/lib/engine/tempo";
import { trimArgs } from "@/lib/engine/trim";
import type { FormatPlan, OutputFormat, PlanContext, ProbeResult, TrimRange } from "@/lib/engine/types";
import { audioVideoFormat } from "@/lib/engine/visualize";
import { parseSrt } from "@/lib/subtitles";

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

const dir = join(tmpdir(), "key-is-soundtrack-plans");

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
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    start_time?: string;
    duration?: string;
    disposition?: Record<string, number>;
    tags?: Record<string, string>;
  }>;
}

function ffprobe(path: string): Probed {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], { encoding: "utf8" }),
  );
}

/** The loudest sample of a stretch of a file, in dBFS, as volumedetect measures it. */
function peakDb(path: string, from = 0, length: number | null = null): number {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-ss", String(from), ...(length === null ? [] : ["-t", String(length)]), "-i", path, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const match = result.stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  if (!match) throw new Error(`volumedetect printed no max_volume:\n${result.stderr.slice(-800)}`);
  return Number(match[1]);
}

let counter = 0;

/** Writes a plan's scratch files where this ffmpeg can read them, and points the arguments at them. */
function materialize(plan: FormatPlan): string[] {
  const scratchDir = join(dir, "scratch");
  const replacements: [string, string][] = [];
  for (const file of plan.scratchFiles ?? []) {
    const target = join(scratchDir, file.path.replace(/^\//, ""));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents);
    replacements.push([file.path, target]);
  }
  replacements.sort((a, b) => b[0].length - a[0].length);
  return plan.args.map((arg) => {
    let out = arg;
    for (const [from, to] of replacements) out = out.split(from).join(to);
    return out;
  });
}

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
  const output = join(dir, `out-${(counter += 1)}-${format.id.replace(/[^a-z0-9-]/gi, "_")}.${plan.extension}`);
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
  const strip = extra.stripMetadata && !plan.stripsMetadata ? STRIP_METADATA_ARGS : [];
  exec([...finalArgs, ...strip], [output]);

  return { output, probed: ffprobe(output) };
}

const stream = (probed: Probed, type: string) => probed.streams.find((entry) => entry.codec_type === type);
const seconds = (probed: Probed) => Number(probed.format.duration);

describe.skipIf(!hasFfmpeg)("soundtrack, level, loop, track, tag, parts and visualiser plans against a real ffmpeg", () => {
  let video: string;
  let silentVideo: string;
  let quiet: string;
  let song: string;
  let flac: string;
  let gif: string;
  let png: string;
  let srtPath: string;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    video = fixture("clip.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-g", "25", "-keyint_min", "25",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    ]);
    silentVideo = fixture("silent.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ]);
    // A quiet tone, so a lift has room to go.
    quiet = fixture("quiet.mp3", [
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "6", "-af", "volume=-20dB", "-c:a", "libmp3lame", "-b:a", "128k",
    ]);
    // Three seconds of a different tone, shorter than the video, tagged.
    song = fixture("song.mp3", [
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100",
      "-t", "3", "-c:a", "libmp3lame", "-b:a", "128k",
      "-metadata", "title=Old title", "-metadata", "comment=keep me",
    ]);
    flac = fixture("tone.flac", ["-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000", "-t", "3", "-c:a", "flac"]);
    // An animated GIF at 10 fps with an odd edge, 2.4 s long.
    gif = fixture("anim.gif", ["-f", "lavfi", "-i", "testsrc2=size=161x91:rate=10", "-t", "2.4", "-f", "gif"]);
    png = fixture("backdrop.png", ["-f", "lavfi", "-i", "color=c=red:s=400x300", "-frames:v", "1"]);
    srtPath = join(dir, "sample.srt");
    writeFileSync(srtPath, "1\n00:00:00,500 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,200 --> 00:00:03,500\n<i>Second</i> cue\n");
  });

  it("replaces a video's sound with a shorter file, padded to the picture", () => {
    const music = { name: "song.mp3", bytes: new Uint8Array(readFileSync(song)), key: "song" };
    const { probed } = run(addAudioFormat(music, { mode: "replace", length: "fit", mixLevelDb: 0 }), video);
    expect(stream(probed, "video")?.codec_name).toBe("h264");
    expect(stream(probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(probed)).toBeCloseTo(6, 0);
    // The picture is copied, so the frames are the source's own.
    expect(stream(probed, "video")?.width).toBe(320);
  });

  it("loops a short track under the picture, and mixes one under the original", () => {
    const music = { name: "song.mp3", bytes: new Uint8Array(readFileSync(song)), key: "song" };
    // Padded to fit, the three-second track leaves the second half silent...
    const padded = run(addAudioFormat(music, { mode: "replace", length: "fit", mixLevelDb: 0 }), video);
    expect(peakDb(padded.output, 4, 1.5)).toBeLessThan(-60);
    // ...and looped, the second half carries the tone at the level of the first.
    const looped = run(addAudioFormat(music, { mode: "replace", length: "loop", mixLevelDb: 0 }), video);
    expect(seconds(looped.probed)).toBeCloseTo(6, 0);
    expect(peakDb(looped.output, 4, 1.5)).toBeGreaterThan(peakDb(looped.output, 0.5, 1.5) - 3);

    const mixed = run(addAudioFormat(music, { mode: "mix", length: "fit", mixLevelDb: -6 }), video);
    expect(seconds(mixed.probed)).toBeCloseTo(6, 0);
    expect(stream(mixed.probed, "audio")?.codec_name).toBe("aac");

    // A silent video gets the track outright.
    const silent = run(addAudioFormat(music, { mode: "mix", length: "fit", mixLevelDb: -6 }), silentVideo);
    expect(stream(silent.probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(silent.probed)).toBeCloseTo(4, 0);
  });

  it("moves the sound later and earlier by reading the file twice, every stream copied", () => {
    const later = run(syncFormat(250), video, null, { sourceExtension: "mkv" });
    const laterVideo = stream(later.probed, "video");
    const laterAudio = stream(later.probed, "audio");
    expect(laterVideo?.codec_name).toBe("h264");
    expect(laterAudio?.codec_name).toBe("aac");
    expect(Number(laterAudio?.start_time) - Number(laterVideo?.start_time)).toBeCloseTo(0.25, 1);

    const earlier = run(syncFormat(-1500), video, null, { sourceExtension: "mkv" });
    expect(Number(stream(earlier.probed, "video")?.start_time) - Number(stream(earlier.probed, "audio")?.start_time)).toBeCloseTo(1.5, 1);

    // The MP4 muxer takes the offset too, through an edit list.
    const mp4 = run(syncFormat(250), video);
    expect(mp4.probed.format.format_name).toContain("mp4");
    expect(Number(stream(mp4.probed, "audio")?.start_time) - Number(stream(mp4.probed, "video")?.start_time)).toBeCloseTo(0.25, 1);
  });

  it("turns a file up by a number of decibels, and up to just under full scale", () => {
    const before = peakDb(quiet);
    const louder = run(volumeFormat({ kind: "db", db: 6 }), quiet);
    expect(stream(louder.probed, "audio")?.codec_name).toBe("mp3");
    expect(peakDb(louder.output)).toBeCloseTo(before + 6, 0);

    const loud = run(volumeFormat({ kind: "peak" }), quiet);
    expect(peakDb(loud.output)).toBeCloseTo(PEAK_TARGET_DB, 0);

    // A video keeps its picture and gets its sound re-encoded.
    const videoLouder = run(volumeFormat({ kind: "db", db: -6 }), video);
    expect(stream(videoLouder.probed, "video")?.codec_name).toBe("h264");
    expect(stream(videoLouder.probed, "audio")?.codec_name).toBe("aac");
  });

  it("fades the sound in and out, and a video's picture with it", () => {
    const faded = run(fadeFormat({ inSeconds: 1, outSeconds: 2, picture: false }), quiet);
    expect(seconds(faded.probed)).toBeCloseTo(6, 0);
    // The start and the end are quieter than the middle.
    const middle = peakDb(faded.output, 2.5, 1);
    expect(peakDb(faded.output, 0, 0.2)).toBeLessThan(middle - 6);
    expect(peakDb(faded.output, 5.6, 0.4)).toBeLessThan(middle - 6);

    const pictured = run(fadeFormat({ inSeconds: 1, outSeconds: 1, picture: true }), video);
    expect(stream(pictured.probed, "video")?.codec_name).toBe("h264");
    expect(stream(pictured.probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(pictured.probed)).toBeCloseTo(6, 0);
  });

  it("re-times the sound alone at twice the speed", () => {
    const { probed } = run(audioSpeedFormat(2), quiet);
    expect(stream(probed, "audio")?.codec_name).toBe("mp3");
    expect(seconds(probed)).toBeCloseTo(3, 0);
  });

  it("loops a video three times over and an audio file out to a minute, by stream copy", () => {
    const thrice = run(loopFormat({ kind: "times", times: 3 }), video);
    expect(stream(thrice.probed, "video")?.codec_name).toBe("h264");
    expect(seconds(thrice.probed)).toBeCloseTo(18, 0);

    const minute = run(loopFormat({ kind: "seconds", seconds: 60 }), song);
    expect(stream(minute.probed, "audio")?.codec_name).toBe("mp3");
    // A copy is cut on a frame, so the minute runs a fraction over.
    expect(Math.abs(seconds(minute.probed) - 60)).toBeLessThan(1);
  });

  it("turns a GIF into an MP4 with even edges at a steady rate, and into a WebM played twice", () => {
    const mp4 = run(gifVideoFormat({ target: "mp4", plays: 1 }), gif);
    const picture = stream(mp4.probed, "video");
    expect(picture?.codec_name).toBe("h264");
    expect(picture?.width).toBe(160);
    expect(picture?.height).toBe(90);
    expect(picture?.r_frame_rate).toBe("30/1");
    expect(seconds(mp4.probed)).toBeCloseTo(2.4, 0);

    const webm = run(gifVideoFormat({ target: "webm", plays: 2 }), gif);
    expect(stream(webm.probed, "video")?.codec_name).toBe("vp8");
    expect(seconds(webm.probed)).toBeCloseTo(4.8, 0);
  });

  it("adds a subtitle file as a track into an MP4, an MKV and a WebM", () => {
    const source = { name: "sample.srt", cues: parseSrt(readFileSync(srtPath, "utf8")).cues, ass: null };
    const mp4 = run(subtitleTrackFormat(source, { language: "eng", title: "English", makeDefault: true }), video);
    const track = stream(mp4.probed, "subtitle");
    expect(track?.codec_name).toBe("mov_text");
    expect(track?.tags?.language).toBe("eng");
    expect(track?.tags?.handler_name).toBe("English");
    expect(track?.disposition?.default).toBe(1);
    expect(stream(mp4.probed, "video")?.codec_name).toBe("h264");

    const mkv = run(subtitleTrackFormat(source, { language: "spa", title: "", makeDefault: false }), video, null, { sourceExtension: "mkv" });
    expect(stream(mkv.probed, "subtitle")?.codec_name).toBe("subrip");
    expect(stream(mkv.probed, "subtitle")?.tags?.language).toBe("spa");
    expect(stream(mkv.probed, "subtitle")?.tags?.title).toBeUndefined();
    expect(stream(mkv.probed, "subtitle")?.disposition?.default).toBe(0);

    const vp8 = fixture("clip.webm", ["-i", video, "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libopus", "-b:a", "64k"]);
    const webm = run(subtitleTrackFormat(source, { language: "eng", title: "", makeDefault: true }), vp8);
    expect(stream(webm.probed, "subtitle")?.codec_name).toBe("webvtt");
  });

  it("writes tags over an MP3's own, clears them first when asked, and puts a cover into an MP3 and a FLAC", () => {
    const tags = { ...EMPTY_TAGS, title: "New title", artist: "Someone", track: "3/12" };
    const kept = run(tagsFormat(tags, null), song);
    expect(kept.probed.format.tags?.title).toBe("New title");
    expect(kept.probed.format.tags?.artist).toBe("Someone");
    expect(kept.probed.format.tags?.track).toBe("3/12");
    expect(kept.probed.format.tags?.comment).toBe("keep me");

    const cleared = run(tagsFormat(tags, null), song, null, { stripMetadata: true });
    expect(cleared.probed.format.tags?.title).toBe("New title");
    expect(cleared.probed.format.tags?.comment).toBeUndefined();

    const cover = { name: "backdrop.png", bytes: new Uint8Array(readFileSync(png)), mimeType: "image/png", key: "png" };
    const withCover = run(tagsFormat(tags, cover), song);
    const picture = stream(withCover.probed, "video");
    expect(picture?.codec_name).toBe("png");
    expect(picture?.disposition?.attached_pic).toBe(1);
    expect(stream(withCover.probed, "audio")?.codec_name).toBe("mp3");

    const flacCover = run(tagsFormat({ ...EMPTY_TAGS, album: "Tones" }, cover), flac);
    expect(stream(flacCover.probed, "video")?.disposition?.attached_pic).toBe(1);
    expect(flacCover.probed.format.tags?.ALBUM ?? flacCover.probed.format.tags?.album).toBe("Tones");
  });

  it("cuts a file into three equal parts by stream copy", () => {
    const rule = { kind: "count" as const, count: 3 };
    for (const index of [0, 1, 2]) {
      const { probed } = run(pieceFormat(index, rule), video);
      expect(stream(probed, "video")?.codec_name).toBe("h264");
      expect(seconds(probed)).toBeCloseTo(2, 0);
    }
    const middle = run(pieceFormat(1, rule), quiet);
    expect(stream(middle.probed, "audio")?.codec_name).toBe("mp3");
    expect(seconds(middle.probed)).toBeCloseTo(2, 0);
  });

  it("puts an MP3 under a colour, an image and a waveform as an MP4", () => {
    const colour = run(audioVideoFormat({ backdrop: "colour", colour: "navy", size: "720p" }, null), quiet);
    const still = stream(colour.probed, "video");
    expect(still?.codec_name).toBe("h264");
    expect(still?.width).toBe(1280);
    expect(still?.height).toBe(720);
    expect(still?.r_frame_rate).toBe("5/1");
    expect(stream(colour.probed, "audio")?.codec_name).toBe("mp3");
    expect(seconds(colour.probed)).toBeCloseTo(6, 0);

    const image = { name: "backdrop.png", bytes: new Uint8Array(readFileSync(png)), mimeType: "image/png", key: "png" };
    const pictured = run(audioVideoFormat({ backdrop: "image", colour: "black", size: "square" }, image), flac);
    expect(stream(pictured.probed, "video")?.width).toBe(1080);
    expect(stream(pictured.probed, "video")?.height).toBe(1080);
    expect(stream(pictured.probed, "audio")?.codec_name).toBe("aac");
    expect(seconds(pictured.probed)).toBeCloseTo(3, 0);

    const waves = run(audioVideoFormat({ backdrop: "waveform", colour: "black", size: "720p" }, null), quiet, { startSeconds: 1, endSeconds: 3 });
    expect(stream(waves.probed, "video")?.r_frame_rate).toBe("25/1");
    expect(seconds(waves.probed)).toBeCloseTo(2, 0);
  });

  it("cuts a range out of an MP3 in its own format without re-encoding", () => {
    const { probed } = run(TRIM_AUDIO_FORMATS[0], quiet, { startSeconds: 1, endSeconds: 3 });
    expect(stream(probed, "audio")?.codec_name).toBe("mp3");
    expect(seconds(probed)).toBeCloseTo(2, 0);
  });
});
