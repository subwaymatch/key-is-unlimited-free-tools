"use client";

import { useMemo, useState } from "react";

import { csvLine } from "@/lib/data/csv";
import { formatBytes } from "@/lib/format-utils";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { CombineOptions } from "@/lib/plainQueue";
import { detectEncoding, looksBinary } from "@/lib/text/encoding";
import { buildPattern, grepLines, searchChunks, SearchError, type FileSearch, type SearchOptions } from "@/lib/text/search";
import { requireTool } from "@/lib/tools";
import { readZip } from "@/lib/zip/archive";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("search-files");

/** Matching lines kept per file; more are counted, not shown. */
const LIMIT_PER_FILE = 2000;
/** Matching lines kept across all files. */
const LIMIT_TOTAL = 20000;

type Flag = "regex" | "caseSensitive" | "wholeWord";

const FLAGS: { value: Flag; label: string; blurb: string }[] = [
  { value: "caseSensitive", label: "Match case", blurb: "Error and error are different" },
  { value: "wholeWord", label: "Whole words", blurb: "cat, but not concatenate" },
  { value: "regex", label: "Regular expression", blurb: "JavaScript syntax: \\d+, (a|b), ^start" },
];

const CONTEXTS = [
  { value: "0", label: "None", blurb: "Only the matching lines" },
  { value: "2", label: "Two lines", blurb: "Either side of each match" },
  { value: "5", label: "Five lines", blurb: "For reading a match in its place" },
];

function isOptions(value: unknown): value is Omit<SearchOptions, "query"> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SearchOptions>;
  return typeof candidate.regex === "boolean" && typeof candidate.caseSensitive === "boolean" && typeof candidate.wholeWord === "boolean" && CONTEXTS.some((context) => Number(context.value) === candidate.context);
}

async function* blobText(blob: Blob, encoding: string): AsyncGenerator<string> {
  const reader = blob.stream().getReader();
  const decoder = new TextDecoder(encoding);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield text;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

interface Searched {
  path: string;
  search: FileSearch | null;
  skipped: string | null;
}

/** Many files, or the files inside ZIPs, searched for a word or a pattern. */
export function SearchFilesApp() {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Omit<SearchOptions, "query">>({ regex: false, caseSensitive: false, wholeWord: false, context: 2 });
  useStoredSettings(storageKey("settings", "search-files"), options, setOptions, isOptions);
  const settings = useMemo<SearchOptions>(() => ({ ...options, query }), [options, query]);

  let problem: string | null = null;
  try {
    buildPattern(settings);
  } catch (error) {
    problem = error instanceof SearchError ? error.message : String(error);
  }

  const queue = useMemo<CombineOptions<SearchOptions>>(
    () => ({
      key: "search-files",
      settings,
      run: async (files, current, report, signal) => {
        const pattern = buildPattern(current);
        const searched: Searched[] = [];
        let kept = 0;
        const searchBlob = async (path: string, blob: Blob) => {
          if (blob.size === 0) {
            searched.push({ path, search: null, skipped: "empty" });
            return;
          }
          const sample = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
          if (looksBinary(sample)) {
            searched.push({ path, search: null, skipped: "binary" });
            return;
          }
          const search = await searchChunks(blobText(blob, detectEncoding(sample).encoding), pattern, current.context, Math.max(0, Math.min(LIMIT_PER_FILE, LIMIT_TOTAL - kept)));
          kept += search.matches.length;
          searched.push({ path, search, skipped: null });
        };
        for (const [index, file] of files.entries()) {
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          report(`Searching ${file.name} (${index + 1} of ${files.length})...`, index / files.length);
          if (/\.zip$/i.test(file.name)) {
            const entries = await readZip(file, undefined, signal);
            for (const entry of entries) await searchBlob(`${file.name}/${entry.path}`, entry.blob);
          } else await searchBlob(file.name, file);
        }
        const hits = searched.filter((entry) => entry.search && entry.search.matchingLines > 0);
        const text = searched.filter((entry) => entry.search);
        const lines = hits.reduce((sum, entry) => sum + entry.search!.matchingLines, 0);
        const occurrences = hits.reduce((sum, entry) => sum + entry.search!.occurrences, 0);
        const skipped = searched.filter((entry) => entry.skipped === "binary");
        const facts = [`Searched: ${text.length} text ${text.length === 1 ? "file" : "files"}${skipped.length > 0 ? `, ${skipped.length} binary skipped` : ""}`];
        if (lines === 0) {
          return {
            outputs: [],
            notes: skipped.length > 0 ? [`Skipped as binary: ${skipped.slice(0, 5).map((entry) => entry.path).join(", ")}${skipped.length > 5 ? "..." : ""}.`] : [],
            nothing: { message: `"${current.query}" was not found.`, hint: `Searched ${text.reduce((sum, entry) => sum + entry.search!.lines, 0).toLocaleString("en")} lines in ${text.length} ${text.length === 1 ? "file" : "files"}${current.caseSensitive || current.wholeWord ? "; try without Match case or Whole words" : ""}.` },
          };
        }
        report("Writing the results...", null);
        const grep = hits.flatMap((entry) => [...grepLines(entry.path, entry.search!), ""]).join("\n");
        const csv = [csvLine(["file", "line", "column", "match", "text"], ",")];
        for (const entry of hits) {
          for (const match of entry.search!.matches) csv.push(csvLine([entry.path, String(match.line), String(match.column), match.text.slice(match.ranges[0]?.[0] ?? 0, match.ranges[0]?.[1] ?? 0), match.text], ","));
        }
        const truncated = hits.filter((entry) => entry.search!.truncated);
        const notes = hits
          .slice()
          .sort((a, b) => b.search!.matchingLines - a.search!.matchingLines)
          .slice(0, 8)
          .map((entry) => `${entry.path}: ${entry.search!.matchingLines.toLocaleString("en")} ${entry.search!.matchingLines === 1 ? "line" : "lines"}`);
        if (truncated.length > 0) notes.push(`Only the first ${LIMIT_PER_FILE.toLocaleString("en")} matching lines of a file, and ${LIMIT_TOTAL.toLocaleString("en")} in all, are written out; the counts include the rest.`);
        facts.push(`Found: ${occurrences.toLocaleString("en")} ${occurrences === 1 ? "match" : "matches"} on ${lines.toLocaleString("en")} ${lines === 1 ? "line" : "lines"} in ${hits.length} ${hits.length === 1 ? "file" : "files"}`);
        const grepBlob = new Blob([grep], { type: "text/plain;charset=utf-8" });
        const csvBlob = new Blob([`${csv.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
        return {
          facts,
          notes,
          outputs: [
            { label: "Matches, grep style", fileName: "search-results.txt", blob: grepBlob, kind: "file", note: `${formatBytes(grepBlob.size)}; file:line:text, context lines with dashes` },
            { label: "Matches as a table", fileName: "search-results.csv", blob: csvBlob, kind: "file", note: "File, line, column, the match and its line" },
          ],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Search for",
    defaultOpen: true,
    invalid: () => problem,
    summary: () => `"${query}"${options.regex ? " as a pattern" : ""}${options.caseSensitive ? ", case matched" : ""}${options.wholeWord ? ", whole words" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Text or pattern</legend>
          <input className={styles.input} style={{ width: "100%", maxWidth: "32rem", fontFamily: "var(--font-mono)" }} value={query} onChange={(event) => setQuery(event.target.value)} spellCheck={false} autoComplete="off" aria-label="Text or pattern" aria-invalid={query !== "" && problem !== null} placeholder="TODO, error, \b\d{3}-\d{4}\b" />
          {query !== "" && problem && <p className={styles.panelNote}>{problem}</p>}
          <div style={{ marginTop: "0.75rem" }}>
            <CheckboxCards aria-label="Matching" value={FLAGS.map((flag) => flag.value).filter((flag) => options[flag])} onValueChange={(next) => setOptions((previous) => ({ ...previous, regex: next.includes("regex"), caseSensitive: next.includes("caseSensitive"), wholeWord: next.includes("wholeWord") }))} options={FLAGS} />
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Context</legend>
          <RadioCards aria-label="Context" value={String(options.context)} onValueChange={(value) => setOptions((previous) => ({ ...previous, context: Number(value) }))} options={CONTEXTS} />
        </fieldset>
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop a folder's worth of files - code, logs, exports, a ZIP of them - and search them all at once for a word, a phrase or a regular expression, grep's way: every matching line with its file, line number and the lines around it. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Search the files"
      minFiles={1}
      noun="files"
      busyLabel="Searching"
      summary={(files) => (files.length > 0 ? `${files.length} ${files.length === 1 ? "file" : "files"}, ${formatBytes(files.reduce((sum, entry) => sum + entry.file.size, 0))}.` : null)}
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop files or ZIPs here", subhead: problem ? "Type what to search for above" : "Every text file inside a ZIP is searched too" }}
      note="Files are read as a stream, so a log of several gigabytes is searched without being loaded whole; only the matching lines are kept. Each file's encoding is detected - UTF-8, UTF-16 or Windows-1252 - and files with bytes no text has, such as pictures, are skipped. Regular expressions use JavaScript's syntax with Unicode on, and Whole words knows letters beyond English. Very long lines, as minified code has, are shown cut down to the part around the match."
    />
  );
}
