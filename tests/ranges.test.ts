import { describe, expect, it } from "vitest";

import { describeRange, everyPages, pageIndices, parsePageRanges, rangeSyntaxProblem } from "@/lib/pdf/ranges";

describe("page ranges", () => {
  it("reads what a print dialog takes", () => {
    const { ranges, problems } = parsePageRanges("1-3, 5; 8-", 10);
    expect(ranges).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
      { from: 8, to: 10 },
    ]);
    expect(problems).toEqual([]);
    expect(parsePageRanges("-2", 10).ranges).toEqual([{ from: 1, to: 2 }]);
    expect(parsePageRanges("3 - 4", 10).ranges).toEqual([{ from: 3, to: 4 }]);
  });

  it("clips, skips and explains", () => {
    const { ranges, problems } = parsePageRanges("2-40, 50, x, 0, 6-4, -", 10);
    expect(ranges).toEqual([{ from: 2, to: 10 }]);
    expect(problems).toEqual([
      '"2-40" was cut at the last page, 10.',
      '"50" is past the last page, 10.',
      '"x" is not a page or a range.',
      '"0" starts before page 1.',
      '"6-4" ends before it starts.',
      '"-" is not a page or a range.',
    ]);
  });

  it("turns ranges into indices without repeats, and describes them", () => {
    expect(pageIndices([{ from: 1, to: 3 }, { from: 3, to: 4 }, { from: 2, to: 2 }])).toEqual([0, 1, 2, 3]);
    expect(describeRange({ from: 5, to: 5 })).toBe("5");
    expect(describeRange({ from: 1, to: 3 })).toBe("1-3");
    expect(everyPages(7, 3)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 7 },
    ]);
  });
});

describe("range syntax, before a file is there", () => {
  it("accepts every form the parser takes", () => {
    for (const text of ["", "  ", "1-3, 5; 8-", "-3", "2", "3 - 4", "1,2,3"]) {
      expect(rangeSyntaxProblem(text), text).toBeNull();
    }
  });

  it("names what cannot be a range, so a typo never reaches a file", () => {
    expect(rangeSyntaxProblem("abc")).toBe('"abc" is not a page or a range.');
    expect(rangeSyntaxProblem("1-3, abc")).toBe('"abc" is not a page or a range.');
    expect(rangeSyntaxProblem("5-2")).toBe('"5-2" ends before it starts.');
    expect(rangeSyntaxProblem("0")).toBe('"0" starts before page 1.');
  });
});
