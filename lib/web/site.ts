/**
 * A static site held in memory: its files by path, the way a web server
 * finds a page for an address, and what each reference in it points to.
 *
 * Paths are relative to the site's root, with forward slashes and no
 * leading slash: "index.html", "css/site.css". An address is looked up the
 * way static hosts do it: the file itself, then the address as a folder
 * with an index.html in it, then with .html added, so /about, /about/ and
 * /about.html all find about.html or about/index.html.
 */

export interface SiteFile {
  path: string;
  blob: Blob;
  type: string;
}

export interface Site {
  files: Map<string, SiteFile>;
  /** The page shown first. */
  entry: string;
  /** Every HTML page, sorted, the entry first. */
  pages: string[];
  /** The folder every file was in, taken off: "my-site/" from a ZIP of the folder. */
  strippedRoot: string;
}

const TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  json: "application/json",
  map: "application/json",
  webmanifest: "application/manifest+json",
  xml: "application/xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  vtt: "text/vtt",
  pdf: "application/pdf",
  wasm: "application/wasm",
  zip: "application/zip",
};

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function typeOf(path: string): string {
  return TYPES[extensionOf(path)] ?? "application/octet-stream";
}

export const isHtml = (path: string) => /\.(html?|xhtml)$/i.test(path);
export const isCss = (path: string) => /\.css$/i.test(path);
export const isScript = (path: string) => /\.(m?js|cjs)$/i.test(path);
export const isFont = (path: string) => /\.(woff2?|ttf|otf|eot)$/i.test(path);

/** "a/./b/../c" to "a/c"; null when it climbs above the root. */
export function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/** The folder a path is in, with its trailing slash: "blog/post.html" to "blog/". */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash + 1) : "";
}

export type Reference =
  /** A file of this site: its path, and any #fragment and ?query the reference had. */
  | { kind: "local"; path: string; hash: string; query: string }
  /** Somewhere else on the web. */
  | { kind: "external"; url: string }
  /** data:, blob:, javascript:, mailto:, a bare #fragment and the like: left alone. */
  | { kind: "other" };

/** What a reference in a file at `from` points to. */
export function resolveReference(reference: string, from: string): Reference {
  const value = reference.trim();
  if (value === "" || value.startsWith("#")) return { kind: "other" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return /^https?:/i.test(value) ? { kind: "external", url: value } : { kind: "other" };
  if (value.startsWith("//")) return { kind: "external", url: `https:${value}` };
  const hashAt = value.indexOf("#");
  const hash = hashAt >= 0 ? value.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? value.slice(0, hashAt) : value;
  const queryAt = beforeHash.indexOf("?");
  const query = queryAt >= 0 ? beforeHash.slice(queryAt) : "";
  let target = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  try {
    target = decodeURIComponent(target);
  } catch {
    // A stray % is taken literally, as servers do.
  }
  const joined = target.startsWith("/") ? target : `${folderOf(from)}${target}`;
  const path = normalizePath(joined);
  if (path === null) return { kind: "other" };
  // A reference to a folder keeps its slash, so the index lookup knows.
  return { kind: "local", path: target.endsWith("/") && path !== "" ? `${path}/` : path, hash, query };
}

/** The file an address finds, as a static host would find it. */
export function lookup(site: Pick<Site, "files">, path: string): SiteFile | null {
  const clean = path.replace(/\/+$/, "");
  const candidates = path.endsWith("/") || clean === "" ? [`${clean ? `${clean}/` : ""}index.html`, `${clean ? `${clean}/` : ""}index.htm`] : [clean, `${clean}/index.html`, `${clean}.html`, `${clean}/index.htm`, `${clean}.htm`];
  for (const candidate of candidates) {
    const found = site.files.get(candidate);
    if (found) return found;
  }
  return null;
}

/** The folders every path is inside, when there are any: "my-site/" for a ZIP made of the folder. */
export function sharedFolder(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  let common = paths[0].split("/").slice(0, -1);
  for (const path of paths.slice(1)) {
    const folders = path.split("/").slice(0, -1);
    let depth = 0;
    while (depth < common.length && depth < folders.length && common[depth] === folders[depth]) depth += 1;
    common = common.slice(0, depth);
  }
  return common.length > 0 ? `${common.join("/")}/` : "";
}

/** Paths to leave out: operating-system litter rather than the site. */
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

export function buildSite(entries: readonly { path: string; blob: Blob }[]): Site {
  const kept = entries.map((entry) => ({ ...entry, path: normalizePath(entry.path) })).filter((entry): entry is { path: string; blob: Blob } => entry.path !== null && entry.path !== "" && !JUNK.test(entry.path) && !entry.path.endsWith("/"));
  const strippedRoot = sharedFolder(kept.map((entry) => entry.path));
  const files = new Map<string, SiteFile>();
  for (const entry of kept) {
    const path = entry.path.slice(strippedRoot.length);
    files.set(path, { path, blob: entry.blob, type: typeOf(path) });
  }
  const pages = [...files.keys()].filter(isHtml).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const entry = files.has("index.html") ? "index.html" : files.has("index.htm") ? "index.htm" : (pages[0] ?? "");
  return { files, entry, pages: entry ? [entry, ...pages.filter((page) => page !== entry)] : pages, strippedRoot };
}
