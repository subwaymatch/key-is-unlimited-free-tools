"use client";

import { useMemo, useState } from "react";

import { canEncode, describeSize, encodeCanvas, IMAGE_ACCEPT, MIME_EXTENSIONS, MIME_LABELS, QUALITY_PRESETS, rejectNonImage, type ImageMime } from "@/lib/images/canvas";
import { composeLayout, drawComposition, LAYOUT_OPTIONS, type ComposeLayout } from "@/lib/images/compose";
import { readPicture } from "@/lib/images/run";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("merge-images");

/** Chrome and Firefox refuse a canvas much past this on a side; Safari earlier. */
const MAX_SIDE = 16384;

type Background = "white" | "black" | "transparent";

interface MergeSettings {
  layout: ComposeLayout;
  columns: number | null;
  gap: number;
  background: Background;
  mime: ImageMime;
}

const GAP_OPTIONS = [
  { value: "0", label: "None", blurb: "Edge to edge" },
  { value: "12", label: "Thin", blurb: "12 pixels" },
  { value: "40", label: "Wide", blurb: "40 pixels" },
];

const BACKGROUND_OPTIONS: { value: Background; label: string; blurb?: string }[] = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "transparent", label: "Transparent", blurb: "PNG or WebP only" },
];

function isMergeSettings(value: unknown): value is MergeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MergeSettings>;
  return (
    LAYOUT_OPTIONS.some((option) => option.id === candidate.layout) &&
    (candidate.columns === null || (typeof candidate.columns === "number" && candidate.columns >= 1)) &&
    typeof candidate.gap === "number" &&
    BACKGROUND_OPTIONS.some((option) => option.value === candidate.background) &&
    (candidate.mime === "image/jpeg" || candidate.mime === "image/png" || candidate.mime === "image/webp")
  );
}

/** Pictures side by side, stacked, or in a grid, as one picture. */
export function MergeImagesApp() {
  const [settings, setSettings] = useState<MergeSettings>({ layout: "row", columns: null, gap: 12, background: "white", mime: "image/jpeg" });
  useStoredSettings(storageKey("settings", "merge-images"), settings, setSettings, isMergeSettings);

  const queue = useMemo<CombineOptions<MergeSettings>>(
    () => ({
      key: "merge-images",
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
        const images = [];
        try {
          for (const [index, file] of files.entries()) {
            report(`Decoding ${file.name}...`, index / (files.length + 1));
            images.push(await readPicture(file));
          }
          const composition = composeLayout(
            images.map((image) => ({ width: image.width, height: image.height })),
            { layout: current.layout, columns: current.columns, gap: current.gap, maxSide: MAX_SIDE },
          );
          report("Drawing...", files.length / (files.length + 1));
          const mime = current.background === "transparent" && current.mime === "image/jpeg" ? "image/png" : current.mime;
          const background = current.background === "transparent" ? null : current.background === "black" ? "#000000" : "#ffffff";
          const canvas = drawComposition(images, composition, mime === "image/jpeg" && background === null ? "#ffffff" : background);
          const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
          const name = files.length === 1 ? fileStem(files[0].name, "picture") : `${fileStem(files[0].name, "picture")}-and-${files.length - 1}-more`;
          return {
            notes: composition.shrunk ? [`The whole was scaled down so its longest side is ${MAX_SIDE} pixels, the most a canvas allows.`] : [],
            outputs: [{ label: `${MIME_LABELS[mime]}, ${files.length} ${files.length === 1 ? "picture" : "pictures"}`, fileName: `${name}-merged.${MIME_EXTENSIONS[mime]}`, blob, kind: "image", note: describeSize(composition) }],
          };
        } finally {
          for (const image of images) image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Layout & format",
    defaultOpen: true,
    invalid: () => (settings.mime === "image/webp" && !canEncode("image/webp") ? "This browser cannot write WebP; choose JPEG or PNG." : null),
    summary: () => `${LAYOUT_OPTIONS.find((option) => option.id === settings.layout)?.label.toLowerCase()}, ${settings.background} background, ${MIME_LABELS[settings.mime]}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Layout</legend>
          <RadioCards aria-label="Layout" value={settings.layout} onValueChange={(layout) => setSettings((previous) => ({ ...previous, layout: layout as ComposeLayout }))} options={LAYOUT_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
          {settings.layout === "grid" && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Columns</span>
                <input type="number" inputMode="numeric" min={1} max={20} step="1" value={settings.columns ?? ""} placeholder="auto" onChange={(event) => setSettings((previous) => ({ ...previous, columns: event.target.value === "" ? null : Math.max(1, Math.round(Number(event.target.value))) }))} className={styles.input} />
              </label>
              <p className={styles.panelNote}>Leave it empty for a grid as square as the count allows.</p>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Gap</legend>
          <RadioCards aria-label="Gap" value={String(settings.gap)} onValueChange={(value) => setSettings((previous) => ({ ...previous, gap: Number(value) }))} options={GAP_OPTIONS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Background</legend>
          <RadioCards aria-label="Background" value={settings.background} onValueChange={(background) => setSettings((previous) => ({ ...previous, background: background as Background, mime: background === "transparent" && previous.mime === "image/jpeg" ? "image/png" : previous.mime }))} options={BACKGROUND_OPTIONS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime: mime as ImageMime, background: mime === "image/jpeg" && previous.background === "transparent" ? "white" : previous.background }))}
            options={[
              { value: "image/jpeg", label: "JPEG", blurb: "Photos: small, no transparency" },
              { value: "image/png", label: "PNG", blurb: "Lossless, keeps a transparent background" },
              { value: "image/webp", label: "WebP", blurb: "Smaller than both; not written by Safari" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop pictures, put them in order, and get one picture back: side by side at the same height, one above another at the same width, or in a grid, with a gap and a background you choose. Before-and-after pairs, contact sheets, a strip for a post. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Merge the pictures"
      minFiles={2}
      noun="pictures"
      busyLabel="Drawing"
      summary={(files) => (files.length >= 2 ? `${files.length} pictures, ${LAYOUT_OPTIONS.find((option) => option.id === settings.layout)?.label.toLowerCase()}, in the order above.` : null)}
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: "Placed in the order below; add them all, then arrange them" }}
      note="Nothing is enlarged: a row is as tall as its shortest picture and a column as wide as its narrowest, with the others scaled down to match, and a grid's cell is the narrowest width by the shortest height with each picture fitted inside. The result is drawn by the browser's canvas, which caps a side at about 16,000 pixels; a larger whole is scaled down and the card says so. What comes out carries none of the sources' metadata."
    />
  );
}
