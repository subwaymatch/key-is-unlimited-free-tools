/**
 * Reading SRT, WebVTT and ASS into cues.
 *
 * Lenient on purpose. Subtitle files in the wild have Windows line endings,
 * byte-order marks, missing sequence numbers, dots where commas should be,
 * position tags from one format pasted into another, and styling nobody can
 * carry across. The parsers take what they can read, skip what they cannot,
 * and say what they skipped.
 */
import { fileExtension } from "../mediaTypes";
import { SubtitleError, type Cue, type ParsedSubtitles, type SubtitleFormat } from "./types";

/**
 * A time in any of the three notations: `01:02:03,456` (SRT), `01:02:03.456`
 * or `02:03.456` (WebVTT), `1:02:03.45` (ASS, centiseconds). Hours are
 * optional and unbounded; the fraction is read as a decimal, so two digits
 * are hundredths and three are thousandths.
 */
const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

export function parseClock(value: string): number | null {
  const match = value.trim().match(CLOCK);
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  if (Number(minutes) >= 60 || Number(seconds) >= 60) return null;
  const millis = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + millis / 1000;
}

const ARROW = /-->/;

function normalise(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/** Blocks separated by one or more blank lines. */
function blocks(text: string): string[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * The markup this model keeps, and everything else gone.
 *
 * `<i>`, `<b>` and `<u>` survive; `<font>`, `<c>`, `<v>`, `<ruby>` and any
 * tag with attributes are dropped along with their closing tags, keeping the
 * text inside. Unclosed tags are closed at the end of the cue, so a cue never
 * leaks italics into the next.
 */
export function cleanMarkup(raw: string): string {
  let text = raw
    // ASS override blocks pasted into SRT, such as {\an8}: nothing to keep.
    .replace(/\{\\[^}]*\}/g, "")
    // Timestamps inside WebVTT cue text, for karaoke-style reveals.
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, "")
    .replace(/<\/?([A-Za-z][A-Za-z0-9]*)(?:[^>]*)>/g, (tag, name: string) => {
      const lower = name.toLowerCase();
      if (lower !== "i" && lower !== "b" && lower !== "u") return "";
      return tag.startsWith("</") ? `</${lower}>` : `<${lower}>`;
    });

  text = balanceTags(text);
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Closes what was opened and drops closes that were never opened. */
export function balanceTags(text: string): string {
  const open: string[] = [];
  let out = "";
  const pattern = /<(\/?)([ibu])>/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    out += text.slice(last, match.index);
    last = match.index + match[0].length;
    const [, closing, name] = match;
    if (!closing) {
      open.push(name);
      out += `<${name}>`;
    } else if (open.includes(name)) {
      // Close everything opened since, innermost first, then reopen it.
      const reopen: string[] = [];
      while (open.length > 0) {
        const top = open.pop()!;
        out += `</${top}>`;
        if (top === name) break;
        reopen.unshift(top);
      }
      for (const name2 of reopen) {
        open.push(name2);
        out += `<${name2}>`;
      }
    }
  }
  out += text.slice(last);
  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Reads a `00:00:01,000 --> 00:00:04,000 [settings]` line. */
function parseTimingLine(line: string): { start: number; end: number } | null {
  if (!ARROW.test(line)) return null;
  const [left, right] = line.split(ARROW);
  const start = parseClock(left.trim());
  // WebVTT puts cue settings after the end time, separated by whitespace.
  const end = parseClock(right.trim().split(/\s+/)[0] ?? "");
  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * SRT and WebVTT share a block shape: an optional identifier line, a timing
 * line, then the text. This reads both; `parseVtt` adds the header handling.
 */
function parseBlocks(text: string, format: SubtitleFormat): ParsedSubtitles {
  const cues: Cue[] = [];
  let skipped = 0;

  for (const block of blocks(text)) {
    const lines = block.split("\n");
    if (format === "vtt" && /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;

    const timingIndex = lines.findIndex((line) => ARROW.test(line));
    if (timingIndex === -1 || timingIndex > 1) {
      skipped += 1;
      continue;
    }
    const timing = parseTimingLine(lines[timingIndex]);
    if (!timing) {
      skipped += 1;
      continue;
    }

    const body = lines.slice(timingIndex + 1).join("\n");
    const cleaned = cleanMarkup(format === "vtt" ? decodeEntities(body) : body);
    cues.push({ start: timing.start, end: Math.max(timing.start, timing.end), text: cleaned });
  }

  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(
      `${skipped} ${skipped === 1 ? "block" : "blocks"} had no readable timing line and ${
        skipped === 1 ? "was" : "were"
      } skipped.`,
    );
  }
  return { format, cues, warnings };
}

export function parseSrt(text: string): ParsedSubtitles {
  return parseBlocks(normalise(text), "srt");
}

export function parseVtt(text: string): ParsedSubtitles {
  const normalised = normalise(text);
  if (!/^WEBVTT/.test(normalised)) {
    throw new SubtitleError(
      "This is not a WebVTT file.",
      'A WebVTT file starts with the line "WEBVTT".',
    );
  }
  // The header block may carry metadata lines; drop it whole.
  const afterHeader = normalised.replace(/^WEBVTT[^\n]*\n(?:[^\n]+\n)*/, "");
  return parseBlocks(afterHeader, "vtt");
}

/** `{\i1}` and friends to the model's tags; every other override dropped. */
function assMarkup(raw: string): string {
  const text = raw
    .replace(/\{([^}]*)\}/g, (_block, inner: string) => {
      let tags = "";
      for (const match of inner.matchAll(/\\([ibu])([01])/g)) {
        const [, name, on] = match;
        tags += on === "1" ? `<${name}>` : `</${name}>`;
      }
      return tags;
    })
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ");
  return cleanMarkup(text);
}

/**
 * ASS and SSA. Only the `[Events]` section matters: `Format:` names the
 * columns, `Dialogue:` lines are cues, and `Text` is always the last column,
 * so it may contain commas.
 */
export function parseAss(text: string): ParsedSubtitles {
  const lines = normalise(text).split("\n");
  const eventsAt = lines.findIndex((line) => /^\[Events\]/i.test(line.trim()));
  if (eventsAt === -1) {
    throw new SubtitleError(
      "This ASS file has no [Events] section.",
      "The dialogue lines live under [Events]; without it there are no cues to read.",
    );
  }

  let columns: string[] | null = null;
  const cues: Cue[] = [];
  let skipped = 0;

  for (const rawLine of lines.slice(eventsAt + 1)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) break;
    if (/^Format:/i.test(line)) {
      columns = line
        .slice("Format:".length)
        .split(",")
        .map((column) => column.trim());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;

    const names = columns ?? [
      "Layer",
      "Start",
      "End",
      "Style",
      "Name",
      "MarginL",
      "MarginR",
      "MarginV",
      "Effect",
      "Text",
    ];
    const fields = line.slice("Dialogue:".length).trim().split(",");
    if (fields.length < names.length) {
      skipped += 1;
      continue;
    }
    const value = (name: string) => fields[names.indexOf(name)]?.trim() ?? "";
    const textIndex = names.indexOf("Text");
    const body = textIndex === -1 ? "" : fields.slice(textIndex).join(",");

    const start = parseClock(value("Start"));
    const end = parseClock(value("End"));
    if (start === null || end === null) {
      skipped += 1;
      continue;
    }
    cues.push({ start, end: Math.max(start, end), text: assMarkup(body) });
  }

  // Events need not be in order in an ASS file; every other format wants them so.
  cues.sort((a, b) => a.start - b.start || a.end - b.end);

  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(
      `${skipped} dialogue ${skipped === 1 ? "line" : "lines"} could not be read and ${
        skipped === 1 ? "was" : "were"
      } skipped.`,
    );
  }
  return { format: "ass", cues, warnings };
}

/**
 * Which format a file is, from its content first and its name second.
 *
 * Content wins because names lie: a WebVTT file saved as .srt is common, and
 * reading it as SRT would only skip the header and shrug at the cue settings.
 */
export function detectFormat(text: string, fileName?: string): SubtitleFormat | null {
  const head = normalise(text).slice(0, 4000);
  if (/^WEBVTT/.test(head)) return "vtt";
  if (/^\[Script Info\]|^\[Events\]|^Dialogue:/m.test(head)) return "ass";
  if (/\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}/.test(head)) return "srt";

  const extension = fileName ? fileExtension(fileName) : null;
  if (extension === "srt") return "srt";
  if (extension === "vtt") return "vtt";
  if (extension === "ass" || extension === "ssa") return "ass";
  return null;
}

export function parseSubtitles(text: string, fileName?: string): ParsedSubtitles {
  const format = detectFormat(text, fileName);
  if (format === null) {
    throw new SubtitleError(
      "This does not look like a subtitle file.",
      "Nothing here reads as SRT, WebVTT or ASS: no timing lines were found.",
    );
  }
  const parsed =
    format === "vtt" ? parseVtt(text) : format === "ass" ? parseAss(text) : parseSrt(text);
  if (parsed.cues.length === 0) {
    throw new SubtitleError(
      `No cues could be read from this ${format.toUpperCase()} file.`,
      "It has the shape of a subtitle file but none of its blocks had a readable timing line.",
    );
  }
  return parsed;
}

/**
 * The text of a subtitle file, whatever it was saved as.
 *
 * UTF-8 is tried first and strictly, because most files are UTF-8 and the
 * ones that are not fail the strict decode at the first accented letter.
 * A UTF-16 byte-order mark is honoured. Everything else is read as
 * Windows-1252, which is what a subtitle file from before 2010 almost always
 * is, and which never fails to decode.
 */
export function decodeSubtitleBytes(bytes: ArrayBuffer): { text: string; encoding: string } {
  const view = new Uint8Array(bytes);
  if (view.length >= 2 && view[0] === 0xff && view[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16" };
  }
  if (view.length >= 2 && view[0] === 0xfe && view[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}
