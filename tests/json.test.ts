import { describe, expect, it } from "vitest";

import { describeJson, formatJson, jsonDepth, locateJsonError, looksLikeJsonLines, parseJson, parseJsonLines, scanJsonError, sortKeysDeep } from "@/lib/data/json";

describe("reading JSON", () => {
  it("parses, dropping a byte-order mark", () => {
    // The mark as a code point, so this file stays ASCII as the policy asks.
    const result = parseJson(`${String.fromCharCode(0xfeff)}{"a": 1}`);
    expect("value" in result && result.value).toEqual({ a: 1 });
  });

  it("says where a broken file broke, from a byte position or a line and column", () => {
    const text = '{\n  "a": 1,\n  "b": }\n';
    const result = parseJson(text);
    if (!("problem" in result)) throw new Error("expected a problem");
    expect(result.problem.line).toBe(3);
    expect(result.problem.column).toBeGreaterThanOrEqual(7);
    expect(result.problem.near).toContain('"b": }');

    const fromPosition = locateJsonError("[1, 2,\n3, oops]", new SyntaxError("Unexpected token o in JSON at position 10"));
    expect(fromPosition).toMatchObject({ line: 2, column: 4 });
    const fromLine = locateJsonError("[1,\n oops]", new SyntaxError("JSON.parse: unexpected character at line 2 column 2 of the JSON data"));
    expect(fromLine).toMatchObject({ line: 2, column: 2, message: "unexpected character at line 2 column 2 of the JSON data" });
    expect(locateJsonError("x", new Error("no clue")).line).toBe(1);
    expect(locateJsonError("[1]", new Error("no clue")).line).toBeNull();
  });

  it("scans for the first place the grammar breaks", () => {
    expect(scanJsonError('{"a": 1}')).toBeNull();
    expect(scanJsonError(' [1, "two", {"three": [true, false, null, -1.5e3]}] ')).toBeNull();
    expect(scanJsonError('{"a": }')).toBe(6);
    expect(scanJsonError("[1, 2,]")).toBe(6);
    expect(scanJsonError('"abc')).toBe(4);
    expect(scanJsonError("{'a': 1}")).toBe(1);
    expect(scanJsonError("[1] x")).toBe(4);
    expect(scanJsonError('"bad \\q escape"')).toBe(6);
    expect(scanJsonError("01")).toBe(1);
  });

  it("recognises and reads JSON Lines", () => {
    expect(looksLikeJsonLines('{"a":1}\n{"a":2}\n')).toBe(true);
    expect(looksLikeJsonLines('{"a":1}')).toBe(false);
    expect(looksLikeJsonLines("{\n}")).toBe(false);
    const read = parseJsonLines('{"a":1}\n\n{"a":2}\n');
    expect("values" in read && read.values).toEqual([{ a: 1 }, { a: 2 }]);
    const broken = parseJsonLines('{"a":1}\n{oops}\n');
    expect("problem" in broken && broken.problem.line).toBe(2);
  });
});

describe("writing JSON", () => {
  it("sorts keys at every depth", () => {
    expect(JSON.stringify(sortKeysDeep({ b: [{ d: 1, c: 2 }], a: null }))).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });

  it("formats at each indent, with a final newline unless minified", () => {
    const value = { a: [1, { b: 2 }] };
    expect(formatJson(value, 2)).toBe('{\n  "a": [\n    1,\n    {\n      "b": 2\n    }\n  ]\n}\n');
    expect(formatJson(value, "tab")).toContain("\n\t\"a\"");
    expect(formatJson(value, 4)).toContain('\n    "a"');
    expect(formatJson(value, "none")).toBe('{"a":[1,{"b":2}]}');
  });

  it("describes a value", () => {
    expect(describeJson([1, 2])).toBe("an array of 2 items");
    expect(describeJson({ a: 1 })).toBe("an object with 1 key");
    expect(describeJson("x")).toBe("a string");
    expect(describeJson(null)).toBe("null");
    expect(jsonDepth({ a: [{ b: 1 }] })).toBe(3);
    expect(jsonDepth(1)).toBe(0);
  });
});
