"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { detectEncoding, looksBinary } from "@/lib/text/encoding";
import { htmlDocument, renderMarkdown, tableOfContents } from "@/lib/text/markdown";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("markdown-to-html");

const MAX_BYTES = 64 * 1024 * 1024;

export const MARKDOWN_ACCEPT = ".md,.markdown,.mdown,.mkd,.mkdn,.mdx,.txt,text/markdown,text/plain";

type Shape = "page" | "fragment";

interface MarkdownSettings {
  shape: Shape;
  toc: boolean;
  allowHtml: boolean;
}

const SHAPES: { value: Shape; label: string; blurb: string }[] = [
  { value: "page", label: "A styled page", blurb: "One .html file that opens in any browser and prints cleanly" },
  { value: "fragment", label: "Just the HTML", blurb: "The body only, for pasting into a CMS, an e-mail or a template" },
];

function isMarkdownSettings(value: unknown): value is MarkdownSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MarkdownSettings>;
  return SHAPES.some((shape) => shape.value === candidate.shape) && typeof candidate.toc === "boolean" && typeof candidate.allowHtml === "boolean";
}

/** Markdown rendered as a web page, or as the HTML to paste somewhere else. */
export function MarkdownToHtmlApp() {
  const [settings, setSettings] = useState<MarkdownSettings>({ shape: "page", toc: false, allowHtml: true });
  useStoredSettings(storageKey("settings", "markdown-to-html"), settings, setSettings, isMarkdownSettings);

  const queue = useMemo<PlainQueueOptions<MarkdownSettings>>(
    () => ({
      key: "markdown-to-html",
      settings,
      reject: (file) => (file.size > MAX_BYTES ? { message: "This file is too large for a Markdown document.", hint: `This renders files up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sample = bytes.subarray(0, 64 * 1024);
        if (looksBinary(sample)) throw new PlainError("This is not a text file.", "Markdown is plain text, and this file has bytes no text has.");
        const text = new TextDecoder(detectEncoding(sample).encoding).decode(bytes);
        if (text.trim() === "") return { outputs: [], nothing: { message: "This file has no text in it.", hint: "There is nothing to render." } };
        report("Rendering...", null);
        const rendered = renderMarkdown(text, { allowHtml: current.allowHtml });
        const toc = current.toc ? tableOfContents(rendered.headings) : "";
        const body = `${toc ? `${toc}\n` : ""}${rendered.html}`;
        const stem = fileStem(file.name, "document");
        const title = rendered.title ?? stem;
        const page = current.shape === "page";
        const output = page ? htmlDocument(title, body) : body;
        const blob = new Blob([output], { type: "text/html;charset=utf-8" });
        const images = (rendered.html.match(/<img\s[^>]*src="(?!data:|https?:)/g) ?? []).length;
        const facts = [`${rendered.headings.length} ${rendered.headings.length === 1 ? "heading" : "headings"}`, `Title: ${title}`];
        const notes: string[] = [];
        if (images > 0) notes.push(`${images} ${images === 1 ? "picture is" : "pictures are"} linked by a relative path, so save the page beside the ${images === 1 ? "file" : "files"} it names, as it was beside the Markdown.`);
        if (current.toc && toc === "") notes.push("There are fewer than two headings, so no table of contents was added.");
        return {
          facts,
          notes,
          outputs: [{ label: page ? "Web page" : "HTML fragment", fileName: `${stem}.html`, blob, kind: "file", note: `${formatBytes(blob.size)}${toc ? ", with a table of contents" : ""}${current.allowHtml ? "" : ", HTML in the source shown as text"}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Output",
    summary: () => `${settings.shape === "page" ? "a styled page" : "just the HTML"}${settings.toc ? ", table of contents" : ""}${settings.allowHtml ? "" : ", raw HTML escaped"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Shape</legend>
          <RadioCards aria-label="Shape" value={settings.shape} onValueChange={(value) => setSettings((previous) => ({ ...previous, shape: value as Shape }))} options={SHAPES} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Extras</legend>
          <CheckboxCards
            aria-label="Extras"
            value={[...(settings.toc ? ["toc"] : []), ...(settings.allowHtml ? ["html"] : [])]}
            onValueChange={(next) => setSettings((previous) => ({ ...previous, toc: next.includes("toc"), allowHtml: next.includes("html") }))}
            options={[
              { value: "toc", label: "Table of contents", blurb: "Links to the headings, at the top" },
              { value: "html", label: "Keep HTML in the source", blurb: "Tags such as <kbd> and <details> pass through, scripts never do" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a README, notes or docs written in Markdown and get a web page back: headings, lists, tables, task lists, code blocks and links laid out to read and print, or just the HTML to paste somewhere else. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Rendering"
      dropZone={{ accept: MARKDOWN_ACCEPT, inputLabel: "Choose Markdown files", headline: "Drop Markdown files here", subhead: "Rendered as they land" }}
      note="Written for the Markdown people write: CommonMark's blocks and inlines plus GitHub's tables, task lists, strikethrough and bare links. It is not a conformance-tested CommonMark implementation, so a rare edge case can differ from GitHub's rendering. Scripts, event handlers and javascript: links are taken out even when HTML is kept, and each heading gets the same anchor GitHub gives it, so links to #sections keep working."
    />
  );
}
