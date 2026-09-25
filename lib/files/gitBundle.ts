/**
 * A git bundle or packfile opened without git: its refs, its commits with
 * their authors and messages, and the files at any commit, ready to save.
 *
 * A bundle is a few header lines - the refs it carries and the commits it
 * assumes the receiver already has - followed by a packfile. A packfile is
 * objects laid end to end, each a small header and a zlib stream; some are
 * whole and some are deltas, instructions for building an object out of
 * another, found by offset or by id. Objects are inflated one after
 * another, deltas applied once their bases are known, and every object's
 * id is its SHA-1 over a "type size" header and its content.
 */
import { createDigest } from "../hash/digest";
import { inflateZlib, InflateError } from "../zip/inflate";

export class GitError extends Error {}

export type GitType = "commit" | "tree" | "blob" | "tag";

const TYPES: Record<number, GitType | "ofs-delta" | "ref-delta"> = { 1: "commit", 2: "tree", 3: "blob", 4: "tag", 6: "ofs-delta", 7: "ref-delta" };

export interface GitObject {
  type: GitType;
  data: Uint8Array;
}

export interface BundleHeader {
  version: number;
  refs: { id: string; name: string }[];
  prerequisites: { id: string; comment: string }[];
  /** Where the packfile starts. */
  packStart: number;
  objectFormat: "sha1" | "sha256";
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The bundle's header lines, or a bare packfile's position. */
export function readBundleHeader(bytes: Uint8Array): BundleHeader {
  if (bytes[0] === 0x50 && bytes[1] === 0x41 && bytes[2] === 0x43 && bytes[3] === 0x4b) return { version: 0, refs: [], prerequisites: [], packStart: 0, objectFormat: "sha1" };
  const signature = new TextDecoder("latin1").decode(bytes.subarray(0, 32));
  const match = /^# v([23]) git bundle\n/.exec(signature);
  if (!match) throw new GitError("This is neither a git bundle nor a packfile: it starts with neither \"# v2 git bundle\" nor \"PACK\".");
  const header: BundleHeader = { version: Number(match[1]), refs: [], prerequisites: [], packStart: 0, objectFormat: "sha1" };
  let at = match[0].length;
  for (;;) {
    const end = bytes.indexOf(0x0a, at);
    if (end < 0) throw new GitError("The bundle's header never ends.");
    const line = new TextDecoder().decode(bytes.subarray(at, end));
    at = end + 1;
    if (line === "") break;
    if (line.startsWith("@")) {
      if (line === "@object-format=sha256") header.objectFormat = "sha256";
      continue;
    }
    if (line.startsWith("-")) {
      const [id, ...comment] = line.slice(1).split(" ");
      header.prerequisites.push({ id, comment: comment.join(" ") });
    } else {
      const space = line.indexOf(" ");
      header.refs.push({ id: line.slice(0, space), name: line.slice(space + 1) });
    }
  }
  header.packStart = at;
  return header;
}

/** A delta applied to its base. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let at = 0;
  const size = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = delta[at++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(byte & 0x80)) return value;
    }
  };
  const baseSize = size();
  if (baseSize !== base.length) throw new GitError("A delta was made against a different base than the one it names.");
  const out = new Uint8Array(size());
  let length = 0;
  while (at < delta.length) {
    const op = delta[at++];
    if (op & 0x80) {
      let offset = 0;
      let count = 0;
      for (let bit = 0; bit < 4; bit += 1) if (op & (1 << bit)) offset += delta[at++] * 2 ** (8 * bit);
      for (let bit = 0; bit < 3; bit += 1) if (op & (0x10 << bit)) count += delta[at++] << (8 * bit);
      if (count === 0) count = 0x10000;
      if (offset + count > base.length || length + count > out.length) throw new GitError("A delta copies from outside its base.");
      out.set(base.subarray(offset, offset + count), length);
      length += count;
    } else if (op > 0) {
      if (length + op > out.length || at + op > delta.length) throw new GitError("A delta inserts past its own end.");
      out.set(delta.subarray(at, at + op), length);
      length += op;
      at += op;
    } else throw new GitError("A delta has an instruction git never writes.");
  }
  if (length !== out.length) throw new GitError("A delta builds an object of the wrong size.");
  return out;
}

function objectId(type: GitType, data: Uint8Array, format: "sha1" | "sha256"): string {
  const digest = createDigest(format === "sha256" ? "sha256" : "sha1");
  digest.update(new TextEncoder().encode(`${type} ${data.length}\0`));
  digest.update(data);
  return digest.hex();
}

export interface Pack {
  objects: Map<string, GitObject>;
  counts: Record<GitType, number>;
  deltas: number;
  /** Deltas whose base is not in the pack: a thin pack, as bundles of a range are. */
  missingBases: number;
}

/** Every object in a packfile, deltas resolved. */
export function readPack(bytes: Uint8Array, start: number, format: "sha1" | "sha256", report?: (done: number, total: number) => void): Pack {
  if (bytes[start] !== 0x50 || bytes[start + 1] !== 0x41 || bytes[start + 2] !== 0x43 || bytes[start + 3] !== 0x4b) throw new GitError("The packfile does not start with PACK.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(start + 4);
  if (version !== 2 && version !== 3) throw new GitError(`Pack version ${version} is not one git writes.`);
  const total = view.getUint32(start + 8);
  const idLength = format === "sha256" ? 32 : 20;
  const pack: Pack = { objects: new Map(), counts: { commit: 0, tree: 0, blob: 0, tag: 0 }, deltas: 0, missingBases: 0 };
  const byOffset = new Map<number, GitObject>();
  const pending: { offset: number; base: number | string; delta: Uint8Array }[] = [];
  let at = start + 12;
  const store = (offset: number, object: GitObject) => {
    byOffset.set(offset, object);
    pack.objects.set(objectId(object.type, object.data, format), object);
    pack.counts[object.type] += 1;
  };
  for (let index = 0; index < total; index += 1) {
    const offset = at;
    let byte = bytes[at++];
    if (byte === undefined) throw new GitError("The packfile ends before its last object.");
    const type = TYPES[(byte >> 4) & 7];
    let size = byte & 15;
    let shift = 4;
    while (byte & 0x80) {
      byte = bytes[at++];
      size += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    }
    if (!type) throw new GitError(`Object ${index + 1} has a type git does not use.`);
    let base: number | string | null = null;
    if (type === "ofs-delta") {
      byte = bytes[at++];
      let distance = byte & 0x7f;
      while (byte & 0x80) {
        byte = bytes[at++];
        distance = (distance + 1) * 128 + (byte & 0x7f);
      }
      base = offset - distance;
    } else if (type === "ref-delta") {
      base = hex(bytes.subarray(at, at + idLength));
      at += idLength;
    }
    let inflated;
    try {
      inflated = inflateZlib(bytes, at, size);
    } catch (error) {
      if (error instanceof InflateError) throw new GitError(`Object ${index + 1} of ${total} is damaged: ${error.message}`);
      throw error;
    }
    at += inflated.consumed;
    if (base === null) store(offset, { type: type as GitType, data: inflated.data.slice() });
    else {
      pack.deltas += 1;
      pending.push({ offset, base, delta: inflated.data.slice() });
    }
    if (report && index % 256 === 0) report(index, total);
  }
  // Resolve deltas; a delta's base may itself be a delta, so go round until nothing changes.
  for (let progress = true; pending.length > 0 && progress; ) {
    progress = false;
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      const base = typeof entry.base === "number" ? byOffset.get(entry.base) : pack.objects.get(entry.base);
      if (!base) continue;
      store(entry.offset, { type: base.type, data: applyDelta(base.data, entry.delta) });
      pending.splice(index, 1);
      index -= 1;
      progress = true;
    }
  }
  pack.missingBases = pending.length;
  return pack;
}

/* ---- Objects ------------------------------------------------------------- */

export interface Person {
  name: string;
  email: string;
  /** Milliseconds. */
  time: number;
  zone: string;
}

export interface Commit {
  id: string;
  tree: string;
  parents: string[];
  author: Person;
  committer: Person;
  message: string;
}

function person(text: string): Person {
  const match = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(text);
  return match ? { name: match[1], email: match[2], time: Number(match[3]) * 1000, zone: match[4] } : { name: text, email: "", time: 0, zone: "+0000" };
}

export function parseCommit(id: string, data: Uint8Array): Commit {
  const text = new TextDecoder().decode(data);
  const split = text.indexOf("\n\n");
  const headers = (split < 0 ? text : text.slice(0, split)).split("\n");
  const commit: Commit = { id, tree: "", parents: [], author: person(""), committer: person(""), message: split < 0 ? "" : text.slice(split + 2) };
  for (const line of headers) {
    const space = line.indexOf(" ");
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (key === "tree") commit.tree = value;
    else if (key === "parent") commit.parents.push(value);
    else if (key === "author") commit.author = person(value);
    else if (key === "committer") commit.committer = person(value);
  }
  return commit;
}

export interface TreeEntry {
  mode: string;
  name: string;
  id: string;
}

export function parseTree(data: Uint8Array, idLength = 20): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const nul = data.indexOf(0, space);
    if (space < 0 || nul < 0) throw new GitError("A tree object is damaged.");
    const mode = new TextDecoder().decode(data.subarray(at, space));
    const name = new TextDecoder().decode(data.subarray(space + 1, nul));
    entries.push({ mode, name, id: hex(data.subarray(nul + 1, nul + 1 + idLength)) });
    at = nul + 1 + idLength;
  }
  return entries;
}

export interface TreeFile {
  path: string;
  mode: string;
  id: string;
  /** null when the blob is not in the pack. */
  data: Uint8Array | null;
}

/** Every file under a tree, with its path, depth first. Submodules and missing trees are listed without content. */
export function walkTree(objects: Map<string, GitObject>, treeId: string, prefix = "", idLength = 20): TreeFile[] {
  const tree = objects.get(treeId);
  if (!tree || tree.type !== "tree") return [];
  const files: TreeFile[] = [];
  for (const entry of parseTree(tree.data, idLength)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.mode === "40000") files.push(...walkTree(objects, entry.id, path, idLength));
    else if (entry.mode === "160000") files.push({ path, mode: entry.mode, id: entry.id, data: null });
    else files.push({ path, mode: entry.mode, id: entry.id, data: objects.get(entry.id)?.data ?? null });
  }
  return files;
}

/** The commits in the pack, newest first. */
export function commitsOf(objects: Map<string, GitObject>): Commit[] {
  const commits: Commit[] = [];
  for (const [id, object] of objects) if (object.type === "commit") commits.push(parseCommit(id, object.data));
  return commits.sort((a, b) => b.committer.time - a.committer.time);
}

/** The commit a ref points to, following an annotated tag. */
export function resolveRef(objects: Map<string, GitObject>, id: string): string | null {
  for (let hops = 0, current = id; hops < 10; hops += 1) {
    const object = objects.get(current);
    if (!object) return null;
    if (object.type === "commit") return current;
    if (object.type !== "tag") return null;
    const target = /^object ([0-9a-f]+)$/m.exec(new TextDecoder().decode(object.data));
    if (!target) return null;
    current = target[1];
  }
  return null;
}
