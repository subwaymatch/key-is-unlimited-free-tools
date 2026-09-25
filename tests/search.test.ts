import { describe, expect, it } from "vitest";

import { buildPattern, grepLines, MAX_LINE, searchChunks, SearchError } from "@/lib/text/search";

async function* pieces(text: string, size: number): AsyncGenerator<string> {
  for (let at = 0; at < text.length; at += size) yield text.slice(at, at + size);
}

const LOG = ["start", "error: disk full", "retrying", "ok", "ok", "ok", "Error: timeout", "error again", "done"].join("\r\n");

describe("the pattern", () => {
  it("is literal text by default, with case and whole words as asked", () => {
    expect(buildPattern({ query: "a.b", regex: false, caseSensitive: false, wholeWord: false }).test("AxB")).toBe(false);
    expect(buildPattern({ query: "a.b", regex: true, caseSensitive: false, wholeWord: false }).test("AxB")).toBe(true);
    expect(buildPattern({ query: "Error", regex: false, caseSensitive: true, wholeWord: false }).test("error")).toBe(false);
    const word = buildPattern({ query: "cat", regex: false, caseSensitive: false, wholeWord: true });
    expect(["cat", "a cat.", "concatenate", "cats", "caf\u00e9cat"].map((text) => (word.lastIndex = 0, word.test(text)))).toEqual([true, true, false, false, false]);
  });

  it("refuses an empty query, a broken expression and one that matches nothing at all", () => {
    expect(() => buildPattern({ query: "", regex: false, caseSensitive: false, wholeWord: false })).toThrow(SearchError);
    expect(() => buildPattern({ query: "a(b", regex: true, caseSensitive: false, wholeWord: false })).toThrow(/not a valid regular expression/);
    expect(() => buildPattern({ query: "x*", regex: true, caseSensitive: false, wholeWord: false })).toThrow(/matches empty text/);
  });
});

describe("searching", () => {
  it("finds every match with its line, column and context, however the text is cut into pieces", async () => {
    const pattern = buildPattern({ query: "error", regex: false, caseSensitive: false, wholeWord: false });
    for (const size of [1, 3, 7, 1000]) {
      const result = await searchChunks(pieces(LOG, size), pattern, 1, 100);
      expect(result).toMatchObject({ matchingLines: 3, occurrences: 3, lines: 9, truncated: false });
      expect(result.matches.map((match) => [match.line, match.column, match.text])).toEqual([
        [2, 1, "error: disk full"],
        [7, 1, "Error: timeout"],
        [8, 1, "error again"],
      ]);
      expect(result.matches[0].before).toEqual([{ line: 1, text: "start" }]);
      expect(result.matches[0].after).toEqual([{ line: 3, text: "retrying" }]);
      expect(result.matches[1].before).toEqual([{ line: 6, text: "ok" }]);
      expect(result.matches[1].after).toEqual([]);
      expect(result.matches[2].after).toEqual([{ line: 9, text: "done" }]);
    }
  });

  it("writes grep's format, groups apart separated by --", async () => {
    const pattern = buildPattern({ query: "error", regex: false, caseSensitive: false, wholeWord: false });
    const result = await searchChunks(pieces(LOG, 5), pattern, 1, 100);
    expect(grepLines("app.log", result)).toEqual(["app.log-1-start", "app.log:2:error: disk full", "app.log-3-retrying", "--", "app.log-6-ok", "app.log:7:Error: timeout", "app.log:8:error again", "app.log-9-done"]);
  });

  it("counts several matches on a line, keeps a limit, and cuts long lines down around the match", async () => {
    const pattern = buildPattern({ query: "o", regex: false, caseSensitive: false, wholeWord: false });
    const limited = await searchChunks(pieces("foo\nboo\nzoo\n", 2), pattern, 0, 2);
    expect(limited).toMatchObject({ matchingLines: 3, occurrences: 6, truncated: true });
    expect(limited.matches).toHaveLength(2);
    expect(limited.matches[0].ranges).toEqual([[1, 2], [2, 3]]);
    const long = `${"a".repeat(5000)}NEEDLE${"b".repeat(5000)}`;
    const [match] = (await searchChunks(pieces(long, 999), buildPattern({ query: "needle", regex: false, caseSensitive: false, wholeWord: false }), 0, 10)).matches;
    expect(match.column).toBe(5001);
    expect(match.text.length).toBeLessThanOrEqual(MAX_LINE + 6);
    expect(match.text.slice(match.ranges[0][0], match.ranges[0][1])).toBe("NEEDLE");
  });
});
