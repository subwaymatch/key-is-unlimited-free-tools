import { describe, expect, it } from "vitest";

import {
  assHeader,
  balanceTags,
  cleanMarkup,
  decodeSubtitleBytes,
  detectFormat,
  FRAME_RATE_PRESETS,
  formatAssTime,
  formatSrtTime,
  formatVttTime,
  parseAss,
  parseClock,
  parseOffset,
  parseSrt,
  parseSubtitles,
  parseVtt,
  retimeCues,
  serialize,
  stretchFactor,
  SubtitleError,
  toAss,
  toSrt,
  toText,
  toVtt,
  type Cue,
} from "@/lib/subtitles";

const SRT = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Hello there.",
  "",
  "2",
  "00:00:05,500 --> 00:00:07,250",
  "<i>Two lines,</i>",
  "with <font color=\"red\">colour</font> and {\\an8}a position tag.",
  "",
].join("\r\n");

const VTT = [
  "WEBVTT - some title",
  "Kind: captions",
  "",
  "NOTE this is a comment",
  "",
  "intro",
  "00:01.000 --> 00:04.000 line:90% align:start",
  "<v Narrator>Hello there.</v>",
  "",
  "00:00:05.500 --> 00:00:07.250",
  "Fish &amp; <c.yellow>chips</c> <b>cost</b> &lt; 5",
  "",
].join("\n");

const ASS = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname",
  "Style: Default,Arial",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:05.50,0:00:07.25,Default,,0,0,0,,{\\i1}Second,{\\i0} with a comma\\Nand a break",
  "Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,not a cue",
  "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\an8\\b1}Hello{\\b0} there.",
  "",
].join("\n");

describe("parseClock", () => {
  it("reads every notation the three formats use", () => {
    expect(parseClock("00:00:01,000")).toBe(1);
    expect(parseClock("01:02:03.456")).toBeCloseTo(3723.456, 3);
    expect(parseClock("02:03.456")).toBeCloseTo(123.456, 3);
    // ASS keeps hundredths: ".45" is 450 ms, not 45.
    expect(parseClock("0:00:01.45")).toBeCloseTo(1.45, 3);
    expect(parseClock("1:02:03.5")).toBeCloseTo(3723.5, 3);
  });

  it("refuses what is not a time", () => {
    expect(parseClock("hello")).toBeNull();
    expect(parseClock("00:99:00,000")).toBeNull();
    expect(parseClock("")).toBeNull();
  });
});

describe("parseSrt", () => {
  it("reads numbered blocks with Windows line endings", () => {
    const parsed = parseSrt(SRT);
    expect(parsed.format).toBe("srt");
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0]).toEqual({ start: 1, end: 4, text: "Hello there." });
    expect(parsed.cues[1].start).toBe(5.5);
    expect(parsed.cues[1].end).toBe(7.25);
  });

  it("keeps italics and drops fonts and position tags", () => {
    expect(parseSrt(SRT).cues[1].text).toBe(
      "<i>Two lines,</i>\nwith colour and a position tag.",
    );
  });

  it("copes with a missing sequence number and dots for commas", () => {
    const parsed = parseSrt("00:00:01.000 --> 00:00:02.000\nLoose\n\n3\n\n00:00:03,000 --> 00:00:04,000\nStrict\n");
    expect(parsed.cues.map((cue) => cue.text)).toEqual(["Loose", "Strict"]);
    expect(parsed.warnings[0]).toMatch(/1 block had no readable timing line/);
  });

  it("strips a byte-order mark", () => {
    expect(parseSrt("\uFEFF1\n00:00:01,000 --> 00:00:02,000\nHi\n").cues).toHaveLength(1);
  });
});

describe("parseVtt", () => {
  it("skips the header, notes and identifiers, and reads settings-bearing timing lines", () => {
    const parsed = parseVtt(VTT);
    expect(parsed.format).toBe("vtt");
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0]).toEqual({ start: 1, end: 4, text: "Hello there." });
  });

  it("decodes entities and drops voice and class spans", () => {
    expect(parseVtt(VTT).cues[1].text).toBe("Fish & chips <b>cost</b> < 5");
  });

  it("insists on the WEBVTT line", () => {
    expect(() => parseVtt("1\n00:00:01,000 --> 00:00:02,000\nHi")).toThrow(SubtitleError);
  });
});

describe("parseAss", () => {
  it("reads dialogue lines, in time order, with commas kept in the text", () => {
    const parsed = parseAss(ASS);
    expect(parsed.format).toBe("ass");
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0]).toEqual({ start: 1, end: 4, text: "<b>Hello</b> there." });
    expect(parsed.cues[1]).toEqual({
      start: 5.5,
      end: 7.25,
      text: "<i>Second,</i> with a comma\nand a break",
    });
  });

  it("ignores comment lines", () => {
    expect(parseAss(ASS).cues.some((cue) => cue.text.includes("not a cue"))).toBe(false);
  });

  it("needs an events section", () => {
    expect(() => parseAss("[Script Info]\nTitle: x\n")).toThrow(/no \[Events\]/);
  });
});

describe("detectFormat", () => {
  it("reads the content before the name", () => {
    expect(detectFormat(VTT, "wrong.srt")).toBe("vtt");
    expect(detectFormat(ASS, "wrong.srt")).toBe("ass");
    expect(detectFormat(SRT, "wrong.vtt")).toBe("srt");
  });

  it("falls back to the extension, then gives up", () => {
    expect(detectFormat("", "thing.ssa")).toBe("ass");
    expect(detectFormat("", "thing.srt")).toBe("srt");
    expect(detectFormat("just words", "thing.txt")).toBeNull();
  });
});

describe("parseSubtitles", () => {
  it("routes to the right parser", () => {
    expect(parseSubtitles(SRT, "a.srt").format).toBe("srt");
    expect(parseSubtitles(VTT, "a.vtt").format).toBe("vtt");
    expect(parseSubtitles(ASS, "a.ass").format).toBe("ass");
  });

  it("refuses a file that is not subtitles, with a hint", () => {
    expect(() => parseSubtitles("Dear diary,\n\nToday was fine.", "diary.txt")).toThrow(
      /does not look like a subtitle file/,
    );
    expect(() => parseSubtitles("1\n\n2\n\n3", "empty.srt")).toThrow(/No cues could be read/);
  });
});

describe("markup", () => {
  it("closes what a cue left open and drops a close with no open", () => {
    expect(balanceTags("<i>open")).toBe("<i>open</i>");
    expect(balanceTags("stray</i> text")).toBe("stray text");
    expect(balanceTags("<i>a<b>b</i>c</b>")).toBe("<i>a<b>b</b></i><b>c</b>");
  });

  it("normalises case and trims lines", () => {
    expect(cleanMarkup("<I>Shout</I>  \n\n  <U>under</U> <FONT size=3>x</FONT>")).toBe(
      "<i>Shout</i>\n<u>under</u> x",
    );
  });
});

describe("writers", () => {
  const cues: Cue[] = [
    { start: 1, end: 4, text: "Hello there." },
    { start: 3723.456, end: 3725, text: "<i>Two lines,</i>\nsecond & <b>third</b> < 5" },
  ];

  it("format times the way each format expects", () => {
    expect(formatSrtTime(3723.456)).toBe("01:02:03,456");
    expect(formatVttTime(3723.456)).toBe("01:02:03.456");
    expect(formatAssTime(3723.456)).toBe("1:02:03.46");
    expect(formatSrtTime(-1)).toBe("00:00:00,000");
  });

  it("write SRT with numbers and CRLF-free blocks", () => {
    expect(toSrt(cues)).toBe(
      "1\n00:00:01,000 --> 00:00:04,000\nHello there.\n\n2\n01:02:03,456 --> 01:02:05,000\n<i>Two lines,</i>\nsecond & <b>third</b> < 5\n",
    );
  });

  it("write WebVTT with the header and the characters that need escaping", () => {
    const vtt = toVtt(cues);
    expect(vtt.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello there.\n")).toBe(true);
    expect(vtt).toContain("second &amp; <b>third</b> &lt; 5");
  });

  it("write ASS with a default style and override tags", () => {
    const ass = toAss(cues);
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain(
      "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello there.",
    );
    expect(ass).toContain("{\\i1}Two lines,{\\i0}\\Nsecond & {\\b1}third{\\b0} < 5");
  });

  it("write a transcript without times or markup", () => {
    expect(toText(cues)).toBe("Hello there.\nTwo lines, second & third < 5\n");
  });

  it("round-trip through every format", () => {
    for (const target of ["srt", "vtt", "ass"] as const) {
      const again = parseSubtitles(serialize(cues, target), `x.${target}`);
      expect(again.cues.map((cue) => cue.text), target).toEqual(cues.map((cue) => cue.text));
      for (const [index, cue] of again.cues.entries()) {
        // ASS keeps hundredths, so allow that much.
        expect(cue.start, target).toBeCloseTo(cues[index].start, 1);
        expect(cue.end, target).toBeCloseTo(cues[index].end, 1);
      }
    }
  });
});

describe("retiming", () => {
  const cues: Cue[] = [
    { start: 0.5, end: 1, text: "a" },
    { start: 10, end: 12, text: "b" },
    { start: 100, end: 104, text: "c" },
  ];

  it("shifts every cue by the offset", () => {
    const { cues: moved, dropped } = retimeCues(cues, { offsetSeconds: 1.5, factor: 1 });
    expect(moved.map((cue) => cue.start)).toEqual([2, 11.5, 101.5]);
    expect(dropped).toBe(0);
  });

  it("drops cues pushed before the start and clamps ones that straddle it", () => {
    const { cues: moved, dropped } = retimeCues(cues, { offsetSeconds: -0.75, factor: 1 });
    expect(dropped).toBe(0);
    expect(moved[0]).toEqual({ start: 0, end: 0.25, text: "a" });
    const { cues: fewer, dropped: gone } = retimeCues(cues, { offsetSeconds: -2, factor: 1 });
    expect(gone).toBe(1);
    expect(fewer[0].text).toBe("b");
  });

  it("stretches by the frame-rate ratio", () => {
    const factor = stretchFactor(25, 23.976);
    expect(factor).toBeCloseTo(1.0427, 3);
    const { cues: moved } = retimeCues(cues, { offsetSeconds: 0, factor });
    expect(moved[2].start).toBeCloseTo(104.271, 2);
    // Every preset's factor is the ratio it names.
    for (const preset of FRAME_RATE_PRESETS) {
      expect(stretchFactor(preset.from, preset.to)).toBeCloseTo(preset.from / preset.to, 6);
    }
  });

  it("leaves the cues alone with no retiming", () => {
    expect(retimeCues(cues, { offsetSeconds: 0, factor: 1 }).cues).toEqual(cues);
  });
});

describe("parseOffset", () => {
  it("reads seconds and clocks with a sign", () => {
    expect(parseOffset("1.5")).toBe(1.5);
    expect(parseOffset("-2")).toBe(-2);
    expect(parseOffset("+0:03.25")).toBe(3.25);
    expect(parseOffset("-1:02")).toBe(-62);
    expect(parseOffset("")).toBe(0);
  });

  it("refuses what is not a time", () => {
    expect(parseOffset("soon")).toBeNull();
    expect(parseOffset("9:99")).toBeNull();
  });
});

describe("decodeSubtitleBytes", () => {
  it("reads UTF-8 strictly and falls back to Windows-1252", () => {
    const utf8 = new TextEncoder().encode("caf\u00e9").buffer;
    expect(decodeSubtitleBytes(utf8)).toEqual({ text: "caf\u00e9", encoding: "UTF-8" });
    // "caf" then 0xE9: the Windows-1252 spelling of the same word.
    const legacy = new Uint8Array([0x63, 0x61, 0x66, 0xe9]).buffer;
    expect(decodeSubtitleBytes(legacy)).toEqual({ text: "caf\u00e9", encoding: "Windows-1252" });
  });

  it("honours a UTF-16 byte-order mark", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]).buffer;
    expect(decodeSubtitleBytes(bytes)).toEqual({ text: "Hi", encoding: "UTF-16" });
  });
});

describe("assHeader", () => {
  it("writes the style it is given, and the plain default otherwise", () => {
    expect(assHeader()).toContain("Style: Default,Arial,48,");
    const styled = assHeader({ fontName: "DejaVu Sans", fontSize: 64, alignment: 8, borderStyle: 3 });
    expect(styled).toContain("Style: Default,DejaVu Sans,64,");
    // Border style 3 is an opaque box, drawn without a shadow, at the top.
    expect(styled).toMatch(/,3,2,0,8,40,40,40,1$/m);
    expect(toAss([{ start: 1, end: 2, text: "Hi" }], { fontSize: 36 })).toContain(",36,");
  });
});
