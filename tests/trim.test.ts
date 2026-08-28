import { describe, expect, it } from "vitest";

import {
  compactTimecode,
  formatTimecode,
  isEntirelySilent,
  isSilenceEventLine,
  parseSilenceLog,
  parseTimecode,
  parseTrimInputs,
  resolveTrim,
  sameTrimRange,
  silenceDetectArgs,
  suggestTrimFromSilence,
  trimArgs,
  trimDuration,
  trimFileSuffix,
} from "@/lib/engine/trim";

/** Trimmed from a real `silencedetect` run over a talking-head recording. */
const SILENCE_LOG = [
  "[silencedetect @ 0x55d1a0] silence_start: -0.001",
  "[silencedetect @ 0x55d1a0] silence_end: 3.20748 | silence_duration: 3.20848",
  "[silencedetect @ 0x55d1a0] silence_start: 61.4",
  "[silencedetect @ 0x55d1a0] silence_end: 62.9 | silence_duration: 1.5",
  "[silencedetect @ 0x55d1a0] silence_start: 118.25",
  "[silencedetect @ 0x55d1a0] silence_end: 120 | silence_duration: 1.75",
];

describe("parseSilenceLog", () => {
  it("pairs starts with ends", () => {
    expect(parseSilenceLog(SILENCE_LOG)).toEqual([
      { start: 0, end: 3.20748 },
      { start: 61.4, end: 62.9 },
      { start: 118.25, end: 120 },
    ]);
  });

  it("keeps a trailing silence the file ended in as an open interval", () => {
    const intervals = parseSilenceLog([
      "[silencedetect @ 0x1] silence_start: 10",
      "[silencedetect @ 0x1] silence_end: 12 | silence_duration: 2",
      "[silencedetect @ 0x1] silence_start: 55.5",
    ]);
    expect(intervals[intervals.length - 1]).toEqual({ start: 55.5, end: null });
  });

  it("clamps the negative start silencedetect reports on the first sample", () => {
    expect(parseSilenceLog(["silence_start: -0.001"])).toEqual([{ start: 0, end: null }]);
  });

  it("ignores an end with nothing open", () => {
    expect(parseSilenceLog(["silence_end: 4 | silence_duration: 4"])).toEqual([]);
  });

  it("ignores unrelated ffmpeg chatter", () => {
    expect(parseSilenceLog(["  Duration: 00:02:00.00, start: 0.000000, bitrate: 128 kb/s"]))
      .toEqual([]);
  });
});

describe("isSilenceEventLine", () => {
  it("keeps only the filter's own events", () => {
    expect(isSilenceEventLine("[silencedetect @ 0x1] silence_start: 3")).toBe(true);
    expect(isSilenceEventLine("[silencedetect @ 0x1] silence_end: 9 | silence_duration: 6")).toBe(
      true,
    );
    expect(isSilenceEventLine("frame= 1200 fps=300 q=-0.0 size=N/A time=00:00:48.00")).toBe(false);
  });
});

describe("suggestTrimFromSilence", () => {
  const intervals = parseSilenceLog(SILENCE_LOG);

  it("cuts the quiet head and tail but keeps the pauses between", () => {
    // 3.20748 - 0.1 padding, and 118.25 + 0.1 padding.
    expect(suggestTrimFromSilence(intervals, 120)).toEqual({
      startSeconds: 3.10748,
      endSeconds: 118.35,
    });
  });

  it("reports the end as null when only the head is silent", () => {
    const headOnly = parseSilenceLog([
      "silence_start: 0",
      "silence_end: 5 | silence_duration: 5",
      "silence_start: 40",
      "silence_end: 41 | silence_duration: 1",
    ]);
    expect(suggestTrimFromSilence(headOnly, 120)).toEqual({
      startSeconds: 4.9,
      endSeconds: null,
    });
  });

  it("trims a tail the file ended inside", () => {
    const openTail = parseSilenceLog(["silence_start: 95.5"]);
    expect(suggestTrimFromSilence(openTail, 120)).toEqual({
      startSeconds: 0,
      endSeconds: 95.6,
    });
  });

  it("suggests nothing when the audio starts and ends loud", () => {
    const middleOnly = parseSilenceLog([
      "silence_start: 30",
      "silence_end: 34 | silence_duration: 4",
    ]);
    expect(suggestTrimFromSilence(middleOnly, 120)).toBeNull();
  });

  it("suggests nothing for a file that is silent throughout", () => {
    expect(suggestTrimFromSilence(parseSilenceLog(["silence_start: 0"]), 120)).toBeNull();
    expect(
      suggestTrimFromSilence(
        parseSilenceLog(["silence_start: 0", "silence_end: 120 | silence_duration: 120"]),
        120,
      ),
    ).toBeNull();
  });

  it("suggests nothing without a duration or without any silence", () => {
    expect(suggestTrimFromSilence(intervals, null)).toBeNull();
    expect(suggestTrimFromSilence([], 120)).toBeNull();
  });

  it("does not propose a sliver of a clip from a nearly silent file", () => {
    const nearlyAllSilent = parseSilenceLog([
      "silence_start: 0",
      "silence_end: 59.99 | silence_duration: 59.99",
      "silence_start: 60",
    ]);
    // A tenth of a second of audio is not worth extracting; the caller says
    // "no leading or trailing silence found" instead.
    expect(suggestTrimFromSilence(nearlyAllSilent, 60)).toBeNull();
  });

  it("still proposes a clip that is short but real", () => {
    const shortSpeech = parseSilenceLog([
      "silence_start: 0",
      "silence_end: 30 | silence_duration: 30",
      "silence_start: 31",
    ]);
    expect(suggestTrimFromSilence(shortSpeech, 60)).toEqual({
      startSeconds: 29.9,
      endSeconds: 31.1,
    });
  });
});

describe("isEntirelySilent", () => {
  it("is true only when one silence spans the file", () => {
    expect(isEntirelySilent([{ start: 0, end: null }], 120)).toBe(true);
    expect(isEntirelySilent([{ start: 0, end: 119.98 }], 120)).toBe(true);
    expect(isEntirelySilent([{ start: 0, end: 60 }], 120)).toBe(false);
    expect(isEntirelySilent([], 120)).toBe(false);
    expect(isEntirelySilent([{ start: 0, end: null }], null)).toBe(false);
  });
});

describe("resolveTrim", () => {
  it("passes a range inside the file through", () => {
    expect(resolveTrim({ startSeconds: 10, endSeconds: 20 }, 120)).toEqual({
      trim: { startSeconds: 10, endSeconds: 20 },
      problem: null,
    });
  });

  it("drops a range that covers the whole file, so nothing is added to the command", () => {
    expect(resolveTrim({ startSeconds: 0, endSeconds: 120 }, 120).trim).toBeNull();
    expect(resolveTrim({ startSeconds: 0, endSeconds: null }, 120).trim).toBeNull();
    expect(resolveTrim(null, 120).trim).toBeNull();
  });

  it("clamps an end past the file to the file, which makes it a start-only trim", () => {
    expect(resolveTrim({ startSeconds: 10, endSeconds: 999 }, 120).trim).toEqual({
      startSeconds: 10,
      endSeconds: null,
    });
  });

  it("rejects a start beyond the end of the file", () => {
    const { trim, problem } = resolveTrim({ startSeconds: 200, endSeconds: null }, 120);
    expect(trim).toBeNull();
    expect(problem?.message).toMatch(/starts after the end/i);
  });

  it("rejects an end at or before the start", () => {
    expect(resolveTrim({ startSeconds: 30, endSeconds: 30 }, 120).problem).not.toBeNull();
    expect(resolveTrim({ startSeconds: 30, endSeconds: 12 }, 120).problem).not.toBeNull();
  });

  it("keeps a range when the duration is unknown", () => {
    expect(resolveTrim({ startSeconds: 5, endSeconds: 25 }, null).trim).toEqual({
      startSeconds: 5,
      endSeconds: 25,
    });
  });
});

describe("trimArgs", () => {
  it("adds nothing without a trim", () => {
    expect(trimArgs(null)).toEqual({ input: [], output: [] });
  });

  it("seeks with -ss before the input and bounds with -t after it", () => {
    // -t is a length, not a timestamp: 20 - 10 = 10 seconds of output.
    expect(trimArgs({ startSeconds: 10, endSeconds: 20 })).toEqual({
      input: ["-ss", "10.000"],
      output: ["-t", "10.000"],
    });
  });

  it("omits -t when the clip runs to the end of the file", () => {
    expect(trimArgs({ startSeconds: 3.10748, endSeconds: null })).toEqual({
      input: ["-ss", "3.107"],
      output: [],
    });
  });

  it("omits -ss when the clip starts at the beginning", () => {
    expect(trimArgs({ startSeconds: 0, endSeconds: 30 })).toEqual({
      input: [],
      output: ["-t", "30.000"],
    });
  });
});

describe("trimDuration", () => {
  it("is the file's own duration without a trim", () => {
    expect(trimDuration(null, 120)).toBe(120);
    expect(trimDuration(null, null)).toBeNull();
  });

  it("is the length of the clip with one", () => {
    expect(trimDuration({ startSeconds: 10, endSeconds: 25 }, 120)).toBe(15);
    expect(trimDuration({ startSeconds: 10, endSeconds: null }, 120)).toBe(110);
    expect(trimDuration({ startSeconds: 10, endSeconds: null }, null)).toBeNull();
  });
});

describe("silenceDetectArgs", () => {
  it("builds the filter", () => {
    expect(silenceDetectArgs({ thresholdDb: -50, minDurationSeconds: 0.5 })).toEqual([
      "-af",
      "silencedetect=noise=-50dB:d=0.5",
    ]);
  });

  it("clamps values that would make the filter nonsense", () => {
    expect(silenceDetectArgs({ thresholdDb: 40, minDurationSeconds: 0 })).toEqual([
      "-af",
      "silencedetect=noise=0dB:d=0.05",
    ]);
  });
});

describe("parseTimecode", () => {
  it("reads the forms people type", () => {
    expect(parseTimecode("90")).toBe(90);
    expect(parseTimecode("1:30")).toBe(90);
    expect(parseTimecode("1:02:03")).toBe(3723);
    expect(parseTimecode("0:04.5")).toBe(4.5);
    expect(parseTimecode("  2:00  ")).toBe(120);
    expect(parseTimecode(".5")).toBe(0.5);
  });

  it("rejects what is not a time", () => {
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("soon")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
    expect(parseTimecode("1::30")).toBeNull();
    expect(parseTimecode("-5")).toBeNull();
  });
});

describe("formatTimecode", () => {
  it("round-trips through parseTimecode", () => {
    for (const seconds of [0, 4.5, 90, 3723.5, 119.99]) {
      expect(parseTimecode(formatTimecode(seconds))).toBeCloseTo(seconds, 2);
    }
  });

  it("drops the hours until there are some, and the fraction until there is one", () => {
    expect(formatTimecode(90)).toBe("1:30");
    expect(formatTimecode(3723)).toBe("1:02:03");
    expect(formatTimecode(4.5)).toBe("0:04.5");
    expect(formatTimecode(4.25)).toBe("0:04.25");
    expect(formatTimecode(0)).toBe("0:00");
  });
});

describe("compactTimecode", () => {
  it("stays filename-safe", () => {
    expect(compactTimecode(45)).toBe("45s");
    expect(compactTimecode(135)).toBe("2m15s");
    expect(compactTimecode(3723)).toBe("1h02m03s");
    expect(compactTimecode(0)).toBe("0s");
  });
});

describe("trimFileSuffix", () => {
  it("is empty for an untrimmed output", () => {
    expect(trimFileSuffix(null, 120)).toBe("");
  });

  it("names the range so clips of one video do not collide", () => {
    expect(trimFileSuffix({ startSeconds: 90, endSeconds: 135 }, 600)).toBe("-1m30s-2m15s");
  });

  it("falls back to the file's end when the clip runs to it", () => {
    expect(trimFileSuffix({ startSeconds: 90, endSeconds: null }, 600)).toBe("-1m30s-10m00s");
    expect(trimFileSuffix({ startSeconds: 90, endSeconds: null }, null)).toBe("-from-1m30s");
  });
});

describe("parseTrimInputs", () => {
  it("treats blank fields as the ends of the file", () => {
    expect(parseTrimInputs("", "")).toEqual({ trim: null, error: null });
    expect(parseTrimInputs("1:30", "")).toEqual({
      trim: { startSeconds: 90, endSeconds: null },
      error: null,
    });
    expect(parseTrimInputs("", "2:00")).toEqual({
      trim: { startSeconds: 0, endSeconds: 120 },
      error: null,
    });
  });

  it("explains a field that is not a time", () => {
    expect(parseTrimInputs("soon", "").error).toMatch(/not a time/);
    expect(parseTrimInputs("", "later").error).toMatch(/not a time/);
  });

  it("explains an end that does not come after the start", () => {
    expect(parseTrimInputs("2:00", "1:00").error).toMatch(/after the start/);
  });
});

describe("sameTrimRange", () => {
  it("treats null as the whole file", () => {
    expect(sameTrimRange(null, null)).toBe(true);
    expect(sameTrimRange(null, { startSeconds: 0, endSeconds: 10 })).toBe(false);
  });

  it("compares both markers", () => {
    expect(
      sameTrimRange({ startSeconds: 1, endSeconds: 2 }, { startSeconds: 1, endSeconds: 2 }),
    ).toBe(true);
    expect(
      sameTrimRange({ startSeconds: 1, endSeconds: 2 }, { startSeconds: 1, endSeconds: null }),
    ).toBe(false);
  });
});
