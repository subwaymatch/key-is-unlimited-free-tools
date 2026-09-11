"use client";

import { useMemo, useState } from "react";

import {
  AUDIO_COMPRESS_PRESETS,
  compressAudioFormat,
  DEFAULT_COMPRESS_AUDIO_SETTINGS,
  type CompressAudioSettings,
} from "@/lib/engine/audio";
import { formatMegabytes, MIN_TARGET_MEGABYTES, targetBytesFromMegabytes } from "@/lib/engine/video";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("compress-audio");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: true,
  requireTrim: false,
  clipLabel: "Compress this clip:",
  alsoLabel: "Also as:",
  busyLabel: "Compressing",
};

const SIZE = "size";

function isCompressAudioSettings(value: unknown): value is CompressAudioSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompressAudioSettings>;
  const preset = candidate.presetId;
  const hasPreset = typeof preset === "string" && AUDIO_COMPRESS_PRESETS.some((entry) => entry.id === preset);
  const hasSize = typeof candidate.targetBytes === "number" && candidate.targetBytes > 0;
  return (hasPreset && candidate.targetBytes === null) || (preset === null && hasSize);
}

const OPTIONS = [
  ...AUDIO_COMPRESS_PRESETS.map((preset) => ({ value: preset.id, label: preset.label, blurb: preset.blurb })),
  { value: SIZE, label: "Under a size", blurb: "Any size in megabytes; the bitrate follows from the length" },
];

/**
 * The audio compressor: a preset for what the audio is, or a size to land
 * under. The setting is baked into the format when a file is queued, and
 * the other presets are on the card.
 */
export function CompressAudioApp() {
  const [settings, setSettings] = useState<CompressAudioSettings>(DEFAULT_COMPRESS_AUDIO_SETTINGS);
  const [customText, setCustomText] = useState("10");

  useStoredSettings(
    storageKey("settings", "compress-audio"),
    settings,
    (stored) => {
      setSettings(stored);
      if (stored.targetBytes !== null) setCustomText(formatMegabytes(stored.targetBytes));
    },
    isCompressAudioSettings,
  );

  const choice = settings.presetId ?? SIZE;
  const customBytes = customText.trim() === "" ? null : targetBytesFromMegabytes(Number(customText));
  const customInvalid = choice === SIZE && customBytes === null;

  const queue = useMemo<QueueOptions>(() => {
    const current = compressAudioFormat(settings);
    const presets = AUDIO_COMPRESS_PRESETS.map((preset) =>
      compressAudioFormat({ presetId: preset.id, targetBytes: null }),
    ).filter((format) => format.id !== current.id);
    return {
      key: "compress-audio",
      formats: [current, ...presets],
      defaultFormatIds: [current.id],
      expects: "audio",
      waveform: true,
      phase: ({ label, trim }) => `Compressing ${trim ? "the clip" : "the audio"} (${label.toLowerCase()})...`,
    };
  }, [settings]);

  const choose = (value: string) => {
    if (value === SIZE) {
      const targetBytes = targetBytesFromMegabytes(Number(customText));
      setSettings({ presetId: null, targetBytes: targetBytes ?? settings.targetBytes ?? 10_000_000 });
      return;
    }
    setSettings({ presetId: value, targetBytes: null });
  };

  const chooseCustom = (text: string) => {
    setCustomText(text);
    const targetBytes = targetBytesFromMegabytes(Number(text));
    if (targetBytes !== null) setSettings({ presetId: null, targetBytes });
  };

  const summary = customInvalid
    ? "no size chosen"
    : settings.presetId
      ? (AUDIO_COMPRESS_PRESETS.find((preset) => preset.id === settings.presetId)?.label ?? settings.presetId)
      : `under ${formatMegabytes(settings.targetBytes ?? 0)} MB`;

  const toolSettings: ToolSettings = {
    title: "How small",
    defaultOpen: true,
    invalid: () =>
      customInvalid ? `A size of at least ${MIN_TARGET_MEGABYTES} MB is needed before a file can be compressed.` : null,
    summary: () => summary,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Preset or size</legend>
        <p className={styles.intro}>
          Speech survives far lower bitrates than music, so pick by what the recording is. Applied to
          files you add next; each file offers the other presets from its own card afterwards.
        </p>
        <RadioCards aria-label="Preset or size" value={choice} onValueChange={choose} options={OPTIONS} />
        {choice === SIZE && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Size in megabytes</span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_TARGET_MEGABYTES}
                step="0.1"
                value={customText}
                aria-invalid={customInvalid}
                aria-describedby="compress-audio-note"
                onChange={(event) => chooseCustom(event.target.value)}
                className={styles.input}
              />
            </label>
            <p id="compress-audio-note" className={styles.panelNote}>
              {customInvalid
                ? `Type a size of at least ${MIN_TARGET_MEGABYTES} MB. Nothing will start until you do.`
                : "Opus below 64 kbps and AAC above it, mono under 32 kbps. The number is never rounded up."}
            </p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop an audio file - or a video, whose soundtrack is taken - and get it back much smaller: Opus for speech, which stays clear at a tenth of an MP3's size, AAC or MP3 for music, or a size to land under for an email or a chat app. Nothing is uploaded, however large the file."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio files here",
        subhead: customInvalid ? "Choose a size above before adding a file" : `Compression starts automatically (${summary}) - change it above`,
      }}
      note="Opus plays in every browser and messaging app and in most players from the last decade; MP3 plays in everything ever made. A voice preset folds the sides to mono, since a spoken recording gains nothing from stereo and the file halves. A file already under a target size is left alone and its card offers the presets."
    />
  );
}
