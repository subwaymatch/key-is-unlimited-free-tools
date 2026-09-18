import { describe, expect, it } from "vitest";

import { cleanRows, DEFAULT_CLEAN_OPTIONS } from "@/lib/data/clean";
import { DISTINCT_CAP, profileReport, Profiler } from "@/lib/data/profile";

describe("profiling columns", () => {
  it("types each column and counts what is in it", () => {
    const profiler = new Profiler(["id", "price", "ok", "when", "city", "blank"]);
    for (const row of [
      ["1", "9.99", "true", "2024-01-02", "Oslo", ""],
      ["2", "10", "FALSE", "2024-01-03T10:00:00Z", "Oslo", ""],
      ["3", "", "true", "2024-02-01", "Bergen", ""],
      ["4", "-1.5e2", "true", "2024-02-02", " Oslo ", ""],
    ]) {
      profiler.add(row);
    }
    const [id, price, ok, when, city, blank] = profiler.finish();
    expect(profiler.rowCount).toBe(4);
    expect(id).toMatchObject({ type: "integer", filled: 4, empty: 0, distinct: 4, min: 1, max: 4, mean: 2.5, minLength: 1, maxLength: 1 });
    expect(price).toMatchObject({ type: "number", filled: 3, empty: 1, min: -150, max: 10 });
    expect(price.mean).toBeCloseTo((9.99 + 10 - 150) / 3, 6);
    expect(ok).toMatchObject({ type: "boolean", distinct: 2 });
    expect(ok.top).toEqual([{ value: "true", count: 3 }, { value: "FALSE", count: 1 }]);
    expect(when).toMatchObject({ type: "date", min: null });
    expect(city).toMatchObject({ type: "text", distinct: 2, minLength: 4, maxLength: 6 });
    expect(city.top[0]).toEqual({ value: "Oslo", count: 3 });
    expect(blank).toMatchObject({ type: "empty", filled: 0, empty: 4, distinct: 0, minLength: 0, maxLength: 0 });
  });

  it("stops counting distinct values at the cap and says so", () => {
    const profiler = new Profiler(["n"]);
    for (let index = 0; index < DISTINCT_CAP + 5; index += 1) profiler.add([String(index)]);
    profiler.add(["0"]);
    const [column] = profiler.finish();
    expect(column.distinct).toBeNull();
    expect(column.top[0]).toEqual({ value: "0", count: 2 });
    expect(column.filled).toBe(DISTINCT_CAP + 6);
  });

  it("writes a report", () => {
    const profiler = new Profiler(["a", "b"]);
    profiler.add(["1", "x"]);
    profiler.add(["2", "x"]);
    const report = profileReport(profiler.finish(), 2, "t.csv");
    expect(report).toContain("2 rows, 2 columns");
    expect(report).toContain("  type: whole numbers");
    expect(report).toContain("  range: 1 to 2, mean 1.5");
    expect(report).toContain('  most common: "x" (2)');
  });
});

describe("cleaning rows", () => {
  const rows = [
    ["name", " city ", "empty"],
    [" Ada ", "Oslo", ""],
    ["Ada", "Oslo", ""],
    ["", "", ""],
    ["Bob", "Bergen"],
    ["Bob", "Bergen", ""],
  ];

  it("trims, drops empty rows, keeps repeats once and pads short rows", () => {
    const result = cleanRows(rows, DEFAULT_CLEAN_OPTIONS);
    expect(result.rows).toEqual([
      ["name", "city", "empty"],
      ["Ada", "Oslo", ""],
      ["Bob", "Bergen", ""],
    ]);
    expect(result).toMatchObject({ trimmed: 2, emptyRows: 1, duplicates: 2, padded: 1, emptyColumns: [] });
  });

  it("drops columns with nothing under the header, by name", () => {
    const result = cleanRows(rows, { ...DEFAULT_CLEAN_OPTIONS, dropEmptyColumns: true });
    expect(result.rows[0]).toEqual(["name", "city"]);
    expect(result.rows[1]).toEqual(["Ada", "Oslo"]);
    expect(result.emptyColumns).toEqual(["empty"]);
  });

  it("leaves things alone when asked to", () => {
    const result = cleanRows(rows, { trim: false, dropEmptyRows: false, dedupe: false, dropEmptyColumns: false, header: false });
    expect(result.rows).toHaveLength(6);
    expect(result.rows[1]).toEqual([" Ada ", "Oslo", ""]);
    expect(result).toMatchObject({ trimmed: 0, emptyRows: 0, duplicates: 0 });
  });
});
