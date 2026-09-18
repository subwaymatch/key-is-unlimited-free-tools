/**
 * A table tidied: cells trimmed, blank rows and columns dropped, and rows
 * that repeat kept once.
 *
 * Pure, on rows of text.
 */

export interface CleanOptions {
  /** Spaces and tabs off both ends of every cell. */
  trim: boolean;
  /** Rows with nothing in any cell. */
  dropEmptyRows: boolean;
  /** Rows identical to an earlier one, after trimming when that is on. */
  dedupe: boolean;
  /** Columns with nothing in any row below the header. */
  dropEmptyColumns: boolean;
  /** The first row is names, kept as it is and never counted as a duplicate. */
  header: boolean;
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = { trim: true, dropEmptyRows: true, dedupe: true, dropEmptyColumns: false, header: true };

export interface CleanResult {
  rows: string[][];
  /** Cells that had whitespace taken off. */
  trimmed: number;
  emptyRows: number;
  duplicates: number;
  /** The names or numbers of the columns dropped. */
  emptyColumns: string[];
  /** Rows made the same width as the widest, with empty cells. */
  padded: number;
}

export function cleanRows(source: readonly (readonly string[])[], options: CleanOptions): CleanResult {
  let trimmed = 0;
  let emptyRows = 0;
  let duplicates = 0;
  let padded = 0;
  const seen = new Set<string>();
  const width = source.reduce((widest, row) => Math.max(widest, row.length), 0);
  const rows: string[][] = [];
  source.forEach((raw, index) => {
    const row = raw.map((cell) => {
      if (!options.trim) return cell;
      const clean = cell.trim();
      if (clean !== cell) trimmed += 1;
      return clean;
    });
    if (row.length < width) {
      padded += 1;
      while (row.length < width) row.push("");
    }
    const isHeader = options.header && index === 0;
    if (!isHeader && options.dropEmptyRows && row.every((cell) => cell === "")) {
      emptyRows += 1;
      return;
    }
    if (!isHeader && options.dedupe) {
      const key = JSON.stringify(row);
      if (seen.has(key)) {
        duplicates += 1;
        return;
      }
      seen.add(key);
    }
    rows.push(row);
  });
  const emptyColumns: string[] = [];
  if (options.dropEmptyColumns && rows.length > 0) {
    const body = options.header ? rows.slice(1) : rows;
    const keep: number[] = [];
    for (let column = 0; column < width; column += 1) {
      if (body.some((row) => row[column] !== "")) keep.push(column);
      else emptyColumns.push(options.header && rows[0][column] ? rows[0][column] : `column ${column + 1}`);
    }
    if (emptyColumns.length > 0) {
      for (let index = 0; index < rows.length; index += 1) rows[index] = keep.map((column) => rows[index][column]);
    }
  }
  return { rows, trimmed, emptyRows, duplicates, emptyColumns, padded };
}
