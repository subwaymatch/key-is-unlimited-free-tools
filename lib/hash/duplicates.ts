/**
 * Files that are the same file: grouped by size first, since two files of
 * different sizes cannot match, and then by hash among the ones that share
 * a size, so a folder of a thousand photos costs a hash of the few that
 * could be duplicates and a stat of the rest.
 */

export interface Hashed {
  name: string;
  size: number;
  hash: string;
}

export interface DuplicateGroup {
  size: number;
  hash: string;
  names: string[];
}

/** The files worth hashing: only those whose size another file shares. */
export function candidatesBySize<T extends { size: number }>(files: readonly T[]): T[] {
  const counts = new Map<number, number>();
  for (const file of files) counts.set(file.size, (counts.get(file.size) ?? 0) + 1);
  return files.filter((file) => (counts.get(file.size) ?? 0) > 1);
}

/** The groups of two or more that share a size and a hash, largest first. */
export function groupDuplicates(hashed: readonly Hashed[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const file of hashed) {
    const key = `${file.size}:${file.hash}`;
    const group = groups.get(key);
    if (group) group.names.push(file.name);
    else groups.set(key, { size: file.size, hash: file.hash, names: [file.name] });
  }
  return [...groups.values()].filter((group) => group.names.length > 1).sort((a, b) => b.size - a.size);
}

/** Bytes a folder would give back if every copy but one went. */
export function wastedBytes(groups: readonly DuplicateGroup[]): number {
  return groups.reduce((sum, group) => sum + group.size * (group.names.length - 1), 0);
}

/** A plain-text report of the groups, one per block. */
export function duplicatesReport(groups: readonly DuplicateGroup[], total: number): string {
  if (groups.length === 0) return `No duplicates among ${total} files.\n`;
  const lines = [`${groups.length} ${groups.length === 1 ? "group" : "groups"} of identical files among ${total}:`, ""];
  for (const group of groups) {
    lines.push(`${group.size} bytes, SHA-256 ${group.hash}`);
    for (const name of group.names) lines.push(`  ${name}`);
    lines.push("");
  }
  return lines.join("\n");
}
