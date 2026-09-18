"use client";

import { useMemo, useState } from "react";

import { describeSize, encodeCanvas, IMAGE_ACCEPT, MIME_LABELS, mayHaveTransparency, QUALITY_PRESETS, rejectNonImage, sameFormatMime } from "@/lib/images/canvas";
import { pictureName, readPicture } from "@/lib/images/run";
import { ADJUSTMENTS, drawAdjusted, type Adjustment } from "@/lib/images/transform";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("adjust-image");

interface AdjustSettings {
  adjustment: Adjustment;
}

function isAdjustSettings(value: unknown): value is AdjustSettings {
  return typeof value === "object" && value !== null && ADJUSTMENTS.some((option) => option.id === (value as Partial<AdjustSettings>).adjustment);
}

/** Pictures made black and white, sepia, negative, lighter, darker, or flatter or punchier. */
export function AdjustImageApp() {
  const [settings, setSettings] = useState<AdjustSettings>({ adjustment: "grayscale" });
  useStoredSettings(storageKey("settings", "adjust-image"), settings, setSettings, isAdjustSettings);

  const chosen = ADJUSTMENTS.find((option) => option.id === settings.adjustment) ?? ADJUSTMENTS[0];

  const queue = useMemo<PlainQueueOptions<AdjustSettings>>(
    () => ({
      key: "adjust-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          const mime = sameFormatMime(file);
          report("Adjusting every pixel...", null);
          const canvas = drawAdjusted(image, current.adjustment, mime === "image/jpeg" && mayHaveTransparency(file) ? "#ffffff" : null);
          const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
          const label = ADJUSTMENTS.find((option) => option.id === current.adjustment)?.label ?? "Adjusted";
          return { facts: [describeSize(source)], outputs: [{ label: `${label}, ${MIME_LABELS[mime]}`, fileName: pictureName(file, mime, `-${current.adjustment}`), blob, kind: "image" }] };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Adjustment",
    defaultOpen: true,
    summary: () => chosen.label.toLowerCase(),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Adjustment</legend>
        <RadioCards aria-label="Adjustment" value={settings.adjustment} onValueChange={(adjustment) => setSettings({ adjustment: adjustment as Adjustment })} options={ADJUSTMENTS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop pictures and get them back in black and white, in sepia, as a negative, a fifth lighter or darker, or with more or less contrast, as many at once as you like, in the format they came in. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Adjusting"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: `${chosen.label} as they land - change it above` }}
      note="Each adjustment is one pass over the pixels: grey by how bright each is, sepia by the usual mix, a negative by inverting, brightness by a fifth, contrast about the middle grey. One fixed step each, the same for every picture, which is what a batch wants; anything finer wants an editor. Transparent parts stay transparent. What comes out carries none of the source's metadata."
    />
  );
}
