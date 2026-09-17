"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fileKey, imageMimeType, readFileBytes } from "@/lib/chosenFile";
import { BURN_FONT_URL } from "@/lib/engine/burn";
import { DEFAULT_WATERMARK_SETTINGS, imageWatermarkFormat, textWatermarkFormat, WATERMARK_OPACITIES, WATERMARK_POSITIONS, WATERMARK_SIZES, type WatermarkImage, type WatermarkSettings } from "@/lib/engine/watermark";
import { IMAGE_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { FileField } from "../ui/FileField";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("add-watermark");

const FEATURES: ToolFeatures = { trim: true, silence: false, requireTrim: false, clipLabel: "Watermark this clip:", alsoLabel: "Also:", busyLabel: "Marking" };

interface PanelSettings extends WatermarkSettings {
  mode: "image" | "text";
  text: string;
}

const DEFAULT_SETTINGS: PanelSettings = { ...DEFAULT_WATERMARK_SETTINGS, mode: "image", text: "" };

function isPanelSettings(value: unknown): value is PanelSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PanelSettings>;
  return (candidate.mode === "image" || candidate.mode === "text") && typeof candidate.text === "string" && WATERMARK_POSITIONS.some((entry) => entry.id === candidate.position) && typeof candidate.size === "number" && typeof candidate.opacity === "number" && typeof candidate.margin === "number";
}

/** A logo or a line of text on every frame. */
export function AddWatermarkApp() {
  const [settings, setSettings] = useState<PanelSettings>(DEFAULT_SETTINGS);
  const [image, setImage] = useState<WatermarkImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [font, setFont] = useState<Uint8Array | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);

  useStoredSettings(storageKey("settings", "add-watermark"), settings, setSettings, isPanelSettings);

  useEffect(() => {
    if (settings.mode !== "text" || font) return;
    let cancelled = false;
    fetch(BURN_FONT_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return new Uint8Array(await response.arrayBuffer());
      })
      .then((bytes) => {
        if (!cancelled) setFont(bytes);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFontError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [settings.mode, font]);

  const chooseImage = useCallback((file: File) => {
    setImageError(null);
    const mimeType = imageMimeType(file);
    if (!mimeType) {
      setImageError("The watermark has to be a PNG or a JPEG; a PNG keeps its transparent parts.");
      return;
    }
    if (file.size > 20_000_000) {
      setImageError("The picture is over 20 MB; a logo does not need to be.");
      return;
    }
    void readFileBytes(file)
      .then((bytes) => setImage({ name: file.name, bytes, mimeType, key: fileKey(file) }))
      .catch(() => setImageError("This file could not be read."));
  }, []);

  const queue = useMemo<QueueOptions>(() => {
    const base: WatermarkSettings = { position: settings.position, size: settings.size, opacity: settings.opacity, margin: settings.margin };
    const format = settings.mode === "image" ? (image ? imageWatermarkFormat(image, base) : null) : font && settings.text.trim() ? textWatermarkFormat(settings.text, font, base) : null;
    return {
      key: "add-watermark",
      formats: format ? [format] : [],
      defaultFormatIds: format ? [format.id] : [],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: () => "Drawing the watermark on every frame...",
    };
  }, [settings, image, font]);

  const invalid =
    settings.mode === "image"
      ? image
        ? null
        : "Choose a picture above before adding a video."
      : fontError
        ? `The font could not be loaded (${fontError}), so no text can be drawn.`
        : !settings.text.trim()
          ? "Type the watermark text before adding a video."
          : font === null
            ? "Loading the font..."
            : null;

  const toolSettings: ToolSettings = {
    title: "Watermark",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () => `${settings.mode === "image" ? (image?.name ?? "no picture yet") : settings.text.trim() ? `"${settings.text.trim()}"` : "no text yet"}, ${settings.position.replace("-", " ")}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>What to draw</legend>
          <RadioCards
            aria-label="What to draw"
            value={settings.mode}
            onValueChange={(mode) => setSettings((previous) => ({ ...previous, mode: mode as PanelSettings["mode"] }))}
            options={[
              { value: "image", label: "A picture", blurb: "A logo, best as a PNG with a transparent background" },
              { value: "text", label: "A line of text", blurb: "White with a dark edge, so it reads on anything" },
            ]}
            columns={2}
          />
          {settings.mode === "image" ? (
            <FileField id="add-watermark-image" accept={IMAGE_ACCEPT} chosen={image?.name ?? null} onChoose={chooseImage} onClear={() => setImage(null)} error={imageError} />
          ) : (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Text</span>
                <input type="text" value={settings.text} placeholder="(c) Your name" onChange={(event) => setSettings((previous) => ({ ...previous, text: event.target.value }))} className={styles.input} style={{ width: "20rem" }} />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Position</legend>
          <RadioCards aria-label="Position" value={settings.position} onValueChange={(position) => setSettings((previous) => ({ ...previous, position }))} options={WATERMARK_POSITIONS.map((entry) => ({ value: entry.id, label: entry.label }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <RadioCards aria-label="Size" value={String(settings.size)} onValueChange={(value) => setSettings((previous) => ({ ...previous, size: Number(value) }))} options={WATERMARK_SIZES.map((entry) => ({ value: String(entry.size), label: entry.label, blurb: `${Math.round(entry.size * 100)}% of the frame's width` }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Opacity</legend>
          <RadioCards aria-label="Opacity" value={String(settings.opacity)} onValueChange={(value) => setSettings((previous) => ({ ...previous, opacity: Number(value) }))} options={WATERMARK_OPACITIES.map((entry) => ({ value: String(entry.opacity), label: entry.label }))} />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Choose a logo or type a line of text, drop a video, and get it back with the mark drawn over every frame in the corner you chose, at the size and opacity you chose. The sound is copied untouched. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: invalid ? "Set the watermark above before adding a video" : "The watermark is drawn on each video you drop" }}
      note="Drawing on every frame is a full re-encode of the picture, at a quality a notch above the converter's, so expect about real time for 1080p. A picture is scaled to a share of the frame's width with its own shape kept, so the same logo sits the same on a portrait and a landscape clip; a PNG's transparent parts stay transparent. Text is set in DejaVu Sans, the one font this site ships, which covers Latin, Greek and Cyrillic."
    />
  );
}
