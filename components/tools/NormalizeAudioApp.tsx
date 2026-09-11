"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_NORMALIZE_SETTINGS,
  formatLufs,
  LOUDNESS_PRESETS,
  MAX_LUFS,
  MIN_LUFS,
  normalizeFormat,
  parseLufs,
  type NormalizeSettings,
} from "@/lib/engine/audio";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("normalize-audio");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Normalize this clip to:",
  alsoLabel: "Also normalize to:",
  busyLabel: "Normalizing",
};

function isNormalizeSettings(value: unknown): value is NormalizeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<NormalizeSettings>;
  return (
    typeof candidate.lufs === "number" &&
    parseLufs(candidate.lufs) === candidate.lufs &&
    typeof candidate.truePeak === "number"
  );
}

const CUSTOM = "custom";

const TARGET_OPTIONS = [
  ...LOUDNESS_PRESETS.map((preset) => ({ value: preset.id, label: preset.label, blurb: preset.blurb })),
  { value: CUSTOM, label: "Custom", blurb: `Any target from ${MIN_LUFS} to ${MAX_LUFS} LUFS, peaks under -1 dBTP` },
];

/**
 * Loudness normalisation to a platform target.
 *
 * Two passes, measured then corrected, so the result is one clean gain
 * rather than a limiter riding the file. The target is baked into the
 * format, so a file queued at -14 stays a -14 job however the panel changes.
 */
export function NormalizeAudioApp() {
  const [settings, setSettings] = useState<NormalizeSettings>(DEFAULT_NORMALIZE_SETTINGS);
  const [choice, setChoice] = useState<string>(
    LOUDNESS_PRESETS.find((preset) => preset.lufs === DEFAULT_NORMALIZE_SETTINGS.lufs)?.id ?? CUSTOM,
  );
  const [customText, setCustomText] = useState("-20");

  useStoredSettings(
    storageKey("settings", "normalize-audio"),
    settings,
    (stored) => {
      setSettings(stored);
      const preset = LOUDNESS_PRESETS.find(
        (entry) => entry.lufs === stored.lufs && entry.truePeak === stored.truePeak,
      );
      setChoice(preset?.id ?? CUSTOM);
      if (!preset) setCustomText(String(stored.lufs));
    },
    isNormalizeSettings,
  );

  const customLufs = customText.trim() === "" ? null : parseLufs(Number(customText));
  const customInvalid = choice === CUSTOM && customLufs === null;
  const label = formatLufs(settings.lufs);

  const queue = useMemo<QueueOptions>(() => {
    const current = normalizeFormat(settings);
    const presets = LOUDNESS_PRESETS.map((preset) =>
      normalizeFormat({ lufs: preset.lufs, truePeak: preset.truePeak }),
    ).filter((format) => format.id !== current.id);
    return {
      key: "normalize-audio",
      formats: [current, ...presets],
      defaultFormatIds: [current.id],
      expects: "media",
      waveform: true,
      sourcePreview: true,
      phase: ({ label: target, trim }) =>
        `Normalizing ${trim ? "the clip" : "the audio"} to ${target}...`,
    };
  }, [settings]);

  const choosePreset = (value: string) => {
    setChoice(value);
    if (value === CUSTOM) {
      const lufs = parseLufs(Number(customText));
      if (lufs !== null) setSettings({ lufs, truePeak: -1 });
      return;
    }
    const preset = LOUDNESS_PRESETS.find((entry) => entry.id === value);
    if (preset) setSettings({ lufs: preset.lufs, truePeak: preset.truePeak });
  };

  const chooseCustom = (text: string) => {
    setCustomText(text);
    const lufs = parseLufs(Number(text));
    if (lufs !== null) setSettings({ lufs, truePeak: -1 });
  };

  const toolSettings: ToolSettings = {
    title: "Loudness target",
    defaultOpen: true,
    invalid: () =>
      customInvalid
        ? `A target between ${MIN_LUFS} and ${MAX_LUFS} LUFS is needed before a file can be normalized.`
        : null,
    summary: () => (customInvalid ? "no target chosen" : `${label}, peaks under ${settings.truePeak} dBTP`),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Target</legend>
        <p className={styles.intro}>
          Integrated loudness in LUFS, the number a platform measures the whole file by. Pick the
          platform the file is for. Applied to files you add next; each file can be normalized
          again to another target from its own card afterwards.
        </p>
        <RadioCards aria-label="Target" value={choice} onValueChange={choosePreset} options={TARGET_OPTIONS} />
        {choice === CUSTOM && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Target in LUFS</span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_LUFS}
                max={MAX_LUFS}
                step="0.5"
                value={customText}
                aria-invalid={customInvalid}
                aria-describedby="lufs-custom-note"
                onChange={(event) => chooseCustom(event.target.value)}
                className={styles.input}
              />
            </label>
            <p id="lufs-custom-note" className={styles.panelNote}>
              {customInvalid
                ? `Type a target between ${MIN_LUFS} and ${MAX_LUFS}. Nothing will start until you do.`
                : `Negative, and quieter the further below zero. Using ${label}.`}
            </p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop an audio file, or a video, and get it back at the loudness a platform expects: -14 LUFS for Spotify and YouTube, -16 for Apple, -23 for European broadcast, or a number of your own. The file is measured first and then corrected with one clean gain, so nothing pumps or squashes. An audio file comes back in its own format; a video keeps its picture untouched. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio or video files here",
        subhead: customInvalid
          ? "Choose a target below before adding a file"
          : `Normalization to ${label} starts automatically - change it below`,
      }}
      note="Two passes over the audio: one to measure, one to apply, so expect the file to take about twice as long as a plain conversion. A file that is already at the target comes back the same loudness, re-encoded; the sample rate is kept as it was. True peaks are held under -1 dBTP (-2 for US broadcast), which is what stops a loud master clipping after a lossy encode."
    />
  );
}
