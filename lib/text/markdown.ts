/**
 * Markdown as HTML: the CommonMark blocks and inlines people write, plus
 * GitHub's tables, task lists, strikethrough and bare links.
 *
 * Blocks are read line by line - fenced and indented code, headings of
 * both kinds, rules, block quotes and lists nested by indentation, tables,
 * raw HTML and paragraphs - and each block's text is then run through the
 * inline pass: code spans and links are set aside first so nothing inside
 * them is taken for emphasis, the rest is escaped, emphasis is marked, and
 * what was set aside is put back. It is not a conformance-tested CommonMark
 * implementation, and the page says so; it renders READMEs, notes and docs
 * the way GitHub does in every case that comes up in practice.
 */

export interface MarkdownOptions {
  /** Let raw HTML in the source through; escaped as text when false. */
  allowHtml: boolean;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface MarkdownResult {
  html: string;
  headings: Heading[];
  /** The first heading's text, for a page title. */
  title: string | null;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A heading's text as an anchor, the way GitHub makes them. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** A URL safe to put in an href: javascript: and data: links (other than pictures) are dropped. */
function safeUrl(url: string, image = false): string {
  const trimmed = url.trim().replace(/^<|>$/g, "");
  if (/^\s*(javascript|vbscript):/i.test(trimmed)) return "#";
  if (/^\s*data:/i.test(trimmed) && !(image && /^\s*data:image\/(png|jpe?g|gif|webp|svg\+xml)/i.test(trimmed))) return "#";
  return trimmed;
}

/* ---- Inlines -------------------------------------------------------------- */

interface InlineContext {
  references: Map<string, { url: string; title: string | null }>;
  options: MarkdownOptions;
}

const PLACEHOLDER = "\u0000";

/** A block's text as inline HTML. */
export function renderInline(source: string, context: InlineContext): string {
  const stash: string[] = [];
  const keep = (html: string) => {
    stash.push(html);
    return `${PLACEHOLDER}${stash.length - 1}${PLACEHOLDER}`;
  };
  let text = source;

  // Backslash escapes: the escaped character is literal from here on.
  text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_, ch: string) => keep(escapeHtml(ch)));

  // Code spans: a run of backticks closed by a run of the same length.
  text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks: string, code: string) => {
    const trimmed = /^ .* $/.test(code) && code.trim() !== "" ? code.slice(1, -1) : code;
    return keep(`<code>${escapeHtml(trimmed.replace(/\n/g, " "))}</code>`);
  });

  // Autolinks in angle brackets, then raw HTML tags when allowed.
  text = text.replace(/<((?:https?|ftp|mailto):[^\s<>]+)>/gi, (_, url: string) => keep(`<a href="${escapeHtml(safeUrl(url))}">${escapeHtml(url)}</a>`));
  text = text.replace(/<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>/g, (_, address: string) => keep(`<a href="mailto:${escapeHtml(address)}">${escapeHtml(address)}</a>`));
  if (context.options.allowHtml) text = text.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\/?>|<!--[\s\S]*?-->/g, (tag) => keep(/^<\/?script/i.test(tag) ? "" : tag));

  // Images and links: inline [text](url "title") and reference [text][ref] forms.
  const link = (image: boolean, label: string, url: string, title: string | null) => {
    const attributes = title ? ` title="${escapeHtml(title)}"` : "";
    if (image) return keep(`<img src="${escapeHtml(safeUrl(url, true))}" alt="${escapeHtml(label.replace(/[*_`]/g, ""))}"${attributes}>`);
    return keep(`<a href="${escapeHtml(safeUrl(url))}"${attributes}>${renderInline(label, context)}</a>`);
  };
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g, (_, bang: string, label: string, url: string, title?: string) => link(bang === "!", label, url, title ? title.slice(1, -1) : null));
    text = text.replace(/(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\](?:\[([^\]]*)\])?/g, (match, bang: string, label: string, ref?: string) => {
      const key = (ref && ref.trim() !== "" ? ref : label).trim().toLowerCase().replace(/\s+/g, " ");
      const found = context.references.get(key);
      if (!found) return match;
      return link(bang === "!", label, found.url, found.title);
    });
  }

  // Bare links, as GitHub makes them.
  text = text.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;"')\]!?*_~])/g, (_, before: string, url: string) => `${before}${keep(`<a href="${escapeHtml(url.startsWith("www.") ? `http://${url}` : url)}">${escapeHtml(url)}</a>`)}`);

  text = escapeHtml(text);

  // Emphasis, strongest first; underscores only at word edges, as CommonMark has it.
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1(?![*_])/g, (match, mark: string, inner: string, offset: number, whole: string) => {
    if (mark === "__" && (/\w/.test(whole[offset - 1] ?? "") || /\w/.test(whole[offset + match.length] ?? ""))) return match;
    return `<strong>${inner}</strong>`;
  });
  text = text.replace(/(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\1(?![*_])/g, (match, mark: string, inner: string, offset: number, whole: string) => {
    if (mark === "_" && (/\w/.test(whole[offset - 1] ?? "") || /\w/.test(whole[offset + match.length] ?? ""))) return match;
    return `<em>${inner}</em>`;
  });
  text = text.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");

  // Hard line breaks: two spaces or a backslash before the newline.
  text = text.replace(/(?: {2,}|\\)\n/g, "<br>\n");

  return text.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g"), (_, index: string) => stash[Number(index)]);
}

/* ---- Blocks --------------------------------------------------------------- */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; info: string; text: string }
  | { type: "rule" }
  | { type: "quote"; blocks: Block[] }
  | { type: "list"; ordered: boolean; start: number; loose: boolean; items: { task: boolean | null; blocks: Block[] }[] }
  | { type: "table"; align: ("left" | "center" | "right" | null)[]; header: string[]; rows: string[][] }
  | { type: "html"; text: string };

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const BULLET = /^( {0,3})([-*+])([ \t]+|$)(.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)(.*)$/;
const HTML_BLOCK = /^ {0,3}<(\/?(?:address|article|aside|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|video|audio|picture|img|center|iframe)\b|!--)/i;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let index = 0; index < row.length; index += 1) {
    const ch = row[index];
    if (ch === "\\" && row[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** The width of leading whitespace, tabs counted to the next multiple of four. */
function indentOf(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

function stripIndent(line: string, count: number): string {
  let width = 0;
  let index = 0;
  while (index < line.length && width < count && (line[index] === " " || line[index] === "\t")) {
    width += line[index] === "\t" ? 4 - (width % 4) : 1;
    index += 1;
  }
  return line.slice(index);
}

function parseBlocks(lines: string[], references: InlineContext["references"]): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", text: paragraph.join("\n").trim() });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      flush();
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const [, indent, marker, info] = fence;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[index])) {
        body.push(stripIndent(lines[index], indent.length));
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", info, text: body.join("\n") });
      continue;
    }

    if (paragraph.length === 0 && indentOf(line) >= 4) {
      const body: string[] = [];
      while (index < lines.length && (indentOf(lines[index]) >= 4 || lines[index].trim() === "")) {
        body.push(stripIndent(lines[index], 4));
        index += 1;
      }
      while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
      blocks.push({ type: "code", info: "", text: body.join("\n") });
      continue;
    }

    // Setext headings: a line of = or - under a paragraph.
    if (paragraph.length > 0 && /^ {0,3}(=+|-+)[ \t]*$/.test(line)) {
      const level = line.trim()[0] === "=" ? 1 : 2;
      blocks.push({ type: "heading", level, text: paragraph.join(" ").trim() });
      paragraph = [];
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      flush();
      blocks.push({ type: "heading", level: atx[1].length, text: (atx[2] ?? "").trim() });
      index += 1;
      continue;
    }

    // Link reference definitions, which render nothing.
    const definition = paragraph.length === 0 ? /^ {0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(line) : null;
    if (definition) {
      const key = definition[1].trim().toLowerCase().replace(/\s+/g, " ");
      if (!references.has(key)) references.set(key, { url: definition[2].replace(/^<|>$/g, ""), title: definition[3] ? definition[3].slice(1, -1) : null });
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      flush();
      const inner: string[] = [];
      while (index < lines.length && lines[index].trim() !== "" && (/^ {0,3}>/.test(lines[index]) || inner.length > 0)) {
        if (!/^ {0,3}>/.test(lines[index]) && (RULE.test(lines[index]) || ATX.test(lines[index]) || FENCE.test(lines[index]))) break;
        inner.push(lines[index].replace(/^ {0,3}> ?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(inner, references) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if ((bullet || ordered) && !(paragraph.length > 0 && ordered && ordered[2] !== "1") && !(paragraph.length > 0 && (bullet?.[4] ?? ordered?.[5] ?? "").trim() === "")) {
      flush();
      const isOrdered = !bullet;
      const marker = bullet ? bullet[2] : ordered![3];
      const items: { task: boolean | null; blocks: Block[] }[] = [];
      let loose = false;
      let sawBlank = false;
      while (index < lines.length) {
        const current = lines[index];
        const itemMatch = isOrdered ? ORDERED.exec(current) : BULLET.exec(current);
        const sameList = itemMatch && (isOrdered ? itemMatch[3] === marker : itemMatch[2] === marker);
        if (!sameList || !itemMatch) break;
        const lead = itemMatch[1].length + (isOrdered ? itemMatch[2].length + 1 : 1);
        const spacing = (isOrdered ? itemMatch[4] : itemMatch[3]).length;
        const content = isOrdered ? itemMatch[5] : itemMatch[4];
        const width = lead + (spacing > 4 || spacing === 0 ? 1 : spacing);
        const body = [content];
        index += 1;
        let blankInItem = false;
        while (index < lines.length) {
          const next = lines[index];
          if (next.trim() === "") {
            body.push("");
            blankInItem = true;
            index += 1;
            continue;
          }
          if (indentOf(next) >= width) {
            body.push(stripIndent(next, width));
            index += 1;
            continue;
          }
          // A lazy continuation line of the item's paragraph.
          if (!blankInItem && !BULLET.test(next) && !ORDERED.test(next) && !RULE.test(next) && !ATX.test(next) && !FENCE.test(next) && !/^ {0,3}>/.test(next)) {
            body.push(next.trim());
            index += 1;
            continue;
          }
          break;
        }
        while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
        if (sawBlank) loose = true;
        if (blankInItem && body.some((entry, position) => entry.trim() === "" && position < body.length - 1)) loose = true;
        sawBlank = lines[index - 1]?.trim() === "" && index < lines.length;
        let task: boolean | null = null;
        const taskMatch = /^\[([ xX])\][ \t]+/.exec(body[0] ?? "");
        if (taskMatch) {
          task = taskMatch[1] !== " ";
          body[0] = body[0].slice(taskMatch[0].length);
        }
        items.push({ task, blocks: parseBlocks(body, references) });
      }
      blocks.push({ type: "list", ordered: isOrdered, start: ordered ? Number(ordered[2]) : 1, loose, items });
      continue;
    }

    // Tables: a header row, then a delimiter row with a matching number of cells.
    if (paragraph.length === 0 && line.includes("|") && index + 1 < lines.length && DELIMITER_ROW.test(lines[index + 1])) {
      const header = splitRow(line);
      const delimiters = splitRow(lines[index + 1]);
      if (delimiters.length === header.length) {
        const align = delimiters.map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null));
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|")) {
          const cells = splitRow(lines[index]);
          rows.push(header.map((_, position) => cells[position] ?? ""));
          index += 1;
        }
        blocks.push({ type: "table", align, header, rows });
        continue;
      }
    }

    if (paragraph.length === 0 && HTML_BLOCK.test(line)) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trim() !== "") {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "html", text: body.join("\n") });
      continue;
    }

    paragraph.push(line.replace(/^ {0,3}/, ""));
    index += 1;
  }
  flush();
  return blocks;
}

/** Markdown as HTML, with the headings found along the way. */
export function renderMarkdown(source: string, options: MarkdownOptions = { allowHtml: true }): MarkdownResult {
  const lines = source.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").split("\n");
  const references: InlineContext["references"] = new Map();
  const blocks = parseBlocks(lines, references);
  const context: InlineContext = { references, options };
  const headings: Heading[] = [];
  const ids = new Map<string, number>();

  const render = (list: Block[], tight: boolean): string => {
    const out: string[] = [];
    for (const block of list) {
      switch (block.type) {
        case "heading": {
          const html = renderInline(block.text, context);
          const plain = html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
          let id = slugify(plain) || "section";
          const seen = ids.get(id) ?? 0;
          ids.set(id, seen + 1);
          if (seen > 0) id = `${id}-${seen}`;
          headings.push({ level: block.level, text: plain, id });
          out.push(`<h${block.level} id="${escapeHtml(id)}">${html}</h${block.level}>`);
          break;
        }
        case "paragraph":
          out.push(tight ? renderInline(block.text, context) : `<p>${renderInline(block.text, context)}</p>`);
          break;
        case "code": {
          const language = block.info.replace(/[^\w+#.-]/g, "");
          out.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(block.text)}${block.text ? "\n" : ""}</code></pre>`);
          break;
        }
        case "rule":
          out.push("<hr>");
          break;
        case "quote":
          out.push(`<blockquote>\n${render(block.blocks, false)}\n</blockquote>`);
          break;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
          const tasks = block.items.some((item) => item.task !== null);
          const items = block.items.map((item) => {
            const box = item.task === null ? "" : `<input type="checkbox" disabled${item.task ? " checked" : ""}> `;
            const inner = render(item.blocks, !block.loose);
            return `<li${item.task !== null ? ' class="task"' : ""}>${box}${inner}</li>`;
          });
          out.push(`<${tag}${start}${tasks ? ' class="tasks"' : ""}>\n${items.join("\n")}\n</${tag}>`);
          break;
        }
        case "table": {
          const cell = (tag: string, text: string, position: number) => `<${tag}${block.align[position] ? ` style="text-align:${block.align[position]}"` : ""}>${renderInline(text, context)}</${tag}>`;
          const head = `<thead>\n<tr>${block.header.map((text, position) => cell("th", text, position)).join("")}</tr>\n</thead>`;
          const body = block.rows.length > 0 ? `\n<tbody>\n${block.rows.map((row) => `<tr>${row.map((text, position) => cell("td", text, position)).join("")}</tr>`).join("\n")}\n</tbody>` : "";
          out.push(`<table>\n${head}${body}\n</table>`);
          break;
        }
        case "html":
          out.push(options.allowHtml ? block.text.replace(/<script[\s\S]*?<\/script\s*>/gi, "") : `<p>${escapeHtml(block.text)}</p>`);
          break;
      }
    }
    return out.join(tight ? "\n" : "\n");
  };

  const html = render(blocks, false);
  return { html: html ? `${html}\n` : "", headings, title: headings[0]?.text ?? null };
}

/** A table of contents from the headings, nested by level. */
export function tableOfContents(headings: readonly Heading[], deepest = 3): string {
  const shown = headings.filter((heading) => heading.level <= deepest);
  if (shown.length < 2) return "";
  interface Node {
    heading: Heading | null;
    level: number;
    children: Node[];
  }
  const root: Node = { heading: null, level: 0, children: [] };
  const stack: Node[] = [root];
  for (const heading of shown) {
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) stack.pop();
    const node: Node = { heading, level: heading.level, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const list = (nodes: Node[]): string => `<ul>${nodes.map((node) => `<li><a href="#${escapeHtml(node.heading!.id)}">${escapeHtml(node.heading!.text)}</a>${node.children.length > 0 ? list(node.children) : ""}</li>`).join("")}</ul>`;
  return `<nav class="toc">${list(root.children)}</nav>`;
}

/** The stylesheet the exported pages carry: readable type, code blocks, tables, and print rules. */
export const DOCUMENT_CSS = `
:root { color-scheme: light dark; }
body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
h1, h2 { border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.5em 0 .5em; }
a { color: #0969da; }
code { font: .875em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #eff1f3; padding: .15em .35em; border-radius: 4px; }
pre { background: #f6f8fa; padding: 1em; overflow: auto; border-radius: 6px; }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding: 0 1em; color: #59636e; border-left: .25em solid #d1d9e0; }
table { border-collapse: collapse; display: block; overflow: auto; }
th, td { border: 1px solid #d1d9e0; padding: .4em .8em; }
tr:nth-child(2n) { background: #f6f8fa; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #d1d9e0; margin: 1.5em 0; }
ul.tasks { list-style: none; padding-left: 1.2em; }
.toc { background: #f6f8fa; padding: .5em 1em; border-radius: 6px; }
@media (prefers-color-scheme: dark) {
  body { color: #e6edf3; background: #0d1117; }
  a { color: #4493f8; }
  code { background: #262c36; }
  pre, tr:nth-child(2n), .toc { background: #151b23; }
  th, td, h1, h2, hr { border-color: #3d444d; }
  blockquote { color: #9198a1; border-color: #3d444d; }
}
@media print { body { max-width: none; margin: 0; } a { color: inherit; } pre { white-space: pre-wrap; } }
`.trim();

/** A complete page around a rendered body. */
export function htmlDocument(title: string, body: string, extraCss = ""): string {
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>\n${DOCUMENT_CSS}${extraCss ? `\n${extraCss}` : ""}\n</style>\n</head>\n<body>\n${body}</body>\n</html>\n`;
}
