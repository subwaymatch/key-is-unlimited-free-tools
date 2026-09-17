"use client";

import { useMemo, useState } from "react";

import { AUDIO_SPEED_PRESETS, audioSpeedFormat } from "@/lib/engine/tempo";
import { formatSpeed, MAX_SPEED_FACTOR, MIN_SPEED_FACTOR, parseSpeedFactor } from "@/lib/engine/video";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("change-audio-speed");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Re-time this clip at:",
  alsoLabel: "Also at:",
  busyLabel: "Re-timing",
};

const CUSTOM = "custom";

const SPEED_OPTIONS = [
  ...AUDIO_SPEED_PRESETS.map((preset) => ({ value: String(preset.factor), label: formatSpeed(preset.factor), blurb: preset.blurb })),
  { value: CUSTOM, label: "Custom", blurb: `Any speed from ${MIN_SPEED_FACTOR}x to ${MAX_SPEED_FACTOR}x` },
];

interface SpeedSetting {
  factor: number;
}

function isSpeedSetting(value: unknown): value is SpeedSetting {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SpeedSetting>;
  return typeof candidate.factor === "number" && parseSpeedFactor(candidate.factor) === candidate.factor;
}

/** The speed changer for sound alone: the video tool's atempo chain, in the file's own format. */
export function ChangeAudioSpeedApp() {
  const [setting, setSetting] = useState<SpeedSetting>({ factor: 1.5 });
  const [choice, setChoice] = useState<string>("1.5");
  const [customText, setCustomText] = useState("1.75");

  useStoredSettings(
    storageKey("settings", "change-audio-speed"),
    setting,
    (stored) => {
      setSetting(stored);
      const isPreset = AUDIO_SPEED_PRESETS.some((preset) => preset.factor === stored.factor);
      setChoice(isPreset ? String(stored.factor) : CUSTOM);
      if (!isPreset) setCustomText(String(stored.factor));
    },
    isSpeedSetting,
  );

  const customFactor = customText.trim() === "" ? null : parseSpeedFactor(Number(customText));
  const customInvalid = choice === CUSTOM && customFactor === null;
  const speed = formatSpeed(setting.factor);

  const queue = useMemo<QueueOptions>(() => {
    const current = audioSpeedFormat(setting.factor);
    const presets = AUDIO_SPEED_PRESETS.map((preset) => audioSpeedFormat(preset.factor)).filter((format) => format.id !== current.id);
    return {
      key: "change-audio-speed",
      formats: [current, ...presets],
      defaultFormatIds: [current.id],
      expects: "audio",
      waveform: true,
      phase: ({ label, trim }) => `Re-timing ${trim ? "the clip" : "the recording"} at ${label}...`,
    };
  }, [setting]);

  const applyFactor = (value: number) => {
    const factor = parseSpeedFactor(value);
    if (factor !== null) setSetting({ factor });
  };

  const toolSettings: ToolSettings = {
    title: "Speed",
    defaultOpen: true,
    invalid: () => (customInvalid ? `A speed between ${MIN_SPEED_FACTOR}x and ${MAX_SPEED_FACTOR}x is needed before a file can be re-timed.` : null),
    summary: () => (customInvalid ? "no speed chosen" : speed),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Speed</legend>
        <p className={styles.intro}>
          Above 1x is faster, below 1x is slower, and the pitch stays where it was either way.
          Applied to files you add next; each file&apos;s card offers the other speeds.
        </p>
        <RadioCards
          aria-label="Speed"
          value={choice}
          onValueChange={(value) => {
            setChoice(value);
            applyFactor(Number(value === CUSTOM ? customText : value));
          }}
          options={SPEED_OPTIONS}
        />
        {choice === CUSTOM && (
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
                onChange={(event) => {
                  setCustomText(event.target.value);
                  applyFactor(Number(event.target.value));
                }}
                className={styles.input}
              />
            </label>
            <p className={styles.panelNote}>
              {customInvalid ? `Type a speed between ${MIN_SPEED_FACTOR} and ${MAX_SPEED_FACTOR}. Nothing will start until you do.` : `Using ${speed}.`}
            </p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a recording, or a video whose soundtrack is taken, and get it back faster or slower with the pitch kept: a lecture at 1.5x, an interview at half speed to transcribe, or any multiple you type. Written back in the file's own format. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio files here",
        subhead: customInvalid ? "Choose a speed below before adding a file" : `Re-timing starts automatically at ${speed} - change it below`,
      }}
      note="The re-timing is ffmpeg's atempo filter, which stretches or compresses the sound without changing its pitch, so voices stay voices. Between 0.75x and 1.5x the result is hard to tell from a recording made at that pace; past 2x speech gets harder to follow, and below half speed the artefacts show. To re-time a video's picture along with its sound, use the video speed tool."
    />
  );
}
