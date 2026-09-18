import { describe, expect, it } from "vitest";

import { diffLines, diffStats, diffTexts, firstDifference, splitLines, unifiedDiff, type Edit } from "@/lib/text/diff";

/** The edits applied to `a` give `b`: the one thing every diff has to get right. */
function apply(a: readonly string[], edits: readonly Edit[]): string[] {
  const out: string[] = [];
  let at = 0;
  for (const edit of edits) {
    if (edit.kind === "insert") {
      out.push(edit.text);
    } else {
      if (a[at] !== edit.text) throw new Error(`edit ${edit.kind} "${edit.text}" does not match a[${at}] "${a[at]}"`);
      if (edit.kind === "equal") out.push(edit.text);
      at += 1;
    }
  }
  if (at !== a.length) throw new Error("edits do not consume all of a");
  return out;
}

function random(seed: number, length: number, alphabet: number): string[] {
  let state = seed;
  const out: string[] = [];
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out.push(String.fromCharCode(97 + (state >>> 16) % alphabet));
  }
  return out;
}

describe("diffing lines", () => {
  it("finds the smallest change in the simple cases", () => {
    expect(diffLines(["a", "b", "c"], ["a", "c"])).toEqual([
      { kind: "equal", text: "a" },
      { kind: "delete", text: "b" },
      { kind: "equal", text: "c" },
    ]);
    expect(diffLines(["a", "c"], ["a", "b", "c"])).toEqual([
      { kind: "equal", text: "a" },
      { kind: "insert", text: "b" },
      { kind: "equal", text: "c" },
    ]);
    expect(diffLines([], ["x"])).toEqual([{ kind: "insert", text: "x" }]);
    expect(diffLines(["x"], [])).toEqual([{ kind: "delete", text: "x" }]);
    expect(diffLines([], [])).toEqual([]);
    expect(diffStats(diffLines(["a", "b"], ["b", "c"]))).toEqual({ inserted: 1, deleted: 1, equal: 1 });
  });

  it("uses unique lines as anchors so a moved block reads as a move", () => {
    const a = ["header", "one", "two", "three", "footer"];
    const b = ["header", "three", "one", "two", "footer"];
    const edits = diffLines(a, b);
    expect(apply(a, edits)).toEqual(b);
    expect(diffStats(edits)).toEqual({ inserted: 1, deleted: 1, equal: 4 });
  });

  it("always produces edits that turn one text into the other", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const a = random(seed, 5 + (seed % 40), 2 + (seed % 5));
      const b = random(seed * 7 + 1, 5 + ((seed * 3) % 40), 2 + (seed % 5));
      expect(apply(a, diffLines(a, b)), `seed ${seed}`).toEqual(b);
    }
  });

  it("copes with texts too different to diff cheaply", () => {
    const a = random(1, 6000, 3);
    const b = random(2, 6000, 3).map((line) => `${line}!`);
    const edits = diffLines(a, b);
    expect(apply(a, edits)).toEqual(b);
  });
});

describe("the unified format", () => {
  it("writes hunks the way diff -u does", () => {
    const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
    const b = ["1", "2", "3", "4x", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
    const text = unifiedDiff(diffLines(a, b), "a.txt", "b.txt");
    expect(text).toBe(
      ["--- a.txt", "+++ b.txt", "@@ -1,7 +1,7 @@", " 1", " 2", " 3", "-4", "+4x", " 5", " 6", " 7", "@@ -10,3 +10,4 @@", " 10", " 11", " 12", "+13", ""].join("\n"),
    );
  });

  it("marks a last line without a line break, and merges hunks that touch", () => {
    expect(splitLines("a\nb\nc")).toEqual({ lines: ["a", "b", "c"], finalNewline: false });
    const diff = diffTexts("a\nb\nc", "a\nb\nc\n");
    expect(diff).toMatchObject({ aFinalNewline: false, bFinalNewline: true });
    const text = unifiedDiff(diff.edits, "a", "b", diff);
    expect(text).toBe(["--- a", "+++ b", "@@ -1,3 +1,3 @@", " a", " b", "-c", "\\ No newline at end of file", "+c", ""].join("\n"));

    // Four unchanged lines between two changes fit in one hunk at two lines of context; five do not.
    const near = unifiedDiff(diffLines(["1", "2", "3", "4", "5", "6"], ["1x", "2", "3", "4", "5", "6x"]), "a", "b", { context: 2 });
    expect(near.split("\n").filter((line) => line.startsWith("@@"))).toEqual(["@@ -1,6 +1,6 @@"]);
    const apart = unifiedDiff(diffLines(["1", "2", "3", "4", "5", "6", "7"], ["1x", "2", "3", "4", "5", "6", "7x"]), "a", "b", { context: 2 });
    expect(apart.split("\n").filter((line) => line.startsWith("@@"))).toEqual(["@@ -1,3 +1,3 @@", "@@ -5,3 +5,3 @@"]);
    expect(unifiedDiff([], "a", "b")).toBe("--- a\n+++ b\n");
    expect(splitLines("")).toEqual({ lines: [], finalNewline: true });
  });

  it("finds the first differing byte", () => {
    expect(firstDifference(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(2);
    expect(firstDifference(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(-1);
  });
});
