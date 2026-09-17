"use client";

import { useMemo } from "react";

import { formatBytes } from "@/lib/format-utils";
import { IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { base64Length, base64Snippets, MAX_BASE64_BYTES } from "@/lib/images/edit";
import { fileStem } from "@/lib/mediaTypes";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("image-to-base64");

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

/** A picture as text. */
export function ImageToBase64App() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "image-to-base64",
      settings: {},
      reject: (file) =>
        rejectNonImage(file) ??
        (file.size > MAX_BASE64_BYTES
          ? { message: `This picture is ${formatBytes(file.size)}, which is too large to be useful as text.`, hint: `A data URI is a third larger than the file and sits in a page or a stylesheet; ${formatBytes(MAX_BASE64_BYTES)} is the most this takes. Compress the picture first.` }
          : null),
      preview: true,
      run: async (file, _settings, report) => {
        report("Encoding...", null);
        const uri = await readAsDataUri(file);
        const stem = fileStem(file.name, "image");
        const snippets = base64Snippets(uri, stem);
        return {
          facts: [`${formatBytes(file.size)} becomes ${formatBytes(base64Length(file.size))} of text`],
          outputs: [
            { label: "Data URI", fileName: `${stem}.base64.txt`, blob: new Blob([uri], { type: "text/plain" }), kind: "text", text: uri },
            { label: "HTML", fileName: `${stem}.img.html`, blob: new Blob([snippets.html], { type: "text/html" }), kind: "text", text: snippets.html },
            { label: "CSS", fileName: `${stem}.css`, blob: new Blob([snippets.css], { type: "text/css" }), kind: "text", text: snippets.css },
          ],
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a picture and get it back as a Base64 data URI, with the img tag and the CSS rule to paste it into: for an icon or a small graphic that has to live inside a page, an email or a stylesheet rather than as a file beside it. Nothing is uploaded."
      queue={queue}
      busyLabel="Encoding"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: "Encoded as they land; copy the text from each card" }}
      note="Base64 makes a file a third larger and a page that carries it cannot cache the picture separately, so it earns its place only for small graphics that would otherwise cost a request each. The text is exactly the file's bytes; nothing is re-encoded and no metadata is removed, so strip a photo first if that matters."
    />
  );
}
