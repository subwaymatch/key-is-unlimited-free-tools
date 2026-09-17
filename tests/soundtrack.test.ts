import { describe, expect, it } from "vitest";

import {
  addAudioFormat,
  addedAudioPath,
  describeSync,
  MAX_ADDED_AUDIO_BYTES,
  parseSyncMs,
  soundtrackTarget,
  syncFormat,
  type AddedAudio,
} from "@/lib/engine/soundtrack";
import { MKV, MP4, MOV, WEBM } from "@/lib/engine/video";

import { AAC, context, H264, joined, probe } from "./fixtures";

const music: AddedAudio = { name: "Song.MP3", bytes: new Uint8Array([1, 2, 3]), key: "song-3-1" };

describe("soundtrackTarget", () => {
  it("keeps the source container when it holds the picture and AAC, and falls back sensibly", () => {
    expect(soundtrackTarget(probe(), context()).container).toBe(MP4);
    expect(soundtrackTarget(probe(), context({ sourceExtension: "mov" })).container).toBe(MOV);
    expect(soundtrackTarget(probe(), context({ sourceExtension: "mkv" })).container).toBe(MKV);
    // A WebM stays a WebM, with Opus, since AAC cannot go in one.
    const vp9 = soundtrackTarget(probe({ video: { ...H264, codec: "vp9" } }), context({ sourceExtension: "webm" }));
    expect(vp9.container).toBe(WEBM);
    expect(joined(vp9.audioArgs)).toBe("-c:a opus -strict -2 -b:a 128k");
    // A ProRes MOV holds AAC as it is.
    expect(soundtrackTarget(probe({ video: { ...H264, codec: "prores" } }), context({ sourceExtension: "mov" })).container).toBe(MOV);
    // Anything odd lands in Matroska.
    expect(soundtrackTarget(probe({ video: { ...H264, codec: "ffv1" } }), context({ sourceExtension: "avi" })).container).toBe(MKV);
  });
});

describe("adding audio", () => {
  it("names the scratch copy after the file's own extension", () => {
    expect(addedAudioPath("Song.MP3")).toBe("/added/audio.mp3");
    expect(addedAudioPath("noext")).toBe("/added/audio");
    expect(addedAudioPath("odd.w a v")).toBe("/added/audio.wav");
  });

  it("replaces the sound, padding the new track to the picture and cutting it there", () => {
    const format = addAudioFormat(music, { mode: "replace", length: "fit", mixLevelDb: -6 });
    expect(format.id).toBe("add-audio-song-3-1-replace-fit");
    const plan = format.plan(probe(), context());
    expect(joined(plan.args)).toBe(
      "-i /added/audio.mp3 -map 0:v:0 -map 1:a:0 -af apad -sn -dn -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart",
    );
    expect(plan.scratchFiles).toEqual([{ path: "/added/audio.mp3", contents: music.bytes }]);
    expect(plan.extension).toBe("mp4");
    expect(plan.mode).toBe("encode");
    expect(plan.kind).toBe("video");
    expect(plan.fileSuffix).toBe("-new-audio");
  });

  it("loops a short track instead of padding it when asked", () => {
    const plan = addAudioFormat(music, { mode: "replace", length: "loop", mixLevelDb: 0 }).plan(probe(), context());
    expect(joined(plan.args)).toContain("-stream_loop -1 -i /added/audio.mp3 -map 0:v:0 -map 1:a:0 -sn");
    expect(joined(plan.args)).not.toContain("apad");
  });

  it("mixes the new track under the original at the chosen level", () => {
    const format = addAudioFormat(music, { mode: "mix", length: "fit", mixLevelDb: -12 });
    expect(format.id).toBe("add-audio-song-3-1-mix-fit-12db");
    const plan = format.plan(probe(), context());
    expect(joined(plan.args)).toBe(
      "-i /added/audio.mp3 -filter_complex [1:a:0]volume=-12dB,apad[added];[0:a:0][added]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a] " +
        "-map 0:v:0 -map [a] -sn -dn -c:v copy -c:a aac -b:a 192k -movflags +faststart",
    );
    expect(plan.fileSuffix).toBe("-mixed");
    expect(plan.warning).toBeUndefined();
  });

  it("falls back to replacing when there is nothing to mix with, and says so", () => {
    const plan = addAudioFormat(music, { mode: "mix", length: "fit", mixLevelDb: -6 }).plan(probe({ audio: null }), context());
    expect(joined(plan.args)).toContain("-map 0:v:0 -map 1:a:0 -af apad");
    expect(plan.warning).toMatch(/no sound of its own/);
  });

  it("refuses an audio file, an oversized track, and an output past the ceiling", () => {
    const format = addAudioFormat(music, { mode: "replace", length: "fit", mixLevelDb: 0 });
    expect(format.blocker?.(probe({ video: null }), context())?.message).toBe("This file has no picture.");
    const huge = addAudioFormat({ ...music, bytes: new Uint8Array(MAX_ADDED_AUDIO_BYTES + 1) }, { mode: "replace", length: "fit", mixLevelDb: 0 });
    expect(huge.blocker?.(probe(), context())?.message).toMatch(/too large to add/);
    expect(format.blocker?.(probe(), context())).toBeNull();
    expect(format.blocker?.(probe(), context({ fileBytes: 2_000_000_000 }))?.message).toMatch(/^The video would be about/);
  });
});

describe("audio sync", () => {
  it("reads an offset in milliseconds and describes it", () => {
    expect(parseSyncMs(250)).toBe(250);
    expect(parseSyncMs(-100.4)).toBe(-100);
    expect(parseSyncMs(0)).toBeNull();
    expect(parseSyncMs(40_000)).toBeNull();
    expect(parseSyncMs(Number.NaN)).toBeNull();
    expect(describeSync(250)).toBe("250 ms later");
    expect(describeSync(-1500)).toBe("1.5 s earlier");
  });

  it("delays the sound by reading the file twice and offsetting the second read", () => {
    const format = syncFormat(250);
    expect(format.id).toBe("sync-later-250ms");
    expect(format.label).toBe("250 ms later");
    const plan = format.plan(probe(), context());
    expect(plan.inputArgs).toEqual([]);
    expect(joined(plan.args)).toBe("-itsoffset 0.250 -i /input/clip.mp4 -map 0:v:0 -map 1:a:0 -sn -dn -c:v copy -c:a copy -movflags +faststart");
    expect(plan.mode).toBe("copy");
    expect(plan.kind).toBe("video");
    expect(plan.fileSuffix).toBe("-audio-later-250ms");
  });

  it("brings the sound forward by delaying the picture instead", () => {
    const plan = syncFormat(-1500).plan(probe(), context({ sourceExtension: "mkv" }));
    expect(plan.inputArgs).toEqual(["-itsoffset", "1.500"]);
    expect(joined(plan.args)).toBe("-i /input/clip.mp4 -map 0:v:0 -map 1:a:0 -sn -dn -c:v copy -c:a copy");
    expect(plan.extension).toBe("mkv");
    expect(plan.fileSuffix).toBe("-audio-earlier-1500ms");
  });

  it("re-encodes the sound only when the container cannot hold it", () => {
    const opusInMp4 = probe({ audio: { ...AAC, codec: "opus" } });
    const plan = syncFormat(100).plan(opusInMp4, context());
    expect(joined(plan.args)).toContain("-c:v copy -c:a aac -b:a 192k");
    expect(plan.mode).toBe("encode");
  });

  it("refuses a file with no picture or no sound", () => {
    expect(syncFormat(100).blocker?.(probe({ video: null }), context())?.message).toMatch(/no picture/);
    expect(syncFormat(100).blocker?.(probe({ audio: null }), context())?.message).toMatch(/no sound/);
    expect(syncFormat(100).blocker?.(probe(), context())).toBeNull();
  });
});
