"use client";

import { zipSync } from "fflate";
import { useMemo } from "react";

import { csvLine } from "@/lib/data/csv";
import { commitsOf, GitError, readBundleHeader, readPack, resolveRef, walkTree, type Commit } from "@/lib/files/gitBundle";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("inspect-git-bundle");

/** Past this the unpacked objects would not fit in a tab. */
const MAX_BYTES = 512 * 1024 * 1024;

function when(time: number, zone: string): string {
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC${zone !== "+0000" ? ` (author's zone ${zone})` : ""}`;
}

function subject(commit: Commit): string {
  return commit.message.split("\n")[0].trim();
}

/** A git bundle or packfile: refs, commits and the files at the tip, without git. */
export function InspectGitBundleApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "inspect-git-bundle",
      settings: {},
      reject: (file) => (file.size > MAX_BYTES ? { message: "This bundle is too large to open in a browser tab.", hint: `Every object is unpacked in memory; this opens bundles up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, _settings, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let header;
        let pack;
        try {
          header = readBundleHeader(bytes);
          pack = readPack(bytes, header.packStart, header.objectFormat, (done, total) => report(`Unpacking object ${done.toLocaleString("en")} of ${total.toLocaleString("en")}...`, done / total));
        } catch (error) {
          if (error instanceof GitError) throw new PlainError(error.message, "Drop a file made by git bundle create, or a .pack file from .git/objects/pack.", { cause: error });
          throw error;
        }
        report("Reading the history...", null);
        const idLength = header.objectFormat === "sha256" ? 32 : 20;
        const commits = commitsOf(pack.objects);
        const byId = new Map(commits.map((commit) => [commit.id, commit]));
        const stem = fileStem(file.name, "bundle");
        const facts = [
          `Kind: ${header.version === 0 ? "packfile" : `git bundle, version ${header.version}`}${header.objectFormat === "sha256" ? ", SHA-256 ids" : ""}`,
          `Objects: ${pack.objects.size.toLocaleString("en")} (${pack.counts.commit.toLocaleString("en")} commits, ${pack.counts.tree.toLocaleString("en")} trees, ${pack.counts.blob.toLocaleString("en")} files, ${pack.counts.tag} tags)`,
        ];
        if (header.refs.length > 0) facts.push(`Refs: ${header.refs.map((ref) => ref.name.replace(/^refs\/(heads|tags)\//, "")).slice(0, 8).join(", ")}${header.refs.length > 8 ? `, and ${header.refs.length - 8} more` : ""}`);
        if (commits.length > 0) facts.push(`History: ${when(commits[commits.length - 1].committer.time, "+0000").slice(0, 10)} to ${when(commits[0].committer.time, "+0000").slice(0, 10)}, by ${new Set(commits.map((commit) => commit.author.email || commit.author.name)).size} ${new Set(commits.map((commit) => commit.author.email || commit.author.name)).size === 1 ? "author" : "authors"}`);
        const notes: string[] = [];
        if (header.prerequisites.length > 0) notes.push(`This bundle only adds to a repository that already has ${header.prerequisites.length === 1 ? "commit" : "commits"} ${header.prerequisites.map((entry) => `${entry.id.slice(0, 10)} (${entry.comment})`).join(", ")}; git bundle unbundle needs ${header.prerequisites.length === 1 ? "it" : "them"} to be there.`);
        if (pack.missingBases > 0) notes.push(`${pack.missingBases} ${pack.missingBases === 1 ? "object is stored" : "objects are stored"} as changes to objects the bundle does not carry, so ${pack.missingBases === 1 ? "it" : "they"} cannot be rebuilt here; files that depend on ${pack.missingBases === 1 ? "it are" : "them are"} left out.`);

        // The files at HEAD, or the first branch, or the newest commit.
        const tipRef = header.refs.find((ref) => ref.name === "HEAD") ?? header.refs.find((ref) => ref.name.startsWith("refs/heads/")) ?? header.refs[0];
        const tipId = (tipRef ? resolveRef(pack.objects, tipRef.id) : null) ?? commits[0]?.id ?? null;
        const tip = tipId ? byId.get(tipId) : undefined;

        const lines = [`# ${file.name}`, ""];
        if (header.refs.length > 0) {
          lines.push("## Refs", "");
          for (const ref of header.refs) {
            const target = resolveRef(pack.objects, ref.id);
            lines.push(`- ${ref.name}: ${ref.id.slice(0, 12)}${target && byId.get(target) ? ` ${subject(byId.get(target)!)}` : ""}${target && target !== ref.id ? " (annotated tag)" : ""}`);
          }
          lines.push("");
        }
        if (header.prerequisites.length > 0) {
          lines.push("## Needs these commits first", "");
          for (const entry of header.prerequisites) lines.push(`- ${entry.id} ${entry.comment}`);
          lines.push("");
        }
        lines.push(`## Commits (${commits.length})`, "");
        for (const commit of commits.slice(0, 500)) lines.push(`- ${commit.id.slice(0, 10)} ${when(commit.author.time, commit.author.zone)} ${commit.author.name}: ${subject(commit)}`);
        if (commits.length > 500) lines.push(`- and ${commits.length - 500} older; every one is in the CSV`);

        const outputs: PlainOutputSpec[] = [];
        if (tip) {
          const files = walkTree(pack.objects, tip.tree, "", idLength);
          const present = files.filter((entry) => entry.data !== null);
          const missing = files.length - present.length;
          lines.push("", `## Files at ${tipRef ? tipRef.name : tip.id.slice(0, 10)} (${files.length})`, "");
          for (const entry of files.slice(0, 2000)) lines.push(`- ${entry.path}${entry.mode === "160000" ? " (submodule)" : entry.mode === "120000" ? " (symbolic link)" : entry.data ? ` ${entry.data.length.toLocaleString("en")} bytes` : " (not in this bundle)"}`);
          if (present.length > 0) {
            report("Packing the files...", null);
            const archive = zipSync(Object.fromEntries(present.map((entry) => [entry.path, entry.data!])), { level: 6 });
            outputs.push({ label: `Files at ${tipRef ? tipRef.name.replace(/^refs\/(heads|tags)\//, "") : "the newest commit"}`, fileName: `${stem}-${tip.id.slice(0, 7)}.zip`, blob: new Blob([archive as BlobPart], { type: "application/zip" }), kind: "file", note: `${present.length.toLocaleString("en")} ${present.length === 1 ? "file" : "files"} at ${tip.id.slice(0, 10)}: ${subject(tip)}` });
          }
          if (missing > 0) notes.push(`${missing} ${missing === 1 ? "file" : "files"} at the tip ${missing === 1 ? "is" : "are"} not in the bundle (submodules, or unchanged since the commits it assumes), so the ZIP leaves ${missing === 1 ? "it" : "them"} out.`);
          if (files.some((entry) => entry.mode === "100755")) notes.push("ZIP does not keep the executable bit, so scripts marked executable in git are plain files in the archive.");
        }
        const csv = [csvLine(["commit", "parents", "author", "email", "date", "subject"], ",")];
        for (const commit of commits) csv.push(csvLine([commit.id, commit.parents.join(" "), commit.author.name, commit.author.email, new Date(commit.author.time).toISOString(), subject(commit)], ","));
        outputs.unshift({ label: "Report", fileName: `${stem}-report.md`, blob: new Blob([`${lines.join("\n")}\n`], { type: "text/markdown;charset=utf-8" }), kind: "file", note: "Refs, commits and files" });
        outputs.push({ label: "Commits", fileName: `${stem}-commits.csv`, blob: new Blob([`${csv.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }), kind: "file", note: `${commits.length.toLocaleString("en")} commits, newest first` });
        return { facts, notes, outputs };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a git bundle - the single-file repository git bundle create makes - or a .pack file, and see what is in it without git: its branches and tags, every commit with author and message, and the files at the tip as a ZIP. Nothing is uploaded."
      queue={queue}
      busyLabel="Unpacking"
      dropZone={{ accept: ".bundle,.pack,.git,application/octet-stream", inputLabel: "Choose bundles", headline: "Drop git bundles or packfiles here", subhead: ".bundle and .pack" }}
      note="Every object is inflated and every delta applied here, and each object's id is recomputed from its content, so the ids match git's exactly. A bundle made from a range of commits is thin: it holds changes against commits it expects the receiver to have, and those files cannot be rebuilt from the bundle alone. Git LFS files appear as their small pointer files, since the content lives on an LFS server."
    />
  );
}
