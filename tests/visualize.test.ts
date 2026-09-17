import { describe, expect, it } from "vitest";

import { TRIM_AUDIO_FORMATS } from "@/lib/engine/cut";
import { audioVideoFormat, backdropImageFilter, backdropPath, DEFAULT_AUDIO_VIDEO_SETTINGS, waveformVideoFilter, type BackdropImage } from "@/lib/engine/visualize";

import { AAC, context, joined, MP3, probe } from "./fixtures";

const image: BackdropImage = { name: "cover.png", bytes: new Uint8Array([137, 80]), mimeType: "image/png", key: "cover-2-1" };

describe("audio to video", () => {
  it("writes the filters for an image and for the waveform at each size", () => {
    expect(backdropPath(image)).toBe("/backdrop.png");
    expect(backdropImageFilter("720p")).toBe("[1:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[v]");
    expect(waveformVideoFilter("square")).toBe("[0:a:0]showwaves=s=1080x1080:mode=cline:rate=25:colors=white,format=yuv420p[v]");
  });

  it("puts an MP3 under a plain colour, copying the sound the MP4 can hold", () => {
    const format = audioVideoFormat(DEFAULT_AUDIO_VIDEO_SETTINGS, null);
    expect(format.id).toBe("audio-video-colour-black-720p");
    expect(format.label).toBe("MP4 on black");
    const plan = format.plan(probe({ video: null, audio: MP3 }), context({ sourceExtension: "mp3" }));
    expect(joined(plan.args)).toBe(
      "-f lavfi -i color=c=0x000000:s=1280x720:r=5:d=600.000 -map 1:v:0 -map 0:a:0 -sn -dn -c:v libx264 -preset veryfast -pix_fmt yuv420p -tune stillimage -crf 23 -c:a copy -shortest -movflags +faststart",
    );
    expect(plan.extension).toBe("mp4");
    expect(plan.kind).toBe("video");
    expect(plan.fileSuffix).toBe("-video");
  });

  it("scales an image into the frame and re-encodes sound the MP4 cannot hold", () => {
    const format = audioVideoFormat({ backdrop: "image", colour: "black", size: "1080p" }, image);
    expect(format.id).toBe("audio-video-image-cover-2-1-1080p");
    const plan = format.plan(probe({ video: null, audio: { ...AAC, codec: "flac" } }), context({ sourceExtension: "flac" }));
    expect(joined(plan.args)).toBe(
      "-loop 1 -framerate 5 -t 600.000 -i /backdrop.png -filter_complex [1:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[v] -map [v] -map 0:a:0 -sn -dn -c:v libx264 -preset veryfast -pix_fmt yuv420p -tune stillimage -crf 23 -c:a aac -b:a 192k -shortest -movflags +faststart",
    );
    expect(plan.scratchFiles).toEqual([{ path: "/backdrop.png", contents: image.bytes }]);
  });

  it("leaves a still unbounded only when the length is unknown", () => {
    const plan = audioVideoFormat(DEFAULT_AUDIO_VIDEO_SETTINGS, null).plan(probe({ video: null, audio: MP3, durationSeconds: null }), context());
    expect(joined(plan.args)).toContain("-i color=c=0x000000:s=1280x720:r=5 -map");
    const clipped = audioVideoFormat(DEFAULT_AUDIO_VIDEO_SETTINGS, null).plan(probe({ video: null, audio: MP3 }), context({ trim: { startSeconds: 10, endSeconds: 25 } }));
    expect(joined(clipped.args)).toContain(":r=5:d=15.000 -map");
  });

  it("draws the waveform without the still tuning", () => {
    const plan = audioVideoFormat({ backdrop: "waveform", colour: "black", size: "720p" }, null).plan(probe({ video: null, audio: MP3 }), context());
    expect(joined(plan.args)).toBe(
      "-filter_complex [0:a:0]showwaves=s=1280x720:mode=cline:rate=25:colors=white,format=yuv420p[v] -map [v] -map 0:a:0 -sn -dn -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 23 -c:a copy -shortest -movflags +faststart",
    );
  });

  it("refuses a silent file, a missing image, and an oversized one", () => {
    expect(audioVideoFormat(DEFAULT_AUDIO_VIDEO_SETTINGS, null).blocker?.(probe({ audio: null }), context())?.message).toMatch(/no sound/);
    expect(audioVideoFormat({ ...DEFAULT_AUDIO_VIDEO_SETTINGS, backdrop: "image" }, null).blocker?.(probe({ video: null }), context())?.message).toMatch(/No image/);
    const big = { ...image, bytes: new Uint8Array(20_000_001) };
    expect(audioVideoFormat({ ...DEFAULT_AUDIO_VIDEO_SETTINGS, backdrop: "image" }, big).blocker?.(probe({ video: null }), context())?.message).toMatch(/too large/);
    expect(audioVideoFormat(DEFAULT_AUDIO_VIDEO_SETTINGS, null).blocker?.(probe({ video: null }), context())).toBeNull();
  });
});

describe("the audio cutter's catalogue", () => {
  it("is the extractor's, insisting on a range, with the copy renamed", () => {
    expect(TRIM_AUDIO_FORMATS.map((format) => format.id)).toEqual(["original", "m4a", "mp3", "opus", "flac", "wav"]);
    expect(TRIM_AUDIO_FORMATS[0].label).toBe("Same format");
    const whole = context();
    for (const format of TRIM_AUDIO_FORMATS) {
      expect(format.blocker?.(probe({ video: null, audio: MP3 }), whole)?.message).toBe("Set a start or end marker first.");
    }
    const clipped = context({ trim: { startSeconds: 1, endSeconds: 5 } });
    expect(TRIM_AUDIO_FORMATS[0].blocker?.(probe({ video: null, audio: MP3 }), clipped)).toBeNull();
    // The WAV guard underneath still applies.
    const wav = probe({ video: null, audio: { ...AAC, codec: "pcm_s16le" }, durationSeconds: 20_000 });
    expect(TRIM_AUDIO_FORMATS[5].blocker?.(wav, context({ trim: { startSeconds: 0, endSeconds: 15_000 } }))?.message).toMatch(/^WAV would be about/);
  });
});
