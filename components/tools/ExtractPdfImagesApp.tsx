"use client";

import { useMemo, useState } from "react";

import { MIME_EXTENSIONS, MIME_LABELS, type ImageMime } from "@/lib/images/canvas";
import { fileStem } from "@/lib/mediaTypes";
import { pageImages, type PageImage } from "@/lib/pdf/extract";
import { PDF_ACCEPT, rejectNonPdf } from "@/lib/pdf/files";
import { closePdf, openPdf } from "@/lib/pdf/render";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("extract-pdf-images");

/** The most pictures one document hands back, so a thousand-page scan does not make a thousand cards. */
const MAX_IMAGES = 400;

interface ExtractSettings {
  mime: ImageMime;
  minSide: number;
}

const SIZE_OPTIONS = [
  { value: "1", label: "Everything", blurb: "Bullets, rules and icons included" },
  { value: "32", label: "32 px and up", blurb: "Skips the decorations" },
  { value: "150", label: "150 px and up", blurb: "Photos and figures only" },
];

function isExtractSettings(value: unknown): value is ExtractSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ExtractSettings>;
  return (candidate.mime === "image/png" || candidate.mime === "image/jpeg") && typeof candidate.minSide === "number";
}

/** The pictures a PDF has in it, as files. */
export function ExtractPdfImagesApp() {
  const [settings, setSettings] = useState<ExtractSettings>({ mime: "image/png", minSide: 32 });
  useStoredSettings(storageKey("settings", "extract-pdf-images"), settings, setSettings, isExtractSettings);

  const queue = useMemo<PlainQueueOptions<ExtractSettings>>(
    () => ({
      key: "extract-pdf-images",
      settings,
      reject: rejectNonPdf,
      run: async (file, current, report, signal) => {
        report("Opening...", null);
        const document = await openPdf(new Uint8Array(await file.arrayBuffer()));
        try {
          const count = document.numPages;
          const found: PageImage[] = [];
          let capped = false;
          for (let index = 0; index < count && !capped; index += 1) {
            if (signal.aborted) break;
            report(`Looking through page ${index + 1} of ${count}... ${found.length} ${found.length === 1 ? "picture" : "pictures"} so far`, index / count);
            const images = await pageImages(document, index, current.mime, current.mime === "image/jpeg" ? 0.92 : null, current.minSide);
            for (const image of images) {
              if (found.length >= MAX_IMAGES) {
                capped = true;
                break;
              }
              found.push(image);
            }
          }
          const facts = [`${count} ${count === 1 ? "page" : "pages"}`, `${found.length} ${found.length === 1 ? "picture" : "pictures"}`];
          if (found.length === 0) {
            return { facts, outputs: [], nothing: { message: "No pictures were found in this PDF.", hint: current.minSide > 1 ? "None at the size asked for, at least; try taking everything." : "Its pages are drawn text and lines, with no images placed on them. A scan that shows as a picture may be a JPEG 2000 or a JBIG2, which come through PDF to images instead." } };
          }
          const stem = fileStem(file.name, "document");
          return {
            facts,
            notes: capped ? [`Only the first ${MAX_IMAGES} pictures are here; split the document to get the rest.`] : [],
            outputs: found.map((image) => ({
              label: `Page ${image.page}, picture ${image.index}`,
              fileName: `${stem}-page-${String(image.page).padStart(2, "0")}-image-${String(image.index).padStart(2, "0")}.${MIME_EXTENSIONS[current.mime]}`,
              blob: image.blob,
              kind: "image" as const,
              note: `${image.width}x${image.height}`,
            })),
          };
        } finally {
          await closePdf(document);
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Format & size",
    summary: () => `${MIME_LABELS[settings.mime]}, ${SIZE_OPTIONS.find((option) => option.value === String(settings.minSide))?.label.toLowerCase() ?? `${settings.minSide} px and up`}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime: mime as ImageMime }))}
            options={[
              { value: "image/png", label: "PNG", blurb: "Lossless, with any transparency kept" },
              { value: "image/jpeg", label: "JPEG", blurb: "Smaller, for photographs" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Smallest picture to take</legend>
          <RadioCards aria-label="Smallest picture to take" value={String(settings.minSide)} onValueChange={(value) => setSettings((previous) => ({ ...previous, minSide: Number(value) }))} options={SIZE_OPTIONS} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a PDF and get every picture placed in it as a file of its own, at the size it was stored, page by page: the photos in a report, the figures in a paper, the scans in a form. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Looking"
      dropZone={{ accept: PDF_ACCEPT, inputLabel: "Choose PDF files", headline: "Drop PDF files here", subhead: "Their pictures come out as they land" }}
      note="The pictures are the ones the PDF places as images, at their own pixel size rather than the size they show at, decoded by PDF.js the way it decodes them to draw the page: a JPEG comes out as its pixels, and a picture with a transparency mask keeps it as PNG. Drawn graphics - charts made of lines, text, vector logos - are not pictures and are not here; PDF to images draws the whole page for those. A picture used on several pages comes out once per page."
    />
  );
}
