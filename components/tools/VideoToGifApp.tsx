"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_GIF_SETTINGS,
  GIF_FPS_OPTIONS,
  GIF_WIDTH_OPTIONS,
  gifFormat,
  type GifSettings,
} from "@/lib/engine/video";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("video-to-gif");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: true,
  wholeLabel: "",
  clipLabel: "Make a GIF of this clip:",
  alsoLabel: "",
};

const FPS_OPTIONS = GIF_FPS_OPTIONS.map((fps) => ({
  value: String(fps),
  label: `${fps} fps`,
  blurb:
    fps <= 10
      ? "Smallest file; fine for slow motion"
      : fps <= 12
        ? "Small, with a little judder"
        : fps <= 15
          ? "The usual choice"
          : "Smooth, and the largest file",
}));

const WIDTH_OPTIONS = GIF_WIDTH_OPTIONS.map((width) => ({
  value: width === null ? "source" : String(width),
  label: width === null ? "Source width" : `${width} px`,
  blurb:
    width === null
      ? "As large as the video. Very large files"
      : width <= 320
        ? "Chat and forum size"
        : width <= 480
          ? "The usual choice"
          : "Large, for a page of its own",
}));

/**
 * Video to GIF, one range at a time.
 *
 * The file is read on arrival so the length and a preview are there to choose
 * a range from, and nothing is produced until one is chosen: a GIF of a whole
 * video is almost never what anyone wants, and it would be enormous.
 */
export function VideoToGifApp() {
  const [settings, setSettings] = useState<GifSettings>(DEFAULT_GIF_SETTINGS);

  const queue = useMemo<QueueOptions>(
    () => ({
      formats: [gifFormat(settings)],
      defaultFormatIds: [],
      expects: "video",
      openWithoutOutputs: true,
      waveform: false,
      sourcePreview: true,
      phase: () => "Making the GIF...",
    }),
    [settings],
  );

  const toolSettings: ToolSettings = {
    title: "Frame rate & size",
    summary: () =>
      `${settings.fps} fps, ${settings.width === null ? "source width" : `${settings.width} px wide`}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Frame rate</legend>
          <RadioCards
            aria-label="Frame rate"
            value={String(settings.fps)}
            onValueChange={(value) =>
              setSettings((previous) => ({ ...previous, fps: Number(value) }))
            }
            options={FPS_OPTIONS}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Width</legend>
          <p className={styles.intro}>Never enlarged: a smaller video keeps its own width.</p>
          <RadioCards
            aria-label="Width"
            value={settings.width === null ? "source" : String(settings.width)}
            onValueChange={(value) =>
              setSettings((previous) => ({
                ...previous,
                width: value === "source" ? null : Number(value),
              }))
            }
            options={WIDTH_OPTIONS}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video, pick the seconds you want, and get a looping GIF with a palette built from the clip itself, so it does not look like it was made in 1998. Choose the frame rate and the width. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: "The file is read first; then pick the range to turn into a GIF" }}
      note="GIFs get big quickly: ten seconds at 480 pixels wide and 15 frames a second is around 8 MB, and a minute is closer to 50 MB. Keep clips short, or lower the width and the frame rate."
    />
  );
}
