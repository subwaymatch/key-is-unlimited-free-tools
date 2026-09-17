"use client";

import { useMemo } from "react";

import { IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { imageContainer, stripImageMetadata } from "@/lib/images/metadata";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("remove-image-metadata");

const CONTAINER_NAMES = { jpeg: "JPEG", png: "PNG", webp: "WebP" } as const;
const MIME_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** The metadata tool: what the file says, and the file without it, losslessly. */
export function RemoveImageMetadataApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "remove-image-metadata",
      settings: {},
      reject: rejectNonImage,
      preview: true,
      run: async (file, _settings, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const container = imageContainer(bytes);
        if (!container) {
          throw new PlainError(
            "Only JPEG, PNG and WebP can be stripped without re-encoding.",
            "This is another format. Convert it to JPEG, PNG or WebP with the image converter, whose output carries no metadata at all.",
          );
        }
        const { metadata, bytes: clean } = stripImageMetadata(bytes);
        const facts = [`${CONTAINER_NAMES[container]}`, ...metadata.facts.map((fact) => `${fact.label}: ${fact.value}`)];
        if (!clean) {
          return { facts, outputs: [], nothing: { message: "No metadata found.", hint: "This file carries no Exif, XMP, comment or text blocks, so there is nothing to remove." } };
        }
        const blob = new Blob([clean as BlobPart], { type: MIME_TYPES[container] });
        const extension = file.name.split(".").pop() ?? container;
        return {
          facts,
          outputs: [{ label: `${CONTAINER_NAMES[container]} without metadata`, fileName: `${fileStem(file.name, "picture")}-clean.${extension}`, blob, kind: "image", note: `${bytes.length - clean.length} bytes of metadata removed: ${metadata.blocks.join(", ")}` }],
          notes: metadata.hasLocation ? ["This file carried a GPS position. It is gone from the copy."] : [],
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a photo and see what it says about itself - the camera, the lens, the moment, the software, and often the exact place it was taken - then save a copy with all of it removed. The picture itself is not touched: the metadata blocks are left out of the copy, byte for byte. Nothing is uploaded."
      queue={queue}
      busyLabel="Reading"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop JPEG, PNG or WebP files here", subhead: "Read as they land; the metadata is listed and a clean copy offered" }}
      note="Exif, XMP, IPTC, comments, maker notes and multi-picture extensions are removed; the JFIF header, the colour profile and the Adobe marker stay, since the picture needs them. One tag is kept: orientation, so a photo taken on its side stays the right way up in players that rely on it. HEIC, AVIF, GIF and TIFF cannot be stripped without decoding them; the converter re-draws those and writes no metadata at all."
    />
  );
}
