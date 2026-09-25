"use client";

import { useMemo, useState } from "react";

import { bookHeading, chapterFromXhtml, encryptedPaths, EPUB_STYLES, EpubError, packagePath, readPackage, wordCount, type EpubStyle } from "@/lib/documents/epub";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";
import { readZip } from "@/lib/zip/archive";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("epub-to-text");

/** Past this an e-book is not an e-book. */
const MAX_BYTES = 512 * 1024 * 1024;

interface EpubSettings {
  style: EpubStyle;
}

function isEpubSettings(value: unknown): value is EpubSettings {
  return typeof value === "object" && value !== null && EPUB_STYLES.some((style) => style.id === (value as Partial<EpubSettings>).style);
}

/** Bytes as text, in the encoding an XML declaration names, UTF-8 when it names none. */
async function xmlText(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const declared = new TextDecoder("latin1").decode(bytes.subarray(0, 200)).match(/encoding=["']([A-Za-z0-9._-]+)["']/)?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** An EPUB's chapters as one text or Markdown file, in reading order. */
export function EpubToTextApp() {
  const [settings, setSettings] = useState<EpubSettings>({ style: "text" });
  useStoredSettings(storageKey("settings", "epub-to-text"), settings, setSettings, isEpubSettings);

  const queue = useMemo<PlainQueueOptions<EpubSettings>>(
    () => ({
      key: "epub-to-text",
      settings,
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is no book in it." };
        if (file.size > MAX_BYTES) return { message: "This file is too large for an e-book.", hint: `This reads EPUBs up to ${formatBytes(MAX_BYTES)}.` };
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension === "mobi" || extension === "azw" || extension === "azw3" || extension === "kfx") return { message: "This is a Kindle book, not an EPUB.", hint: "Kindle formats are Amazon's own and often locked to a device; only EPUB is read here." };
        return null;
      },
      run: async (file, current, report, signal) => {
        report("Unpacking...", null);
        const entries = await readZip(file, (done) => report(`Unpacking... ${formatBytes(done)} of ${formatBytes(file.size)}`, done / file.size), signal);
        const byPath = new Map(entries.map((entry) => [entry.path, entry.blob]));
        const container = byPath.get("META-INF/container.xml");
        if (!container) throw new PlainError("This is a ZIP, but not an EPUB.", "An EPUB has a META-INF/container.xml saying where the book is, and this has none.");
        let book;
        try {
          const opf = packagePath(await xmlText(container));
          const opfBlob = byPath.get(opf);
          if (!opfBlob) throw new EpubError(`The package file ${opf} is missing from the archive.`);
          book = readPackage(await xmlText(opfBlob), opf);
        } catch (error) {
          throw new PlainError("This EPUB's table of contents could not be read.", error instanceof Error ? error.message : String(error), { cause: error });
        }
        const encryption = byPath.get("META-INF/encryption.xml");
        const locked = encryption ? new Set(encryptedPaths(await xmlText(encryption))) : new Set<string>();
        if (book.spine.some((path) => locked.has(path)) || byPath.has("META-INF/sinf.xml")) {
          throw new PlainError("This e-book is locked with DRM.", "Its chapters are encrypted for one reader's app, so there is no text here to read.");
        }
        const parts: string[] = [];
        const heading = bookHeading(book, current.style);
        if (heading) parts.push(heading);
        let loose = 0;
        let missing = 0;
        for (const [index, path] of book.spine.entries()) {
          if (signal.aborted) throw new PlainError("Cancelled.");
          report(`Reading chapter ${index + 1} of ${book.spine.length}...`, index / book.spine.length);
          const blob = byPath.get(path);
          if (!blob) {
            missing += 1;
            continue;
          }
          const chapter = chapterFromXhtml(await xmlText(blob), current.style);
          if (chapter.loose) loose += 1;
          if (chapter.text) parts.push(chapter.text);
        }
        const text = `${parts.join(current.style === "markdown" ? "\n\n---\n\n" : "\n\n\n")}\n`;
        const words = wordCount(text);
        if (words === 0) return { facts: [`${book.spine.length} chapters`], outputs: [], nothing: { message: "No text was found in this book.", hint: "Its pages may be pictures, as in a comic or a scanned book." } };
        const notes: string[] = [];
        if (loose > 0) notes.push(`${loose} ${loose === 1 ? "chapter was" : "chapters were"} not well-formed XHTML and were read the forgiving way; check their paragraphs.`);
        if (missing > 0) notes.push(`${missing} ${missing === 1 ? "chapter the book lists is" : "chapters the book lists are"} missing from the file.`);
        return {
          facts: [book.title ? `"${book.title}"` : "untitled", ...(book.authors.length > 0 ? [`by ${book.authors.join(", ")}`] : []), `Chapters: ${book.spine.length}`, `Words: ${words.toLocaleString("en")}`, ...(book.language ? [`Language: ${book.language}`] : [])],
          notes,
          outputs: [{ label: current.style === "markdown" ? "Markdown" : "Text", fileName: `${fileStem(file.name, "book")}.${current.style === "markdown" ? "md" : "txt"}`, blob: new Blob([text], { type: current.style === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }), kind: "file", note: `${words.toLocaleString("en")} words, about ${Math.max(1, Math.round(words / 250)).toLocaleString("en")} minutes of reading` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Output",
    summary: () => EPUB_STYLES.find((style) => style.id === settings.style)?.label ?? "",
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Write it as</legend>
        <RadioCards aria-label="Write it as" value={settings.style} onValueChange={(style) => setSettings({ style: style as EpubStyle })} options={EPUB_STYLES.map((style) => ({ value: style.id, label: style.label, blurb: style.blurb }))} columns={2} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an EPUB and get the book as one text file, chapter after chapter in reading order, with a blank line between paragraphs, or as Markdown with its headings, lists and emphasis kept. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Reading"
      dropZone={{ accept: ".epub,application/epub+zip", inputLabel: "Choose EPUB files", headline: "Drop EPUB files here", subhead: "Read as they land" }}
      note="Chapters follow the book's own reading order, its spine, and the title and authors come from its package file. Pictures are left out, leaving their descriptions where the book gives one. A book locked with DRM, as most bought from a store are, has its chapters encrypted and cannot be read; Kindle files are not EPUBs."
    />
  );
}
