"use client";

import { useMemo, useState } from "react";

import { describeSize, drawImage, encodeCanvas, fitLongestSide, IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { drawSwatches, medianCut, PALETTE_SIZES, paletteText } from "@/lib/images/palette";
import { readPicture } from "@/lib/images/run";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("extract-colours");

/** The picture is sampled at this size: enough pixels to count, few enough to sort. */
const SAMPLE_SIDE = 200;

interface PaletteSettings {
  count: number;
}

function isPaletteSettings(value: unknown): value is PaletteSettings {
  return typeof value === "object" && value !== null && PALETTE_SIZES.some((size) => size.count === (value as Partial<PaletteSettings>).count);
}

/** The colours a picture is made of. */
export function ExtractColoursApp() {
  const [settings, setSettings] = useState<PaletteSettings>({ count: 8 });
  useStoredSettings(storageKey("settings", "extract-colours"), settings, setSettings, isPaletteSettings);

  const queue = useMemo<PlainQueueOptions<PaletteSettings>>(
    () => ({
      key: "extract-colours",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          const canvas = drawImage(image, fitLongestSide(source, SAMPLE_SIDE), null);
          const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          report("Counting colours...", null);
          const swatches = medianCut(pixels, current.count);
          if (swatches.length === 0) throw new PlainError("This picture is entirely transparent.", "There are no opaque pixels to take colours from.");
          const strip = await encodeCanvas(drawSwatches(swatches), "image/png");
          const text = paletteText(swatches, file.name);
          const stem = fileStem(file.name, "picture");
          return {
            facts: [describeSize(source)],
            outputs: [
              { label: "Palette", fileName: `${stem}-palette.png`, blob: strip, kind: "image", note: swatches.map((swatch) => `${swatch.hex} ${Math.round(swatch.share * 100)}%`).join(", ") },
              { label: "Hex codes", fileName: `${stem}-palette.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }), kind: "text", text: swatches.map((swatch) => swatch.hex).join(", ") },
            ],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "How many colours",
    summary: () => `${settings.count} colours`,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Colours</legend>
        <RadioCards aria-label="Colours" value={String(settings.count)} onValueChange={(value) => setSettings({ count: Number(value) })} options={PALETTE_SIZES.map((size) => ({ value: String(size.count), label: size.label, blurb: size.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a picture and get the colours it is made of, largest share first: a strip of swatches labelled with their hex codes, and the codes as text with CSS variables to paste. For a palette from a photo, a logo's exact colours, or a theme to match a picture. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Counting"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: "Their colours are counted as they land" }}
      note="The picture is sampled at 200 pixels on its longest side and its colours grouped by median cut: every pixel starts in one box, the box is split at the median of the channel that varies most, the widest box is split again, and so on until there are as many boxes as colours asked for; each box's average is a swatch and its pixel count is the share. Transparent pixels are left out. A logo with three flat colours gets three swatches back, whatever was asked for."
    />
  );
}
