"use client";

import { useMemo } from "react";

import { csvLine } from "@/lib/data/csv";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { detectEncoding, looksBinary } from "@/lib/text/encoding";
import { FORMAT_LABELS, LEVELS, logReport, summarizeLog } from "@/lib/text/logs";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("analyze-log");

const ACCEPT = ".log,.txt,.out,.err,.json,.jsonl,.ndjson,.gz,text/plain,application/gzip";

async function* streamText(stream: ReadableStream<Uint8Array>, encoding: string): AsyncGenerator<string> {
  const reader = stream.getReader();
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

/** A log file summarised: levels, time span, recurring errors, and for access logs the traffic. */
export function AnalyzeLogApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "analyze-log",
      settings: {},
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there are no lines to read." } : null),
      run: async (file, _settings, report) => {
        const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
        const gzipped = head[0] === 0x1f && head[1] === 0x8b;
        let stream: ReadableStream<Uint8Array> = file.stream();
        let sample: Uint8Array = head;
        if (gzipped) {
          if (typeof DecompressionStream !== "function") throw new PlainError("This browser cannot unpack .gz files.", "Unpack it first, or use a current browser.");
          stream = stream.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
          const reader = file.slice(0, 256 * 1024).stream().pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
          const first = await reader.read().catch(() => ({ value: undefined }));
          sample = first.value ?? new Uint8Array(0);
          void reader.cancel().catch(() => {});
        }
        if (looksBinary(sample.subarray(0, 64 * 1024))) throw new PlainError("This is not a text log.", "It has bytes no text has. Logs are text files, one entry to a line, sometimes gzipped.");
        report(gzipped ? "Unpacking and reading..." : "Reading...", null);
        const summary = await summarizeLog(streamText(stream, detectEncoding(sample.subarray(0, 64 * 1024)).encoding), new Date(file.lastModified || Date.now()).getUTCFullYear());
        if (summary.entries === 0) return { outputs: [], nothing: { message: "This file has no log lines in it.", hint: "Every line is blank." } };
        const name = file.name.replace(/\.gz$/i, "");
        const stem = fileStem(name, "log");
        const reportText = logReport(name, summary, file.size);
        const csv = [csvLine(["count", "level", "pattern", "example", "first_line", "last_line"], ",")];
        for (const pattern of summary.patterns.slice(0, 5000)) csv.push(csvLine([String(pattern.count), pattern.level ?? "", pattern.pattern, pattern.example, String(pattern.firstLine), String(pattern.lastLine)], ","));
        const levels = LEVELS.filter((level) => summary.levels[level] > 0)
          .map((level) => `${summary.levels[level].toLocaleString("en")} ${level}`)
          .join(", ");
        const facts = [`Kind: ${FORMAT_LABELS[summary.format]}`, `Lines: ${summary.lines.toLocaleString("en")}${summary.continuations > 0 ? `, of which ${summary.continuations.toLocaleString("en")} continue the entry above` : ""}`];
        if (summary.first !== null && summary.last !== null) facts.push(`Covers: ${new Date(summary.first).toISOString().slice(0, 16).replace("T", " ")} to ${new Date(summary.last).toISOString().slice(0, 16).replace("T", " ")} UTC`);
        if (levels) facts.push(`Levels: ${levels}`);
        const notes: string[] = [];
        if (summary.access) {
          const { access } = summary;
          const errors = access.statuses.filter((status) => status.key.startsWith("5")).reduce((sum, status) => sum + status.count, 0);
          const missing = access.statuses.filter((status) => status.key === "404").reduce((sum, status) => sum + status.count, 0);
          facts.push(`Requests: ${access.requests.toLocaleString("en")}, ${formatBytes(access.bytes)} sent, ${missing.toLocaleString("en")} not found, ${errors.toLocaleString("en")} server errors`);
          if (access.paths[0]) notes.push(`Most requested: ${access.paths[0].key} (${access.paths[0].count.toLocaleString("en")} times).`);
          if (access.bots > 0) notes.push(`${Math.round((access.bots / access.requests) * 100)}% of requests came from bots and scripts, going by their user agents.`);
        } else {
          const worst = summary.patterns.find((pattern) => pattern.level === "error" || pattern.level === "fatal");
          if (worst) notes.push(`The most frequent error, ${worst.count.toLocaleString("en")} ${worst.count === 1 ? "time" : "times"} from line ${worst.firstLine.toLocaleString("en")}: ${worst.example.slice(0, 160)}`);
        }
        if (summary.otherPatterns > 0) notes.push(`${summary.otherPatterns.toLocaleString("en")} entries had messages past the first 20,000 distinct ones and are counted, not grouped.`);
        return {
          facts,
          notes,
          outputs: [
            { label: "Report", fileName: `${stem}-report.md`, blob: new Blob([reportText], { type: "text/markdown;charset=utf-8" }), kind: "file", note: "Levels, time span, frequent messages and, for access logs, the traffic" },
            { label: "Messages by frequency", fileName: `${stem}-messages.csv`, blob: new Blob([`${csv.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }), kind: "file", note: `${Math.min(summary.patterns.length, 5000).toLocaleString("en")} distinct messages, numbers and ids taken out` },
          ],
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a log file - an app's log, nginx or Apache access logs, syslog, JSON lines, even gzipped - and get a summary: the time it covers, errors and warnings by count, the messages that repeat most, and for web logs the status codes, top paths, 404s and bots. Nothing is uploaded."
      queue={queue}
      busyLabel="Reading"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose log files", headline: "Drop log files here", subhead: ".log, .txt, .jsonl and .gz" }}
      note="The file is read as a stream, line by line, so a log of several gigabytes needs no more memory than a small one. Messages are grouped once what varies between them - numbers, ids, IP addresses, times, quoted values - is taken out, so a thousand timeouts to different hosts count as one message. Stack traces are kept with the entry they belong to. Times are shown in UTC; syslog lines carry no year, so the file's own date supplies it."
    />
  );
}
