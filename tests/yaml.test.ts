import { describe, expect, it } from "vitest";

import { isPlainSafe, parseYaml, resolvePlain, toYaml, YamlError } from "@/lib/data/yaml";

/*
 * The sample and its expected value were checked against PyYAML 6, which
 * agrees on everything but the three places YAML 1.1 and 1.2 differ:
 * PyYAML reads "yes" as true and "-1.5e3" as a string, and 1.2 does not.
 */
const SAMPLE = "# a config\nname: Example App\nversion: 1.20\nbuild: 007\ncount: 42\nhex: 0x1F\nratio: -1.5e3\nenabled: true\nanswer: yes\nnothing: ~\nempty:\ndate: 2026-09-01\nquoted: \"tab\\there \u00e9 \\\"q\\\"\"\nsingle: 'it''s'\nurl: http://example.com:8080/path#frag\ncolon in value: a:b\nlist:\n  - one\n  - two # comment\n  - - nested\n    - pair\nobjects:\n- name: first\n  tags: [a, b, \"c d\"]\n- name: second\n  meta: {x: 1, y: [1, 2], z: }\nliteral: |\n  line one\n    indented\n  line three\nfolded: >-\n  folded\n  text\n\n  new para\nkeep: |+\n  kept\n\nstrip: |-\n  stripped\nbase: &base\n  host: localhost\n  port: 5432\ndev:\n  <<: *base\n  port: 5433\nalias: *base\nmulti line plain: this is\n  continued here\n\"quoted key\": 1\ntagged: !!str 123\nflow: [1, 2.5, null, true, {k: v}]\n";

const EXPECTED = {"name": "Example App", "version": 1.2, "build": 7, "count": 42, "hex": 31, "ratio": -1500, "enabled": true, "answer": "yes", "nothing": null, "empty": null, "date": "2026-09-01", "quoted": "tab\there \u00e9 \"q\"", "single": "it's", "url": "http://example.com:8080/path#frag", "colon in value": "a:b", "list": ["one", "two", ["nested", "pair"]], "objects": [{"name": "first", "tags": ["a", "b", "c d"]}, {"name": "second", "meta": {"x": 1, "y": [1, 2], "z": null}}], "literal": "line one\n  indented\nline three\n", "folded": "folded text\nnew para", "keep": "kept\n\n", "strip": "stripped", "base": {"host": "localhost", "port": 5432}, "dev": {"host": "localhost", "port": 5433}, "alias": {"host": "localhost", "port": 5432}, "multi line plain": "this is continued here", "quoted key": 1, "tagged": "123", "flow": [1, 2.5, null, true, {"k": "v"}]};

describe("reading YAML", () => {
  it("reads every construct a config file uses, as a 1.2 parser does", () => {
    expect(parseYaml(SAMPLE)).toEqual([EXPECTED]);
  });

  it("resolves plain scalars by the core schema", () => {
    expect([resolvePlain("~"), resolvePlain("TRUE"), resolvePlain("0o17"), resolvePlain("0x1f"), resolvePlain(".inf"), resolvePlain("1e3"), resolvePlain("yes"), resolvePlain("12345678901234567890")]).toEqual([null, true, 15, 31, Infinity, 1000, "yes", "12345678901234567890"]);
  });

  it("reads several documents, and a lone scalar", () => {
    expect(parseYaml("a: 1\n---\n- x\n...\n--- plain text\n")).toEqual([{ a: 1 }, ["x"], "plain text"]);
    // An empty stream holds no documents at all, as PyYAML's load_all agrees.
    expect(parseYaml("")).toEqual([]);
    expect(parseYaml("# only a comment\n")).toEqual([]);
  });

  it("says where a file breaks", () => {
    const problem = (text: string) => {
      try {
        parseYaml(text);
      } catch (error) {
        return error as YamlError;
      }
      throw new Error("expected an error");
    };
    expect(problem("a: 1\na: 2\n").message).toBe('Line 2: The key "a" appears twice in this mapping.');
    expect(problem("a: [1, 2\n").message).toMatch(/never closed/);
    expect(problem("a: *nope\n").message).toMatch(/names no anchor/);
    expect(problem("a:\n\tb: 1\n").message).toMatch(/tab/);
    expect(problem("key: \"open\n").message).toMatch(/never closed/);
  });
});

describe("writing YAML", () => {
  it("writes what reads back as the same value", () => {
    const written = toYaml(EXPECTED);
    expect(parseYaml(written)).toEqual([EXPECTED]);
    expect(written).toContain("literal: |\n  line one\n    indented\n  line three\n");
    expect(written).toContain('answer: "yes"');
    expect(written).toContain("objects:\n  - name: first\n    tags:\n      - a\n");
  });

  it("quotes only what needs it", () => {
    expect(["plain", "with space", "a:b", "http://x.y/z"].every(isPlainSafe)).toBe(true);
    expect(["", " lead", "true", "123", "null", "- dash", "a: b", "# hash", "yes", "0755", "multi\nline"].some(isPlainSafe)).toBe(false);
    // "n" is quoted because a YAML 1.1 reader takes it for false.
    expect(toYaml({ list: [], map: {}, n: null, s: "x" })).toBe('list: []\nmap: {}\n"n": null\ns: x\n');
    expect(toYaml([[1, 2], { a: [3] }])).toBe("- - 1\n  - 2\n- a:\n    - 3\n");
  });
});
