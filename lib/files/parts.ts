/**
 * A file in numbered pieces, and the pieces back together.
 *
 * The pieces are named the way `split` and every other splitter names
 * them - the file's own name with .001, .002 and so on - so what one tool
 * cut, another joins. Pure; the cutting is a `Blob.slice` and the joining
 * a `Blob` of the pieces, neither of which copies a byte.
 */

export const PART_SIZE_OPTIONS: readonly { bytes: number; label: string; blurb: string }[] = [
  { bytes: 10 * 1000 * 1000, label: "10 MB", blurb: "Small attachments" },
  { bytes: 25 * 1000 * 1000, label: "25 MB", blurb: "What most email allows" },
  { bytes: 100 * 1000 * 1000, label: "100 MB", blurb: "Chat and forum uploads" },
  { bytes: 2 * 1000 * 1000 * 1000, label: "2 GB", blurb: "The cap on many drives and old file systems" },
];

/** How many pieces a file of this size makes. */
export function partCount(size: number, partBytes: number): number {
  return Math.max(1, Math.ceil(size / partBytes));
}

/** "video.mp4" and 3 of 12 -> "video.mp4.003"; the number is as wide as the count needs, at least three digits. */
export function partName(fileName: string, index: number, count: number): string {
  const width = Math.max(3, String(count).length);
  return `${fileName}.${String(index).padStart(width, "0")}`;
}

export interface PartRef {
  /** The name the pieces share: the original file's. */
  base: string;
  index: number;
}

/** "video.mp4.003" -> base "video.mp4", index 3; also ".part3" and ".z03" as other tools write them; null for anything else. */
export function parsePartName(name: string): PartRef | null {
  const numbered = name.match(/^(.+)\.(\d{2,})$/);
  if (numbered) return { base: numbered[1], index: Number(numbered[2]) };
  const part = name.match(/^(.+)\.(?:part|z)(\d+)$/i);
  if (part) return { base: part[1], index: Number(part[2]) };
  return null;
}

export interface PartOrder<T> {
  ordered: T[];
  base: string;
  problems: string[];
}

/**
 * The pieces in order, with what is wrong with the set: pieces from two
 * different files, a number missing, a number twice, or a name that is
 * not a piece at all (kept, in the order given, so a set named oddly
 * still joins).
 */
export function orderParts<T extends { name: string }>(files: readonly T[]): PartOrder<T> {
  const problems: string[] = [];
  if (files.length === 0) return { ordered: [], base: "joined", problems };
  const parsed = files.map((file) => ({ file, ref: parsePartName(file.name) }));
  const unnamed = parsed.filter((entry) => entry.ref === null);
  if (unnamed.length > 0) {
    problems.push(`${unnamed.length === 1 ? "One file is" : `${unnamed.length} files are`} not named as a piece (${unnamed.map((entry) => entry.file.name).join(", ")}); the files are joined in the order listed.`);
    return { ordered: [...files], base: files[0]?.name ?? "joined", problems };
  }
  const bases = new Set(parsed.map((entry) => entry.ref!.base));
  if (bases.size > 1) problems.push(`The pieces come from ${bases.size} different names: ${[...bases].join(", ")}.`);
  const sorted = [...parsed].sort((a, b) => a.ref!.index - b.ref!.index || a.file.name.localeCompare(b.file.name));
  const indices = sorted.map((entry) => entry.ref!.index);
  const first = indices[0];
  if (first !== 0 && first !== 1) problems.push(`The first piece is number ${first}; the set may be missing its start.`);
  for (let at = 1; at < indices.length; at += 1) {
    if (indices[at] === indices[at - 1]) problems.push(`Piece ${indices[at]} is here twice.`);
    else if (indices[at] !== indices[at - 1] + 1) problems.push(`Piece${indices[at] - indices[at - 1] > 2 ? "s" : ""} ${indices[at - 1] + 1}${indices[at] - indices[at - 1] > 2 ? ` to ${indices[at] - 1}` : ""} ${indices[at] - indices[at - 1] > 2 ? "are" : "is"} missing.`);
  }
  return { ordered: sorted.map((entry) => entry.file), base: sorted[0].ref!.base, problems };
}

/** The commands that join the pieces on a computer, for the note beside the download. */
export function joinCommands(base: string, count: number): { unix: string; windows: string } {
  const width = Math.max(3, String(count).length);
  const glob = `${base}.${"?".repeat(width)}`;
  return {
    unix: `cat ${quoteShell(glob)} > ${quoteShell(base)}`,
    windows: `copy /b ${quoteWindows(glob)} ${quoteWindows(base)}`,
  };
}

function quoteShell(text: string): string {
  return /[^A-Za-z0-9._?/-]/.test(text) ? `'${text.replace(/'/g, "'\\''")}'` : text;
}

function quoteWindows(text: string): string {
  return /[\s&]/.test(text) ? `"${text}"` : text;
}
