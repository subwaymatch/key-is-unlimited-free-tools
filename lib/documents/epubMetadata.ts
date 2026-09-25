/**
 * An e-book's details - title, authors, series, language, publisher,
 * date, description, subjects and cover - read from its package file and
 * written back.
 *
 * Only the elements being changed are touched: they are cut out of the
 * package file's <metadata> and written again at its end, and everything
 * else in the file, and every other file in the book, is kept byte for
 * byte. Series are written both the way calibre writes them and the way
 * EPUB 3 does, since readers follow one or the other. The archive is
 * rebuilt with its mimetype entry first and uncompressed, as the
 * specification requires and as some readers check.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";

import { EpubError, packagePath, resolvePath } from "./epub";

export interface EpubMetadata {
  title: string;
  authors: string[];
  series: string;
  seriesIndex: string;
  language: string;
  publisher: string;
  date: string;
  description: string;
  subjects: string[];
}

export interface EpubInfo {
  version: 2 | 3;
  opfPath: string;
  metadata: EpubMetadata;
  /** The cover picture, and its manifest entry exactly as written. */
  cover: { path: string; mediaType: string; item: string } | null;
  identifier: string;
}

const DC = "http://purl.org/dc/elements/1.1/";

function unescape(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .trim();
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function prefixOf(opf: string): string {
  const match = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)=["']${DC.replace(/[.]/g, "\\.")}["']`).exec(opf);
  return match ? match[1] : "dc";
}

function metadataBlock(opf: string): { start: number; end: number; inner: string; open: string } {
  const open = /<(?:[\w-]+:)?metadata\b[^>]*>/.exec(opf);
  const close = /<\/(?:[\w-]+:)?metadata\s*>/.exec(opf);
  if (!open || !close || close.index < open.index) throw new EpubError("The book's package file has no metadata section.");
  return { start: open.index + open[0].length, end: close.index, inner: opf.slice(open.index + open[0].length, close.index), open: open[0] };
}

function elements(inner: string, name: string): { text: string; attributes: string; whole: string }[] {
  const pattern = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, "g");
  const out: { text: string; attributes: string; whole: string }[] = [];
  for (let match = pattern.exec(inner); match; match = pattern.exec(inner)) out.push({ attributes: match[1], text: unescape(match[2] ?? ""), whole: match[0] });
  return out;
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? (match[2] ?? match[3]) : null;
}

/** The book's details, from its archive's files. */
export function readEpubInfo(files: Record<string, Uint8Array>): EpubInfo {
  const decoder = new TextDecoder();
  const container = files["META-INF/container.xml"];
  if (!container) throw new EpubError("This is not an EPUB: it has no META-INF/container.xml.");
  const opfPath = packagePath(decoder.decode(container));
  const opfBytes = files[opfPath];
  if (!opfBytes) throw new EpubError(`The book's package file, ${opfPath}, is missing.`);
  const opf = decoder.decode(opfBytes);
  const version = /<package\b[^>]*\bversion\s*=\s*["']3/.test(opf) ? 3 : 2;
  const dc = prefixOf(opf);
  const { inner } = metadataBlock(opf);
  const first = (name: string) => elements(inner, `${dc}:${name}`)[0]?.text ?? "";
  const metas = elements(inner, "meta");
  const named = (name: string) => metas.find((meta) => attribute(meta.attributes, "name") === name);
  let series = attribute(named("calibre:series")?.attributes ?? "", "content") ?? "";
  let seriesIndex = attribute(named("calibre:series_index")?.attributes ?? "", "content") ?? "";
  const collection = metas.find((meta) => attribute(meta.attributes, "property") === "belongs-to-collection");
  if (!series && collection) {
    series = collection.text;
    const id = attribute(collection.attributes, "id");
    const position = metas.find((meta) => attribute(meta.attributes, "refines") === `#${id}` && attribute(meta.attributes, "property") === "group-position");
    if (position) seriesIndex = position.text;
  }
  // The cover: EPUB 3 marks it with properties="cover-image"; EPUB 2 names it in a meta.
  const items = elements(opf, "item");
  let cover: EpubInfo["cover"] = null;
  const coverItem = items.find((item) => (attribute(item.attributes, "properties") ?? "").split(/\s+/).includes("cover-image")) ?? items.find((item) => attribute(item.attributes, "id") === attribute(named("cover")?.attributes ?? "", "content"));
  if (coverItem) {
    const href = attribute(coverItem.attributes, "href");
    if (href) cover = { path: resolvePath(opfPath, decodeURIComponent(href)), mediaType: attribute(coverItem.attributes, "media-type") ?? "image/jpeg", item: coverItem.whole };
  }
  return {
    version,
    opfPath,
    identifier: first("identifier"),
    cover,
    metadata: {
      title: first("title"),
      authors: elements(inner, `${dc}:creator`).map((creator) => creator.text).filter(Boolean),
      series,
      seriesIndex,
      language: first("language"),
      publisher: first("publisher"),
      date: first("date"),
      description: first("description"),
      subjects: elements(inner, `${dc}:subject`).map((subject) => subject.text).filter(Boolean),
    },
  };
}

/** The package file with the given details in place of the old ones. */
export function rewriteOpf(opf: string, version: 2 | 3, metadata: EpubMetadata, now = new Date()): string {
  const dc = prefixOf(opf);
  const block = metadataBlock(opf);
  let inner = block.inner;
  const remove = (whole: string) => {
    inner = inner.replace(whole, "");
  };
  const managed = ["title", "creator", "language", "publisher", "date", "description", "subject"];
  const creatorIds: string[] = [];
  for (const name of managed) {
    for (const element of elements(inner, `${dc}:${name}`)) {
      if (name === "creator") {
        const id = attribute(element.attributes, "id");
        if (id) creatorIds.push(id);
      }
      if (name === "date" && /opf:event\s*=\s*["'](?!publication)/.test(element.attributes)) continue;
      remove(element.whole);
    }
  }
  const collectionIds: string[] = [];
  for (const meta of elements(inner, "meta")) {
    const name = attribute(meta.attributes, "name");
    const property = attribute(meta.attributes, "property");
    const refines = attribute(meta.attributes, "refines")?.replace(/^#/, "");
    if (property === "belongs-to-collection") collectionIds.push(attribute(meta.attributes, "id") ?? "");
    if (name === "calibre:series" || name === "calibre:series_index" || property === "belongs-to-collection" || property === "dcterms:modified" || (refines && creatorIds.includes(refines))) remove(meta.whole);
  }
  for (const meta of elements(inner, "meta")) {
    const refines = attribute(meta.attributes, "refines")?.replace(/^#/, "");
    if (refines && collectionIds.includes(refines)) remove(meta.whole);
  }
  // What is left, tidied: runs of blank lines where elements came out collapse to one.
  inner = inner.replace(/\n\s*\n(\s*\n)+/g, "\n").replace(/\s+$/, "");
  const indent = /\n([ \t]+)</.exec(block.inner)?.[1] ?? "    ";
  const lines: string[] = [];
  const add = (line: string) => lines.push(`${indent}${line}`);
  if (metadata.title) add(`<${dc}:title>${escape(metadata.title)}</${dc}:title>`);
  metadata.authors.forEach((author, index) => {
    if (version === 3) {
      add(`<${dc}:creator id="creator${index + 1}">${escape(author)}</${dc}:creator>`);
      add(`<meta refines="#creator${index + 1}" property="role" scheme="marc:relators">aut</meta>`);
    } else add(`<${dc}:creator opf:role="aut">${escape(author)}</${dc}:creator>`);
  });
  if (metadata.language) add(`<${dc}:language>${escape(metadata.language)}</${dc}:language>`);
  if (metadata.publisher) add(`<${dc}:publisher>${escape(metadata.publisher)}</${dc}:publisher>`);
  if (metadata.date) add(`<${dc}:date>${escape(metadata.date)}</${dc}:date>`);
  if (metadata.description) add(`<${dc}:description>${escape(metadata.description)}</${dc}:description>`);
  for (const subject of metadata.subjects) add(`<${dc}:subject>${escape(subject)}</${dc}:subject>`);
  if (metadata.series) {
    add(`<meta name="calibre:series" content="${escape(metadata.series)}"/>`);
    if (metadata.seriesIndex) add(`<meta name="calibre:series_index" content="${escape(metadata.seriesIndex)}"/>`);
    if (version === 3) {
      add(`<meta property="belongs-to-collection" id="series">${escape(metadata.series)}</meta>`);
      add(`<meta refines="#series" property="collection-type">series</meta>`);
      if (metadata.seriesIndex) add(`<meta refines="#series" property="group-position">${escape(metadata.seriesIndex)}</meta>`);
    }
  }
  if (version === 3) add(`<meta property="dcterms:modified">${now.toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>`);
  let open = block.open;
  // EPUB 2's opf:role needs the opf prefix declared where the creators are.
  if (version === 2 && !/xmlns:opf\s*=/.test(opf)) open = open.replace(/>$/, ' xmlns:opf="http://www.idpf.org/2007/opf">');
  const closing = /\n([ \t]*)<\/(?:[\w-]+:)?metadata/.exec(opf)?.[1] ?? "  ";
  return `${opf.slice(0, block.start - block.open.length)}${open}${inner}\n${lines.join("\n")}\n${closing}${opf.slice(block.end)}`;
}

/** The book with new details and, if given, a new cover picture. */
export function writeEpub(bytes: Uint8Array, metadata: EpubMetadata, cover?: { bytes: Uint8Array; mediaType: string }): Uint8Array {
  const files = unzipSync(bytes);
  const info = readEpubInfo(files);
  const decoder = new TextDecoder();
  let opf = rewriteOpf(decoder.decode(files[info.opfPath]), info.version, metadata);
  const out: Zippable = { mimetype: [strToU8("application/epub+zip"), { level: 0 }] };
  if (cover && info.cover) {
    files[info.cover.path] = cover.bytes as Uint8Array<ArrayBuffer>;
    if (cover.mediaType !== info.cover.mediaType) opf = opf.replace(info.cover.item, info.cover.item.replace(/media-type\s*=\s*("[^"]*"|'[^']*')/, `media-type="${cover.mediaType}"`));
  }
  for (const [path, data] of Object.entries(files)) {
    if (path === "mimetype") continue;
    out[path] = path === info.opfPath ? strToU8(opf) : [data, { level: /\.(jpe?g|png|gif|webp|woff2?|mp3|mp4)$/i.test(path) ? 0 : 6 }];
  }
  return zipSync(out);
}
