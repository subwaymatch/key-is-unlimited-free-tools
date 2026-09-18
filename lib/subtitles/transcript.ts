/**
 * A subtitle file as a transcript: the words without the timing, in one
 * of a few shapes.
 */
import { csvLine } from "../data/csv";
import type { Cue } from "./types";
import { stripMarkup } from "./write";

export type TranscriptStyle = "lines" | "paragraphs" | "timed" | "csv";

export const TRANSCRIPT_STYLES: readonly { id: TranscriptStyle; label: string; blurb: string; extension: string; mimeType: string }[] = [
  { id: "paragraphs", label: "Paragraphs", blurb: "Cues run together, a new paragraph at each pause", extension: "txt", mimeType: "text/plain" },
  { id: "lines", label: "One cue per line", blurb: "The words of each cue on a line of its own", extension: "txt", mimeType: "text/plain" },
  { id: "timed", label: "With timestamps", blurb: "[00:01:23] before each cue, for notes and quotes", extension: "txt", mimeType: "text/plain" },
  { id: "csv", label: "CSV", blurb: "start, end and text columns, for a spreadsheet", extension: "csv", mimeType: "text/csv" },
];

/** "00:01:23" from seconds. */
export function clockStamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "00:01:23.450" from seconds, for a spreadsheet column. */
export function preciseStamp(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000) % 1000;
  return `${clockStamp(seconds)}.${String(ms).padStart(3, "0")}`;
}

/** A cue's words on one line, markup and line breaks gone. */
export function cueWords(cue: Cue): string {
  return stripMarkup(cue.text).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** A gap this long between cues starts a new paragraph, and so does a shorter one after a full stop. */
const PARAGRAPH_GAP = 2;
const SENTENCE_GAP = 0.8;

/** Consecutive cues run into paragraphs, broken where the speech pauses. */
export function paragraphsOf(cues: readonly Cue[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let lastEnd: number | null = null;
  for (const cue of cues) {
    const words = cueWords(cue);
    if (!words) continue;
    const gap = lastEnd === null ? 0 : cue.start - lastEnd;
    const previous = current[current.length - 1] ?? "";
    const pause = gap >= PARAGRAPH_GAP || (gap >= SENTENCE_GAP && /[.!?]["')\]]?$/.test(previous));
    if (current.length > 0 && pause) {
      paragraphs.push(current.join(" "));
      current = [];
    }
    current.push(words);
    lastEnd = Math.max(cue.end, cue.start);
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs;
}

/** The transcript in the style asked for. */
export function transcript(cues: readonly Cue[], style: TranscriptStyle): string {
  switch (style) {
    case "paragraphs":
      return paragraphsOf(cues).join("\n\n").concat("\n");
    case "timed":
      return cues
        .map((cue) => ({ stamp: clockStamp(cue.start), words: cueWords(cue) }))
        .filter((entry) => entry.words)
        .map((entry) => `[${entry.stamp}] ${entry.words}`)
        .join("\n")
        .concat("\n");
    case "csv":
      return [csvLine(["start", "end", "text"], ","), ...cues.map((cue) => csvLine([preciseStamp(cue.start), preciseStamp(cue.end), cueWords(cue)], ","))].join("\r\n").concat("\r\n");
    default:
      return cues
        .map(cueWords)
        .filter((words) => words)
        .join("\n")
        .concat("\n");
  }
}

/** How many words the cues hold, for the card. */
export function wordCount(cues: readonly Cue[]): number {
  return cues.reduce((sum, cue) => sum + cueWords(cue).split(" ").filter(Boolean).length, 0);
}
