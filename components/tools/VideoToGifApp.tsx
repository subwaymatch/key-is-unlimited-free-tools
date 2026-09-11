"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_GIF_SETTINGS,
  GIF_FPS_OPTIONS,
  GIF_SIZE_OPTIONS,
  gifFormat,
  type GifSettings,
} from "@/lib/engine/video";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("video-to-gif");

/** Guards a stored settings object, which may be from an older build. */
function isGifSettings(value: unknown): value is GifSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GifSettings>;
  return (
    typeof candidate.fps === "number" &&
    GIF_FPS_OPTIONS.includes(candidate.fps) &&
    (candidate.width === null || typeof candidate.width === "number")
  );
}

/**
 * A GIF of a whole film is absurd, so a range is required - but a short clip
 * is exactly what people want a GIF of, and asking for two markers that mean
 * "all of it" is a chore. Thirty seconds at 480 px and 15 fps is around 25 MB,
 * which is the point where a whole-clip GIF stops being a reasonable offer.
 */
const WHOLE_CLIP_SECONDS = 30;

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: true,
  clipLabel: "Make a GIF of this clip:",
  alsoLabel: "",
  busyLabel: "Making the GIF",
  wholeClipSeconds: WHOLE_CLIP_SECONDS,
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

const SIZE_OPTIONS = GIF_SIZE_OPTIONS.map((size) => ({
  value: size === null ? "source" : String(size),
  label: size === null ? "Source size" : `${size} px`,
  blurb:
    size === null
      ? "As large as the video. Very large files"
      : size <= 320
        ? "Chat and forum size"
        : size <= 480
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


  useStoredSettings(storageKey("settings", "video-to-gif"), settings, setSettings, isGifSettings);

  const queue = useMemo<QueueOptions>(
    () => ({
      key: "video-to-gif",
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
      `${settings.fps} fps, ${
        settings.width === null ? "source size" : `up to ${settings.width} px`
      }`,
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
          <legend className={styles.legend}>Size</legend>
          <p className={styles.intro}>
            The limit is the longest side, so a portrait clip and a landscape one at the same
            setting come out about the same size rather than the portrait one being the larger of
            the two. Never enlarged: a smaller video keeps its own size.
          </p>
          <RadioCards
            aria-label="Size"
            value={settings.width === null ? "source" : String(settings.width)}
            onValueChange={(value) =>
              setSettings((previous) => ({
                ...previous,
                width: value === "source" ? null : Number(value),
              }))
            }
            options={SIZE_OPTIONS}
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
      note="GIFs get big quickly: ten seconds at 480 px and 15 frames a second is around 8 MB, and a minute is closer to 50 MB. Keep clips short, or lower the size and the frame rate."
    />
  );
}
