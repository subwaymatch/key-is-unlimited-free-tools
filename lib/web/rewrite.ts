/**
 * A page of a static site rewritten to run inside a sandboxed frame that
 * cannot load anything from anywhere.
 *
 * The frame has an opaque origin, so the site's scripts cannot reach this
 * site's storage or pages, and it inherits a Content-Security-Policy that
 * allows scripts only inline or from blob: URLs, styles only inline, and
 * fonts only from this site. So each page is rebuilt before it is shown:
 * stylesheets are inlined as <style> with their @imports followed and their
 * pictures turned into data: URLs; fonts are taken out of @font-face and
 * handed to the frame's runtime, which loads them from bytes with FontFace;
 * classic scripts are inlined, the deferred ones moved to the end of the
 * body; module scripts become imports of their virtual addresses, which an
 * import map the runtime writes points at blob: URLs of their code; and
 * every other file reference is marked for the runtime to point at the
 * file's bytes. The virtual addresses sit under /__site__/ on this site's
 * own origin, the only base a page may set here, and a meta policy in each
 * page forbids every request that is not blob: or data:, so a reference the
 * rewriting misses fails quietly instead of going out.
 */
import { folderOf, isCss, isFont, isScript, lookup, resolveReference, type Site } from "./site";

export const VIRTUAL_PATH = "/__site__/";

export interface FontRecord {
  family: string;
  descriptors: Record<string, string>;
  path: string;
}

export interface Issues {
  /** References to files that are not in the site, by the file they are in. */
  missing: { from: string; reference: string; link: boolean }[];
  /** Addresses on other sites, which the preview does not fetch. */
  external: string[];
}

export interface Context {
  site: Site;
  /** The virtual root: https://key.is/__site__/ */
  root: string;
  /** A file's bytes, read once. */
  bytes: (path: string) => Promise<Uint8Array>;
  issues: Issues;
  fonts: FontRecord[];
}

export function newIssues(): Issues {
  return { missing: [], external: [] };
}

function noteMissing(context: Context, from: string, reference: string, link = false): void {
  if (!context.issues.missing.some((entry) => entry.from === from && entry.reference === reference)) context.issues.missing.push({ from, reference, link });
}

function noteExternal(context: Context, url: string): void {
  if (!context.issues.external.includes(url)) context.issues.external.push(url);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

/* ---- CSS ------------------------------------------------------------------- */

const FONT_DESCRIPTORS: Record<string, string> = {
  "font-weight": "weight",
  "font-style": "style",
  "font-stretch": "stretch",
  "unicode-range": "unicodeRange",
  "font-display": "display",
  "font-feature-settings": "featureSettings",
};

const unquote = (value: string) => value.trim().replace(/^(['"])([\s\S]*)\1$/, "$2");

/**
 * A stylesheet with @imports inlined, local url()s as data: URLs and
 * @font-face rules with local fonts taken out and recorded.
 */
export async function rewriteCss(css: string, from: string, context: Context, seen: Set<string> = new Set()): Promise<string> {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // @import, followed once each; a cycle stops where it would repeat.
  const imports = [...text.matchAll(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/g)];
  for (const found of imports) {
    const reference = found[2] ?? found[4];
    const media = found[5].trim();
    const target = resolveReference(reference, from);
    let replacement = "";
    if (target.kind === "external") noteExternal(context, target.url);
    else if (target.kind === "local") {
      const file = lookup(context.site, target.path);
      if (!file) noteMissing(context, from, reference);
      else if (!seen.has(file.path)) {
        seen.add(file.path);
        const inner = await rewriteCss(new TextDecoder().decode(await context.bytes(file.path)), file.path, context, seen);
        replacement = media && !/^(layer|supports)\b/.test(media) ? `@media ${media} {\n${inner}\n}` : inner;
      }
    }
    text = text.replace(found[0], () => replacement);
  }

  // @font-face with a local source becomes a font for the runtime.
  const faces = [...text.matchAll(/@font-face\s*\{([^{}]*)\}/g)];
  for (const found of faces) {
    const declarations = new Map<string, string>();
    for (const declaration of found[1].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0) declarations.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim());
    }
    const family = unquote(declarations.get("font-family") ?? "");
    const sources = [...(declarations.get("src") ?? "").matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((match) => match[2]);
    let chosen: string | null = null;
    let anyLocal = false;
    for (const source of sources) {
      const target = resolveReference(source, from);
      if (target.kind === "external") noteExternal(context, target.url);
      if (target.kind !== "local") continue;
      anyLocal = true;
      const file = lookup(context.site, target.path);
      // EOT is Internet Explorer's alone; every other kind loads.
      if (file && isFont(file.path) && !/\.eot$/i.test(file.path)) {
        chosen = file.path;
        break;
      }
    }
    if (chosen && family) {
      const descriptors: Record<string, string> = {};
      for (const [property, name] of Object.entries(FONT_DESCRIPTORS)) {
        const value = declarations.get(property);
        if (value) descriptors[name] = value;
      }
      context.fonts.push({ family, descriptors, path: chosen });
      text = text.replace(found[0], "");
    } else if (anyLocal) {
      for (const source of sources) if (resolveReference(source, from).kind === "local") noteMissing(context, from, source);
      text = text.replace(found[0], "");
    } else if (sources.length > 0) {
      // A font from elsewhere would only be refused; the text falls back as it would offline.
      text = text.replace(found[0], "");
    }
  }

  // Everything else a stylesheet points at, as data: URLs.
  const urls = [...text.matchAll(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/g)];
  const replaced = new Map<string, string>();
  for (const found of urls) {
    if (replaced.has(found[0])) continue;
    const target = resolveReference(found[2], from);
    if (target.kind === "external") {
      noteExternal(context, target.url);
      replaced.set(found[0], 'url("about:invalid#elsewhere")');
    }
    if (target.kind !== "local") continue;
    const file = lookup(context.site, target.path);
    if (!file) {
      noteMissing(context, from, found[2]);
      // Settled here, so a sheet this one is inlined into does not resolve it again against its own folder.
      replaced.set(found[0], 'url("about:invalid#missing")');
      continue;
    }
    replaced.set(found[0], `url("data:${file.type};base64,${base64(await context.bytes(file.path))}${target.hash}")`);
  }
  text = text.replace(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/g, (whole) => replaced.get(whole) ?? whole);
  return text;
}

/* ---- JavaScript -------------------------------------------------------------- */

/**
 * Module specifiers and import.meta.url made absolute, so code loaded from
 * a blob: URL still finds its neighbours through the import map. Only
 * relative and root-relative specifiers change; bare ones ("react") and
 * full URLs are left alone.
 */
export function rewriteModule(code: string, path: string, root: string): string {
  const absolute = (specifier: string) => {
    if (!/^(\.{1,2}\/|\/(?!\/))/.test(specifier)) return specifier;
    const target = resolveReference(specifier, path);
    return target.kind === "local" ? `${root}${target.path.split("/").map(encodeURIComponent).join("/")}${target.query}` : specifier;
  };
  return code
    .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"'\n]+)\2/g, (whole, lead: string, quote: string, specifier: string) => `${lead}${quote}${absolute(specifier)}${quote}`)
    .replace(/\bimport\.meta\.url\b/g, JSON.stringify(`${root}${path}`));
}

/** Script text made safe to sit inside a <script> element. */
export function inlineScript(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

/* ---- HTML -------------------------------------------------------------------- */

/** Attributes that point at files, by element. */
const FILE_ATTRIBUTES: [string, string[]][] = [
  ["img", ["src", "srcset"]],
  ["source", ["src", "srcset"]],
  ["video", ["src", "poster"]],
  ["audio", ["src"]],
  ["track", ["src"]],
  ["input", ["src"]],
  ["embed", ["src"]],
  ["object", ["data"]],
  ["iframe", ["src"]],
  ["image", ["href", "xlink:href"]],
];

const LINK_RELS = /\b(icon|apple-touch-icon|mask-icon|manifest|preload|prefetch)\b/i;

const JS_TYPES = /^(|text\/javascript|application\/javascript|module|text\/ecmascript|application\/ecmascript)$/i;

export interface PageOptions {
  context: Context;
  page: string;
  /** Parse HTML without running it: the browser's DOMParser. */
  parse: (html: string) => Document;
  /** Keep the site's scripts; without them the page is shown as its markup and styles alone. */
  runScripts: boolean;
  /** The frame runtime's source. */
  runtime: string;
  /** What the runtime needs besides the page: filled in by the caller. */
  config: Record<string, unknown>;
}

function decodeHtml(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function doctypeOf(document: Document): string {
  const doctype = document.doctype;
  if (!doctype) return "";
  return `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ""}${doctype.systemId ? `${doctype.publicId ? "" : " SYSTEM"} "${doctype.systemId}"` : ""}>\n`;
}

/** The policy each page carries: nothing but inline code and blob: or data: addresses. */
export const FRAME_POLICY = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:; font-src blob: data:; connect-src blob: data:; worker-src blob:; frame-src blob: data:; form-action 'none'";

/** One page, ready to be a frame's srcdoc, and what was found wrong on the way. */
export async function buildPage(options: PageOptions): Promise<string> {
  const { context, page, parse } = options;
  const file = context.site.files.get(page);
  if (!file) throw new Error(`No page ${page}`);
  const document = parse(decodeHtml(await context.bytes(page)));
  const head = document.head ?? document.documentElement.insertBefore(document.createElement("head"), document.body);

  // A page's own <base> decides how its references resolve; the preview sets its own.
  let from = page;
  const baseElement = document.querySelector("base[href]");
  if (baseElement) {
    const target = resolveReference(baseElement.getAttribute("href") ?? "", page);
    if (target.kind === "local") from = `${target.path.endsWith("/") || target.path === "" ? target.path : folderOf(target.path)}index.html`;
  }
  for (const element of [...document.querySelectorAll("base, meta[http-equiv]")]) {
    const equiv = element.getAttribute("http-equiv")?.toLowerCase();
    if (element.tagName.toLowerCase() === "base" || equiv === "content-security-policy") element.remove();
    else if (equiv === "refresh") {
      const found = /^\s*(\d+)\s*[;,]\s*url\s*=\s*['"]?([^'"]+)/i.exec(element.getAttribute("content") ?? "");
      const target = found ? resolveReference(found[2], from) : null;
      if (found && target?.kind === "local") options.config.refresh = { seconds: Number(found[1]), path: target.path, hash: target.hash };
      element.remove();
    }
  }

  // Stylesheets, inlined.
  for (const link of [...document.querySelectorAll("link[href]")]) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase();
    const reference = link.getAttribute("href") ?? "";
    const target = resolveReference(reference, from);
    if (target.kind === "external") {
      // Stylesheets, icons and hints from elsewhere would only be refused; the rest (canonical, alternate) is inert.
      if (/\b(stylesheet|icon|apple-touch-icon|mask-icon|manifest|preload|prefetch|preconnect|dns-prefetch|modulepreload)\b/.test(rel)) {
        if (!/\b(preconnect|dns-prefetch)\b/.test(rel)) noteExternal(context, target.url);
        link.remove();
      }
      continue;
    }
    if (target.kind !== "local") continue;
    const found = lookup(context.site, target.path);
    if (/\bstylesheet\b/.test(rel)) {
      if (/\balternate\b/.test(rel)) continue;
      if (!found || !isCss(found.path)) {
        noteMissing(context, from, reference);
        link.remove();
        continue;
      }
      const style = document.createElement("style");
      const media = link.getAttribute("media");
      if (media) style.setAttribute("media", media);
      style.textContent = (await rewriteCss(new TextDecoder().decode(await context.bytes(found.path)), found.path, context)).replace(/<\/(style)/gi, "<\\/$1");
      link.replaceWith(style);
    } else if (/\bmodulepreload\b/.test(rel)) link.remove();
    else if (LINK_RELS.test(rel)) {
      if (!found) {
        noteMissing(context, from, reference);
        link.remove();
      } else {
        link.removeAttribute("href");
        link.setAttribute("data-keyis-href", `${context.root}${found.path}`);
      }
    }
  }
  for (const style of [...document.querySelectorAll("style")]) style.textContent = (await rewriteCss(style.textContent ?? "", from, context)).replace(/<\/(style)/gi, "<\\/$1");
  for (const element of [...document.querySelectorAll("[style]")]) {
    const value = element.getAttribute("style") ?? "";
    if (/url\(/i.test(value)) element.setAttribute("style", await rewriteCss(value, from, context));
  }

  // A page's own import map is merged into the runtime's, its addresses made virtual.
  for (const script of [...document.querySelectorAll('script[type="importmap"]')]) {
    try {
      const map = JSON.parse(script.textContent ?? "{}") as { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>> };
      const virtual = (value: string) => {
        const target = resolveReference(value, from);
        return target.kind === "local" ? `${context.root}${target.path}${target.query}` : value;
      };
      const imports = Object.fromEntries(Object.entries(map.imports ?? {}).map(([key, value]) => [/^(\.{1,2}\/|\/)/.test(key) ? virtual(key) : key, virtual(value)]));
      const scopes = Object.fromEntries(Object.entries(map.scopes ?? {}).map(([scope, entries]) => [virtual(scope), Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, virtual(value)]))]));
      options.config.importMap = { imports, scopes };
    } catch {
      // A map that does not parse would not have worked on the real site either.
    }
    script.remove();
  }

  // Scripts: inlined, or turned into imports the import map resolves; or taken out.
  const deferred: HTMLScriptElement[] = [];
  for (const script of [...document.querySelectorAll("script")]) {
    const type = (script.getAttribute("type") ?? "").trim();
    if (!JS_TYPES.test(type)) continue;
    const isModule = type.toLowerCase() === "module";
    if (!options.runScripts) {
      script.remove();
      continue;
    }
    const reference = script.getAttribute("src");
    if (reference === null) {
      if (isModule) script.textContent = inlineScript(rewriteModule(script.textContent ?? "", from, context.root));
      continue;
    }
    const target = resolveReference(reference, from);
    if (target.kind === "external") {
      noteExternal(context, target.url);
      script.remove();
      continue;
    }
    if (target.kind !== "local") continue;
    const found = lookup(context.site, target.path);
    if (!found || !isScript(found.path)) {
      noteMissing(context, from, reference);
      script.remove();
      continue;
    }
    const replacement = document.createElement("script");
    if (isModule) {
      replacement.setAttribute("type", "module");
      replacement.textContent = `import ${JSON.stringify(`${context.root}${found.path}`)};`;
      script.replaceWith(replacement);
      continue;
    }
    replacement.textContent = inlineScript(rewriteModule(new TextDecoder().decode(await context.bytes(found.path)), found.path, context.root));
    for (const attribute of [...script.attributes]) if (!["src", "defer", "async", "integrity", "crossorigin", "type"].includes(attribute.name)) replacement.setAttribute(attribute.name, attribute.value);
    if (script.hasAttribute("defer") || script.hasAttribute("async")) {
      deferred.push(replacement);
      script.remove();
    } else script.replaceWith(replacement);
  }
  for (const script of deferred) (document.body ?? document.documentElement).appendChild(script);
  if (!options.runScripts) {
    for (const element of [...document.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || /^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
    // Parsed with scripting off, a <noscript>'s content is already markup: shown as it would be.
    for (const element of [...document.querySelectorAll("noscript")]) element.replaceWith(...element.childNodes);
  }

  // Pictures, video, sound and the rest: marked for the runtime.
  for (const [tag, attributes] of FILE_ATTRIBUTES) {
    for (const element of [...document.getElementsByTagName(tag)]) {
      for (const attribute of attributes) {
        const value = element.getAttribute(attribute);
        if (value === null) continue;
        const references = attribute === "srcset" ? value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean) : [value];
        let local = false;
        let external = false;
        for (const reference of references) {
          const target = resolveReference(reference, from);
          if (target.kind === "external") {
            noteExternal(context, target.url);
            external = true;
          }
          if (target.kind !== "local") continue;
          local = true;
          if (!lookup(context.site, target.path)) noteMissing(context, from, reference);
        }
        if (!local) {
          // From elsewhere: not fetched, so the element shows as it would offline.
          if (external) {
            element.removeAttribute(attribute);
            element.setAttribute(`data-keyis-elsewhere-${attribute.replace(":", "-")}`, value);
          }
          continue;
        }
        // The runtime reads the virtual address and sets the real one.
        const absolute = attribute === "srcset" ? value.replace(/(^|,)(\s*)([^\s,]+)/g, (whole, lead: string, space: string, reference: string) => {
          const target = resolveReference(reference, from);
          return target.kind === "local" ? `${lead}${space}${context.root}${target.path}${target.hash}` : whole;
        }) : (() => {
          const target = resolveReference(value, from);
          return target.kind === "local" ? `${context.root}${target.path}${target.hash}` : value;
        })();
        element.removeAttribute(attribute);
        element.setAttribute(`data-keyis-${attribute.replace(":", "-")}`, absolute);
      }
    }
  }

  // Links to pages that are not there, for the report.
  for (const element of [...document.querySelectorAll("a[href], area[href]")]) {
    const reference = element.getAttribute("href") ?? "";
    const target = resolveReference(reference, from);
    if (target.kind === "local" && !lookup(context.site, target.path)) noteMissing(context, from, reference, true);
  }

  // The policy, the base, the runtime's configuration and the runtime, first in the head.
  const policy = document.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", FRAME_POLICY);
  const base = document.createElement("base");
  base.setAttribute("href", `${context.root}${folderOf(from)}`);
  const config = document.createElement("script");
  config.setAttribute("type", "application/json");
  config.id = "__keyis_config";
  config.textContent = JSON.stringify({ ...options.config, fonts: context.fonts, page }).replace(/</g, "\\u003c");
  const runtime = document.createElement("script");
  runtime.textContent = inlineScript(options.runtime);
  head.prepend(policy, base, config, runtime);
  return `${doctypeOf(document)}${document.documentElement.outerHTML}`;
}

/* ---- The whole site ---------------------------------------------------------- */

export interface Audit extends Issues {
  pages: number;
}

function cssReferences(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [...text.matchAll(/@import\s+(['"])([^'"]+)\1/g)].map((match) => match[2]);
  for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/g)) found.push(match[2]);
  return found;
}

/**
 * Every page and stylesheet read for what it points at, without drawing
 * anything: the links and files that are not in the site, and the
 * addresses on other sites.
 */
export async function auditSite(site: Site, parse: (html: string) => Document, bytes: (path: string) => Promise<Uint8Array>): Promise<Audit> {
  const issues = newIssues();
  const context = { issues } as Context;
  const check = (reference: string, from: string, link = false) => {
    const target = resolveReference(reference, from);
    if (target.kind === "external") noteExternal(context, target.url);
    else if (target.kind === "local" && !lookup(site, target.path)) noteMissing(context, from, reference, link);
  };
  const pages = [...site.files.keys()].filter((path) => /\.(html?|xhtml)$/i.test(path));
  for (const page of pages) {
    const document = parse(decodeHtml(await bytes(page)));
    let from = page;
    const base = document.querySelector("base[href]")?.getAttribute("href");
    if (base) {
      const target = resolveReference(base, page);
      if (target.kind === "local") from = `${target.path.endsWith("/") || target.path === "" ? target.path : folderOf(target.path)}index.html`;
    }
    for (const element of [...document.querySelectorAll("a[href], area[href]")]) check(element.getAttribute("href") ?? "", from, true);
    for (const element of [...document.querySelectorAll("link[href]")]) {
      if (/\b(stylesheet|icon|apple-touch-icon|manifest|preload|modulepreload)\b/i.test(element.getAttribute("rel") ?? "")) check(element.getAttribute("href") ?? "", from);
    }
    for (const element of [...document.querySelectorAll("script[src]")]) check(element.getAttribute("src") ?? "", from);
    for (const [tag, attributes] of FILE_ATTRIBUTES) {
      for (const element of [...document.getElementsByTagName(tag)]) {
        for (const attribute of attributes) {
          const value = element.getAttribute(attribute);
          if (value === null) continue;
          const references = attribute === "srcset" ? value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean) : [value];
          for (const reference of references) check(reference, from);
        }
      }
    }
    for (const style of [...document.querySelectorAll("style")]) for (const reference of cssReferences(style.textContent ?? "")) check(reference, from);
    for (const element of [...document.querySelectorAll("[style]")]) for (const reference of cssReferences(element.getAttribute("style") ?? "")) check(reference, from);
  }
  for (const path of [...site.files.keys()].filter(isCss)) {
    for (const reference of cssReferences(new TextDecoder().decode(await bytes(path)))) check(reference, path);
  }
  issues.missing.sort((a, b) => a.from.localeCompare(b.from) || a.reference.localeCompare(b.reference));
  issues.external.sort();
  return { ...issues, pages: pages.length };
}
