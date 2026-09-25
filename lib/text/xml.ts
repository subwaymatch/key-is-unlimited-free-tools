/**
 * XML read into a tree and written back, by hand.
 *
 * The browser has `DOMParser`, but a worker and Node do not, it reports a
 * broken file as a document containing an error element rather than as a
 * position, and it forgets how the file was written: which entity was used,
 * where the comments were, whether an empty element closed itself. The
 * formatter, the JSON converter, the SVG cleaner, the GPS converter and the
 * e-book reader all want the tree and the original spelling both, so this
 * keeps each node's raw text beside its meaning.
 *
 * It reads well-formed XML 1.0 and says where a file is not: a closing tag
 * that does not match, an attribute with no quotes, a bare ampersand, a
 * second root. It does not read a DTD beyond skipping it, so an entity a
 * DTD declares is kept as written rather than expanded.
 */

export interface XmlAttribute {
  name: string;
  /** With the entities expanded. */
  value: string;
  /** As written between the quotes. */
  raw: string;
}

export interface XmlElement {
  type: "element";
  name: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  /** Written as `<name/>` rather than `<name></name>`. */
  selfClosing: boolean;
}

export interface XmlText {
  type: "text";
  /** With the entities expanded. */
  text: string;
  raw: string;
}

export interface XmlCData {
  type: "cdata";
  text: string;
}

export interface XmlComment {
  type: "comment";
  text: string;
}

export interface XmlInstruction {
  type: "instruction";
  target: string;
  data: string;
}

export interface XmlDoctype {
  type: "doctype";
  /** Everything between `<!DOCTYPE` and the closing `>`. */
  raw: string;
}

export type XmlNode = XmlElement | XmlText | XmlCData | XmlComment | XmlInstruction | XmlDoctype;

export interface XmlDocument {
  /** Everything at the top level, the root element among it. */
  children: XmlNode[];
  root: XmlElement;
}

/** Where a file stops being XML, with the position a person can find. */
export class XmlError extends Error {
  readonly line: number;
  readonly column: number;
  readonly near: string;

  constructor(message: string, text: string, offset: number) {
    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    super(message);
    this.name = "XmlError";
    this.line = line;
    this.column = column;
    this.near = text.slice(Math.max(0, offset - 30), offset + 30).replace(/\s+/g, " ").trim();
  }
}

/*
 * The handful of HTML's named entities that turn up in XHTML - e-books,
 * mostly - without a DTD to declare them. Anything else unknown is kept as
 * written.
 */
const HTML_ENTITIES: Record<string, string> = {
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  hellip: "\u2026",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  shy: "\u00ad",
  middot: "\u00b7",
  bull: "\u2022",
  laquo: "\u00ab",
  raquo: "\u00bb",
};

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const NAME_START = /[A-Za-z_:\u00c0-\uffff]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-\u00b7\u00c0-\uffff]/;

/**
 * The text with its entity references expanded. `strict` throws on an
 * ampersand that starts no reference at all, which is the commonest way a
 * hand-edited file stops being XML; a named entity nobody declared is kept
 * as written.
 */
export function decodeEntities(raw: string, strict = false, source?: { text: string; offset: number }): string {
  if (!raw.includes("&")) return raw;
  let out = "";
  let at = 0;
  for (;;) {
    const amp = raw.indexOf("&", at);
    if (amp < 0) break;
    out += raw.slice(at, amp);
    const semi = raw.indexOf(";", amp);
    const name = semi > amp ? raw.slice(amp + 1, semi) : "";
    let expanded: string | null = null;
    if (/^#x[0-9a-fA-F]+$/.test(name) || /^#[0-9]+$/.test(name)) {
      const code = name[1] === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code > 0 && code <= 0x10ffff) expanded = String.fromCodePoint(code);
    } else if (name in XML_ENTITIES) {
      expanded = XML_ENTITIES[name];
    } else if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
      expanded = HTML_ENTITIES[name] ?? `&${name};`;
    }
    if (expanded === null) {
      if (strict && source) throw new XmlError("A bare & must be written &amp; in XML.", source.text, source.offset + amp);
      out += "&";
      at = amp + 1;
      continue;
    }
    out += expanded;
    at = semi + 1;
  }
  return out + raw.slice(at);
}

export function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
}

/** Reads a whole document, or throws an `XmlError` saying where it broke. */
export function parseXml(input: string): XmlDocument {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const length = text.length;
  let at = 0;
  const top: XmlNode[] = [];
  const stack: { element: XmlElement; offset: number }[] = [];
  let root: XmlElement | null = null;

  const fail = (message: string, offset = at): never => {
    throw new XmlError(message, text, offset);
  };
  const append = (node: XmlNode) => {
    if (stack.length > 0) stack[stack.length - 1].element.children.push(node);
    else top.push(node);
  };
  const readName = (): string => {
    const start = at;
    if (at >= length || !NAME_START.test(text[at])) fail("A name was expected here.");
    at += 1;
    while (at < length && NAME_CHAR.test(text[at])) at += 1;
    return text.slice(start, at);
  };
  const skipSpace = () => {
    while (at < length && (text[at] === " " || text[at] === "\n" || text[at] === "\t" || text[at] === "\r")) at += 1;
  };

  while (at < length) {
    if (text[at] !== "<") {
      const start = at;
      const next = text.indexOf("<", at);
      at = next < 0 ? length : next;
      const raw = text.slice(start, at);
      if (stack.length === 0) {
        if (raw.trim() !== "") fail(root ? "There is text after the root element has closed." : "There is text before the root element.", start + raw.search(/\S/));
        top.push({ type: "text", text: raw, raw });
        continue;
      }
      if (raw.includes("]]>")) fail("The sequence ]]> cannot appear in text.", start + raw.indexOf("]]>"));
      append({ type: "text", text: decodeEntities(raw, true, { text, offset: start }), raw });
      continue;
    }

    if (text.startsWith("<!--", at)) {
      const end = text.indexOf("-->", at + 4);
      if (end < 0) fail("A comment is never closed with -->.");
      append({ type: "comment", text: text.slice(at + 4, end) });
      at = end + 3;
      continue;
    }

    if (text.startsWith("<![CDATA[", at)) {
      const end = text.indexOf("]]>", at + 9);
      if (end < 0) fail("A CDATA section is never closed with ]]>.");
      if (stack.length === 0) fail("A CDATA section cannot sit outside the root element.");
      append({ type: "cdata", text: text.slice(at + 9, end) });
      at = end + 3;
      continue;
    }

    if (text.startsWith("<!DOCTYPE", at) || text.startsWith("<!doctype", at)) {
      if (stack.length > 0 || root) fail("A DOCTYPE can only come before the root element.");
      let depth = 0;
      let cursor = at + 9;
      let quote: string | null = null;
      for (; cursor < length; cursor += 1) {
        const ch = text[cursor];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "[") depth += 1;
        else if (ch === "]") depth -= 1;
        else if (ch === ">" && depth <= 0) break;
      }
      if (cursor >= length) fail("The DOCTYPE is never closed.");
      top.push({ type: "doctype", raw: text.slice(at + 9, cursor) });
      at = cursor + 1;
      continue;
    }

    if (text.startsWith("<?", at)) {
      const end = text.indexOf("?>", at + 2);
      if (end < 0) fail("A processing instruction is never closed with ?>.");
      const body = text.slice(at + 2, end);
      const target = body.match(/^[^\s]+/)?.[0] ?? "";
      if (!target) fail("A processing instruction needs a name.", at + 2);
      if (target.toLowerCase() === "xml" && at !== 0) fail("The XML declaration must be the very first thing in the file.");
      append({ type: "instruction", target, data: body.slice(target.length).trim() });
      at = end + 2;
      continue;
    }

    if (text.startsWith("</", at)) {
      const start = at;
      at += 2;
      const name = readName();
      skipSpace();
      if (text[at] !== ">") fail(`The closing tag </${name}> is not closed with >.`);
      at += 1;
      const open = stack.pop();
      if (!open) fail(`</${name}> closes an element that was never opened.`, start);
      if (open!.element.name !== name) fail(`</${name}> does not match <${open!.element.name}>, opened on line ${new XmlError("", text, open!.offset).line}.`, start);
      continue;
    }

    // An opening tag.
    const start = at;
    at += 1;
    const name = readName();
    if (stack.length === 0 && root) fail(`A second root element, <${name}>; a document has exactly one.`, start);
    const element: XmlElement = { type: "element", name, attributes: [], children: [], selfClosing: false };
    const seen = new Set<string>();
    for (;;) {
      const before = at;
      skipSpace();
      if (at >= length) fail(`The tag <${name}> is never closed.`, start);
      if (text[at] === ">") {
        at += 1;
        break;
      }
      if (text.startsWith("/>", at)) {
        at += 2;
        element.selfClosing = true;
        break;
      }
      if (before === at) fail(`Attributes in <${name}> need a space between them.`);
      const attributeStart = at;
      const attribute = readName();
      skipSpace();
      if (text[at] !== "=") fail(`The attribute ${attribute} has no value; XML writes ${attribute}="...".`, attributeStart);
      at += 1;
      skipSpace();
      const quote = text[at];
      if (quote !== '"' && quote !== "'") fail(`The value of ${attribute} is not in quotes.`);
      const close = text.indexOf(quote, at + 1);
      if (close < 0) fail(`The value of ${attribute} is never closed.`);
      const raw = text.slice(at + 1, close);
      const lt = raw.indexOf("<");
      if (lt >= 0) fail(`A < cannot appear inside the value of ${attribute}; write &lt;.`, at + 1 + lt);
      if (seen.has(attribute)) fail(`The attribute ${attribute} appears twice in <${name}>.`, attributeStart);
      seen.add(attribute);
      element.attributes.push({ name: attribute, value: decodeEntities(raw, true, { text, offset: at + 1 }).replace(/[\t\n\r]/g, " "), raw });
      at = close + 1;
    }
    append(element);
    if (stack.length === 0) root = element;
    if (!element.selfClosing) stack.push({ element, offset: start });
  }

  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    fail(`<${open.element.name}> is never closed.`, open.offset);
  }
  if (!root) fail("There is no root element: the file has no tags in it.", 0);
  return { children: top, root: root! };
}

/* ---- Queries ------------------------------------------------------------ */

/** The name without its namespace prefix: "dc:title" is "title". */
export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

export function attribute(element: XmlElement, name: string): string | null {
  for (const entry of element.attributes) if (entry.name === name) return entry.value;
  for (const entry of element.attributes) if (localName(entry.name) === name) return entry.value;
  return null;
}

export function childElements(element: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) if (child.type === "element") out.push(child);
  return out;
}

/** The direct children whose local name matches. */
export function children(element: XmlElement, name: string): XmlElement[] {
  return childElements(element).filter((child) => localName(child.name) === name);
}

export function child(element: XmlElement, name: string): XmlElement | null {
  for (const entry of element.children) if (entry.type === "element" && localName(entry.name) === name) return entry;
  return null;
}

/** Every element below this one whose local name matches, in document order. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    for (const entry of node.children) {
      if (entry.type !== "element") continue;
      if (localName(entry.name) === name) out.push(entry);
      walk(entry);
    }
  };
  walk(element);
  return out;
}

/** The text inside, entities expanded, CDATA included, tags dropped. */
export function textContent(node: XmlNode): string {
  if (node.type === "text" || node.type === "cdata") return node.text;
  if (node.type !== "element") return "";
  let out = "";
  for (const entry of node.children) out += textContent(entry);
  return out;
}

/* ---- Writing ------------------------------------------------------------ */

export type XmlIndent = 2 | 4 | "tab" | "none";

export interface XmlFormatOptions {
  indent: XmlIndent;
  /** Leave the comments out. */
  dropComments: boolean;
  /** Elements to write exactly as they came, whitespace and all: an SVG's text, say. */
  verbatim?: (element: XmlElement) => boolean;
}

function openTag(element: XmlElement): string {
  let out = `<${element.name}`;
  for (const entry of element.attributes) out += ` ${entry.name}="${entry.raw.includes('"') ? entry.raw.replace(/"/g, "&quot;") : entry.raw}"`;
  return out;
}

function isBlank(node: XmlNode): boolean {
  return node.type === "text" && node.raw.trim() === "";
}

function preservesSpace(element: XmlElement): boolean {
  return attribute(element, "xml:space") === "preserve";
}

/** One node exactly as it came in, whitespace and all. */
function writeVerbatim(node: XmlNode, dropComments: boolean): string {
  switch (node.type) {
    case "text":
      return node.raw;
    case "cdata":
      return `<![CDATA[${node.text}]]>`;
    case "comment":
      return dropComments ? "" : `<!--${node.text}-->`;
    case "instruction":
      return `<?${node.target}${node.data ? ` ${node.data}` : ""}?>`;
    case "doctype":
      return `<!DOCTYPE${node.raw}>`;
    case "element": {
      if (node.children.length === 0) return `${openTag(node)}${node.selfClosing ? "/>" : `></${node.name}>`}`;
      let inner = "";
      for (const entry of node.children) inner += writeVerbatim(entry, dropComments);
      return `${openTag(node)}>${inner}</${node.name}>`;
    }
  }
}

/**
 * The document written back indented, or on one line.
 *
 * Whitespace between tags is layout and is replaced; whitespace inside text
 * is content and is kept. An element with text and tags mixed - a paragraph
 * with a bold word in it - is written on one line exactly as it came, since
 * a line break added there would be a space added to the text, and so is
 * anything under `xml:space="preserve"`.
 */
export function formatXml(document: XmlDocument, options: XmlFormatOptions): string {
  const { indent } = options;
  const minify = indent === "none";
  const unit = indent === "tab" ? "\t" : indent === "none" ? "" : " ".repeat(indent);
  const lines: string[] = [];

  const write = (node: XmlNode, depth: number) => {
    const pad = unit.repeat(depth);
    if (node.type === "comment" && options.dropComments) return;
    if (node.type !== "element") {
      if (isBlank(node)) return;
      const verbatim = writeVerbatim(node, options.dropComments);
      lines.push(minify ? verbatim : `${pad}${node.type === "text" ? verbatim.trim() : verbatim}`);
      return;
    }
    const kept = node.children.filter((entry) => !(entry.type === "comment" && options.dropComments));
    const mixed = kept.some((entry) => (entry.type === "text" && !isBlank(entry)) || entry.type === "cdata") && kept.some((entry) => entry.type === "element");
    const onlyText = kept.length > 0 && kept.every((entry) => entry.type === "text" || entry.type === "cdata") && !kept.every(isBlank);
    if (preservesSpace(node) || mixed || onlyText || options.verbatim?.(node)) {
      lines.push(`${minify ? "" : pad}${writeVerbatim({ ...node, children: kept }, options.dropComments)}`);
      return;
    }
    const content = kept.filter((entry) => !isBlank(entry));
    if (content.length === 0) {
      lines.push(`${minify ? "" : pad}${openTag(node)}${node.selfClosing || minify ? "/>" : `></${node.name}>`}`);
      return;
    }
    lines.push(`${minify ? "" : pad}${openTag(node)}>`);
    for (const entry of content) write(entry, depth + 1);
    lines.push(`${minify ? "" : pad}</${node.name}>`);
  };

  for (const node of document.children) write(node, 0);
  return minify ? lines.join("") : `${lines.join("\n")}\n`;
}

/** How many elements, and how deep they go. */
export function describeXml(document: XmlDocument): { elements: number; depth: number } {
  let elements = 0;
  let depth = 0;
  const walk = (node: XmlElement, level: number) => {
    elements += 1;
    depth = Math.max(depth, level);
    for (const entry of node.children) if (entry.type === "element") walk(entry, level + 1);
  };
  walk(document.root, 1);
  return { elements, depth };
}

/* ---- XML and JSON --------------------------------------------------------- */

export interface XmlJsonOptions {
  /** "123" as 123 and "true" as true, where JSON would give them back unchanged. */
  typed: boolean;
}

function typedText(text: string, typed: boolean): string | number | boolean {
  if (!typed) return text;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?(0|[1-9][0-9]{0,14})(\.[0-9]+)?$/.test(text) && String(Number(text)) === text) return Number(text);
  return text;
}

/**
 * An element as JSON, in the convention most converters share: attributes
 * as keys starting with @, text beside them as #text, a child element named
 * twice as an array, and an element with nothing but text as that text.
 */
export function elementToJson(element: XmlElement, options: XmlJsonOptions): unknown {
  const out: Record<string, unknown> = {};
  for (const entry of element.attributes) out[`@${entry.name}`] = typedText(entry.value, options.typed);
  let text = "";
  let hasElements = false;
  const repeated = new Set<string>();
  for (const entry of element.children) {
    if (entry.type === "text" || entry.type === "cdata") {
      text += entry.text;
      continue;
    }
    if (entry.type !== "element") continue;
    hasElements = true;
    const value = elementToJson(entry, options);
    const existing = out[entry.name];
    if (existing === undefined) out[entry.name] = value;
    else if (repeated.has(entry.name)) (existing as unknown[]).push(value);
    else {
      repeated.add(entry.name);
      out[entry.name] = [existing, value];
    }
  }
  const trimmed = hasElements ? text.trim() : text;
  if (Object.keys(out).length === 0) return trimmed === "" ? "" : typedText(trimmed, options.typed);
  if (trimmed !== "") out["#text"] = typedText(trimmed, options.typed);
  return out;
}

export function xmlToJson(document: XmlDocument, options: XmlJsonOptions): Record<string, unknown> {
  return { [document.root.name]: elementToJson(document.root, options) };
}

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/** A JSON key as an element name: kept when it is one, made one when it is not. */
export function xmlName(key: string): string {
  if (XML_NAME.test(key) && !/^xml/i.test(key)) return key;
  const cleaned = key.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) && !/^xml/i.test(cleaned) ? cleaned : `_${cleaned}`;
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * JSON as XML, the convention above run backwards: @keys become attributes,
 * #text the text, an array a repeated element. A value that is neither an
 * object nor an array becomes an element's text. The whole is wrapped in
 * `rootName` unless the JSON is an object with exactly one key, which is
 * what came out of the other direction.
 */
export function jsonToXml(value: unknown, rootName = "root", indent: XmlIndent = 2): string {
  const unit = indent === "tab" ? "\t" : indent === "none" ? "" : " ".repeat(indent);
  const newline = indent === "none" ? "" : "\n";
  let out = `<?xml version="1.0" encoding="UTF-8"?>${newline}`;

  const element = (name: string, entry: unknown, depth: number) => {
    const pad = unit.repeat(depth);
    if (Array.isArray(entry)) {
      for (const item of entry) element(name, item, depth);
      return;
    }
    const tag = xmlName(name);
    if (entry === null || typeof entry !== "object") {
      const text = scalarText(entry);
      out += text === "" ? `${pad}<${tag}/>${newline}` : `${pad}<${tag}>${escapeText(text)}</${tag}>${newline}`;
      return;
    }
    const record = entry as Record<string, unknown>;
    let attributes = "";
    let text = "";
    const inner: [string, unknown][] = [];
    for (const [key, item] of Object.entries(record)) {
      if (key.startsWith("@") && key.length > 1 && (item === null || typeof item !== "object")) attributes += ` ${xmlName(key.slice(1))}="${escapeAttribute(scalarText(item))}"`;
      else if (key === "#text") text = scalarText(item);
      else inner.push([key, item]);
    }
    if (inner.length === 0) {
      out += text === "" ? `${pad}<${tag}${attributes}/>${newline}` : `${pad}<${tag}${attributes}>${escapeText(text)}</${tag}>${newline}`;
      return;
    }
    out += `${pad}<${tag}${attributes}>${newline}`;
    if (text !== "") out += `${pad}${unit}${escapeText(text)}${newline}`;
    for (const [key, item] of inner) element(key, item, depth + 1);
    out += `${pad}</${tag}>${newline}`;
  };

  const single = value !== null && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : null;
  if (single && single.length === 1 && !single[0][0].startsWith("@") && single[0][0] !== "#text" && !Array.isArray(single[0][1])) element(single[0][0], single[0][1], 0);
  else if (Array.isArray(value)) {
    out += `<${rootName}>${newline}`;
    for (const item of value) element("item", item, 1);
    out += `</${rootName}>${newline}`;
  } else element(rootName, value, 0);
  return out;
}
