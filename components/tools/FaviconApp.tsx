"use client";

import { useMemo } from "react";

import { encodeCanvas, IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { centredCrop, drawCrop, FAVICON_PNGS, faviconSnippet, ICO_SIZES, icoFromPngs } from "@/lib/images/edit";
import { readPicture } from "@/lib/images/run";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("favicon");

/** Every icon a site needs, from one picture. */
export function FaviconApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "favicon",
      settings: {},
      reject: rejectNonImage,
      preview: true,
      run: async (file, _settings, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const rect = centredCrop({ width: image.width, height: image.height }, { width: 1, height: 1 });
          const pngAt = async (size: number) => new Uint8Array(await (await encodeCanvas(drawCrop(image, rect, { width: size, height: size }, null), "image/png")).arrayBuffer());
          report("Drawing the ICO sizes...", 0.2);
          const icoEntries = [];
          for (const size of ICO_SIZES) icoEntries.push({ size, bytes: await pngAt(size) });
          const ico = icoFromPngs(icoEntries);
          report("Drawing the PNG sizes...", 0.6);
          const pngs = [];
          for (const entry of FAVICON_PNGS) pngs.push({ ...entry, bytes: await pngAt(entry.size) });
          const snippet = faviconSnippet();
          return {
            facts: [`${image.width}x${image.height}${rect.width !== image.width || rect.height !== image.height ? ", cropped square from the middle" : ""}`],
            outputs: [
              { label: "favicon.ico", fileName: "favicon.ico", blob: new Blob([ico as BlobPart], { type: "image/x-icon" }), kind: "file", note: `${ICO_SIZES.join(", ")} pixel entries` },
              ...pngs.map((entry) => ({ label: entry.fileName, fileName: entry.fileName, blob: new Blob([entry.bytes as BlobPart], { type: "image/png" }), kind: "image" as const, note: `${entry.size}x${entry.size}, ${entry.purpose}` })),
              { label: "Lines for the page's head", fileName: "favicon-snippet.html", blob: new Blob([snippet], { type: "text/html" }), kind: "text", text: snippet },
            ],
          };
        } finally {
          image.close();
        }
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a logo or any picture and get every icon a site needs: a favicon.ico with 16, 32 and 48 pixel entries, the 180 pixel icon iOS shows on the home screen, and the 192 and 512 pixel icons a web app manifest wants, with the lines to paste into your page. Nothing is uploaded."
      queue={queue}
      busyLabel="Drawing"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose an image", headline: "Drop a picture here", subhead: "A square is best; anything else is cropped square from the middle" }}
      note="The ICO holds PNG entries, which every browser and every Windows since 7 read; older Windows wanted bitmaps. Transparency is kept in every size, so a logo with a transparent background stays one. A picture with fine detail turns to mush at 16 pixels, as every favicon does; a simple mark at high contrast survives."
    />
  );
}
