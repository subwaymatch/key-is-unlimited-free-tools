/**
 * YAML read into plain values and written back, for converting to and
 * from JSON.
 *
 * Reads what configuration files use: block mappings and sequences nested
 * by indentation, flow collections, plain, single- and double-quoted
 * scalars that may run across lines, literal and folded block scalars with
 * their chomping indicators, anchors, aliases and merge keys, the standard
 * tags, comments, and several documents in one file. Scalars resolve by
 * YAML 1.2's core schema, which JSON matches: yes and no are strings, as
 * they are in Kubernetes, GitHub Actions and every 1.2 parser.
 *
 * Writing goes the other way, from any JSON value: plain scalars where they
 * read back unchanged, quotes where they would not, literal blocks for text
 * with line breaks.
 */

export class YamlError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
    this.name = "YamlError";
    this.line = line;
  }
}

interface Line {
  indent: number;
  text: string;
  raw: string;
  number: number;
}

/* ---- Scalars ------------------------------------------------------------- */

const INT = /^[-+]?[0-9]+$/;
const FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;

/** A plain scalar as the core schema reads it. */
export function resolvePlain(text: string): unknown {
  if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (text === "true" || text === "True" || text === "TRUE") return true;
  if (text === "false" || text === "False" || text === "FALSE") return false;
  if (INT.test(text)) {
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : text;
  }
  if (/^0o[0-7]+$/.test(text)) return parseInt(text.slice(2), 8);
  if (/^0x[0-9a-fA-F]+$/.test(text)) return parseInt(text.slice(2), 16);
  if (FLOAT.test(text)) return Number(text);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return Number.NaN;
  return text;
}

function applyTag(tag: string | null, value: unknown, raw: string): unknown {
  if (!tag) return value;
  switch (tag) {
    case "!!str":
      return value === null ? "" : typeof value === "string" ? value : raw;
    case "!!int":
      return typeof value === "number" ? Math.trunc(value) : Number.parseInt(String(value), 10);
    case "!!float":
      return Number(value);
    case "!!bool":
      return value === true || String(value).toLowerCase() === "true";
    case "!!null":
      return null;
    default:
      // !!binary, !!timestamp and application tags keep their text.
      return value;
  }
}

const ESCAPES: Record<string, string> = { "0": "\u0000", a: "\u0007", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\u000b", f: "\f", r: "\r", e: "\u001b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029" };

/** A double-quoted scalar's content with its escapes and line folding undone. */
function unescapeDouble(body: string, line: number): string {
  // Line breaks inside quotes fold to spaces, blank lines to newlines, and an escaped break joins.
  const folded = body.replace(/\\\r?\n[ \t]*/g, "").replace(/[ \t]*\r?\n[ \t]*/g, "\n").replace(/\n(\n*)/g, (_, more: string) => (more.length > 0 ? more : " "));
  let out = "";
  for (let index = 0; index < folded.length; index += 1) {
    const ch = folded[index];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = folded[index + 1];
    if (next === "x" || next === "u" || next === "U") {
      const length = next === "x" ? 2 : next === "u" ? 4 : 8;
      const hex = folded.slice(index + 2, index + 2 + length);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== length) throw new YamlError(`\\${next} must be followed by ${length} hex digits.`, line);
      out += String.fromCodePoint(parseInt(hex, 16));
      index += 1 + length;
      continue;
    }
    if (next === undefined || !(next in ESCAPES)) throw new YamlError(`\\${next ?? ""} is not an escape YAML knows.`, line);
    out += ESCAPES[next];
    index += 1;
  }
  return out;
}

function unescapeSingle(body: string): string {
  return body.replace(/[ \t]*\r?\n[ \t]*/g, "\n").replace(/\n(\n*)/g, (_, more: string) => (more.length > 0 ? more : " ")).replace(/''/g, "'");
}

/** Where a comment starts in a line, outside quotes, or -1. */
function commentStart(text: string): number {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      if (ch === quote && !(quote === '"' && text[index - 1] === "\\")) {
        if (quote === "'" && text[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && (index === 0 || /[\s[{,:]/.test(text[index - 1]))) quote = ch;
    else if (ch === "#" && (index === 0 || /\s/.test(text[index - 1]))) return index;
  }
  return -1;
}

function withoutComment(text: string): string {
  const at = commentStart(text);
  return (at < 0 ? text : text.slice(0, at)).trimEnd();
}

/* ---- The parser ---------------------------------------------------------- */

class Parser {
  private readonly lines: Line[];
  private position = 0;
  private readonly anchors = new Map<string, unknown>();

  constructor(source: string) {
    this.lines = source
      .replace(/^\ufeff/, "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((raw, index) => {
        const indent = raw.length - raw.replace(/^ +/, "").length;
        if (/^ *\t/.test(raw) && raw.trim() !== "" && !raw.trimStart().startsWith("#")) {
          // Tabs may not indent YAML, but a tab after the indentation is fine.
          const tabAt = raw.indexOf("\t");
          if (tabAt < indent + 1 && raw.slice(0, tabAt).trim() === "") throw new YamlError("A tab is used for indentation, which YAML does not allow; use spaces.", index + 1);
        }
        return { indent, text: raw.slice(indent), raw, number: index + 1 };
      });
  }

  private blank(line: Line): boolean {
    return line.text.trim() === "" || line.text.startsWith("#");
  }

  private boundary(line: Line): boolean {
    return line.indent === 0 && (/^---(\s|$)/.test(line.text) || /^\.\.\.(\s|$)/.test(line.text));
  }

  /** The next line with something on it, within the current document. */
  private peek(): Line | null {
    while (this.position < this.lines.length && this.blank(this.lines[this.position])) this.position += 1;
    const line = this.lines[this.position];
    if (!line || this.boundary(line)) return null;
    return line;
  }

  documents(): unknown[] {
    const documents: unknown[] = [];
    for (;;) {
      while (this.position < this.lines.length && (this.blank(this.lines[this.position]) || this.lines[this.position].text.startsWith("%"))) this.position += 1;
      if (this.position >= this.lines.length) break;
      const line = this.lines[this.position];
      let explicit = false;
      if (/^\.\.\.(\s|$)/.test(line.text) && line.indent === 0) {
        this.position += 1;
        continue;
      }
      if (/^---(\s|$)/.test(line.text) && line.indent === 0) {
        explicit = true;
        const rest = withoutComment(line.text.slice(3)).trim();
        if (rest === "") this.position += 1;
        else {
          // Content on the marker line: "--- |" or "--- value".
          line.text = line.text.slice(3).trimStart();
          line.indent = line.raw.length - line.text.length;
        }
      }
      this.anchors.clear();
      const value = this.peek() ? this.block(-1) : null;
      if (explicit || value !== null || documents.length === 0) documents.push(value);
      const next = this.lines[this.position];
      if (next && !this.boundary(next) && !this.blank(next)) throw new YamlError(`Unexpected content: "${next.text.slice(0, 40)}". Check its indentation.`, next.number);
    }
    return documents;
  }

  /** A node indented more than `parent`. */
  private block(parent: number): unknown {
    const line = this.peek();
    if (!line || line.indent <= parent) return null;
    // Node properties alone on a line: "&anchor" or "!!tag" before a block.
    const properties = /^((?:[&!][^\s]*\s*)+)$/.exec(withoutComment(line.text));
    if (properties) {
      const { anchor, tag } = this.readProperties(properties[1]);
      this.position += 1;
      const next = this.peek();
      const value = next && (next.indent > line.indent || (next.indent === line.indent && this.isItem(next.text))) ? this.block(line.indent - (this.isItem(next.text) ? 1 : 0)) : null;
      const tagged = applyTag(tag, value, "");
      if (anchor) this.anchors.set(anchor, tagged);
      return tagged;
    }
    if (this.isItem(line.text)) return this.sequence(line.indent);
    if (this.keyOf(line.text) !== null) return this.mapping(line.indent);
    this.position += 1;
    return this.value(line.text, line.indent - 1, line);
  }

  private isItem(text: string): boolean {
    return text === "-" || text.startsWith("- ") || text.startsWith("-\t");
  }

  /** A mapping line's key and the rest of the line, or null when it is not one. */
  private keyOf(text: string): { key: string; rest: string } | null {
    if (text.startsWith("? ")) return null;
    let at = 0;
    let key: string;
    if (text[0] === '"' || text[0] === "'") {
      const quote = text[0];
      at = 1;
      while (at < text.length) {
        if (text[at] === quote) {
          if (quote === "'" && text[at + 1] === "'") at += 2;
          else break;
        } else at += text[at] === "\\" && quote === '"' ? 2 : 1;
      }
      if (at >= text.length) return null;
      const body = text.slice(1, at);
      key = quote === '"' ? unescapeDouble(body, 0) : unescapeSingle(body);
      at += 1;
      const after = text.slice(at).replace(/^[ \t]*/, "");
      if (!after.startsWith(":") || !(after.length === 1 || /\s/.test(after[1]))) return null;
      return { key, rest: after.slice(1) };
    }
    if (/^[[{]/.test(text) || text.startsWith("#") || text.startsWith("&") || text.startsWith("*") || text.startsWith("!") || text.startsWith("|") || text.startsWith(">")) return null;
    let depth = 0;
    for (at = 0; at < text.length; at += 1) {
      const ch = text[at];
      if (ch === "[" || ch === "{") depth += 1;
      else if (ch === "]" || ch === "}") depth -= 1;
      else if (ch === "#" && at > 0 && /\s/.test(text[at - 1])) return null;
      else if (ch === ":" && depth <= 0 && (at === text.length - 1 || /\s/.test(text[at + 1]))) {
        return { key: text.slice(0, at).trimEnd(), rest: text.slice(at + 1) };
      }
    }
    return null;
  }

  private sequence(indent: number): unknown[] {
    const items: unknown[] = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent || !this.isItem(line.text)) break;
      const content = line.text.slice(1).replace(/^[ \t]+/, "");
      if (withoutComment(content) === "") {
        this.position += 1;
        items.push(this.block(indent));
        continue;
      }
      // The item's content is a node of its own starting at its column.
      line.indent = indent + (line.text.length - content.length);
      line.text = content;
      items.push(this.block(indent));
    }
    return items;
  }

  private mapping(indent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const explicit = new Set<string>();
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent) break;
      if (this.isItem(line.text)) throw new YamlError("A list item is at the same indentation as the keys around it; indent it under its key.", line.number);
      const found = this.keyOf(line.text);
      if (!found) throw new YamlError(`Expected "key: value" here, found "${line.text.slice(0, 40)}".`, line.number);
      this.position += 1;
      const key = found.key;
      const value = this.value(found.rest, indent, line);
      if (key === "<<") {
        // A merge key brings in another mapping's keys, which keys written here override.
        const sources = Array.isArray(value) ? value : [value];
        for (const source of sources) {
          if (!source || typeof source !== "object" || Array.isArray(source)) throw new YamlError("A merge key (<<) must name a mapping or a list of mappings.", line.number);
          for (const [mergedKey, mergedValue] of Object.entries(source as Record<string, unknown>)) if (!explicit.has(mergedKey) && !(mergedKey in out)) out[mergedKey] = mergedValue;
        }
        continue;
      }
      if (explicit.has(key)) throw new YamlError(`The key "${key}" appears twice in this mapping.`, line.number);
      explicit.add(key);
      out[key] = value;
    }
    return out;
  }

  private readProperties(text: string): { anchor: string | null; tag: string | null; rest: string } {
    let anchor: string | null = null;
    let tag: string | null = null;
    let rest = text.trimStart();
    for (;;) {
      const match = /^([&!])([^\s,[\]{}]*)\s*/.exec(rest);
      if (!match) break;
      if (match[1] === "&") anchor = match[2];
      else tag = `!${match[2]}`;
      rest = rest.slice(match[0].length);
    }
    return { anchor, tag, rest };
  }

  /** The value after a key or on a line of its own, which may continue on the lines below. */
  private value(text: string, indent: number, line: Line): unknown {
    const { anchor, tag, rest: afterProperties } = this.readProperties(text);
    const rest = withoutComment(afterProperties).trim();
    let value: unknown;
    let raw = rest;
    if (rest === "") {
      const next = this.peek();
      if (next && next.indent > indent) value = this.block(indent);
      else if (next && next.indent === indent && this.isItem(next.text)) value = this.sequence(indent);
      else value = null;
      raw = "";
    } else if (rest[0] === "|" || rest[0] === ">") {
      value = this.blockScalar(rest, indent, line);
      raw = String(value);
    } else if (rest[0] === "*") {
      const name = rest.slice(1);
      if (!this.anchors.has(name)) throw new YamlError(`The alias *${name} names no anchor defined above it.`, line.number);
      value = this.anchors.get(name);
    } else if (rest[0] === "[" || rest[0] === "{") {
      const text = this.gatherFlow(afterProperties.trim(), indent, line);
      value = new FlowParser(text, line.number, this.anchors).parse();
    } else if (rest[0] === '"' || rest[0] === "'") {
      const quoted = this.gatherQuoted(afterProperties.trim(), line);
      value = quoted;
      raw = quoted;
    } else {
      // A plain scalar, folded across the more-indented lines that follow it.
      const parts = [rest];
      for (;;) {
        const next = this.lines[this.position];
        if (!next || this.boundary(next)) break;
        if (next.text.trim() === "") {
          const after = this.lines.slice(this.position + 1).find((candidate) => candidate.text.trim() !== "");
          if (after && after.indent > indent && !after.text.startsWith("#")) {
            parts.push("\n");
            this.position += 1;
            continue;
          }
          break;
        }
        if (next.indent <= indent || next.text.startsWith("#") || (this.keyOf(next.text) !== null && next.indent <= indent + 1)) break;
        parts.push(withoutComment(next.text).trim());
        this.position += 1;
      }
      raw = parts.reduce((out, part) => (part === "\n" ? `${out}\n` : out === "" || out.endsWith("\n") ? out + part : `${out} ${part}`), "").replace(/ \n/g, "\n");
      value = tag === "!!str" || parts.length > 1 ? raw : resolvePlain(raw);
      if (parts.length > 1 && tag !== "!!str") value = raw;
    }
    const tagged = applyTag(tag, value, raw);
    if (anchor) this.anchors.set(anchor, tagged);
    return tagged;
  }

  private gatherFlow(start: string, indent: number, line: Line): string {
    let text = start;
    const balanced = (candidate: string) => {
      let depth = 0;
      let quote: string | null = null;
      for (let index = 0; index < candidate.length; index += 1) {
        const ch = candidate[index];
        if (quote) {
          if (ch === quote && candidate[index - 1] !== "\\") quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "[" || ch === "{") depth += 1;
        else if (ch === "]" || ch === "}") depth -= 1;
        else if (ch === "#" && /\s/.test(candidate[index - 1] ?? " ")) return depth <= 0;
      }
      return depth <= 0;
    };
    while (!balanced(text)) {
      const next = this.lines[this.position];
      if (!next || this.boundary(next)) throw new YamlError("A [ or { is never closed.", line.number);
      text += ` ${withoutComment(next.text).trim()}`;
      this.position += 1;
    }
    void indent;
    return withoutComment(text).trim();
  }

  private gatherQuoted(start: string, line: Line): string {
    const quote = start[0];
    let text = start;
    const closes = (candidate: string) => {
      for (let index = 1; index < candidate.length; index += 1) {
        if (quote === '"' && candidate[index] === "\\") {
          index += 1;
          continue;
        }
        if (candidate[index] === quote) {
          if (quote === "'" && candidate[index + 1] === "'") {
            index += 1;
            continue;
          }
          return index;
        }
      }
      return -1;
    };
    while (closes(text) < 0) {
      const next = this.lines[this.position];
      if (!next) throw new YamlError(`A ${quote === '"' ? "double" : "single"}-quoted string is never closed.`, line.number);
      text += `\n${next.raw}`;
      this.position += 1;
    }
    const end = closes(text);
    const trailing = withoutComment(text.slice(end + 1)).trim();
    if (trailing !== "") throw new YamlError(`Unexpected text after a quoted string: "${trailing.slice(0, 30)}".`, line.number);
    const body = text.slice(1, end);
    return quote === '"' ? unescapeDouble(body, line.number) : unescapeSingle(body);
  }

  /** A literal (|) or folded (>) block, with its chomping and indentation indicators. */
  private blockScalar(header: string, indent: number, line: Line): string {
    const match = /^([|>])([1-9]?)([+-]?)([1-9]?)\s*$/.exec(header);
    if (!match) throw new YamlError(`"${header}" is not a block scalar header.`, line.number);
    const literal = match[1] === "|";
    const chomp = match[3] || "";
    const explicit = Number(match[2] || match[4] || 0);
    const body: string[] = [];
    let contentIndent = explicit > 0 ? Math.max(0, indent) + explicit : -1;
    while (this.position < this.lines.length) {
      const next = this.lines[this.position];
      if (next.raw.trim() === "") {
        body.push("");
        this.position += 1;
        continue;
      }
      if (this.boundary(next)) break;
      if (contentIndent < 0) {
        if (next.indent <= indent) break;
        contentIndent = next.indent;
      }
      if (next.indent < contentIndent) break;
      body.push(next.raw.slice(contentIndent));
      this.position += 1;
    }
    // Trailing blank lines belong to the chomping, and the lines after them to whatever comes next.
    let trailing = 0;
    while (body.length > 0 && body[body.length - 1] === "") {
      body.pop();
      trailing += 1;
    }
    let text: string;
    if (literal) text = body.join("\n");
    else {
      text = "";
      for (let index = 0; index < body.length; index += 1) {
        const current = body[index];
        const previous = body[index - 1];
        if (index === 0) text = current;
        else if (current === "") text += "\n";
        else if (previous === "" || /^\s/.test(current) || /^\s/.test(previous ?? "")) text += (previous === "" ? "" : "\n") + current;
        else text += ` ${current}`;
      }
    }
    if (body.length === 0) return chomp === "+" ? "\n".repeat(trailing) : "";
    if (chomp === "-") return text;
    if (chomp === "+") return `${text}\n${"\n".repeat(trailing)}`;
    return `${text}\n`;
  }
}

/* ---- Flow collections ---------------------------------------------------- */

class FlowParser {
  private at = 0;

  constructor(
    private readonly text: string,
    private readonly line: number,
    private readonly anchors: Map<string, unknown>,
  ) {}

  parse(): unknown {
    const value = this.node();
    this.space();
    if (this.at < this.text.length) throw new YamlError(`Unexpected "${this.text.slice(this.at, this.at + 20)}" after a flow collection.`, this.line);
    return value;
  }

  private space() {
    while (this.at < this.text.length && /\s/.test(this.text[this.at])) this.at += 1;
  }

  private node(): unknown {
    this.space();
    let anchor: string | null = null;
    let tag: string | null = null;
    while (this.text[this.at] === "&" || this.text[this.at] === "!") {
      const match = /^[&!][^\s,[\]{}]*/.exec(this.text.slice(this.at))!;
      if (match[0][0] === "&") anchor = match[0].slice(1);
      else tag = `!${match[0].slice(1)}`;
      this.at += match[0].length;
      this.space();
    }
    const ch = this.text[this.at];
    let value: unknown;
    let raw = "";
    if (ch === "[") value = this.sequence();
    else if (ch === "{") value = this.mapping();
    else if (ch === "*") {
      const match = /^\*([^\s,[\]{}]+)/.exec(this.text.slice(this.at))!;
      this.at += match[0].length;
      if (!this.anchors.has(match[1])) throw new YamlError(`The alias *${match[1]} names no anchor defined above it.`, this.line);
      value = this.anchors.get(match[1]);
    } else if (ch === '"' || ch === "'") {
      raw = this.quoted();
      value = raw;
    } else {
      raw = this.plain();
      value = resolvePlain(raw);
    }
    const tagged = applyTag(tag, value, raw);
    if (anchor) this.anchors.set(anchor, tagged);
    return tagged;
  }

  private quoted(): string {
    const quote = this.text[this.at];
    let index = this.at + 1;
    while (index < this.text.length) {
      if (quote === '"' && this.text[index] === "\\") index += 2;
      else if (this.text[index] === quote) {
        if (quote === "'" && this.text[index + 1] === "'") index += 2;
        else break;
      } else index += 1;
    }
    if (index >= this.text.length) throw new YamlError("A quoted string in a flow collection is never closed.", this.line);
    const body = this.text.slice(this.at + 1, index);
    this.at = index + 1;
    return quote === '"' ? unescapeDouble(body, this.line) : unescapeSingle(body);
  }

  private plain(): string {
    const start = this.at;
    while (this.at < this.text.length) {
      const ch = this.text[this.at];
      if (ch === "," || ch === "]" || ch === "}") break;
      if (ch === ":" && (this.at + 1 >= this.text.length || /[\s,\]}]/.test(this.text[this.at + 1]))) break;
      this.at += 1;
    }
    return this.text.slice(start, this.at).trim();
  }

  private sequence(): unknown[] {
    this.at += 1;
    const items: unknown[] = [];
    for (;;) {
      this.space();
      if (this.text[this.at] === "]") {
        this.at += 1;
        return items;
      }
      const item = this.node();
      this.space();
      if (this.text[this.at] === ":") {
        // A single-pair mapping inside a flow sequence: [a: 1].
        this.at += 1;
        items.push({ [String(item)]: this.node() });
        this.space();
      } else items.push(item);
      if (this.text[this.at] === ",") this.at += 1;
      else if (this.text[this.at] !== "]") throw new YamlError("Expected , or ] in a flow sequence.", this.line);
    }
  }

  private mapping(): Record<string, unknown> {
    this.at += 1;
    const out: Record<string, unknown> = {};
    for (;;) {
      this.space();
      if (this.text[this.at] === "}") {
        this.at += 1;
        return out;
      }
      const key = this.node();
      this.space();
      let value: unknown = null;
      if (this.text[this.at] === ":") {
        this.at += 1;
        this.space();
        value = this.text[this.at] === "," || this.text[this.at] === "}" ? null : this.node();
        this.space();
      }
      out[String(key)] = value;
      if (this.text[this.at] === ",") this.at += 1;
      else if (this.text[this.at] !== "}") throw new YamlError("Expected , or } in a flow mapping.", this.line);
    }
  }
}

/** Every document in a YAML text. */
export function parseYaml(source: string): unknown[] {
  return new Parser(source).documents();
}

/* ---- Writing ------------------------------------------------------------- */

const INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

/** Whether a string can be written without quotes and read back as the same string. */
export function isPlainSafe(text: string): boolean {
  if (text === "" || text !== text.trim() || /[\n\r\t]/.test(text)) return false;
  if (INDICATOR.test(text) && !/^[-?:][^\s]/.test(text)) return false;
  if (/^[-?:]\s/.test(text) || text === "-" || text === "?" || text === ":") return false;
  if (/: |:$| #/.test(text)) return false;
  if (/[\u0000-\u001f\u007f\u0080-\u009f\ufeff]/.test(text)) return false;
  if (resolvePlain(text) !== text) return false;
  // Values YAML 1.1 parsers read as booleans or octals; quoting them costs nothing.
  if (/^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|0[0-7]+)$/.test(text)) return false;
  return true;
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/[\u0000-\u001f\u007f]/g, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`)}"`;
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isNaN(value) ? ".nan" : value === Infinity ? ".inf" : value === -Infinity ? "-.inf" : String(value);
  const text = String(value);
  return isPlainSafe(text) ? text : quote(text);
}

function keyText(key: string): string {
  return isPlainSafe(key) ? key : quote(key);
}

/** A multi-line string as a literal block, when it can be one; `indent` is its content's indentation. */
function literalBlock(text: string, indent: string): string | null {
  if (!text.includes("\n") || /^[\s]/.test(text) || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) return null;
  const chomp = text.endsWith("\n\n") ? "+" : text.endsWith("\n") ? "" : "-";
  const body = chomp === "-" ? text : text.slice(0, -1);
  return `|${chomp}\n${body.split("\n").map((line) => (line === "" ? "" : indent + line)).join("\n")}`;
}

function isContainer(value: unknown): value is object {
  return value !== null && typeof value === "object" && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0);
}

function inline(value: unknown, indent: string): string {
  if (Array.isArray(value)) return "[]";
  if (value !== null && typeof value === "object") return "{}";
  if (typeof value === "string") return literalBlock(value, indent) ?? scalar(value);
  return scalar(value);
}

/** The lines of a mapping or a sequence written as a block at an indentation. */
function blockLines(value: object, indent: string): string[] {
  const lines: string[] = [];
  const deeper = `${indent}  `;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isContainer(item)) {
        // A mapping or list inside a list starts on the dash's own line.
        const nested = blockLines(item, deeper);
        lines.push(`${indent}- ${nested[0].slice(deeper.length)}`, ...nested.slice(1));
      } else lines.push(`${indent}- ${inline(item, deeper)}`);
    }
    return lines;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isContainer(item)) lines.push(`${indent}${keyText(key)}:`, ...blockLines(item, deeper));
    else lines.push(`${indent}${keyText(key)}: ${inline(item, deeper)}`);
  }
  return lines;
}

/** Any JSON value as YAML, two spaces to a level. */
export function toYaml(value: unknown): string {
  return `${(isContainer(value) ? blockLines(value, "") : [inline(value, "  ")]).join("\n")}\n`;
}
