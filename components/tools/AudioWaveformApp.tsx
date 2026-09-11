"use client";

import { useMemo, useState } from "react";

import {
  AUDIO_PICTURE_SIZES,
  DEFAULT_AUDIO_PICTURE_SETTINGS,
  spectrogramFormat,
  waveformFormat,
  type AudioPictureSettings,
} from "@/lib/engine/audio";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("audio-waveform");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Draw this clip as:",
  alsoLabel: "Also draw:",
  busyLabel: "Drawing",
};

function isPictureSettings(value: unknown): value is AudioPictureSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AudioPictureSettings>;
  return (
    AUDIO_PICTURE_SIZES.some((size) => size.width === candidate.width && size.height === candidate.height) &&
    (candidate.tone === "dark" || candidate.tone === "light")
  );
}

const SIZE_OPTIONS = AUDIO_PICTURE_SIZES.map((size) => ({
  value: `${size.width}x${size.height}`,
  label: `${size.width} x ${size.height}`,
  blurb: size.blurb,
}));

const TONE_OPTIONS = [
  { value: "dark", label: "Dark ink", blurb: "For a light page" },
  { value: "light", label: "Light ink", blurb: "For a dark page" },
];

/**
 * Pictures of audio: a waveform on arrival, a spectrogram on request.
 *
 * Both are one PNG from one pass over the audio, with the waveform on a
 * transparent background so it drops onto any page.
 */
export function AudioWaveformApp() {
  const [settings, setSettings] = useState<AudioPictureSettings>(DEFAULT_AUDIO_PICTURE_SETTINGS);

  useStoredSettings(storageKey("settings", "audio-waveform"), settings, setSettings, isPictureSettings);

  const queue = useMemo<QueueOptions>(() => {
    const waveform = waveformFormat(settings);
    return {
      key: "audio-waveform",
      formats: [waveform, spectrogramFormat(settings)],
      defaultFormatIds: [waveform.id],
      expects: "audio",
      waveform: false,
      phase: ({ label }) => `Drawing the ${label.toLowerCase()}...`,
    };
  }, [settings]);

  const toolSettings: ToolSettings = {
    title: "Size & ink",
    summary: () => `${settings.width} x ${settings.height}, ${settings.tone} ink`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <RadioCards
            aria-label="Size"
            value={`${settings.width}x${settings.height}`}
            onValueChange={(value) => {
              const [width, height] = value.split("x").map(Number);
              setSettings((previous) => ({ ...previous, width, height }));
            }}
            options={SIZE_OPTIONS}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Waveform ink</legend>
          <p className={styles.intro}>The background is transparent either way; the spectrogram has its own colours.</p>
          <RadioCards
            aria-label="Waveform ink"
            value={settings.tone}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, tone: value as "dark" | "light" }))}
            options={TONE_OPTIONS}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop an audio file, or a video, and get its waveform as a PNG on a transparent background, ready for a podcast page, a cover or a post; or a spectrogram, which shows what is in the sound and where. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio files here",
        subhead: "The waveform is drawn automatically; the spectrogram from the card",
      }}
      note="The waveform is the whole file's shape, mixed to mono, scaled to the width chosen; set markers on the card to draw a range instead. A spectrogram plots frequency against time on a log scale with its legend along the edges, which is the picture that shows a hum, a cut-off or a lossy encode at a glance."
    />
  );
}
