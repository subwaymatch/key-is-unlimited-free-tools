"use client";

import { useMemo, useState } from "react";

import { describeSize, IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { imageContainer, stripImageMetadata } from "@/lib/images/metadata";
import { encodePicture, readPicture } from "@/lib/images/run";
import { fileStem } from "@/lib/mediaTypes";
import { imagesToPdf, type ImagePage, type ImagesToPdfSettings, type PageSizeChoice } from "@/lib/pdf/pages";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("images-to-pdf");

const PAGE_OPTIONS: { value: PageSizeChoice; label: string; blurb: string }[] = [
  { value: "a4", label: "A4", blurb: "Turned to suit each picture, with a margin. What most of the world prints on" },
  { value: "letter", label: "Letter", blurb: "The same, on US Letter" },
  { value: "fit", label: "The picture's size", blurb: "No margins: each page is exactly its picture, for viewing rather than printing" },
];

function isPdfSettings(value: unknown): value is ImagesToPdfSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ImagesToPdfSettings>;
  return (candidate.page === "a4" || candidate.page === "letter" || candidate.page === "fit") && typeof candidate.margin === "number";
}

/**
 * A picture as pdf-lib takes it: a JPEG or PNG that is already upright goes
 * in as it is; anything else is drawn again by the browser.
 */
async function pictureForPdf(file: File): Promise<ImagePage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const container = imageContainer(bytes);
  if (container === "jpeg" || container === "png") {
    const { metadata } = stripImageMetadata(bytes);
    if (metadata.orientation === null || metadata.orientation === 1) {
      const image = await readPicture(file);
      try {
        return { bytes, mime: container === "jpeg" ? "image/jpeg" : "image/png", width: image.width, height: image.height };
      } finally {
        image.close();
      }
    }
  }
  const image = await readPicture(file);
  try {
    const size = { width: image.width, height: image.height };
    const { blob } = await encodePicture(image, file, size, "image/jpeg", 0.9);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg", ...size };
  } finally {
    image.close();
  }
}

/** Pictures into one PDF, a page each. */
export function ImagesToPdfApp() {
  const [settings, setSettings] = useState<ImagesToPdfSettings>({ page: "a4", margin: 36 });
  useStoredSettings(storageKey("settings", "images-to-pdf"), settings, setSettings, isPdfSettings);

  const queue = useMemo<CombineOptions<ImagesToPdfSettings>>(
    () => ({
      key: "images-to-pdf",
      settings,
      reject: rejectNonImage,
      inspect: async (file) => {
        const image = await readPicture(file);
        try {
          return { facts: [describeSize({ width: image.width, height: image.height })], previewUrl: URL.createObjectURL(file) };
        } finally {
          image.close();
        }
      },
      run: async (files, current, report) => {
        const pages: ImagePage[] = [];
        for (const [index, file] of files.entries()) {
          report(`Reading ${file.name}...`, index / (files.length + 1));
          pages.push(await pictureForPdf(file));
        }
        report("Writing the PDF...", files.length / (files.length + 1));
        const bytes = await imagesToPdf(pages, current);
        const name = files.length === 1 ? fileStem(files[0].name, "pictures") : `${fileStem(files[0].name, "pictures")}-and-${files.length - 1}-more`;
        return { outputs: [{ label: `PDF, ${pages.length} ${pages.length === 1 ? "page" : "pages"}`, fileName: `${name}.pdf`, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), kind: "pdf" }] };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Page size",
    summary: () => PAGE_OPTIONS.find((option) => option.value === settings.page)?.label ?? settings.page,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Page</legend>
        <RadioCards aria-label="Page" value={settings.page} onValueChange={(page) => setSettings((previous) => ({ ...previous, page }))} options={PAGE_OPTIONS} />
      </fieldset>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop photos or scans, put them in order, and get one PDF with a page for each: on A4 or Letter turned to suit the picture, or on pages the pictures' own size. JPEGs and PNGs go in exactly as they are. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Make the PDF"
      noun="pictures"
      busyLabel="Writing"
      summary={(files) => (files.length > 0 ? `${files.length} ${files.length === 1 ? "picture" : "pictures"}, one page each, in the order above.` : null)}
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: "Pages follow the order below; add them all, then arrange them" }}
      note="An upright JPEG or PNG is embedded byte for byte, with its metadata; a photo stored on its side, or any other format, is drawn again by the browser as a JPEG, upright and without metadata. A page the picture's own size is the picture at 72 pixels an inch, so a 4000-pixel photo makes a page 56 inches wide; viewers show it fine, printers want A4 or Letter."
    />
  );
}
