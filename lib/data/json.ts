/**
 * JSON read, formatted, and read as records.
 *
 * `JSON.parse` says where a file broke in whatever words the engine
 * chooses - a byte position in one browser, a line and a column in
 * another - so the position is read out of the message where there is one
 * and turned into a line, a column and the text around it, which is what
 * someone with a broken export needs to see.
 */

export interface JsonProblem {
  message: string;
  /** 1-based, when the position could be read. */
  line: number | null;
  column: number | null;
  /** The text around the problem, on one line. */
  near: string | null;
}

/** Where `JSON.parse` gave up, from the message it threw. */
export function locateJsonError(text: string, error: unknown): JsonProblem {
  const message = error instanceof Error ? error.message : String(error);
  let offset: number | null = null;
  let line: number | null = null;
  let column: number | null = null;
  const byPosition = message.match(/position (\d+)/);
  const byLine = message.match(/line (\d+) column (\d+)/);
  if (byLine) {
    line = Number(byLine[1]);
    column = Number(byLine[2]);
    offset = offsetOf(text, line, column);
  } else {
    // V8 names the token and quotes the text around it but gives no position
    // for most errors; a scan of our own finds where the grammar first breaks.
    offset = byPosition ? Math.min(Number(byPosition[1]), text.length) : scanJsonError(text);
    if (offset !== null) {
      const before = text.slice(0, offset);
      line = before.split("\n").length;
      column = offset - before.lastIndexOf("\n");
    }
  }
  const near = offset === null ? null : text.slice(Math.max(0, offset - 30), offset + 30).replace(/\s+/g, " ").trim();
  return { message: message.replace(/^JSON\.parse: /, ""), line, column, near: near || null };
}

/**
 * The offset at which the text stops being JSON, by a small parser of the
 * grammar, or null when it reads as JSON after all.
 */
export function scanJsonError(text: string): number | null {
  let at = 0;
  const ws = () => {
    while (at < text.length && " \t\n\r".includes(text[at])) at += 1;
  };
  const fail = (): never => {
    throw at;
  };
  const value = (): void => {
    ws();
    const ch = text[at];
    if (ch === "{") {
      at += 1;
      ws();
      if (text[at] === "}") {
        at += 1;
        return;
      }
      for (;;) {
        ws();
        if (text[at] !== '"') fail();
        string();
        ws();
        if (text[at] !== ":") fail();
        at += 1;
        value();
        ws();
        if (text[at] === ",") {
          at += 1;
          continue;
        }
        if (text[at] === "}") {
          at += 1;
          return;
        }
        fail();
      }
    }
    if (ch === "[") {
      at += 1;
      ws();
      if (text[at] === "]") {
        at += 1;
        return;
      }
      for (;;) {
        value();
        ws();
        if (text[at] === ",") {
          at += 1;
          continue;
        }
        if (text[at] === "]") {
          at += 1;
          return;
        }
        fail();
      }
    }
    if (ch === '"') {
      string();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, at)) {
        at += literal.length;
        return;
      }
    }
    const number = text.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number && number[0] !== "") {
      at += number[0].length;
      return;
    }
    fail();
  };
  const string = (): void => {
    at += 1;
    for (;;) {
      if (at >= text.length) fail();
      const ch = text[at];
      if (ch === '"') {
        at += 1;
        return;
      }
      if (ch === "\\") {
        at += 1;
        if (at >= text.length) fail();
        if (text[at] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(at + 1, at + 5))) fail();
          at += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(text[at])) fail();
        at += 1;
        continue;
      }
      if (ch < " ") fail();
      at += 1;
    }
  };
  try {
    value();
    ws();
    if (at < text.length) return at;
    return null;
  } catch (position) {
    return typeof position === "number" ? Math.min(position, text.length) : null;
  }
}

function offsetOf(text: string, line: number, column: number): number {
  let at = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", at);
    if (next === -1) return text.length;
    at = next + 1;
  }
  return Math.min(text.length, at + column - 1);
}

/**
 * The byte-order mark, spelt as a code point so this file stays ASCII.
 *
 * `TextDecoder` drops it, but `File.text()` keeps it, and `JSON.parse`
 * refuses a document that starts with it.
 */
export const BOM = String.fromCharCode(0xfeff);

/** The text without a leading byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The value, or the problem worded for a card. */
export function parseJson(text: string): { value: unknown } | { problem: JsonProblem } {
  const clean = stripBom(text);
  try {
    return { value: JSON.parse(clean) as unknown };
  } catch (error) {
    return { problem: locateJsonError(clean, error) };
  }
}

/** Whether every non-empty line is a JSON value of its own: JSON Lines. */
export function looksLikeJsonLines(text: string): boolean {
  const lines = stripBom(text).split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return false;
  return lines.slice(0, 5).every((line) => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
}

/** Every line's value, with the line number of the first that does not read. */
export function parseJsonLines(text: string): { values: unknown[] } | { problem: JsonProblem } {
  const values: unknown[] = [];
  const lines = stripBom(text).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    try {
      values.push(JSON.parse(line) as unknown);
    } catch (error) {
      const located = locateJsonError(line, error);
      return { problem: { ...located, line: index + 1 } };
    }
  }
  return { values };
}

/** The value with every object's keys in order, at every depth. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export type JsonIndent = 2 | 4 | "tab" | "none";

export const INDENT_OPTIONS: readonly { id: JsonIndent; label: string; blurb: string }[] = [
  { id: 2, label: "Two spaces", blurb: "The usual choice" },
  { id: 4, label: "Four spaces", blurb: "Wider, as some editors default to" },
  { id: "tab", label: "Tabs", blurb: "One tab per level" },
  { id: "none", label: "Minified", blurb: "One line, no spaces: the smallest file" },
];

/** The value written back, indented or on one line, with a final newline unless minified. */
export function formatJson(value: unknown, indent: JsonIndent): string {
  const text = JSON.stringify(value, null, indent === "none" ? undefined : indent === "tab" ? "\t" : indent);
  return indent === "none" ? text : `${text}\n`;
}

/** "an object with 12 keys", "an array of 300 items", "a string". */
export function describeJson(value: unknown): string {
  if (Array.isArray(value)) return `an array of ${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (value === null) return "null";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).length;
    return `an object with ${keys} ${keys === 1 ? "key" : "keys"}`;
  }
  return `a ${typeof value}`;
}

/** How deep the nesting goes. */
export function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  let deepest = 0;
  for (const entry of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    deepest = Math.max(deepest, jsonDepth(entry));
  }
  return deepest + 1;
}
