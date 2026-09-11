"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_SPEED_SETTINGS,
  formatSpeed,
  MAX_SPEED_FACTOR,
  MIN_SPEED_FACTOR,
  parseSpeedFactor,
  SPEED_PRESETS,
  speedFormat,
  type SpeedSettings,
} from "@/lib/engine/video";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("change-speed");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Re-time this clip at:",
  alsoLabel: "Also at:",
  busyLabel: "Re-timing",
};

/** Guards a stored settings object, which may be from an older build. */
function isSpeedSettings(value: unknown): value is SpeedSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SpeedSettings>;
  return (
    typeof candidate.factor === "number" &&
    parseSpeedFactor(candidate.factor) === candidate.factor &&
    typeof candidate.keepAudio === "boolean"
  );
}

const CUSTOM = "custom";

const SPEED_OPTIONS = [
  ...SPEED_PRESETS.map((preset) => ({
    value: String(preset.factor),
    label: formatSpeed(preset.factor),
    blurb: preset.blurb,
  })),
  { value: CUSTOM, label: "Custom", blurb: `Any speed from ${MIN_SPEED_FACTOR}x to ${MAX_SPEED_FACTOR}x` },
];

const AUDIO_OPTIONS = [
  {
    value: "keep",
    label: "Keep the audio",
    blurb: "Re-timed to match the picture and pitch-corrected, so voices stay voices",
  },
  {
    value: "drop",
    label: "Drop the audio",
    blurb: "A silent file. The choice for a time-lapse, where sped-up sound is noise",
  },
];

/**
 * The speed changer.
 *
 * One setting shapes the whole plan, so it is baked into the format when a
 * file is queued: a clip queued at 2x stays a 2x job however the panel
 * changes afterwards, and the other presets are one click away on the card.
 */
export function ChangeSpeedApp() {
  const [settings, setSettings] = useState<SpeedSettings>(DEFAULT_SPEED_SETTINGS);
  const [speedChoice, setSpeedChoice] = useState<string>(String(DEFAULT_SPEED_SETTINGS.factor));
  const [customText, setCustomText] = useState("3");

  useStoredSettings(
    storageKey("settings", "change-speed"),
    settings,
    (stored) => {
      setSettings(stored);
      const isPreset = SPEED_PRESETS.some((preset) => preset.factor === stored.factor);
      setSpeedChoice(isPreset ? String(stored.factor) : CUSTOM);
      if (!isPreset) setCustomText(String(stored.factor));
    },
    isSpeedSettings,
  );

  /*
   * Whatever the custom field says right now, or null when it is not a speed
   * the tool takes. The summary, the chips and the job all read the factor
   * through this, so the number on the button is the number the filter gets.
   */
  const customFactor = customText.trim() === "" ? null : parseSpeedFactor(Number(customText));
  const customInvalid = speedChoice === CUSTOM && customFactor === null;
  const speed = formatSpeed(settings.factor);

  const queue = useMemo<QueueOptions>(() => {
    const current = speedFormat(settings);
    // The chosen speed first, then every preset, so a file can be re-timed
    // again at another speed from its own card.
    const presets = SPEED_PRESETS.map((preset) =>
      speedFormat({ ...settings, factor: preset.factor }),
    ).filter((format) => format.id !== current.id);

    return {
      key: "change-speed",
      formats: [current, ...presets],
      defaultFormatIds: [current.id],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label, trim }) => `Re-timing ${trim ? "the clip" : "the video"} at ${label}...`,
    };
  }, [settings]);

  const applyFactor = (value: number) => {
    const factor = parseSpeedFactor(value);
    if (factor === null) return;
    setSettings((previous) => ({ ...previous, factor }));
  };

  const chooseSpeed = (value: string) => {
    setSpeedChoice(value);
    applyFactor(Number(value === CUSTOM ? customText : value));
  };

  const chooseCustom = (text: string) => {
    setCustomText(text);
    applyFactor(Number(text));
  };

  const toolSettings: ToolSettings = {
    title: "Speed & audio",
    defaultOpen: true,
    invalid: () =>
      customInvalid
        ? `A speed between ${MIN_SPEED_FACTOR}x and ${MAX_SPEED_FACTOR}x is needed before a file can be re-timed.`
        : null,
    summary: () =>
      customInvalid
        ? "no speed chosen"
        : `${speed}, ${settings.keepAudio ? "audio kept" : "audio dropped"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Speed</legend>
          <p className={styles.intro}>
            Above 1x is faster, below 1x is slower. The frame rate stays as it was, so a speed-up
            drops frames and a slow-down repeats them. Applied to files you add next; each file
            can be re-timed again at another speed from its own card afterwards.
          </p>
          <RadioCards
            aria-label="Speed"
            value={speedChoice}
            onValueChange={chooseSpeed}
            options={SPEED_OPTIONS}
          />
          {speedChoice === CUSTOM && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Speed, as a multiple</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={MIN_SPEED_FACTOR}
                  max={MAX_SPEED_FACTOR}
                  step="0.05"
                  value={customText}
                  aria-invalid={customInvalid}
                  aria-describedby="speed-custom-note"
                  onChange={(event) => chooseCustom(event.target.value)}
                  className={styles.input}
                />
              </label>
              <p id="speed-custom-note" className={styles.panelNote}>
                {customInvalid
                  ? `Type a speed between ${MIN_SPEED_FACTOR} and ${MAX_SPEED_FACTOR}. Nothing will start until you do.`
                  : `1.5 plays half as fast again; 0.8 is a fifth slower. Using ${speed}.`}
              </p>
            </div>
          )}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Audio</legend>
          <RadioCards
            aria-label="Audio"
            value={settings.keepAudio ? "keep" : "drop"}
            onValueChange={(value) =>
              setSettings((previous) => ({ ...previous, keepAudio: value === "keep" }))
            }
            options={AUDIO_OPTIONS}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video and pick a speed: twice as fast for a walkthrough, half speed to see what happened, or any multiple you type. The audio is re-timed to match and pitch-corrected, so people still sound like themselves. Nothing is uploaded, however large the file."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        subhead: customInvalid
          ? "Choose a speed below before adding a file"
          : `Re-timing starts automatically at ${speed} - change it below`,
      }}
      note="A speed change is always a full re-encode, since every frame moves and every audio sample is resampled; expect about real time for 1080p, measured against the length of the output. Slow motion repeats frames rather than inventing new ones, so it is smooth at half speed and stutters at a quarter. Audio is re-timed with ffmpeg's atempo filter, which holds the pitch; above about 4x, speech becomes hard to follow and dropping the audio is the better choice."
    />
  );
}
