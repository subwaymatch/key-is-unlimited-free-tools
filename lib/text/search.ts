/**
 * Searching files for a word, a phrase or a regular expression, grep's
 * way: line by line, with the line number, the column, and a few lines of
 * context either side.
 *
 * Files are read as a stream and decoded in pieces, so a log of several
 * gigabytes is searched without being held; only the matching lines and
 * their context are kept, up to a limit.
 */

export interface SearchOptions {
  query: string;
  /** The query is a regular expression rather than literal text. */
  regex: boolean;
  caseSensitive: boolean;
  /** Only where the query stands as a word of its own. */
  wholeWord: boolean;
  /** Lines of context kept either side of a match. */
  context: number;
}

export class SearchError extends Error {}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The query as one global regular expression. Throws SearchError when it is not a valid one. */
export function buildPattern(options: Pick<SearchOptions, "query" | "regex" | "caseSensitive" | "wholeWord">): RegExp {
  if (options.query === "") throw new SearchError("Type something to search for.");
  let source = options.regex ? options.query : escapeRegExp(options.query);
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, `g${options.caseSensitive ? "" : "i"}u`);
  } catch (error) {
    throw new SearchError(`That is not a valid regular expression: ${(error instanceof Error ? error.message : String(error)).replace(/^Invalid regular expression: /, "")}`);
  }
  if (pattern.test("")) throw new SearchError("The expression matches empty text, so it would match every line. Make it match at least one character.");
  pattern.lastIndex = 0;
  return pattern;
}

export interface Match {
  /** 1-based. */
  line: number;
  /** 1-based column of the first match on the line, in characters. */
  column: number;
  text: string;
  /** Every match on the line, as [start, end) character offsets into `text`. */
  ranges: [number, number][];
  before: { line: number; text: string }[];
  after: { line: number; text: string }[];
}

export interface FileSearch {
  matches: Match[];
  /** Lines with at least one match, including any past the limit. */
  matchingLines: number;
  /** Every match, several to a line counted separately. */
  occurrences: number;
  lines: number;
  /** Matches past the limit were counted but not kept. */
  truncated: boolean;
}

/** Past this a line is shown cut down to the part around its first match. */
export const MAX_LINE = 400;

function trimLine(text: string, ranges: [number, number][]): { text: string; ranges: [number, number][] } {
  if (text.length <= MAX_LINE) return { text, ranges };
  const start = Math.max(0, (ranges[0]?.[0] ?? 0) - 120);
  const end = Math.min(text.length, start + MAX_LINE);
  const prefix = start > 0 ? "..." : "";
  const shift = prefix.length - start;
  return {
    text: `${prefix}${text.slice(start, end)}${end < text.length ? "..." : ""}`,
    ranges: ranges.filter(([from, to]) => from >= start && to <= end).map(([from, to]) => [from + shift, to + shift]),
  };
}

/** Searches text that arrives in pieces, as a stream decodes it. */
export async function searchChunks(chunks: AsyncIterable<string>, pattern: RegExp, context: number, limit: number): Promise<FileSearch> {
  const result: FileSearch = { matches: [], matchingLines: 0, occurrences: 0, lines: 0, truncated: false };
  const recent: { line: number; text: string }[] = [];
  let afterLeft = 0;
  let carry = "";
  const handle = (raw: string) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    result.lines += 1;
    const number = result.lines;
    pattern.lastIndex = 0;
    const ranges: [number, number][] = [];
    for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
      ranges.push([found.index, found.index + found[0].length]);
      if (found[0].length === 0) pattern.lastIndex += 1;
    }
    if (ranges.length > 0) {
      result.matchingLines += 1;
      result.occurrences += ranges.length;
      if (result.matches.length < limit) {
        const shown = trimLine(text, ranges);
        result.matches.push({ line: number, column: ranges[0][0] + 1, text: shown.text, ranges: shown.ranges, before: recent.map((entry) => ({ ...entry })), after: [] });
        afterLeft = context;
      } else {
        result.truncated = true;
        afterLeft = 0;
      }
      recent.length = 0;
      return;
    }
    const shortened = text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}...` : text;
    if (afterLeft > 0 && result.matches.length > 0) {
      result.matches[result.matches.length - 1].after.push({ line: number, text: shortened });
      afterLeft -= 1;
      return;
    }
    if (context > 0) {
      recent.push({ line: number, text: shortened });
      if (recent.length > context) recent.shift();
    }
  };
  for await (const chunk of chunks) {
    const text = carry + chunk;
    let start = 0;
    for (let newline = text.indexOf("\n"); newline !== -1; newline = text.indexOf("\n", start)) {
      handle(text.slice(start, newline));
      start = newline + 1;
    }
    carry = text.slice(start);
  }
  if (carry !== "") handle(carry);
  return result;
}

/** The results as grep writes them: `path:line:text` for matches, `path-line-text` for context, `--` between groups. */
export function grepLines(path: string, search: FileSearch): string[] {
  const out: string[] = [];
  let lastLine = 0;
  for (const match of search.matches) {
    const firstLine = match.before[0]?.line ?? match.line;
    if (out.length > 0 && firstLine > lastLine + 1) out.push("--");
    for (const entry of match.before) out.push(`${path}-${entry.line}-${entry.text}`);
    out.push(`${path}:${match.line}:${match.text}`);
    for (const entry of match.after) out.push(`${path}-${entry.line}-${entry.text}`);
    lastLine = match.after[match.after.length - 1]?.line ?? match.line;
  }
  return out;
}
