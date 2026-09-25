/**
 * An EPUB read as text: a ZIP of XHTML chapters, in the order its package
 * file's spine lists them.
 *
 * META-INF/container.xml names the package file; the package file's
 * manifest names every file and its spine the reading order; each chapter
 * is XHTML, walked for its blocks - paragraphs, headings, list items - so
 * the text comes out with a blank line between paragraphs rather than as
 * one run of words. A chapter that is not well-formed XML, which happens,
 * is read the forgiving way instead: tags stripped, blocks broken.
 */
import { htmlToText } from "../text/html";
import { attribute, child, children, descendants, localName, parseXml, textContent, type XmlElement, type XmlNode } from "../text/xml";

export type EpubStyle = "text" | "markdown";

export const EPUB_STYLES: readonly { id: EpubStyle; label: string; blurb: string }[] = [
  { id: "text", label: "Plain text", blurb: "Paragraphs with a blank line between them" },
  { id: "markdown", label: "Markdown", blurb: "Headings, lists, bold and italics kept" },
];

export interface EpubBook {
  title: string | null;
  authors: string[];
  language: string | null;
  /** Chapter paths in reading order, relative to the archive. */
  spine: string[];
}

export class EpubError extends Error {}

/** A path inside the archive, relative to a file inside it, resolved: "../Text/ch1.xhtml" from "OEBPS/nav/toc.xhtml". */
export function resolvePath(from: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0]);
  const parts = from.split("/").slice(0, -1);
  for (const piece of clean.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

/** The package file's path, from the container. */
export function packagePath(containerXml: string): string {
  const root = parseXml(containerXml).root;
  const rootfile = descendants(root, "rootfile")[0];
  const path = rootfile ? attribute(rootfile, "full-path") : null;
  if (!path) throw new EpubError("The container does not say where the book's package file is.");
  return path;
}

/**
 * The files META-INF/encryption.xml says are encrypted. Fonts obfuscated
 * the way the EPUB standard allows are listed here too, in books with no
 * DRM at all, so what matters is whether a chapter is.
 */
export function encryptedPaths(encryptionXml: string): string[] {
  try {
    return descendants(parseXml(encryptionXml).root, "CipherReference")
      .map((reference) => attribute(reference, "URI"))
      .filter((uri): uri is string => uri !== null)
      .map((uri) => resolvePath("container-root", uri));
  } catch {
    return [];
  }
}

/** The title, authors, language and reading order from the package file. */
export function readPackage(opfXml: string, opfPath: string): EpubBook {
  const root = parseXml(opfXml).root;
  const metadata = child(root, "metadata");
  const manifest = child(root, "manifest");
  const spine = child(root, "spine");
  if (!manifest || !spine) throw new EpubError("The package file has no manifest or no spine, so the chapters cannot be put in order.");
  const items = new Map<string, string>();
  for (const item of children(manifest, "item")) {
    const id = attribute(item, "id");
    const href = attribute(item, "href");
    if (id && href) items.set(id, resolvePath(opfPath, href));
  }
  const order: string[] = [];
  for (const itemref of children(spine, "itemref")) {
    const path = items.get(attribute(itemref, "idref") ?? "");
    if (path && !order.includes(path)) order.push(path);
  }
  const text = (name: string) => (metadata ? children(metadata, name).map((entry) => textContent(entry).trim()).filter(Boolean) : []);
  return { title: text("title")[0] ?? null, authors: text("creator"), language: text("language")[0] ?? null, spine: order };
}

const BLOCKS = new Set(["p", "div", "section", "article", "aside", "header", "footer", "blockquote", "figure", "figcaption", "table", "tr", "ul", "ol", "dl", "dt", "dd", "pre", "hr", "nav", "main"]);
const SKIP = new Set(["head", "script", "style", "title", "svg", "math", "noscript"]);

/** Whitespace as a reader sees it: runs become one space. */
function collapse(text: string): string {
  return text.replace(/[ \t\r\n\f]+/g, " ");
}

/**
 * The text of an XHTML chapter as paragraphs. In Markdown, headings get
 * their hashes, list items a dash, and bold and italic their stars; links
 * keep only their words, since a link inside the book points nowhere once
 * it is a text file.
 */
export function chapterText(root: XmlElement, style: EpubStyle): string {
  const blocks: string[] = [];
  let line = "";
  // A heading's hashes or a list item's dash, for the next block written.
  let prefix = "";
  const flush = () => {
    const text = line.replace(/ +/g, " ").replace(/ *\n */g, "\n").trim();
    if (text) {
      blocks.push(prefix + text);
      prefix = "";
    }
    line = "";
  };
  const md = style === "markdown";
  const walk = (node: XmlNode, listDepth: number, pre: boolean) => {
    if (node.type === "text" || node.type === "cdata") {
      line += pre ? node.text : collapse(node.text);
      return;
    }
    if (node.type !== "element") return;
    const name = localName(node.name).toLowerCase();
    if (SKIP.has(name)) return;
    if (name === "br") {
      line += md ? "\\\n" : "\n";
      return;
    }
    if (name === "img") {
      const alt = attribute(node, "alt");
      if (alt) line += md ? `[${alt}]` : alt;
      return;
    }
    const heading = /^h([1-6])$/.exec(name);
    if (heading) {
      flush();
      prefix = md ? `${"#".repeat(Number(heading[1]))} ` : "";
      for (const entry of node.children) walk(entry, listDepth, pre);
      flush();
      prefix = "";
      return;
    }
    if (name === "li") {
      flush();
      prefix = md ? `${"  ".repeat(listDepth)}- ` : "";
      for (const entry of node.children) walk(entry, listDepth + 1, pre);
      flush();
      prefix = "";
      return;
    }
    if (name === "pre") {
      flush();
      for (const entry of node.children) walk(entry, listDepth, true);
      const text = line.replace(/^\n+|\n+$/g, "");
      if (text) blocks.push(md ? `\`\`\`\n${text}\n\`\`\`` : text);
      line = "";
      return;
    }
    if (name === "td" || name === "th") {
      if (line.trim()) line += md ? " | " : "\t";
      for (const entry of node.children) walk(entry, listDepth, pre);
      return;
    }
    if (md && (name === "em" || name === "i" || name === "strong" || name === "b")) {
      const mark = name === "em" || name === "i" ? "*" : "**";
      const before = line;
      line = "";
      for (const entry of node.children) walk(entry, listDepth, pre);
      const inner = line;
      line = before + (inner.trim() ? inner.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${mark}$2${mark}$3`) : inner);
      return;
    }
    const block = BLOCKS.has(name) || name === "body";
    if (block) flush();
    if (name === "hr") {
      if (md) blocks.push("---");
      return;
    }
    const quote = md && name === "blockquote";
    const start = blocks.length;
    for (const entry of node.children) walk(entry, listDepth, pre);
    if (block) flush();
    if (quote) for (let index = start; index < blocks.length; index += 1) blocks[index] = blocks[index].split("\n").map((entry) => `> ${entry}`).join("\n");
  };
  const body = descendants(root, "body")[0] ?? root;
  walk(body, 0, false);
  flush();
  return blocks.join("\n\n");
}

export function chapterFromXhtml(xhtml: string, style: EpubStyle): { text: string; loose: boolean } {
  try {
    return { text: chapterText(parseXml(xhtml).root, style), loose: false };
  } catch {
    return { text: htmlToText(xhtml), loose: true };
  }
}

/** The book's heading: its title and authors, in the style asked for. */
export function bookHeading(book: EpubBook, style: EpubStyle): string {
  const lines: string[] = [];
  if (book.title) lines.push(style === "markdown" ? `# ${book.title}` : book.title);
  if (book.authors.length > 0) lines.push(style === "markdown" ? `*${book.authors.join(", ")}*` : book.authors.join(", "));
  return lines.join("\n\n");
}

export function wordCount(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}
