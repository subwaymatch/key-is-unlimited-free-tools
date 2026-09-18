import { describe, expect, it } from "vitest";

import { cellText, columnNames, CsvParser, csvField, csvLine, detectDelimiter, flattenRecord, recordsOf, rowRecord, tabulate, typedValue, type Delimiter } from "@/lib/data/csv";

function parseWhole(text: string, delimiter: Delimiter = ","): string[][] {
  const parser = new CsvParser(delimiter);
  return [...parser.push(text), ...parser.end()];
}

function parseInChunks(text: string, size: number, delimiter: Delimiter = ","): string[][] {
  const parser = new CsvParser(delimiter);
  const rows: string[][] = [];
  for (let at = 0; at < text.length; at += size) rows.push(...parser.push(text.slice(at, at + size)));
  rows.push(...parser.end());
  return rows;
}

const SAMPLE = 'name,note,n\r\n"Smith, John","He said ""hi""",1\r\nplain,"two\nlines",2\r\n\r\nlast,,3';

describe("the CSV parser", () => {
  it("reads quotes, escaped quotes, line breaks inside fields, CRLF and blank lines", () => {
    expect(parseWhole(SAMPLE)).toEqual([
      ["name", "note", "n"],
      ["Smith, John", 'He said "hi"', "1"],
      ["plain", "two\nlines", "2"],
      ["last", "", "3"],
    ]);
  });

  it("reads the same rows however the text is chunked", () => {
    const whole = parseWhole(SAMPLE);
    for (let size = 1; size <= SAMPLE.length; size += 1) {
      expect(parseInChunks(SAMPLE, size), `chunks of ${size}`).toEqual(whole);
    }
  });

  it("keeps a lone quote in the middle of a field, and text after a closing quote", () => {
    expect(parseWhole('5" tall,"quoted"tail,x')).toEqual([['5" tall', "quotedtail", "x"]]);
  });

  it("takes other delimiters and a file that ends with a line break", () => {
    expect(parseWhole("a\tb\nc\td\n", "\t")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseWhole("a;b\r", ";")).toEqual([["a", "b"]]);
    expect(parseWhole("")).toEqual([]);
    expect(parseWhole("\n\n")).toEqual([]);
  });

  it("counts the rows it has read", () => {
    const parser = new CsvParser(",");
    parser.push("a\nb\nc");
    expect(parser.count).toBe(2);
    parser.end();
    expect(parser.count).toBe(3);
  });
});

describe("detecting the delimiter", () => {
  it("picks the character that appears consistently, ignoring quoted ones", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
    expect(detectDelimiter("a;b;c\n1,5;2;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(detectDelimiter('"Smith, J";1\n"Doe, A";2\n')).toBe(";");
    expect(detectDelimiter("just one column\nand another\n")).toBe(",");
  });

  it("ignores the last line when the sample cuts it short, and falls back to the first line", () => {
    expect(detectDelimiter("a|b|c\n1|2|3\n4|5")).toBe("|");
    expect(detectDelimiter("a,b,c\n1,2\n")).toBe(",");
  });
});

describe("typed values", () => {
  it("turns what JSON would give back unchanged into numbers and booleans", () => {
    expect(typedValue("42")).toBe(42);
    expect(typedValue("-3.5")).toBe(-3.5);
    expect(typedValue("1e3")).toBe(1000);
    expect(typedValue("TRUE")).toBe(true);
    expect(typedValue("false")).toBe(false);
    expect(typedValue("")).toBeNull();
    expect(typedValue("007")).toBe("007");
    expect(typedValue("1,000")).toBe("1,000");
    expect(typedValue("4111111111111111")).toBe("4111111111111111");
    expect(typedValue("2024-01-02")).toBe("2024-01-02");
  });
});

describe("records", () => {
  it("names columns from the header, or makes names up, telling repeats apart", () => {
    expect(columnNames(["a", "", "a"], 3)).toEqual(["a", "column2", "a_2"]);
    expect(columnNames(null, 2)).toEqual(["column1", "column2"]);
    expect(columnNames(["a"], 3)).toEqual(["a", "column2", "column3"]);
  });

  it("builds a record per row, typed or as text", () => {
    expect(rowRecord(["a", "b"], ["1", ""], true)).toEqual({ a: 1, b: null });
    expect(rowRecord(["a", "b"], ["1", ""], false)).toEqual({ a: "1", b: "" });
    expect(rowRecord(["a"], ["1", "x"], false)).toEqual({ a: "1", column2: "x" });
  });
});

describe("writing", () => {
  it("quotes what needs quoting", () => {
    expect(csvField("plain", ",")).toBe("plain");
    expect(csvField("a,b", ",")).toBe('"a,b"');
    expect(csvField("a,b", ";")).toBe("a,b");
    expect(csvField('say "hi"', ",")).toBe('"say ""hi"""');
    expect(csvField("two\nlines", ",")).toBe('"two\nlines"');
    expect(csvField(" padded", ",")).toBe('" padded"');
    expect(csvLine(["a", "b;c"], ";")).toBe('a;"b;c"');
  });

  it("writes cells from any value", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(3)).toBe("3");
    expect(cellText(true)).toBe("true");
    expect(cellText(["a", 1])).toBe("a; 1");
    expect(cellText([{ a: 1 }])).toBe('[{"a":1}]');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });

  it("flattens nested records into dotted names", () => {
    const flat = flattenRecord({ id: 1, address: { city: "Oslo", geo: { lat: 59.9 } }, tags: ["a", "b"] });
    expect([...flat.entries()]).toEqual([
      ["id", "1"],
      ["address.city", "Oslo"],
      ["address.geo.lat", "59.9"],
      ["tags", "a; b"],
    ]);
    expect([...flattenRecord("bare").entries()]).toEqual([["value", "bare"]]);
  });

  it("finds the records in a value", () => {
    expect(recordsOf([{ a: 1 }])).toEqual({ records: [{ a: 1 }], from: "an array" });
    expect(recordsOf({ data: [{ a: 1 }], total: 1 })).toEqual({ records: [{ a: 1 }], from: 'the "data" list' });
    expect(recordsOf({ a: [1], b: [1, 2] }).from).toBe('the "b" list, the longest of 2');
    expect(recordsOf({ a: 1 })).toEqual({ records: [{ a: 1 }], from: "one object" });
    expect(recordsOf("x").records).toEqual([]);
  });

  it("tabulates records into the columns first seen", () => {
    const { columns, rows } = tabulate([{ a: 1, b: 2 }, { b: 3, c: { d: 4 } }]);
    expect(columns).toEqual(["a", "b", "c.d"]);
    expect(rows[1].get("c.d")).toBe("4");
    expect(rows[1].get("a")).toBeUndefined();
  });
});
