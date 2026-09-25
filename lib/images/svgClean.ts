/**
 * An SVG made smaller and safe to put on a page: what drawing programs
 * leave in it for themselves taken out, numbers rounded, whitespace gone,
 * and anything that could run code removed.
 *
 * Inkscape, Illustrator, Sketch and Figma all write their own bookkeeping
 * into an SVG - editor namespaces, metadata blocks, comments, ids nothing
 * refers to - and write coordinates to more decimal places than a screen
 * can show. None of it changes the picture. Scripts, event handlers and
 * javascript: links are another matter: an SVG is a document that can run
 * code when opened on its own, which is why sites that accept uploads
 * refuse it, and sanitising takes all of that out.
 */
import { formatXml, localName, parseXml, type XmlAttribute, type XmlDocument, type XmlElement, type XmlNode } from "../text/xml";

export interface SvgCleanOptions {
  /** Decimal places numbers are rounded to; null to leave them. */
  precision: number | null;
  /** Take out scripts, event handlers, javascript: links and embedded HTML. */
  sanitize: boolean;
  /** Keep <title> and <desc>, which screen readers read. */
  keepTitles: boolean;
}

export const DEFAULT_SVG_OPTIONS: SvgCleanOptions = { precision: 3, sanitize: true, keepTitles: true };

export interface SvgCleanCounts {
  comments: number;
  metadata: number;
  editorData: number;
  unusedIds: number;
  emptyGroups: number;
  scripts: number;
  handlers: number;
}

const EDITOR_PREFIXES = new Set(["inkscape", "sodipodi", "sketch", "serif", "i", "x", "graph", "a", "figma", "bx", "vectornator", "krita", "illustrator", "adobe", "ns1", "ns2"]);
const EDITOR_NAMESPACES = /inkscape|sodipodi|bohemiancoding|serif\.com|adobe\.com|ns\.adobe|figma|vectornator|boxy-svg|krita/i;
const NUMERIC_ATTRIBUTES = new Set(["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "fx", "fy", "dx", "dy", "stroke-width", "font-size", "offset", "stroke-dashoffset", "letter-spacing", "stroke-miterlimit"]);
const LIST_ATTRIBUTES = new Set(["d", "points", "viewBox", "transform", "gradientTransform", "patternTransform", "stroke-dasharray"]);
const DANGEROUS_ELEMENTS = new Set(["script", "foreignObject", "iframe", "embed", "object", "handler", "listener"]);
const TEXT_ELEMENTS = new Set(["text", "textPath", "style", "title", "desc"]);

function round(value: number, precision: number): string {
  const rounded = Number(value.toFixed(precision));
  const text = String(Object.is(rounded, -0) ? 0 : rounded);
  return text.replace(/^(-?)0\./, "$1.");
}

/** Every number in a list rounded, and the spaces a parser does not need taken out. */
export function roundNumbers(text: string, precision: number, path: boolean): string {
  let out = text.replace(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, (match) => round(Number(match), precision));
  if (path) {
    out = out
      .replace(/\s*,\s*/g, " ")
      .replace(/\s*([MmLlHhVvCcSsQqTtAaZz])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/ (-)/g, "$1")
      .trim();
  } else out = out.replace(/\s+/g, " ").trim();
  return out;
}

function prefixOf(name: string): string | null {
  const colon = name.indexOf(":");
  return colon < 0 ? null : name.slice(0, colon);
}

/** The ids something in the document points at: url(#a), href="#a", begin="a.end", aria references. */
function referencedIds(document: XmlDocument): Set<string> {
  const ids = new Set<string>();
  const walk = (node: XmlNode) => {
    if (node.type === "text" || node.type === "cdata") {
      for (const match of node.text.matchAll(/#([A-Za-z_][\w.-]*)/g)) ids.add(match[1]);
      return;
    }
    if (node.type !== "element") return;
    for (const attribute of node.attributes) {
      for (const match of attribute.value.matchAll(/#([A-Za-z_][\w.-]*)/g)) ids.add(match[1]);
      if (/^(begin|end|aria-\w+|for)$/.test(attribute.name)) for (const word of attribute.value.split(/[\s;.]+/)) ids.add(word);
    }
    for (const child of node.children) walk(child);
  };
  walk(document.root);
  return ids;
}

function hasElement(element: XmlElement, names: Set<string>): boolean {
  if (names.has(localName(element.name))) return true;
  return element.children.some((child) => child.type === "element" && hasElement(child, names));
}

export class SvgError extends Error {}

/** The SVG written back smaller and, when asked, with nothing in it that can run. */
export function cleanSvg(text: string, options: SvgCleanOptions): { svg: string; counts: SvgCleanCounts } {
  const document = parseXml(text);
  if (localName(document.root.name) !== "svg") throw new SvgError(`This is XML, but its root is <${document.root.name}>, not <svg>.`);
  const counts: SvgCleanCounts = { comments: 0, metadata: 0, editorData: 0, unusedIds: 0, emptyGroups: 0, scripts: 0, handlers: 0 };
  // Ids are only pruned when no stylesheet or script that stays could refer to one by name.
  const keepIds = hasElement(document.root, new Set(options.sanitize ? ["style"] : ["style", "script"]));
  const referenced = referencedIds(document);
  const editorPrefixes = new Set(EDITOR_PREFIXES);
  for (const attribute of document.root.attributes) {
    if (attribute.name.startsWith("xmlns:") && EDITOR_NAMESPACES.test(attribute.value)) editorPrefixes.add(attribute.name.slice(6));
  }

  const cleanAttributes = (element: XmlElement): XmlAttribute[] => {
    const kept: XmlAttribute[] = [];
    for (const attribute of element.attributes) {
      const prefix = prefixOf(attribute.name);
      if (attribute.name.startsWith("xmlns:") && editorPrefixes.has(attribute.name.slice(6))) {
        counts.editorData += 1;
        continue;
      }
      if (prefix && prefix !== "xmlns" && prefix !== "xml" && prefix !== "xlink" && editorPrefixes.has(prefix)) {
        counts.editorData += 1;
        continue;
      }
      if (attribute.name === "data-name" || attribute.name === "enable-background") {
        counts.editorData += 1;
        continue;
      }
      if (options.sanitize && /^on/i.test(attribute.name)) {
        counts.handlers += 1;
        continue;
      }
      if (options.sanitize && /(^|:)href$/.test(attribute.name) && /^\s*(javascript|data:text\/html|vbscript):/i.test(attribute.value)) {
        counts.handlers += 1;
        continue;
      }
      if (attribute.name === "id" && !keepIds && !referenced.has(attribute.value)) {
        counts.unusedIds += 1;
        continue;
      }
      let value = attribute.value;
      if (options.precision !== null && (NUMERIC_ATTRIBUTES.has(attribute.name) || LIST_ATTRIBUTES.has(attribute.name))) {
        const unit = /^\s*-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*(px|pt|mm|cm|in|em|ex|%)?\s*$/.exec(value);
        if (LIST_ATTRIBUTES.has(attribute.name)) value = roundNumbers(value, options.precision, attribute.name === "d");
        else if (unit) value = `${round(parseFloat(value), options.precision)}${unit[1] ?? ""}`;
      }
      const raw = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      kept.push({ name: attribute.name, value, raw });
    }
    return kept;
  };

  const cleanChildren = (nodes: XmlNode[], inText: boolean): XmlNode[] => {
    const out: XmlNode[] = [];
    for (const node of nodes) {
      if (node.type === "comment") {
        counts.comments += 1;
        continue;
      }
      if (node.type === "doctype" || node.type === "instruction") continue;
      if (node.type === "text") {
        // Text only matters inside text elements and styles; elsewhere it is layout.
        if (inText || node.raw.trim() !== "") out.push(node);
        continue;
      }
      if (node.type !== "element") {
        out.push(node);
        continue;
      }
      const name = localName(node.name);
      const prefix = prefixOf(node.name);
      if (prefix && editorPrefixes.has(prefix)) {
        counts.editorData += 1;
        continue;
      }
      if (name === "metadata") {
        counts.metadata += 1;
        continue;
      }
      if (!options.keepTitles && (name === "title" || name === "desc")) {
        counts.metadata += 1;
        continue;
      }
      if (options.sanitize && DANGEROUS_ELEMENTS.has(name)) {
        counts.scripts += 1;
        continue;
      }
      const textual = inText || TEXT_ELEMENTS.has(name) || name === "tspan";
      const element: XmlElement = { ...node, attributes: cleanAttributes(node), children: cleanChildren(node.children, textual) };
      if ((name === "g" || name === "defs") && element.children.length === 0 && !element.attributes.some((attribute) => attribute.name === "id")) {
        counts.emptyGroups += 1;
        continue;
      }
      out.push(element);
    }
    return out;
  };

  for (const node of document.children) if (node.type === "comment") counts.comments += 1;
  const [root] = cleanChildren([document.root], false) as XmlElement[];
  // Whitespace between two runs of text is a space on screen, so text is written as it came.
  const svg = formatXml({ children: [root], root }, { indent: "none", dropComments: true, verbatim: (element) => TEXT_ELEMENTS.has(localName(element.name)) });
  return { svg, counts };
}

/** "3 comments, Inkscape's data, 12 unused ids": what went, in words. */
export function describeCleaning(counts: SvgCleanCounts): string[] {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };
  add(counts.comments, "comment", "comments");
  add(counts.metadata, "metadata block", "metadata blocks");
  add(counts.editorData, "piece of editor data", "pieces of editor data");
  add(counts.unusedIds, "unused id", "unused ids");
  add(counts.emptyGroups, "empty group", "empty groups");
  add(counts.scripts, "script or embedded document", "scripts or embedded documents");
  add(counts.handlers, "event handler or script link", "event handlers or script links");
  return parts;
}
