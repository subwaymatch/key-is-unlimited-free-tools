/**
 * A Jupyter notebook as one web page: its Markdown rendered, its code in
 * blocks with the numbers Jupyter gave them, and its outputs - text,
 * tables, pictures and tracebacks - as the notebook last showed them.
 *
 * A notebook's outputs are stored in it as MIME bundles, so a chart is
 * already a base64 PNG and a pandas table already HTML; the page shows the
 * richest form each output carries that a page can show without running
 * anything. Scripts are dropped - an interactive plot's JavaScript cannot
 * run in a file opened from disk without the libraries it expects - and
 * such an output falls back to its image or its text.
 */
import { escapeHtml, htmlDocument, renderMarkdown } from "../text/markdown";
import { readNotebook } from "./notebook";

export interface NotebookHtmlOptions {
  /** Show the code cells, or only their outputs, for a report. */
  showCode: boolean;
  /** Show the In [n] numbers beside cells. */
  showPrompts: boolean;
}

type Bundle = Record<string, unknown>;

function joined(value: unknown): string {
  if (Array.isArray(value)) return value.map((part) => (typeof part === "string" ? part : "")).join("");
  return typeof value === "string" ? value : "";
}

/** ANSI colour codes, which tracebacks are full of, taken out. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function withoutScripts(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** The richest form of an output a static page can show. */
export function renderBundle(data: Bundle): string {
  const text = (key: string) => joined(data[key]);
  if (typeof data["image/png"] === "string" || Array.isArray(data["image/png"])) return `<img src="data:image/png;base64,${text("image/png").replace(/\s/g, "")}" alt="">`;
  if (typeof data["image/jpeg"] === "string" || Array.isArray(data["image/jpeg"])) return `<img src="data:image/jpeg;base64,${text("image/jpeg").replace(/\s/g, "")}" alt="">`;
  if (data["image/svg+xml"] !== undefined) return `<div class="svg">${withoutScripts(text("image/svg+xml"))}</div>`;
  if (data["text/html"] !== undefined) {
    const html = text("text/html");
    // An output that is only a script, as an interactive plot is, says nothing without it.
    if (withoutScripts(html).replace(/<[^>]+>/g, "").trim() !== "" || /<(table|img|svg|div)\b/i.test(withoutScripts(html))) return `<div class="html">${withoutScripts(html)}</div>`;
  }
  if (data["text/markdown"] !== undefined) return `<div class="markdown">${renderMarkdown(text("text/markdown")).html}</div>`;
  if (data["text/latex"] !== undefined) return `<pre class="latex">${escapeHtml(text("text/latex"))}</pre>`;
  if (data["application/json"] !== undefined) return `<pre>${escapeHtml(JSON.stringify(data["application/json"], null, 2))}</pre>`;
  if (data["text/plain"] !== undefined) return `<pre>${escapeHtml(stripAnsi(text("text/plain")))}</pre>`;
  return "";
}

function renderOutput(output: Record<string, unknown>): string {
  switch (output.output_type) {
    case "stream":
      return `<pre class="${output.name === "stderr" ? "stderr" : "stdout"}">${escapeHtml(stripAnsi(joined(output.text)))}</pre>`;
    case "execute_result":
    case "display_data":
      return renderBundle((output.data as Bundle) ?? {});
    case "error": {
      const traceback = Array.isArray(output.traceback) ? output.traceback.map((line) => stripAnsi(String(line))).join("\n") : `${String(output.ename ?? "Error")}: ${String(output.evalue ?? "")}`;
      return `<pre class="error">${escapeHtml(traceback)}</pre>`;
    }
    default:
      return "";
  }
}

const NOTEBOOK_CSS = `
body { max-width: 58rem; }
.cell { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0 .75rem; margin: 1rem 0; }
.cell.no-prompt { grid-template-columns: 1fr; }
.prompt { font: .8em ui-monospace, Menlo, Consolas, monospace; color: #6e7781; text-align: right; padding-top: 1em; }
.no-prompt .prompt { display: none; }
.cell pre { margin: 0 0 .5rem; }
.source pre { border-left: 3px solid #0969da; }
.output pre { background: none; padding: .25em 0; }
.output .stderr { background: #fff8c5; padding: .5em; }
.output .error { background: #ffebe9; padding: .5em; color: #82071e; }
.output img { max-width: 100%; }
.output table { font-size: .875em; }
.markdown-cell { grid-column: 1 / -1; }
@media (prefers-color-scheme: dark) {
  .output .stderr { background: #3b2e00; }
  .output .error { background: #4a1014; color: #ffb3b3; }
}
`.trim();

export interface NotebookHtml {
  html: string;
  title: string;
  cells: { code: number; markdown: number; outputs: number; images: number };
  language: string;
}

/** The notebook as a page. */
export function notebookToHtml(text: string, fallbackTitle: string, options: NotebookHtmlOptions): NotebookHtml {
  const notebook = readNotebook(text);
  const metadata = (notebook.metadata ?? {}) as Record<string, unknown>;
  const language = String(((metadata.language_info as Record<string, unknown> | undefined)?.name ?? (metadata.kernelspec as Record<string, unknown> | undefined)?.language) ?? "python");
  const counts = { code: 0, markdown: 0, outputs: 0, images: 0 };
  let title: string | null = null;
  const parts: string[] = [];
  const cellClass = options.showPrompts ? "cell" : "cell no-prompt";
  for (const raw of notebook.cells as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const cell = raw as Record<string, unknown>;
    const source = joined(cell.source);
    if (cell.cell_type === "markdown") {
      counts.markdown += 1;
      const rendered = renderMarkdown(source);
      title ??= rendered.title;
      // Attachments pasted into a Markdown cell are referenced as attachment:name.
      let html = rendered.html;
      const attachments = (cell.attachments ?? {}) as Record<string, Bundle>;
      for (const [name, bundle] of Object.entries(attachments)) {
        const [mime, data] = Object.entries(bundle)[0] ?? [];
        if (mime && typeof data === "string") html = html.split(`attachment:${name}`).join(`data:${mime};base64,${data}`);
      }
      parts.push(`<div class="${cellClass}"><div class="markdown-cell">${html}</div></div>`);
    } else if (cell.cell_type === "code") {
      counts.code += 1;
      const outputs = Array.isArray(cell.outputs) ? (cell.outputs as Record<string, unknown>[]) : [];
      counts.outputs += outputs.length;
      counts.images += outputs.filter((output) => output.data && typeof output.data === "object" && ("image/png" in (output.data as Bundle) || "image/jpeg" in (output.data as Bundle))).length;
      const count = typeof cell.execution_count === "number" ? String(cell.execution_count) : " ";
      if (options.showCode && source.trim() !== "") parts.push(`<div class="${cellClass}"><div class="prompt">In [${count}]:</div><div class="source"><pre><code class="language-${escapeHtml(language)}">${escapeHtml(source)}</code></pre></div></div>`);
      const rendered = outputs.map(renderOutput).filter(Boolean);
      if (rendered.length > 0) parts.push(`<div class="${cellClass}"><div class="prompt">${outputs.some((output) => output.output_type === "execute_result") ? `Out [${count}]:` : ""}</div><div class="output">${rendered.join("\n")}</div></div>`);
    } else if (cell.cell_type === "raw") {
      parts.push(`<div class="${cellClass}"><div class="markdown-cell"><pre>${escapeHtml(source)}</pre></div></div>`);
    }
  }
  const pageTitle = title ?? fallbackTitle;
  return { html: htmlDocument(pageTitle, `${parts.join("\n")}\n`, NOTEBOOK_CSS), title: pageTitle, cells: counts, language };
}
