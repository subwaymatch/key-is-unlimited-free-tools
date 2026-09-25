// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { FRAME_RUNTIME } from "@/lib/web/frameRuntime";
import { auditSite, buildPage, FRAME_POLICY, newIssues, rewriteCss, rewriteModule, type Context } from "@/lib/web/rewrite";
import { buildSite, lookup, normalizePath, resolveReference, sharedFolder } from "@/lib/web/site";

const ROOT = "https://key.is/__site__/";

function siteOf(files: Record<string, string | Uint8Array>) {
  const bytes = new Map(Object.entries(files).map(([path, content]) => [path, typeof content === "string" ? new TextEncoder().encode(content) : content]));
  const site = buildSite([...bytes.keys()].map((path) => ({ path, blob: new Blob([bytes.get(path)! as BlobPart]) })));
  const read = async (path: string) => bytes.get(`${site.strippedRoot}${path}`) ?? bytes.get(path)!;
  return { site, read };
}

function contextOf(files: Record<string, string | Uint8Array>): Context {
  const { site, read } = siteOf(files);
  return { site, root: ROOT, bytes: read, issues: newIssues(), fonts: [] };
}

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("the site's files", () => {
  it("resolves references as a browser would, against the file they are in", () => {
    expect(resolveReference("css/a.css", "blog/post.html")).toEqual({ kind: "local", path: "blog/css/a.css", hash: "", query: "" });
    expect(resolveReference("/css/a.css?v=3#x", "blog/post.html")).toEqual({ kind: "local", path: "css/a.css", hash: "#x", query: "?v=3" });
    expect(resolveReference("../img/My%20Photo.png", "blog/post.html")).toMatchObject({ kind: "local", path: "img/My Photo.png" });
    expect(resolveReference("docs/", "index.html")).toMatchObject({ path: "docs/" });
    expect(resolveReference("https://example.com/a.js", "index.html")).toEqual({ kind: "external", url: "https://example.com/a.js" });
    expect(resolveReference("//cdn.example.com/a.js", "index.html")).toEqual({ kind: "external", url: "https://cdn.example.com/a.js" });
    for (const other of ["#top", "mailto:a@b.c", "data:image/png;base64,AA", "javascript:void(0)", "../../../etc/passwd"]) expect(resolveReference(other, "blog/post.html").kind).toBe("other");
    expect(normalizePath("a/./b/../c")).toBe("a/c");
  });

  it("finds pages the way static hosts do", () => {
    const { site } = siteOf({ "index.html": "", "about.html": "", "docs/index.html": "", "docs/guide.html": "" });
    expect(lookup(site, "")?.path).toBe("index.html");
    expect(lookup(site, "about")?.path).toBe("about.html");
    expect(lookup(site, "docs/")?.path).toBe("docs/index.html");
    expect(lookup(site, "docs")?.path).toBe("docs/index.html");
    expect(lookup(site, "docs/guide")?.path).toBe("docs/guide.html");
    expect(lookup(site, "nope")).toBeNull();
  });

  it("takes off the folder a ZIP was made of, and the litter operating systems leave", () => {
    const { site } = siteOf({ "my-site/index.html": "", "my-site/css/a.css": "", "__MACOSX/my-site/._index.html": "", "my-site/.DS_Store": "" });
    expect(site.strippedRoot).toBe("my-site/");
    expect([...site.files.keys()].sort()).toEqual(["css/a.css", "index.html"]);
    expect(site.entry).toBe("index.html");
    expect(sharedFolder(["a/b/c.html", "a/b/d/e.css"])).toBe("a/b/");
    expect(sharedFolder(["index.html", "a/b.css"])).toBe("");
  });
});

describe("stylesheets", () => {
  it("inlines @import, turns local pictures into data: URLs and takes fonts out for the runtime", async () => {
    const context = contextOf({
      "index.html": "",
      "css/main.css": '@import url("base.css") screen;\n.hero { background: url(../img/bg.png) } /* url(ignored.png) */ .x { background: url("https://cdn.example.com/a.png") }',
      "css/base.css": "@font-face { font-family: 'Brand'; src: url(../fonts/brand.eot); src: url(../fonts/brand.woff2) format('woff2'), url(../fonts/brand.woff) format('woff'); font-weight: 700; font-display: swap }\nbody { color: red } .gone { background: url(missing.png) }",
      "img/bg.png": new Uint8Array([137, 80, 78, 71]),
      "fonts/brand.woff2": new Uint8Array([1, 2, 3]),
    });
    const css = await rewriteCss(new TextDecoder().decode(await context.bytes("css/main.css")), "css/main.css", context);
    expect(css).toContain("@media screen {");
    expect(css).toContain("body { color: red }");
    expect(css).toContain('url("data:image/png;base64,iVBORw==")');
    expect(css).toContain('url("about:invalid#elsewhere")');
    expect(css).not.toContain("@font-face");
    expect(css).not.toContain("ignored.png");
    expect(context.fonts).toEqual([{ family: "Brand", descriptors: { weight: "700", display: "swap" }, path: "fonts/brand.woff2" }]);
    expect(context.issues.external).toEqual(["https://cdn.example.com/a.png"]);
    expect(context.issues.missing).toEqual([{ from: "css/base.css", reference: "missing.png", link: false }]);
  });

  it("stops at an @import cycle", async () => {
    const context = contextOf({ "a.css": '@import "b.css"; .a{}', "b.css": '@import "a.css"; .b{}' });
    const css = await rewriteCss(new TextDecoder().decode(await context.bytes("a.css")), "a.css", context, new Set(["a.css"]));
    expect(css.match(/\.a\{\}/g)).toHaveLength(1);
    expect(css.match(/\.b\{\}/g)).toHaveLength(1);
  });
});

describe("scripts", () => {
  it("makes module specifiers and import.meta.url absolute, and leaves bare ones alone", () => {
    const code = 'import{a as b}from"./util.js";import "../lib/x.js";export * from "/shared/y.js";const c=await import("./chunk.js");import React from "react";const u=new URL("./img.png",import.meta.url);';
    expect(rewriteModule(code, "js/main.js", ROOT)).toBe(
      `import{a as b}from"${ROOT}js/util.js";import "${ROOT}lib/x.js";export * from "${ROOT}shared/y.js";const c=await import("${ROOT}js/chunk.js");import React from "react";const u=new URL("./img.png","${ROOT}js/main.js");`,
    );
  });
});

describe("pages", () => {
  const files = {
    "index.html": `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><base href="/"><title>Home</title>
<link rel="stylesheet" href="css/site.css"><link rel="icon" href="favicon.png"><link rel="stylesheet" href="https://fonts.example.com/css">
<script defer src="js/late.js"></script><script src="js/now.js"></script><script type="module" src="js/app.js"></script>
</head><body style="background:url(img/a.png)"><img src="img/a.png" srcset="img/a.png 1x, img/b.png 2x" alt="A"><a href="about">About</a><a href="gone.html">Gone</a><a href="https://example.org">Out</a><noscript><p>No scripts</p></noscript></body></html>`,
    "about.html": "<p>About</p>",
    "css/site.css": "h1 { color: blue }",
    "js/late.js": "window.late = '</script>';",
    "js/now.js": "window.now = 1;",
    "js/app.js": 'import "./dep.js";',
    "js/dep.js": "",
    "img/a.png": new Uint8Array([1]),
    "favicon.png": new Uint8Array([2]),
  };

  it("rebuilds a page to run in the sandbox without asking anything of the network", async () => {
    const context = contextOf(files);
    const html = await buildPage({ context, page: "index.html", parse, runScripts: true, runtime: FRAME_RUNTIME, config: { root: ROOT, token: "t" } });
    const document = parse(html);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    // The preview's policy, base, configuration and runtime come first; the page's own policy is gone.
    const first = [...document.head.children].slice(0, 4);
    expect(first.map((element) => element.tagName)).toEqual(["META", "BASE", "SCRIPT", "SCRIPT"]);
    expect(first[0].getAttribute("content")).toBe(FRAME_POLICY);
    expect(first[1].getAttribute("href")).toBe(ROOT);
    expect(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
    expect(JSON.parse(first[2].textContent!)).toMatchObject({ page: "index.html", token: "t", fonts: [] });
    // The stylesheet inlined, the external one left to be blocked, the icon marked.
    expect([...document.querySelectorAll("style")].map((style) => style.textContent)).toContain("h1 { color: blue }");
    // One from elsewhere is taken out and listed rather than left to be refused.
    expect(document.querySelector('link[href="https://fonts.example.com/css"]')).toBeNull();
    expect(document.querySelector("link[rel=icon]")?.getAttribute("data-keyis-href")).toBe(`${ROOT}favicon.png`);
    // Scripts inlined, the deferred one moved to the end of the body and made safe to embed; the module an import.
    const scripts = [...document.querySelectorAll("script:not([type])")].slice(1).map((script) => script.textContent);
    expect(scripts).toEqual(["window.now = 1;", "window.late = '<\\/script>';"]);
    expect(document.body.lastElementChild?.textContent).toBe("window.late = '<\\/script>';");
    expect(document.querySelector('script[type="module"]')?.textContent).toBe(`import "${ROOT}js/app.js";`);
    // Pictures marked for the runtime, the inline style's picture a data: URL.
    const image = document.querySelector("img")!;
    expect(image.getAttribute("src")).toBeNull();
    expect(image.getAttribute("data-keyis-src")).toBe(`${ROOT}img/a.png`);
    expect(image.getAttribute("data-keyis-srcset")).toBe(`${ROOT}img/a.png 1x, ${ROOT}img/b.png 2x`);
    expect(document.body.getAttribute("style")).toContain("data:image/png;base64,AQ==");
    // What is wrong, for the report.
    expect(context.issues.missing).toEqual([
      { from: "index.html", reference: "img/b.png", link: false },
      { from: "index.html", reference: "gone.html", link: true },
    ]);
    expect(context.issues.external).toEqual(["https://fonts.example.com/css"]);
  });

  it("shows the page as its markup and styles alone when scripts are off", async () => {
    const context = contextOf({ ...files, "index.html": '<body><button onclick="alert(1)">Go</button><a href="javascript:alert(2)">x</a><script>alert(3)</script><noscript><p id="fallback">No scripts</p></noscript></body>' });
    const document = parse(await buildPage({ context, page: "index.html", parse, runScripts: false, runtime: FRAME_RUNTIME, config: { root: ROOT, token: "t" } }));
    expect(document.querySelector("button")?.getAttribute("onclick")).toBeNull();
    expect(document.querySelector("a")?.getAttribute("href")).toBeNull();
    // Only the preview's own two scripts are left.
    expect(document.querySelectorAll("script")).toHaveLength(2);
    expect(document.querySelector("#fallback")?.textContent).toBe("No scripts");
    expect(document.querySelector("noscript")).toBeNull();
  });

  it("follows a page's meta refresh through the runtime, and merges its import map", async () => {
    const context = contextOf({ "index.html": '<meta http-equiv="refresh" content="0; url=docs/"><script type="importmap">{"imports":{"lib":"./vendor/lib.js"}}</script>', "docs/index.html": "", "vendor/lib.js": "" });
    const config: Record<string, unknown> = { root: ROOT, token: "t" };
    const document = parse(await buildPage({ context, page: "index.html", parse, runScripts: true, runtime: FRAME_RUNTIME, config }));
    expect(config.refresh).toEqual({ seconds: 0, path: "docs/", hash: "" });
    expect(config.importMap).toEqual({ imports: { lib: `${ROOT}vendor/lib.js` }, scopes: {} });
    expect(document.querySelector('script[type="importmap"]')).toBeNull();
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });

  it("audits the whole site: broken links, missing files and other sites", async () => {
    const { site, read } = siteOf({ ...files, "about.html": '<a href="index.html">Home</a><a href="team/">Team</a><img src="//cdn.example.com/x.png">', "css/site.css": "@import 'reset.css'; .a{background:url(../img/a.png)}" });
    const audit = await auditSite(site, parse, read);
    expect(audit.pages).toBe(2);
    expect(audit.missing).toEqual([
      { from: "about.html", reference: "team/", link: true },
      { from: "css/site.css", reference: "reset.css", link: false },
      { from: "index.html", reference: "gone.html", link: true },
      { from: "index.html", reference: "img/b.png", link: false },
    ]);
    expect(audit.external).toEqual(["https://cdn.example.com/x.png", "https://example.org", "https://fonts.example.com/css"]);
  });
});
