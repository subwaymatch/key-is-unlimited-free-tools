"use client";

import { useMemo, useState } from "react";

import { DEFAULT_FADE_SETTINGS, describeFade, FADE_SECONDS_OPTIONS, fadeFormat, type FadeSettings } from "@/lib/engine/level";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import { Select } from "../ui/Select";
import settingsStyles from "../Settings.module.css";
import styles from "./AddFadeApp.module.css";

const tool = requireTool("add-fade");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Fade this clip:",
  alsoLabel: "Also:",
  busyLabel: "Fading",
};

function isFadeSettings(value: unknown): value is FadeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FadeSettings>;
  return (
    FADE_SECONDS_OPTIONS.includes(candidate.inSeconds ?? -1) &&
    FADE_SECONDS_OPTIONS.includes(candidate.outSeconds ?? -1) &&
    typeof candidate.picture === "boolean"
  );
}

const SECONDS_OPTIONS = FADE_SECONDS_OPTIONS.map((seconds) => ({ value: seconds, label: seconds === 0 ? "None" : `${seconds} s` }));

const PICTURE_OPTIONS = [
  { value: "picture", label: "Sound and picture", blurb: "A video fades to and from black as well. Re-encodes the picture, so about real time" },
  { value: "sound", label: "Sound only", blurb: "A video's picture is copied as it is; only the sound fades" },
];

/** Fades: two lengths and, for a video, whether the picture goes with the sound. */
export function AddFadeApp() {
  const [settings, setSettings] = useState<FadeSettings>(DEFAULT_FADE_SETTINGS);

  useStoredSettings(storageKey("settings", "add-fade"), settings, setSettings, isFadeSettings);

  const queue = useMemo<QueueOptions>(() => {
    const current = fadeFormat(settings);
    const other = fadeFormat({ ...settings, picture: !settings.picture });
    return {
      key: "add-fade",
      formats: [current, other],
      defaultFormatIds: [current.id],
      expects: "audio",
      waveform: true,
      sourcePreview: true,
      phase: ({ label }) => `${label}...`,
    };
  }, [settings]);

  const none = settings.inSeconds === 0 && settings.outSeconds === 0;

  const toolSettings: ToolSettings = {
    title: "Fades",
    defaultOpen: true,
    invalid: () => (none ? "Choose a fade in, a fade out or both before adding a file." : null),
    summary: () => `${describeFade(settings)}${settings.picture ? ", picture too" : ""}`,
    render: () => (
      <>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Length</legend>
          <p className={settingsStyles.intro}>
            Half a second takes the click off a hard start; two or three seconds is a musical
            ending; ten is a slow fade under speech. Measured from the range when one is set.
          </p>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={settingsStyles.fieldLabel}>Fade in</span>
              <Select
                aria-label="Fade in"
                value={settings.inSeconds}
                options={SECONDS_OPTIONS}
                onValueChange={(inSeconds) => setSettings((previous) => ({ ...previous, inSeconds }))}
              />
            </label>
            <label className={styles.field}>
              <span className={settingsStyles.fieldLabel}>Fade out</span>
              <Select
                aria-label="Fade out"
                value={settings.outSeconds}
                options={SECONDS_OPTIONS}
                onValueChange={(outSeconds) => setSettings((previous) => ({ ...previous, outSeconds }))}
              />
            </label>
          </div>
        </fieldset>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>For a video</legend>
          <RadioCards
            aria-label="For a video"
            value={settings.picture ? "picture" : "sound"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, picture: value === "picture" }))}
            options={PICTURE_OPTIONS}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a recording, or a video, and give it a gentle start and finish: a fade in, a fade out or both, from half a second to ten. An audio file comes back in its own format; a video's picture can fade to black with its sound, or stay as it is. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio or video files here",
        subhead: none ? "Choose a fade below before adding a file" : `Fade ${describeFade(settings)} - change it below`,
      }}
      note="The fade out has to know where the file ends, so a file whose container does not report a length is asked for an end marker. Fading a video's picture is a full re-encode of it, at a quality a notch above the converter's; fading the sound alone copies the picture and takes seconds."
    />
  );
}
