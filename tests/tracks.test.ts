import { describe, expect, it } from "vitest";

import {
  AUDIO_TRACK_FORMATS,
  audioTrackFormat,
  audioTrackFormatIds,
  describeAudioTrack,
  MAX_AUDIO_TRACKS,
} from "@/lib/engine/tracks";
import type { AudioStreamInfo, PlanContext, ProbeResult } from "@/lib/engine/types";

const ENGLISH: AudioStreamInfo = {
  codec: "aac",
  profile: "LC",
  sampleRate: 48_000,
  channels: 2,
  channelLayout: "stereo",
  bitrateKbps: 192,
  language: "eng",
  title: null,
};

const COMMENTARY: AudioStreamInfo = {
  codec: "ac3",
  profile: null,
  sampleRate: 48_000,
  channels: 6,
  channelLayout: "5.1(side)",
  bitrateKbps: 448,
  language: "fre",
  title: "Commentary",
};

const UNTAGGED: AudioStreamInfo = {
  codec: "truehd",
  profile: null,
  sampleRate: 48_000,
  channels: 8,
  channelLayout: "7.1",
  bitrateKbps: null,
  language: null,
  title: null,
};

function probe(audioStreams: AudioStreamInfo[] = [ENGLISH, COMMENTARY, UNTAGGED]): ProbeResult {
  return {
    durationSeconds: 7200,
    bitrateKbps: 8000,
    audioStreams,
    audio: audioStreams[0] ?? null,
    videoStreams: [],
    video: null,
    hasVideo: true,
    subtitleStreams: [],
    chapters: [],
    formatName: "matroska,webm",
    log: [],
  };
}

const context = (fileBytes = 7_000_000_000): PlanContext => ({ trim: null, fileBytes, sourceExtension: "mkv" });

describe("audio tracks out", () => {
  it("offers a format per track the file has, described by what the track says of itself", () => {
    expect(AUDIO_TRACK_FORMATS).toHaveLength(MAX_AUDIO_TRACKS);
    expect(audioTrackFormatIds(probe())).toEqual(["audio-track-1", "audio-track-2", "audio-track-3"]);
    expect(audioTrackFormat(2).offer?.(probe(), context())).toBe(true);
    expect(audioTrackFormat(3).offer?.(probe(), context())).toBe(false);
    expect(audioTrackFormat(0).describe?.(probe())).toBe("Track 1: eng, AAC stereo");
    expect(audioTrackFormat(1).describe?.(probe())).toBe("Track 2: Commentary, fre, AC3 5.1(side)");
    expect(audioTrackFormat(2).describe?.(probe())).toBe("Track 3: TRUEHD 7.1");
    expect(describeAudioTrack(undefined, 3)).toBe("Track 4");
  });

  it("copies the one track into the container its codec belongs in, named by language", () => {
    const first = audioTrackFormat(0).plan(probe(), context());
    expect(first.args.join(" ")).toBe("-map 0:a:0 -vn -sn -dn -c:a copy -metadata:s:a:0 language=eng -movflags +faststart");
    expect(first.extension).toBe("m4a");
    expect(first.mode).toBe("copy");
    expect(first.kind).toBe("audio");
    expect(first.fileSuffix).toBe("-track1-eng");

    const second = audioTrackFormat(1).plan(probe(), context());
    expect(second.args.join(" ")).toBe("-map 0:a:1 -vn -sn -dn -c:a copy -metadata:s:a:0 language=fre -metadata:s:a:0 title=Commentary");
    expect(second.extension).toBe("ac3");
    expect(second.fileSuffix).toBe("-track2-fre");

    const third = audioTrackFormat(2).plan(probe(), context());
    expect(third.args.join(" ")).toBe("-map 0:a:2 -vn -sn -dn -c:a copy");
    expect(third.extension).toBe("mka");
    expect(third.fileSuffix).toBe("-track3");
  });

  it("refuses a track the file lacks, and one too large to build", () => {
    expect(audioTrackFormat(4).blocker?.(probe(), context())?.message).toBe("This file has no audio track 5.");
    expect(audioTrackFormat(1).blocker?.(probe(), context())).toBeNull();
    // No rate on the track: a third of a 7 GB file is over the ceiling.
    expect(audioTrackFormat(2).blocker?.(probe(), context())?.message).toMatch(/^This track would be about/);
    // A known rate is used instead of the share: 448 kbps over two hours is 400 MB.
    expect(audioTrackFormat(1).blocker?.(probe(), context(30_000_000_000))).toBeNull();
  });
});
