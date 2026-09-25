"use client";

import { useMemo, useState } from "react";

import { canEncode, encodeCanvas, IMAGE_ACCEPT, rejectNonImage, type DecodedImage, type ImageMime } from "@/lib/images/canvas";
import { readPicture } from "@/lib/images/run";
import { layoutSprites, spriteCss, spriteJson, type SpriteLayout } from "@/lib/images/sprites";
import { formatBytes } from "@/lib/format-utils";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("create-sprite-sheet");

/** Canvases past this on a side fail in some browsers. */
const MAX_SIDE = 16384;
const MAX_PIXELS = 120_000_000;

interface SheetSettings {
  layout: SpriteLayout;
  padding: number;
  mime: Extract<ImageMime, "image/png" | "image/webp">;
}

const LAYOUTS: { value: SpriteLayout; label: string; blurb: string }[] = [
  { value: "packed", label: "Packed", blurb: "As small a sheet as the pictures allow; the usual choice" },
  { value: "grid", label: "Grid", blurb: "Equal cells, for animation frames of one size" },
  { value: "row", label: "One row", blurb: "Side by side, left to right" },
  { value: "column", label: "One column", blurb: "Stacked, top to bottom" },
];

const PADDINGS = [
  { value: "0", label: "None", blurb: "Pictures touch" },
  { value: "2", label: "2 px", blurb: "Stops edges bleeding when scaled" },
  { value: "8", label: "8 px", blurb: "Room for mipmaps and filtering" },
];

function isSettings(value: unknown): value is SheetSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SheetSettings>;
  return LAYOUTS.some((layout) => layout.value === candidate.layout) && PADDINGS.some((padding) => Number(padding.value) === candidate.padding) && (candidate.mime === "image/png" || candidate.mime === "image/webp");
}

/** Many small pictures on one sheet, with the CSS and JSON that place them. */
export function CreateSpriteSheetApp() {
  const [settings, setSettings] = useState<SheetSettings>({ layout: "packed", padding: 2, mime: "image/png" });
  useStoredSettings(storageKey("settings", "create-sprite-sheet"), settings, setSettings, isSettings);

  const queue = useMemo<CombineOptions<SheetSettings>>(
    () => ({
      key: "create-sprite-sheet",
      settings,
      reject: rejectNonImage,
      run: async (files, current, report) => {
        const pictures: { name: string; image: DecodedImage }[] = [];
        try {
          for (const [index, file] of files.entries()) {
            report(`Decoding ${file.name} (${index + 1} of ${files.length})...`, index / files.length / 2);
            pictures.push({ name: file.name, image: await readPicture(file) });
          }
          const sheet = layoutSprites(
            pictures.map(({ name, image }) => ({ name, width: image.width, height: image.height })),
            current.layout,
            current.padding,
          );
          if (sheet.width > MAX_SIDE || sheet.height > MAX_SIDE || sheet.width * sheet.height > MAX_PIXELS) {
            throw new PlainError(`The sheet would be ${sheet.width} x ${sheet.height} pixels, more than a browser can draw.`, "Use fewer or smaller pictures, or the packed layout, which makes the smallest sheet.");
          }
          report("Drawing the sheet...", 0.6);
          const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(sheet.width, sheet.height) : Object.assign(document.createElement("canvas"), { width: sheet.width, height: sheet.height });
          const context = canvas.getContext("2d") as CanvasRenderingContext2D;
          sheet.frames.forEach((frame, index) => context.drawImage(pictures[index].image.source, frame.x, frame.y, frame.width, frame.height));
          const mime = current.mime === "image/webp" && !canEncode("image/webp") ? "image/png" : current.mime;
          const blob = await encodeCanvas(canvas, mime, mime === "image/webp" ? 1 : undefined);
          const imageName = `spritesheet.${mime === "image/webp" ? "webp" : "png"}`;
          const used = sheet.frames.reduce((sum, frame) => sum + frame.width * frame.height, 0);
          return {
            notes: [`${files.length} pictures on a ${sheet.width} x ${sheet.height} sheet, ${Math.round((used / (sheet.width * sheet.height)) * 100)}% of it used.`, "The CSS gives each picture a class named after its file, such as .sprite-arrow-left; put both classes on an element: class=\"sprite sprite-arrow-left\"."],
            outputs: [
              { label: "Sprite sheet", fileName: imageName, blob, kind: "image", note: `${sheet.width} x ${sheet.height}, ${formatBytes(blob.size)}` },
              { label: "CSS", fileName: "spritesheet.css", blob: new Blob([spriteCss(sheet, imageName)], { type: "text/css;charset=utf-8" }), kind: "file", note: "A class for each picture" },
              { label: "JSON", fileName: "spritesheet.json", blob: new Blob([spriteJson(sheet, imageName)], { type: "application/json" }), kind: "file", note: "TexturePacker's hash format, for Phaser, PixiJS and other engines" },
            ],
          };
        } finally {
          for (const { image } of pictures) image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Layout",
    summary: () => `${LAYOUTS.find((layout) => layout.value === settings.layout)?.label.toLowerCase()}, ${settings.padding} px apart, ${settings.mime === "image/webp" ? "WebP" : "PNG"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Layout</legend>
          <RadioCards aria-label="Layout" value={settings.layout} onValueChange={(layout) => setSettings((previous) => ({ ...previous, layout }))} options={LAYOUTS} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Space between</legend>
          <RadioCards aria-label="Space between" value={String(settings.padding)} onValueChange={(value) => setSettings((previous) => ({ ...previous, padding: Number(value) }))} options={PADDINGS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Sheet format</legend>
          <RadioCards
            aria-label="Sheet format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime }))}
            options={[
              { value: "image/png" as const, label: "PNG", blurb: "Lossless, read everywhere" },
              { value: "image/webp" as const, label: "WebP", blurb: "Smaller, at top quality" },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop a set of icons, game frames or UI pictures and get them packed onto one sprite sheet, with the CSS classes for a website and the JSON a game engine reads to find each one. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Make the sprite sheet"
      minFiles={2}
      noun="pictures"
      busyLabel="Packing"
      summary={(files) => (files.length >= 2 ? `${files.length} pictures, in the order listed.` : null)}
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose pictures", headline: "Drop pictures here", subhead: "PNG keeps transparency" }}
      note="Every picture keeps its own size and transparency; nothing is scaled or trimmed. The JSON follows TexturePacker's hash format, keyed by file name, which Phaser, PixiJS, Cocos and most engines load directly. A little space between pictures stops neighbours bleeding into each other when the sheet is scaled or filtered on a GPU."
    />
  );
}
