"use client";

import { useMemo } from "react";

import { orderParts, parsePartName } from "@/lib/files/parts";
import { formatBytes } from "@/lib/format-utils";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";

const tool = requireTool("join-files");

/** Numbered pieces back into one file. */
export function JoinFilesApp() {
  const queue = useMemo<CombineOptions<Record<string, never>>>(
    () => ({
      key: "join-files",
      settings: {},
      inspect: async (file) => {
        const ref = parsePartName(file.name);
        return { facts: [ref ? `piece ${ref.index} of ${ref.base}` : "not numbered as a piece"] };
      },
      run: async (files) => {
        const order = orderParts(files);
        const blob = new Blob(order.ordered);
        const base = order.base === files[0]?.name ? `${files[0].name}.joined` : order.base;
        return {
          notes: [...order.problems, `${order.ordered.length} pieces joined in the order ${order.ordered.map((file) => parsePartName(file.name)?.index ?? file.name).join(", ")}.`],
          outputs: [{ label: "Joined file", fileName: base, blob, kind: "file", note: `${formatBytes(blob.size)} from ${order.ordered.length} pieces` }],
        };
      },
    }),
    [],
  );

  return (
    <CombineApp
      tool={tool}
      lead="Drop the pieces of a split file - video.mp4.001, .002 and so on, from the split tool here or from any splitter - and get the file back in one piece, the pieces put in order by their numbers whatever order they arrived in. Nothing is uploaded, and nothing is copied."
      queue={queue}
      action="Join the pieces"
      minFiles={2}
      noun="pieces"
      busyLabel="Joining"
      summary={(files) => {
        if (files.length < 2) return null;
        const order = orderParts(files.map((entry) => entry.file));
        return `${files.length} pieces, ${formatBytes(files.reduce((sum, entry) => sum + entry.file.size, 0))} in all, joined as ${order.base}${order.problems.length > 0 ? `. ${order.problems[0]}` : ""}`;
      }}
      dropZone={{ accept: "*/*", inputLabel: "Choose the pieces", headline: "Drop the pieces here", subhead: "Joined by their numbers; the list order counts only for pieces without one" }}
      note="Pieces named .001, .002, .part1 or .z01 are sorted by their numbers, and the card says when one is missing, one is here twice, or the pieces come from files of different names; files not named as pieces are joined in the order of the list. The joined file is the pieces' bytes end to end, which is what any splitter made and what the original was. Nothing checks that the result is the original: a checksum from the sender does that, and the checksum tool here reads one."
    />
  );
}
