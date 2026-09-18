import { describe, expect, it } from "vitest";

import { htmlTable, markdownTable, sqlColumnNames, sqlColumnType, sqlIdentifier, sqlLiteral, sqlStatements } from "@/lib/data/export";
import { detectSortKind, findColumn, mergeTables, pieceCount, pieceSuffix, recordsFromRows, sortRows, splitRows } from "@/lib/data/tables";

describe("merging tables", () => {
  it("matches columns by name whatever their order and appends new ones", () => {
    const merged = mergeTables(
      [
        { name: "a.csv", rows: [["id", "name"], ["1", "Ann"]] },
        { name: "b.csv", rows: [["Name", "id", "city"], ["Bob", "2", "Rome"]] },
        { name: "c.csv", rows: [["id", "name"], ["3", "Cy", "extra"]] },
      ],
      { header: true, sourceColumn: false },
    );
    expect(merged.columns).toEqual(["id", "name", "city"]);
    expect(merged.rows).toEqual([["1", "Ann", ""], ["2", "Bob", "Rome"], ["3", "Cy", ""]]);
    expect(merged.added).toEqual(["city"]);
    expect(merged.matching).toBe(2);
  });

  it("names the source file in a first column", () => {
    const merged = mergeTables([{ name: "a.csv", rows: [["source", "x"], ["s", "1"]] }, { name: "b.csv", rows: [["x"], ["2"]] }], { header: true, sourceColumn: true });
    expect(merged.columns).toEqual(["source file", "source", "x"]);
    expect(merged.rows).toEqual([["a.csv", "s", "1"], ["b.csv", "", "2"]]);
  });

  it("stacks headerless rows padded to the widest", () => {
    const merged = mergeTables([{ name: "a", rows: [["1", "2"]] }, { name: "b", rows: [["3", "4", "5"]] }], { header: false, sourceColumn: true });
    expect(merged.columns).toBeNull();
    expect(merged.rows).toEqual([["a", "1", "2", ""], ["b", "3", "4", "5"]]);
  });
});

describe("splitting rows", () => {
  it("repeats the header on every piece", () => {
    const rows = [["h"], ["1"], ["2"], ["3"], ["4"], ["5"]];
    expect(splitRows(rows, true, 2)).toEqual([[["h"], ["1"], ["2"]], [["h"], ["3"], ["4"]], [["h"], ["5"]]]);
    expect(splitRows(rows, false, 4)).toEqual([[["h"], ["1"], ["2"], ["3"]], [["4"], ["5"]]]);
    expect(splitRows([["h"]], true, 10)).toEqual([[["h"]]]);
    expect(pieceCount(5, 2)).toBe(3);
    expect(pieceCount(0, 2)).toBe(1);
    expect(pieceSuffix(2, 12)).toBe("-part-03");
  });
});

describe("sorting rows", () => {
  const header = ["name", "size", "file"];
  const rows = [header, ["pear", "10", "file10"], ["Apple", "9", "file9"], ["fig", "", "file2"], ["apple", "100", "File1"]];

  it("finds a column by number or name", () => {
    expect(findColumn(header, "2", 3)).toBe(1);
    expect(findColumn(header, " Size ", 3)).toBe(1);
    expect(findColumn(header, "4", 3)).toBeNull();
    expect(findColumn(header, "nope", 3)).toBeNull();
    expect(findColumn(null, "colour", 3)).toBeNull();
    expect(findColumn(null, "1", 3)).toBe(0);
  });

  it("works out numbers from text", () => {
    expect(detectSortKind(["1", "2.5", "", "-3e2"])).toBe("number");
    expect(detectSortKind(["1", "two"])).toBe("natural");
    expect(detectSortKind(["", ""])).toBe("natural");
  });

  it("sorts as numbers with empties last, header on top, ties stable", () => {
    expect(sortRows(rows, 1, "asc", "auto", true).map((row) => row[0])).toEqual(["name", "Apple", "pear", "apple", "fig"]);
    expect(sortRows(rows, 1, "desc", "auto", true).map((row) => row[0])).toEqual(["name", "apple", "pear", "Apple", "fig"]);
    expect(sortRows(rows, 0, "asc", "auto", true).map((row) => row[0])).toEqual(["name", "Apple", "apple", "fig", "pear"]);
    expect(sortRows(rows, 2, "asc", "natural", true).map((row) => row[2])).toEqual(["file", "File1", "file2", "file9", "file10"]);
    expect(sortRows(rows, 2, "asc", "text", true).map((row) => row[2])).toEqual(["file", "File1", "file10", "file2", "file9"]);
    expect(sortRows(rows.slice(1), 1, "asc", "number", false).map((row) => row[0])).toEqual(["Apple", "pear", "apple", "fig"]);
    expect(sortRows([["b", "x"], ["a", "x"]], 1, "asc", "text", false)).toEqual([["b", "x"], ["a", "x"]]);
  });
});

describe("records from rows", () => {
  it("keys rows by the header and types the values when asked", () => {
    expect(recordsFromRows([["id", "ok", "note"], ["1", "true", "hi"], ["2", "", "x"]], true, true)).toEqual([
      { id: 1, ok: true, note: "hi" },
      { id: 2, ok: null, note: "x" },
    ]);
    expect(recordsFromRows([["1", "x"]], false, false)).toEqual([{ column1: "1", column2: "x" }]);
  });
});

describe("markdown and html tables", () => {
  const rows = [["name", "qty", "note"], ["pear", "10", "a | b"], ["fig", "2", "two\nlines"]];

  it("writes a padded, aligned markdown table with pipes escaped", () => {
    expect(markdownTable(rows, true)).toBe(["| name | qty | note         |", "| ---- | --: | ------------ |", "| pear |  10 | a \\| b       |", "| fig  |   2 | two<br>lines |"].join("\n").concat("\n"));
    expect(markdownTable([["1", "2"]], false)).toContain("| column1 | column2 |");
    expect(markdownTable([], true)).toBe("");
  });

  it("writes an escaped html table", () => {
    const html = htmlTable([["a<b", "c"], ["&", "\"q\""]], true);
    expect(html).toContain("<th>a&lt;b</th>");
    expect(html).toContain("<td>&amp;</td>");
    expect(html.startsWith("<table>\n  <thead>")).toBe(true);
  });
});

describe("sql", () => {
  it("makes safe identifiers", () => {
    expect(sqlIdentifier("First Name")).toBe("first_name");
    expect(sqlIdentifier("2024 sales")).toBe("column_2024_sales");
    expect(sqlIdentifier("  ", "imported")).toBe("imported");
    expect(sqlColumnNames(["a", "A", "", "a"])).toEqual(["a", "a_2", "column_3", "a_3"]);
  });

  it("infers the narrowest type", () => {
    expect(sqlColumnType(["1", "", "-3"])).toBe("INTEGER");
    expect(sqlColumnType(["1.5", "2"])).toBe("REAL");
    expect(sqlColumnType(["true", "FALSE"])).toBe("BOOLEAN");
    expect(sqlColumnType(["1", "x"])).toBe("TEXT");
    expect(sqlColumnType(["", ""])).toBe("TEXT");
    expect(sqlColumnType(["12345678901234567890"])).toBe("REAL");
  });

  it("writes literals by type and dialect", () => {
    expect(sqlLiteral("", "TEXT", "generic")).toBe("NULL");
    expect(sqlLiteral(" 42 ", "INTEGER", "generic")).toBe("42");
    expect(sqlLiteral("true", "BOOLEAN", "postgres")).toBe("TRUE");
    expect(sqlLiteral("true", "BOOLEAN", "sqlite")).toBe("1");
    expect(sqlLiteral("O'Brien \\ co", "TEXT", "generic")).toBe("'O''Brien \\ co'");
    expect(sqlLiteral("O'Brien \\ co", "TEXT", "mysql")).toBe("'O''Brien \\\\ co'");
  });

  it("writes CREATE TABLE and batched INSERTs", () => {
    const rows = [["id", "name", "price"], ["1", "pear", "1.5"], ["2", "fig", ""], ["3", "plum", "3"]];
    const script = sqlStatements(rows, { table: "Fruit list", dialect: "mysql", header: true, createTable: true, rowsPerInsert: 2 });
    expect(script.columns).toEqual(["id", "name", "price"]);
    expect(script.types).toEqual(["INTEGER", "TEXT", "REAL"]);
    expect(script.rows).toBe(3);
    expect(script.sql).toContain("CREATE TABLE `fruit_list` (\n  `id` INTEGER,\n  `name` TEXT,\n  `price` DOUBLE\n);");
    expect(script.sql.match(/INSERT INTO/g)).toHaveLength(2);
    expect(script.sql).toContain("  (1, 'pear', 1.5),\n  (2, 'fig', NULL);");
    const plain = sqlStatements(rows, { table: "", dialect: "generic", header: true, createTable: false, rowsPerInsert: 500 });
    expect(plain.sql.startsWith('INSERT INTO "imported" ("id", "name", "price") VALUES')).toBe(true);
  });
});
