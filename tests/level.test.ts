import { describe, expect, it } from "vitest";

import {
  describeFade,
  fadeFilters,
  fadeFormat,
  formatDb,
  isPeakLine,
  parsePeak,
  parseVolumeDb,
  peakGainDb,
  volumeFormat,
} from "@/lib/engine/level";
import { audioSpeedFormat } from "@/lib/engine/tempo";

import { AAC, context, joined, MP3, probe } from "./fixtures";

describe("volume", () => {
  it("reads and formats a change in decibels", () => {
    expect(parseVolumeDb(6)).toBe(6);
    expect(parseVolumeDb(-3.55)).toBe(-3.5);
    expect(parseVolumeDb(0)).toBeNull();
    expect(parseVolumeDb(41)).toBeNull();
    expect(formatDb(6)).toBe("+6 dB");
    expect(formatDb(-3.5)).toBe("-3.5 dB");
  });

  it("reads the loudest sample out of volumedetect's report", () => {
    const lines = ["[Parsed_volumedetect_0 @ 0x1] n_samples: 288000", "[Parsed_volumedetect_0 @ 0x1] mean_volume: -20.1 dB", "[Parsed_volumedetect_0 @ 0x1] max_volume: -12.3 dB"];
    expect(lines.filter(isPeakLine)).toEqual([lines[2]]);
    expect(parsePeak(lines)).toBe(-12.3);
    expect(parsePeak([])).toBeNull();
    expect(peakGainDb(-12.3)).toBe(11.3);
    expect(peakGainDb(null)).toBe(0);
  });

  it("turns an audio file up in its own format", () => {
    const format = volumeFormat({ kind: "db", db: 6 });
    expect(format.id).toBe("volume-up-6db");
    const plan = format.plan(probe({ video: null, audio: MP3 }), context({ sourceExtension: "mp3" }));
    expect(joined(plan.args)).toBe("-map 0:a:0 -vn -sn -dn -af volume=6dB -c:a libmp3lame -q:a 2");
    expect(plan.extension).toBe("mp3");
    expect(plan.kind).toBe("audio");
    expect(plan.fileSuffix).toBe("-plus6db");
  });

  it("turns a video's sound down with its picture copied", () => {
    const plan = volumeFormat({ kind: "db", db: -3 }).plan(probe(), context({ sourceExtension: "mov" }));
    expect(joined(plan.args)).toBe("-map 0:v:0 -map 0:a:0 -sn -dn -c:v copy -af volume=-3dB -c:a aac -b:a 192k -movflags +faststart");
    expect(plan.extension).toBe("mov");
    expect(plan.kind).toBe("video");
    expect(plan.fileSuffix).toBe("-minus3db");
  });

  it("measures the peak in a pass of its own and lifts to just under full scale", () => {
    const plan = volumeFormat({ kind: "peak" }).plan(probe({ video: null, audio: AAC }), context({ sourceExtension: "m4a" }));
    expect(plan.analysisPasses).toEqual([["-map", "0:a:0", "-vn", "-sn", "-dn", "-af", "volumedetect"]]);
    expect(joined(plan.args)).toContain("-af volume=0dB");
    const refined = plan.refine!.args(["[Parsed_volumedetect_0 @ 0x1] max_volume: -8.0 dB"]);
    expect(joined(refined)).toBe("-map 0:a:0 -vn -sn -dn -af volume=7dB -c:a aac -b:a 192k -movflags +faststart");
    expect(plan.fileSuffix).toBe("-loud");
  });

  it("refuses a silent file and an uncompressed output past the ceiling", () => {
    const format = volumeFormat({ kind: "db", db: 6 });
    expect(format.blocker?.(probe({ audio: null }), context())?.message).toMatch(/no sound/);
    const wav = probe({ video: null, audio: { ...AAC, codec: "pcm_s16le" }, durationSeconds: 12_000 });
    expect(format.blocker?.(wav, context())?.message).toMatch(/^The WAV would be about/);
    expect(format.blocker?.(probe(), context())).toBeNull();
  });
});

describe("fade", () => {
  it("describes the setting and writes both filters against the clip's length", () => {
    expect(describeFade({ inSeconds: 1, outSeconds: 2, picture: true })).toBe("1 s in, 2 s out");
    expect(describeFade({ inSeconds: 0, outSeconds: 3, picture: false })).toBe("3 s out");
    expect(describeFade({ inSeconds: 0, outSeconds: 0, picture: false })).toBe("none");
    expect(fadeFilters({ inSeconds: 1, outSeconds: 2, picture: true }, 30)).toEqual({
      audio: "afade=t=in:st=0:d=1,afade=t=out:st=28.000:d=2",
      video: "fade=t=in:st=0:d=1,fade=t=out:st=28.000:d=2",
    });
    expect(fadeFilters({ inSeconds: 0.5, outSeconds: 0, picture: false }, 30)).toEqual({ audio: "afade=t=in:st=0:d=0.5", video: "fade=t=in:st=0:d=0.5" });
  });

  it("fades an audio file in its own format, and a video's sound with the picture copied", () => {
    const settings = { inSeconds: 1, outSeconds: 2, picture: false };
    expect(fadeFormat(settings).id).toBe("fade-in1-out2");
    const audio = fadeFormat(settings).plan(probe({ video: null, audio: MP3, durationSeconds: 30 }), context({ sourceExtension: "mp3" }));
    expect(joined(audio.args)).toBe("-map 0:a:0 -vn -sn -dn -af afade=t=in:st=0:d=1,afade=t=out:st=28.000:d=2 -c:a libmp3lame -q:a 2");
    expect(audio.fileSuffix).toBe("-faded");
    const video = fadeFormat(settings).plan(probe({ durationSeconds: 30 }), context());
    expect(joined(video.args)).toContain("-c:v copy -af afade=t=in:st=0:d=1,afade=t=out:st=28.000:d=2 -c:a aac");
    expect(video.kind).toBe("video");
  });

  it("re-encodes the picture too when asked, measuring the fade out from the range", () => {
    const format = fadeFormat({ inSeconds: 1, outSeconds: 2, picture: true });
    expect(format.id).toBe("fade-in1-out2-picture");
    expect(format.requiredEncoder).toBe("libx264");
    const plan = format.plan(probe(), context({ trim: { startSeconds: 10, endSeconds: 20 } }));
    expect(joined(plan.args)).toBe(
      "-map 0:v:0 -map 0:a:0 -sn -dn -vf fade=t=in:st=0:d=1,fade=t=out:st=8.000:d=2 -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 -af afade=t=in:st=0:d=1,afade=t=out:st=8.000:d=2 -c:a aac -b:a 192k -movflags +faststart",
    );
    expect(plan.mode).toBe("encode");
  });

  it("refuses no fade, fades longer than the file, and an unknown length", () => {
    expect(fadeFormat({ inSeconds: 0, outSeconds: 0, picture: false }).blocker?.(probe(), context())?.severity).toBe("info");
    expect(fadeFormat({ inSeconds: 5, outSeconds: 5, picture: false }).blocker?.(probe({ durationSeconds: 8 }), context())?.message).toMatch(/longer than the file/);
    expect(fadeFormat({ inSeconds: 1, outSeconds: 2, picture: false }).blocker?.(probe({ durationSeconds: null }), context())?.message).toMatch(/length is unknown/);
    expect(fadeFormat({ inSeconds: 1, outSeconds: 0, picture: false }).blocker?.(probe({ durationSeconds: null }), context())).toBeNull();
    expect(fadeFormat({ inSeconds: 1, outSeconds: 2, picture: true }).blocker?.(probe(), context())).toBeNull();
  });
});

describe("audio speed", () => {
  it("chains atempo and writes back in the file's own format, on the output's clock", () => {
    const format = audioSpeedFormat(3);
    expect(format.id).toBe("audio-speed-3x");
    const plan = format.plan(probe({ video: null, audio: MP3 }), context({ sourceExtension: "mp3" }));
    expect(joined(plan.args)).toBe("-map 0:a:0 -vn -sn -dn -af atempo=2,atempo=1.5 -c:a libmp3lame -q:a 2");
    expect(plan.durationFactor).toBe(1 / 3);
    expect(plan.limitInput).toBe(true);
    expect(plan.fileSuffix).toBe("-3x");
    expect(plan.kind).toBe("audio");
  });

  it("takes a video's soundtrack and refuses a silent file", () => {
    const plan = audioSpeedFormat(1.5).plan(probe(), context());
    expect(plan.extension).toBe("m4a");
    expect(audioSpeedFormat(1.5).blocker?.(probe({ audio: null }), context())?.message).toMatch(/no sound/);
    expect(audioSpeedFormat(0.5).blocker?.(probe({ video: null, audio: { ...AAC, codec: "pcm_s16le" }, durationSeconds: 7000 }), context())?.message).toMatch(/^The WAV would be about/);
  });
});
