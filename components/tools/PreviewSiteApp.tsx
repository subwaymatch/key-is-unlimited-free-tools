"use client";

import { ArrowLeft, ArrowRight, Download, FolderOpen, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { saveBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format-utils";
import { FRAME_RUNTIME } from "@/lib/web/frameRuntime";
import { auditSite, buildPage, newIssues, rewriteModule, VIRTUAL_PATH, type Audit } from "@/lib/web/rewrite";
import { buildSite, isFont, isHtml, isScript, lookup, type Site } from "@/lib/web/site";
import { readZip } from "@/lib/zip/archive";
import { requireTool } from "@/lib/tools";

import { DropZone } from "../DropZone";
import { PlainFootnote } from "../PlainToolApp";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import shared from "./CreateQrCodeApp.module.css";
import styles from "./PreviewSiteApp.module.css";

const tool = requireTool("preview-site");

/** Files sent with every page, so the page has them at once; larger ones are sent when asked for. */
const EMBED_BUDGET = 24 * 1024 * 1024;

const WIDTHS = [
  { value: "full", label: "Full width" },
  { value: "1280", label: "Laptop, 1280 px" },
  { value: "768", label: "Tablet, 768 px" },
  { value: "390", label: "Phone, 390 px" },
];

const SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

interface Loaded {
  name: string;
  site: Site;
  bytes: (path: string) => Promise<Uint8Array>;
  embedded: Record<string, { t: string; d: string }>;
  known: Record<string, string>;
  totalBytes: number;
  audit: Audit | null;
}

interface Place {
  path: string;
  hash: string;
}

interface LogEntry {
  level: string;
  text: string;
  page: string;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** A page the preview draws itself: a picture, a file it cannot show, or an address that is not there. */
function placeholderPage(body: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'"><style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem;color:#1f2937}code{background:#f1f5f9;padding:0 .25rem;border-radius:4px}img{max-width:100%}</style></head><body>${body}</body></html>`;
}

async function readInput(files: File[]): Promise<{ name: string; entries: { path: string; blob: Blob }[] }> {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    const entries = await readZip(files[0]);
    return { name: files[0].name, entries: entries.map((entry) => ({ path: entry.path, blob: entry.blob })) };
  }
  const relative = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const folder = relative(files[0]).split("/")[0];
  return { name: files.length === 1 ? files[0].name : relative(files[0]).includes("/") ? `${folder}/` : `${files.length} files`, entries: files.map((file) => ({ path: relative(file), blob: file })) };
}

function reportMarkdown(loaded: Loaded, blocked: string[], logs: LogEntry[]): string {
  const lines = [`# Site check: ${loaded.name}`, "", `- Pages: ${loaded.site.pages.length}`, `- Files: ${loaded.site.files.size}, ${formatBytes(loaded.totalBytes)}`, ""];
  const audit = loaded.audit;
  if (audit) {
    const links = audit.missing.filter((entry) => entry.link);
    const resources = audit.missing.filter((entry) => !entry.link);
    lines.push(`## Broken links (${links.length})`, "", ...(links.length ? links.map((entry) => `- ${entry.from}: \`${entry.reference}\``) : ["None."]), "");
    lines.push(`## Missing files (${resources.length})`, "", ...(resources.length ? resources.map((entry) => `- ${entry.from}: \`${entry.reference}\``) : ["None."]), "");
    lines.push(`## Addresses on other sites (${audit.external.length})`, "", ...(audit.external.length ? audit.external.map((url) => `- ${url}`) : ["None."]), "");
  }
  if (blocked.length) lines.push(`## Requested while previewing, not fetched (${blocked.length})`, "", ...blocked.map((url) => `- ${url}`), "");
  if (logs.length) lines.push(`## Errors and warnings while previewing (${logs.length})`, "", ...logs.map((entry) => `- ${entry.level} on ${entry.page}: ${entry.text}`), "");
  return `${lines.join("\n")}\n`;
}

/** A static site from a ZIP or a folder, shown page by page in a sandbox that cannot reach anything. */
export function PreviewSiteApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ places: Place[]; index: number }>({ places: [], index: -1 });
  const [frame, setFrame] = useState<{ html: string; key: number; page: string; file: string | null } | null>(null);
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [runScripts, setRunScripts] = useState(true);
  const [width, setWidth] = useState("full");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [reloads, setReloads] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const token = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random())), []);
  const root = typeof window === "undefined" ? "" : `${window.location.origin}${VIRTUAL_PATH}`;

  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const open = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setLoading("Reading the files...");
      try {
        const { name, entries } = await readInput(files);
        const site = buildSite(entries);
        if (site.pages.length === 0) throw new Error("There is no web page among these files: a site needs at least one .html file.");
        const cache = new Map<string, Promise<Uint8Array>>();
        const bytes = (path: string) => {
          let pending = cache.get(path);
          if (!pending) {
            const file = site.files.get(path);
            pending = file ? file.blob.arrayBuffer().then((buffer) => new Uint8Array(buffer)) : Promise.resolve(new Uint8Array(0));
            cache.set(path, pending);
          }
          return pending;
        };
        setLoading("Preparing the files...");
        const known: Record<string, string> = {};
        const embedded: Record<string, { t: string; d: string }> = {};
        let used = 0;
        for (const file of [...site.files.values()].sort((a, b) => a.blob.size - b.blob.size)) {
          known[file.path] = file.type;
          const always = isScript(file.path) || isFont(file.path);
          if (!always && (used + file.blob.size > EMBED_BUDGET || (/^(video|audio)\//.test(file.type) && file.blob.size > 1024 * 1024))) continue;
          let content = await bytes(file.path);
          if (isScript(file.path)) content = new TextEncoder().encode(rewriteModule(new TextDecoder().decode(content), file.path, root));
          embedded[file.path] = { t: file.type, d: base64(content) };
          used += file.blob.size;
        }
        const totalBytes = [...site.files.values()].reduce((sum, file) => sum + file.blob.size, 0);
        setLoaded({ name, site, bytes, embedded, known, totalBytes, audit: null });
        setLogs([]);
        setBlocked([]);
        setTrail({ places: [{ path: site.entry, hash: "" }], index: 0 });
        setLoading(null);
        const audit = await auditSite(site, parse, bytes);
        setLoaded((previous) => (previous && previous.site === site ? { ...previous, audit } : previous));
      } catch (caught) {
        setLoading(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [root],
  );

  const place = trail.index >= 0 ? trail.places[trail.index] : null;

  // Whenever the place or the scripts setting changes, the page is built again.
  useEffect(() => {
    if (!loaded || !place) return;
    let live = true;
    const show = async () => {
      const found = lookup(loaded.site, place.path);
      const key = ++counter.current;
      setTitle("");
      setAddress(`/${place.path}${place.hash}`);
      if (!found) {
        setFrame({ key, page: place.path, file: null, html: placeholderPage(`<h1>Not in the files</h1><p>This site has no page at <code>/${escapeHtml(place.path)}</code>. On a real server this would be a 404.</p>`) });
        return;
      }
      if (!isHtml(found.path)) {
        const picture = /^image\//.test(found.type);
        const data = picture ? `data:${found.type};base64,${base64(await loaded.bytes(found.path))}` : "";
        if (live) setFrame({ key, page: found.path, file: found.path, html: placeholderPage(picture ? `<img src="${data}" alt="${escapeHtml(found.path)}">` : `<p>This link is to a file, <code>${escapeHtml(found.path)}</code> (${escapeHtml(found.type)}, ${formatBytes(found.blob.size)}), not a page. Save it to open it.</p>`) });
        return;
      }
      const context = { site: loaded.site, root, bytes: loaded.bytes, issues: newIssues(), fonts: [] };
      const html = await buildPage({ context, page: found.path, parse, runScripts, runtime: FRAME_RUNTIME, config: { root, token, known: loaded.known, files: loaded.embedded, hash: place.hash } });
      if (live) setFrame({ key, page: found.path, file: null, html });
    };
    show().catch((caught) => live && setError(caught instanceof Error ? caught.message : String(caught)));
    return () => {
      live = false;
    };
  }, [loaded, place, runScripts, root, token, reloads]);

  const navigate = useCallback((path: string, hash: string) => {
    setTrail((previous) => ({ places: [...previous.places.slice(0, previous.index + 1), { path, hash }], index: previous.index + 1 }));
  }, []);

  // Messages from the page: files it asks for, links followed, what happened in it.
  useEffect(() => {
    if (!loaded) return;
    const onMessage = (event: MessageEvent) => {
      const target = frameRef.current?.contentWindow;
      const data = event.data as Record<string, unknown> | null;
      if (!target || event.source !== target || !data || data.__keyis !== token) return;
      const page = frame?.page ?? "";
      switch (data.type) {
        case "request": {
          const path = String(data.path);
          const file = loaded.site.files.get(path);
          void (file ? file.blob.arrayBuffer() : Promise.resolve(null)).then((buffer) => {
            target.postMessage({ __keyis: token, type: "file", id: data.id, path, mime: file?.type ?? "", buffer }, "*", buffer ? [buffer] : []);
          });
          break;
        }
        case "navigate":
          navigate(String(data.path ?? "").slice(0, 2000), String(data.hash ?? "").slice(0, 500));
          break;
        case "loaded":
          setTitle(String(data.title ?? "").slice(0, 200));
          break;
        case "log":
          setLogs((previous) => [...previous.slice(-199), { level: data.level === "warn" ? "warning" : "error", text: String(data.text ?? "").slice(0, 600), page }]);
          break;
        case "blocked":
          setBlocked((previous) => (previous.includes(String(data.url)) || previous.length >= 200 ? previous : [...previous, String(data.url).slice(0, 500)]));
          break;
        case "missing":
          setLogs((previous) => [...previous.slice(-199), { level: "error", text: `Not in the files: /${String(data.path ?? "").slice(0, 300)}`, page }]);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loaded, token, frame, navigate]);

  const go = (entry: string) => {
    const value = entry.trim().replace(/^\//, "");
    const hashAt = value.indexOf("#");
    navigate(hashAt >= 0 ? value.slice(0, hashAt) : value, hashAt >= 0 ? value.slice(hashAt) : "");
  };

  const audit = loaded?.audit;
  const links = audit?.missing.filter((entry) => entry.link) ?? [];
  const resources = audit?.missing.filter((entry) => !entry.link) ?? [];

  return (
    <ToolFrame
      tool={tool}
      lead="Drop a website's files - a ZIP of a build, a folder, a docs or report export someone sent - and click through it as if it were online, with its scripts running in a locked-down sandbox, then see its broken links, missing files and errors. Nothing is uploaded and nothing is fetched."
      footer={
        <PlainFootnote note="Each page is shown in a sandboxed frame with no origin of its own, so the site's scripts cannot read this site's storage or pages, and a policy in every page lets it load nothing from the network: its pictures, styles, scripts and fonts come from the files you dropped, turned into in-memory addresses. Addresses on other sites - fonts from Google, a script from a CDN - are listed rather than fetched, which is also a check that a site stands on its own. Root-relative links, folders with an index.html and addresses without .html work as they do on Netlify, GitHub Pages or Cloudflare. Single-page apps that route by the address rather than a # show their first page only, since the preview has no real address to route by." />
      }
    >
      <DropZone onFiles={(files) => void open(files)} compact={loaded !== null} warmsEngine={false} accept=".zip,.html,.htm,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.ico,.woff,.woff2,.ttf,.otf,.mp4,.webm,.mp3,.txt,.xml,*/*" inputLabel="Choose files" headline="Drop a site's ZIP, or its files" subhead="Or choose the folder below; index.html is shown first" />
      <div style={{ marginTop: "0.625rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input ref={folderRef} type="file" multiple hidden onChange={(event) => void open([...(event.target.files ?? [])]).then(() => void (event.target.value = ""))} aria-label="Choose a folder" />
        <Button onClick={() => folderRef.current?.click()}>
          <FolderOpen aria-hidden="true" size={16} /> Choose a folder
        </Button>
        {loading && <span className={shared.hint}>{loading}</span>}
      </div>
      {error && (
        <p className={shared.error} role="alert">
          {error}
        </p>
      )}

      {loaded && frame && (
        <>
          <section className={styles.card} aria-label="Preview">
            <div className={styles.toolbar}>
              <Button onClick={() => setTrail((previous) => ({ ...previous, index: Math.max(0, previous.index - 1) }))} disabled={trail.index <= 0} aria-label="Back">
                <ArrowLeft aria-hidden="true" size={15} />
              </Button>
              <Button onClick={() => setTrail((previous) => ({ ...previous, index: Math.min(previous.places.length - 1, previous.index + 1) }))} disabled={trail.index >= trail.places.length - 1} aria-label="Forward">
                <ArrowRight aria-hidden="true" size={15} />
              </Button>
              <Button onClick={() => setReloads((count) => count + 1)} aria-label="Reload">
                <RotateCw aria-hidden="true" size={15} />
              </Button>
              <input
                className={styles.address}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") go(address);
                }}
                aria-label="Address in the site"
                spellCheck={false}
              />
              <select className={styles.select} value={loaded.site.pages.includes(frame.page) ? frame.page : ""} onChange={(event) => event.target.value && navigate(event.target.value, "")} aria-label="Pages">
                <option value="">{loaded.site.pages.length} pages</option>
                {loaded.site.pages.map((page) => (
                  <option key={page} value={page}>
                    /{page}
                  </option>
                ))}
              </select>
              <select className={styles.select} value={width} onChange={(event) => setWidth(event.target.value)} aria-label="Width">
                {WIDTHS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className={styles.check}>
                <input type="checkbox" checked={runScripts} onChange={(event) => setRunScripts(event.target.checked)} /> Run its scripts
              </label>
            </div>
            <div className={styles.stage}>
              <iframe key={frame.key} ref={frameRef} className={styles.frame} style={{ width: width === "full" ? "100%" : `${width}px` }} sandbox={SANDBOX} srcDoc={frame.html} title={`Preview of ${loaded.name}`} />
            </div>
            <div className={styles.status}>
              <span>
                {title ? `${title} - ` : ""}
                {loaded.name}: {loaded.site.pages.length} {loaded.site.pages.length === 1 ? "page" : "pages"}, {loaded.site.files.size} files, {formatBytes(loaded.totalBytes)}
              </span>
              {frame.file && (
                <Button
                  onClick={() => {
                    const file = loaded.site.files.get(frame.file!);
                    if (file) saveBlob(file.path.split("/").pop() || "file", file.blob);
                  }}
                >
                  <Download aria-hidden="true" size={15} /> Save {frame.file.split("/").pop()}
                </Button>
              )}
            </div>
          </section>

          <div className={styles.report}>
            <section className={styles.section}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
                <h2 className={styles.sectionTitle}>{audit ? `Broken links ${links.length}, missing files ${resources.length}, addresses elsewhere ${audit.external.length}` : "Checking every page..."}</h2>
                <Button onClick={() => saveBlob(`${loaded.name.replace(/\.zip$|\/$/i, "") || "site"}-check.md`, new Blob([reportMarkdown(loaded, blocked, logs)], { type: "text/markdown;charset=utf-8" }))} disabled={!audit}>
                  <Download aria-hidden="true" size={15} /> Save the report
                </Button>
              </div>
              {audit && (
                <div className={styles.list}>
                  {[...links, ...resources].slice(0, 40).map((entry) => (
                    <p key={`${entry.from}|${entry.reference}`}>
                      <span className={styles.muted}>{entry.link ? "Link" : "File"} in {entry.from}: </span>
                      <span className={styles.mono}>{entry.reference}</span>
                    </p>
                  ))}
                  {links.length + resources.length > 40 && <p className={styles.muted}>And {links.length + resources.length - 40} more, in the report.</p>}
                  {audit.external.slice(0, 15).map((url) => (
                    <p key={url}>
                      <span className={styles.muted}>Not fetched: </span>
                      <span className={styles.mono}>{url}</span>
                    </p>
                  ))}
                  {audit.external.length > 15 && <p className={styles.muted}>And {audit.external.length - 15} more addresses elsewhere, in the report.</p>}
                  {links.length + resources.length + audit.external.length === 0 && <p className={styles.muted}>Every link and file reference points at a file in the site, and nothing is loaded from elsewhere.</p>}
                </div>
              )}
            </section>
            {logs.length > 0 && (
              <section className={styles.section}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
                  <h2 className={styles.sectionTitle}>Errors in the pages ({logs.length})</h2>
                  <Button variant="ghost" onClick={() => setLogs([])}>
                    Clear
                  </Button>
                </div>
                <div className={styles.list}>
                  {logs.slice(-30).map((entry, index) => (
                    <p key={index} className={entry.level === "error" ? styles.error : styles.warn}>
                      <span className={styles.muted}>/{entry.page}: </span>
                      <span className={styles.mono}>{entry.text}</span>
                    </p>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </ToolFrame>
  );
}
