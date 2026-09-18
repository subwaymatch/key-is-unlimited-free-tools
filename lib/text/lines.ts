/**
 * The lines of a text file, sorted, deduplicated, shuffled or reversed.
 */

export type LineOrder = "keep" | "az" | "za" | "natural" | "length" | "reverse" | "shuffle";

export const LINE_ORDERS: readonly { id: LineOrder; label: string; blurb: string }[] = [
  { id: "az", label: "A to Z", blurb: "Alphabetical, numbers in order: item2 before item10" },
  { id: "za", label: "Z to A", blurb: "The same, backwards" },
  { id: "natural", label: "A to Z, character by character", blurb: "item10 before item2, the way a computer sorts" },
  { id: "length", label: "Shortest first", blurb: "By length, then A to Z" },
  { id: "reverse", label: "Reversed", blurb: "The last line first" },
  { id: "shuffle", label: "Shuffled", blurb: "A random order" },
  { id: "keep", label: "As they are", blurb: "Only the steps ticked below" },
];

export interface LineOptions {
  order: LineOrder;
  /** "apple" and "Apple" sort together and count as one. */
  ignoreCase: boolean;
  /** A line the same as an earlier one is dropped. */
  dedupe: boolean;
  /** Lines with nothing on them are dropped. */
  dropBlank: boolean;
  /** Spaces and tabs off both ends of every line first. */
  trim: boolean;
}

export const DEFAULT_LINE_OPTIONS: LineOptions = { order: "az", ignoreCase: true, dedupe: false, dropBlank: true, trim: false };

export interface LineResult {
  lines: string[];
  /** Lines in, before anything was dropped. */
  total: number;
  duplicates: number;
  blanks: number;
  /** The line ending the file used, kept on the way out. */
  newline: "\n" | "\r\n";
}

function comparator(order: LineOrder, ignoreCase: boolean): ((a: string, b: string) => number) | null {
  const sensitivity = ignoreCase ? "base" : "variant";
  if (order === "az" || order === "za") {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity });
    const sign = order === "az" ? 1 : -1;
    return (a, b) => sign * (collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
  }
  if (order === "natural") {
    const collator = new Intl.Collator("en", { numeric: false, sensitivity });
    return (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  }
  if (order === "length") {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity });
    return (a, b) => a.length - b.length || collator.compare(a, b);
  }
  return null;
}

/** The text's lines put through the options. `random` is Math.random unless a test says otherwise. */
export function processLines(text: string, options: LineOptions, random: () => number = Math.random): LineResult {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.endsWith("\n") ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text;
  let lines = body === "" ? [] : body.split(/\r?\n/);
  const total = lines.length;
  if (options.trim) lines = lines.map((line) => line.trim());
  let blanks = 0;
  if (options.dropBlank) {
    const kept = lines.filter((line) => line.trim() !== "");
    blanks = lines.length - kept.length;
    lines = kept;
  }
  let duplicates = 0;
  if (options.dedupe) {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const line of lines) {
      const key = options.ignoreCase ? line.toLowerCase() : line;
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      kept.push(line);
    }
    lines = kept;
  }
  const compare = comparator(options.order, options.ignoreCase);
  if (compare) {
    lines = lines.map((line, position) => ({ line, position })).sort((a, b) => compare(a.line, b.line) || a.position - b.position).map((entry) => entry.line);
  } else if (options.order === "reverse") {
    lines = [...lines].reverse();
  } else if (options.order === "shuffle") {
    lines = [...lines];
    for (let index = lines.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [lines[index], lines[other]] = [lines[other], lines[index]];
    }
  }
  return { lines, total, duplicates, blanks, newline };
}

/** The result as the text of a file, ending in a newline when it has any lines. */
export function joinLines(result: LineResult): string {
  return result.lines.length === 0 ? "" : result.lines.join(result.newline).concat(result.newline);
}
