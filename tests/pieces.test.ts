import { describe, expect, it } from "vitest";

import { describePiece, describeRule, MAX_PIECES, parsePieceMinutes, pieceFormat, pieceFormatIds, pieceFormats, pieceRanges } from "@/lib/engine/pieces";
import { formatSeconds } from "@/lib/engine/trim";

import { context, joined, MP3, probe } from "./fixtures";

describe("equal parts", () => {
  it("describes a rule and reads a typed length", () => {
    expect(describeRule({ kind: "length", seconds: 600 })).toBe("every 10 minutes");
    expect(describeRule({ kind: "length", seconds: 60 })).toBe("every minute");
    expect(describeRule({ kind: "length", seconds: 3600 })).toBe("every hour");
    expect(describeRule({ kind: "length", seconds: 150 })).toBe("every 2.5 minutes");
    expect(describeRule({ kind: "count", count: 4 })).toBe("into 4 parts");
    expect(parsePieceMinutes(2.5)).toBe(150);
    expect(parsePieceMinutes(0)).toBeNull();
  });

  it("cuts a length into pieces, folding a tiny tail into the last one", () => {
    expect(pieceRanges(600, { kind: "length", seconds: 250 })).toEqual([
      { startSeconds: 0, endSeconds: 250 },
      { startSeconds: 250, endSeconds: 500 },
      { startSeconds: 500, endSeconds: 600 },
    ]);
    expect(pieceRanges(600.4, { kind: "length", seconds: 60 })).toHaveLength(10);
    expect(pieceRanges(600.4, { kind: "length", seconds: 60 })[9]).toEqual({ startSeconds: 540, endSeconds: 600.4 });
    expect(pieceRanges(100, { kind: "count", count: 4 })).toEqual([
      { startSeconds: 0, endSeconds: 25 },
      { startSeconds: 25, endSeconds: 50 },
      { startSeconds: 50, endSeconds: 75 },
      { startSeconds: 75, endSeconds: 100 },
    ]);
    expect(pieceRanges(null, { kind: "count", count: 4 })).toEqual([]);
    expect(pieceRanges(100_000, { kind: "length", seconds: 1 })).toHaveLength(MAX_PIECES);
    expect(describePiece(pieceRanges(600, { kind: "length", seconds: 250 }), 2)).toBe("Part 3 of 3: 8:20 to 10:00");
    expect(describePiece(pieceRanges(6.03, { kind: "count", count: 3 }), 1)).toBe("Part 2 of 3: 0:02 to 0:04");
  });

  it("offers one format per piece and labels each by its range", () => {
    const rule = { kind: "length" as const, seconds: 250 };
    expect(pieceFormats(rule)).toHaveLength(MAX_PIECES);
    expect(pieceFormatIds(rule)(probe())).toEqual(["part-1", "part-2", "part-3"]);
    expect(pieceFormat(2, rule).offer?.(probe(), context())).toBe(true);
    expect(pieceFormat(3, rule).offer?.(probe(), context())).toBe(false);
    expect(pieceFormat(1, rule).describe?.(probe())).toBe("Part 2 of 3: 4:10 to 8:20");
  });

  it("copies a piece's range, seeking before the input", () => {
    const rule = { kind: "count" as const, count: 3 };
    const plan = pieceFormat(1, rule).plan(probe({ video: null, audio: MP3, durationSeconds: 300 }), context({ sourceExtension: "mp3" }));
    expect(plan.inputArgs).toEqual(["-ss", formatSeconds(100)]);
    expect(joined(plan.args)).toBe(`-map 0:a:0 -vn -sn -dn -t ${formatSeconds(100)} -c copy -avoid_negative_ts make_zero -map_chapters -1`);
    expect(plan.extension).toBe("mp3");
    expect(plan.mode).toBe("copy");
    expect(plan.kind).toBe("audio");
    expect(plan.fileSuffix).toBe("-part02");
    expect(plan.durationFactor).toBeCloseTo(1 / 3, 6);

    const first = pieceFormat(0, rule).plan(probe({ durationSeconds: 300 }), context());
    expect(first.inputArgs).toEqual([]);
    expect(joined(first.args)).toContain("-map 0:v:0 -map 0:a? -map 0:s? -dn -t");
    expect(first.kind).toBe("video");
  });

  it("refuses an unknown length, a file too short to cut, a missing part, and one past the ceiling", () => {
    const rule = { kind: "length" as const, seconds: 600 };
    expect(pieceFormat(0, rule).blocker?.(probe({ durationSeconds: null }), context())?.message).toMatch(/length is unknown/);
    expect(pieceFormat(0, rule).blocker?.(probe({ durationSeconds: 500 }), context())?.severity).toBe("info");
    expect(pieceFormat(5, rule).blocker?.(probe({ durationSeconds: 1500 }), context())?.message).toBe("This file has no part 6.");
    expect(pieceFormat(0, rule).blocker?.(probe({ durationSeconds: 1500 }), context())).toBeNull();
    expect(pieceFormat(0, rule).blocker?.(probe({ durationSeconds: 1200 }), context({ fileBytes: 4_000_000_000 }))?.message).toMatch(/^This part would be about/);
  });
});
