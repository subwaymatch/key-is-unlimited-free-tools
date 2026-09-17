"use client";

import { useMemo, useState } from "react";

import { DEFAULT_GIF_VIDEO_SETTINGS, GIF_PLAYS_OPTIONS, gifVideoFormat, type GifVideoSettings } from "@/lib/engine/animated";
import { GIF_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("gif-to-video");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also as:",
  busyLabel: "Converting",
};

function isGifVideoSettings(value: unknown): value is GifVideoSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GifVideoSettings>;
  return (candidate.target === "mp4" || candidate.target === "webm") && GIF_PLAYS_OPTIONS.includes(candidate.plays ?? 0);
}

const TARGET_OPTIONS = [
  { value: "mp4", label: "MP4 (H.264)", blurb: "Plays anywhere: chat apps, social feeds, every browser. The usual choice" },
  { value: "webm", label: "WebM (VP8)", blurb: "The open web format; slower to encode" },
];

const PLAYS_OPTIONS = GIF_PLAYS_OPTIONS.map((plays) => ({
  value: String(plays),
  label: plays === 1 ? "Once" : `${plays} times`,
  blurb: plays === 1 ? "The animation as it is; the player can loop it" : `The animation played ${plays} times in a row, for players that will not loop`,
}));

/**
 * GIF to MP4.
 *
 * A GIF is a video to ffmpeg, so this is the converter pointed at GIFs with
 * the three things a GIF needs: even edges, a steady frame rate, and the
 * animation repeated when the player is not going to loop it.
 */
export function GifToVideoApp() {
  const [settings, setSettings] = useState<GifVideoSettings>(DEFAULT_GIF_VIDEO_SETTINGS);

  useStoredSettings(storageKey("settings", "gif-to-video"), settings, setSettings, isGifVideoSettings);

  const queue = useMemo<QueueOptions>(() => {
    const current = gifVideoFormat(settings);
    const other = gifVideoFormat({ ...settings, target: settings.target === "mp4" ? "webm" : "mp4" });
    return {
      key: "gif-to-video",
      formats: [current, other],
      defaultFormatIds: [current.id],
      expects: "video",
      waveform: false,
      phase: ({ label }) => `Converting to ${label}...`,
    };
  }, [settings]);

  const toolSettings: ToolSettings = {
    title: "Format & plays",
    summary: () => `${settings.target.toUpperCase()}, ${settings.plays === 1 ? "played once" : `played ${settings.plays} times`}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.target}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, target: value as GifVideoSettings["target"] }))}
            options={TARGET_OPTIONS}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Plays</legend>
          <p className={styles.intro}>
            A GIF loops on its own; a video plays once unless the player loops it. Repeating the
            animation in the file makes it loop everywhere, at the cost of a longer file.
          </p>
          <RadioCards
            aria-label="Plays"
            value={String(settings.plays)}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, plays: Number(value) }))}
            options={PLAYS_OPTIONS}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop an animated GIF and get it back as an MP4 that plays anywhere at a tenth of the size, or as a WebM. Every frame is kept, the edges are made even and the frame rate steadied, and the animation can be repeated for players that will not loop it. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: GIF_ACCEPT,
        inputLabel: "Choose GIF files",
        headline: "Drop GIF files here",
        subhead: `Converted to ${settings.target.toUpperCase()} automatically - change it below`,
      }}
      note="A GIF stores each frame's own delay and often runs at eight or ten frames a second, which some players stall on, so a GIF slower than 24 fps is written at a steady 30 with frames repeated; a faster one keeps its own rate. The picture is encoded at a quality where a GIF's flat colours survive intact. A GIF that is a single frame is a picture, not an animation, and is refused with a suggestion."
    />
  );
}
