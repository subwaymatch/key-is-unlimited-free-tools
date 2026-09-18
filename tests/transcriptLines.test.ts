import { describe, expect, it } from "vitest";

import { clockStamp, paragraphsOf, preciseStamp, transcript, wordCount } from "@/lib/subtitles/transcript";
import { joinLines, processLines } from "@/lib/text/lines";

const cues = [
  { start: 0, end: 2, text: "Hello there.\nWelcome <i>back</i>." },
  { start: 3, end: 4, text: "It is good to see you" },
  { start: 4.1, end: 6, text: "again." },
  { start: 9, end: 11, text: "Now, the news." },
];

describe("transcripts", () => {
  it("formats times", () => {
    expect(clockStamp(83)).toBe("00:01:23");
    expect(clockStamp(3661.9)).toBe("01:01:01");
    expect(preciseStamp(83.45)).toBe("00:01:23.450");
  });

  it("runs cues into paragraphs at pauses and full stops", () => {
    expect(paragraphsOf(cues)).toEqual(["Hello there. Welcome back.", "It is good to see you again.", "Now, the news."]);
  });

  it("writes each style", () => {
    expect(transcript(cues, "lines")).toBe("Hello there. Welcome back.\nIt is good to see you\nagain.\nNow, the news.\n");
    expect(transcript(cues, "timed")).toContain("[00:00:03] It is good to see you\n[00:00:04] again.");
    expect(transcript(cues, "csv").split("\r\n")[1]).toBe("00:00:00.000,00:00:02.000,Hello there. Welcome back.");
    expect(transcript(cues, "paragraphs")).toBe("Hello there. Welcome back.\n\nIt is good to see you again.\n\nNow, the news.\n");
    expect(wordCount(cues)).toBe(14);
  });
});

describe("lines", () => {
  const text = "pear\nApple\n\nitem10\nitem2\napple\npear\n";

  it("sorts with numbers in order, ignoring case, keeping ties in file order", () => {
    const result = processLines(text, { order: "az", ignoreCase: true, dedupe: false, dropBlank: true, trim: false });
    expect(result.lines).toEqual(["Apple", "apple", "item2", "item10", "pear", "pear"]);
    expect(result).toMatchObject({ total: 7, blanks: 1, duplicates: 0, newline: "\n" });
    expect(processLines(text, { order: "natural", ignoreCase: false, dedupe: false, dropBlank: true, trim: false }).lines).toEqual(["apple", "Apple", "item10", "item2", "pear", "pear"]);
    expect(processLines(text, { order: "za", ignoreCase: true, dedupe: false, dropBlank: true, trim: false }).lines[0]).toBe("pear");
    expect(processLines(text, { order: "length", ignoreCase: true, dedupe: false, dropBlank: true, trim: false }).lines).toEqual(["pear", "pear", "Apple", "apple", "item2", "item10"]);
  });

  it("drops duplicates, with or without regard to case", () => {
    const loose = processLines(text, { order: "keep", ignoreCase: true, dedupe: true, dropBlank: true, trim: false });
    expect(loose.lines).toEqual(["pear", "Apple", "item10", "item2"]);
    expect(loose.duplicates).toBe(2);
    const strict = processLines(text, { order: "keep", ignoreCase: false, dedupe: true, dropBlank: false, trim: false });
    expect(strict.lines).toEqual(["pear", "Apple", "", "item10", "item2", "apple"]);
  });

  it("reverses, shuffles and trims, keeping the file's line endings", () => {
    expect(processLines("a\r\nb\r\nc", { order: "reverse", ignoreCase: true, dedupe: false, dropBlank: false, trim: false })).toMatchObject({ lines: ["c", "b", "a"], newline: "\r\n" });
    const shuffled = processLines("1\n2\n3\n4\n", { order: "shuffle", ignoreCase: true, dedupe: false, dropBlank: false, trim: false }, () => 0);
    expect([...shuffled.lines].sort()).toEqual(["1", "2", "3", "4"]);
    expect(shuffled.lines).toEqual(["2", "3", "4", "1"]);
    expect(processLines("  a  \n b\n", { order: "keep", ignoreCase: true, dedupe: false, dropBlank: false, trim: true }).lines).toEqual(["a", "b"]);
    expect(joinLines(processLines("b\na\n", { order: "az", ignoreCase: true, dedupe: false, dropBlank: false, trim: false }))).toBe("a\nb\n");
    expect(joinLines(processLines("", { order: "az", ignoreCase: true, dedupe: false, dropBlank: false, trim: false }))).toBe("");
  });
});
