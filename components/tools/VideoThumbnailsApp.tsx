"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_SHEET_SETTINGS,
  FRAME_FORMATS,
  SHEET_FRAME_OPTIONS,
  SHEET_WIDTH_OPTIONS,
  sheetFormat,
  sheetLayout,
  type SheetSettings,
} from "@/lib/engine/picture";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("video-thumbnails");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "From this range:",
  alsoLabel: "Also make:",
  busyLabel: "Taking frames",
};

function isSheetSettings(value: unknown): value is SheetSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SheetSettings>;
  return (
    typeof candidate.frames === "number" &&
    SHEET_FRAME_OPTIONS.includes(candidate.frames) &&
    typeof candidate.width === "number" &&
    SHEET_WIDTH_OPTIONS.includes(candidate.width)
  );
}

const FRAME_OPTIONS = SHEET_FRAME_OPTIONS.map((frames) => {
  const { columns, rows } = sheetLayout(frames);
  return { value: String(frames), label: `${frames} frames`, blurb: `A ${columns}x${rows} grid` };
});

const WIDTH_OPTIONS = SHEET_WIDTH_OPTIONS.map((width) => ({
  value: String(width),
  label: `${width} px`,
  blurb:
    width <= 160
      ? "Tiny tiles, a small sheet"
      : width <= 240
        ? "Enough to tell scenes apart"
        : width <= 320
          ? "The usual choice"
          : "Large tiles, a large sheet",
}));

/**
 * Still frames from a video: a contact sheet on arrival, single frames on
 * request.
 *
 * The sheet is what most people want from "thumbnails" and it is cheap, so it
 * runs as soon as the file lands. A single frame needs a moment chosen, which
 * the preview and its "Start here" button are for.
 */
export function VideoThumbnailsApp() {
  const [settings, setSettings] = useState<SheetSettings>(DEFAULT_SHEET_SETTINGS);

  useStoredSettings(storageKey("settings", "video-thumbnails"), settings, setSettings, isSheetSettings);

  const queue = useMemo<QueueOptions>(() => {
    const sheet = sheetFormat(settings);
    return {
      key: "video-thumbnails",
      formats: [sheet, ...FRAME_FORMATS],
      defaultFormatIds: [sheet.id],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label, trim }) =>
        label.startsWith("Contact")
          ? `Making the contact sheet${trim ? " from the range" : ""}...`
          : `Taking the frame${trim ? " at the start marker" : ""}...`,
    };
  }, [settings]);

  const { columns, rows } = sheetLayout(settings.frames);

  const toolSettings: ToolSettings = {
    title: "Contact sheet",
    summary: () => `${settings.frames} frames at ${settings.width} px`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Frames</legend>
          <p className={styles.intro}>
            Spread evenly over the whole video, or over the range set on the card, and laid out in a
            grid. Applied to files you add next.
          </p>
          <RadioCards
            aria-label="Frames"
            value={String(settings.frames)}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, frames: Number(value) }))}
            options={FRAME_OPTIONS}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Frame width</legend>
          <RadioCards
            aria-label="Frame width"
            value={String(settings.width)}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, width: Number(value) }))}
            options={WIDTH_OPTIONS}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video and get a contact sheet: a grid of frames spread evenly across it, one picture that shows what is in the file. Then pick any moment on the preview and take it as a JPEG or a lossless PNG. Nothing is uploaded, however large the file."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        subhead: `A ${columns}x${rows} sheet of ${settings.frames} frames is made automatically; single frames from the card`,
      }}
      note="For a single frame, scrub the preview to the moment you want and press Start here, then choose JPEG or PNG under the markers; the frame is taken at the start marker. The sheet seeks through the file rather than decoding all of it, so it is quick even on a long one."
    />
  );
}
