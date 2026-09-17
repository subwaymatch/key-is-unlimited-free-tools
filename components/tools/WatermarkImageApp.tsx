"use client";

import { useCallback, useMemo, useState } from "react";

import { describeSize, encodeCanvas, drawImage, IMAGE_ACCEPT, MIME_LABELS, mayHaveTransparency, QUALITY_PRESETS, rejectNonImage, sameFormatMime } from "@/lib/images/canvas";
import { CORNERS, drawImageMark, drawTextMark, type Corner } from "@/lib/images/edit";
import { pictureName, readPicture } from "@/lib/images/run";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { FileField } from "../ui/FileField";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("watermark-image");

interface MarkSettings {
  mode: "text" | "image";
  text: string;
  corner: Corner;
  size: number;
  opacity: number;
}

const DEFAULT_SETTINGS: MarkSettings = { mode: "text", text: "", corner: "bottom-right", size: 0.2, opacity: 0.7 };

function isMarkSettings(value: unknown): value is MarkSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MarkSettings>;
  return (candidate.mode === "text" || candidate.mode === "image") && typeof candidate.text === "string" && CORNERS.some((entry) => entry.id === candidate.corner) && typeof candidate.size === "number" && typeof candidate.opacity === "number";
}

interface RunSettings extends MarkSettings {
  logo: File | null;
}

/** A logo or a line of text on every photo. */
export function WatermarkImageApp() {
  const [settings, setSettings] = useState<MarkSettings>(DEFAULT_SETTINGS);
  const [logo, setLogo] = useState<File | null>(null);
  useStoredSettings(storageKey("settings", "watermark-image"), settings, setSettings, isMarkSettings);

  const chooseLogo = useCallback((file: File) => setLogo(file), []);

  const queue = useMemo<PlainQueueOptions<RunSettings>>(
    () => ({
      key: "watermark-image",
      settings: { ...settings, logo },
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        const mark = current.mode === "image" && current.logo ? await readPicture(current.logo) : null;
        try {
          const size = { width: image.width, height: image.height };
          const mime = sameFormatMime(file);
          const canvas = drawImage(image, size, mime === "image/jpeg" && mayHaveTransparency(file) ? "#ffffff" : null);
          const style = { corner: current.corner, size: current.size, opacity: current.opacity, margin: 0.03 };
          if (mark) drawImageMark(canvas, mark, style);
          else drawTextMark(canvas, current.text.trim(), style);
          report("Writing...", null);
          const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
          return { facts: [describeSize(size)], outputs: [{ label: `Watermarked ${MIME_LABELS[mime]}`, fileName: pictureName(file, mime, "-watermarked"), blob, kind: "image" }] };
        } finally {
          image.close();
          mark?.close();
        }
      },
    }),
    [settings, logo],
  );

  const invalid = settings.mode === "image" ? (logo ? null : "Choose a logo above before adding pictures.") : settings.text.trim() ? null : "Type the watermark text before adding pictures.";

  const toolSettings: PlainSettings = {
    title: "Watermark",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () => `${settings.mode === "image" ? (logo?.name ?? "no logo yet") : settings.text.trim() ? `"${settings.text.trim()}"` : "no text yet"}, ${settings.corner.replace("-", " ")}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>What to draw</legend>
          <RadioCards
            aria-label="What to draw"
            value={settings.mode}
            onValueChange={(mode) => setSettings((previous) => ({ ...previous, mode: mode as MarkSettings["mode"] }))}
            options={[
              { value: "text", label: "A line of text", blurb: "White with a dark edge, so it reads on anything" },
              { value: "image", label: "A logo", blurb: "Best as a PNG with a transparent background" },
            ]}
            columns={2}
          />
          {settings.mode === "text" ? (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Text</span>
                <input type="text" value={settings.text} placeholder="(c) Your name" onChange={(event) => setSettings((previous) => ({ ...previous, text: event.target.value }))} className={styles.input} style={{ width: "20rem" }} />
              </label>
            </div>
          ) : (
            <FileField id="watermark-image-logo" accept={IMAGE_ACCEPT} chosen={logo?.name ?? null} onChoose={chooseLogo} onClear={() => setLogo(null)} />
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Position</legend>
          <RadioCards aria-label="Position" value={settings.corner} onValueChange={(corner) => setSettings((previous) => ({ ...previous, corner }))} options={CORNERS.map((entry) => ({ value: entry.id, label: entry.label }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <RadioCards
            aria-label="Size"
            value={String(settings.size)}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, size: Number(value) }))}
            options={[
              { value: "0.1", label: "Small", blurb: "A tenth of the width" },
              { value: "0.2", label: "Medium", blurb: "A fifth of the width" },
              { value: "0.35", label: "Large", blurb: "A third of the width" },
            ]}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Opacity</legend>
          <RadioCards
            aria-label="Opacity"
            value={String(settings.opacity)}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, opacity: Number(value) }))}
            options={[
              { value: "0.4", label: "Faint" },
              { value: "0.7", label: "Clear" },
              { value: "1", label: "Solid" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Type a line of text or choose a logo, then drop photos: each comes back with the mark in the corner you chose, at the size and opacity you chose, in the format it came in, as many at once as you like. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Marking"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: invalid ? "Set the watermark above before adding pictures" : "The watermark is drawn on each picture you drop" }}
      note="The mark is scaled to a share of each picture's width, so it sits the same on a portrait and a landscape photo. Text is set in the system's own sans-serif, which is what a browser draws on a canvas; a logo keeps its transparent parts. What comes out carries none of the source's metadata."
    />
  );
}
