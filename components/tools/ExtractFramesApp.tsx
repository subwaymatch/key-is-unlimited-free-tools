"use client";

import { useMemo, useState } from "react";

import { DEFAULT_FRAMES_SETTINGS, FRAME_INTERVALS, frameFormatIds, frameFormats, MAX_FRAMES, parseInterval, type FramesSettings } from "@/lib/engine/frames";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("extract-frames");

const FEATURES: ToolFeatures = { trim: false, silence: false, requireTrim: false, clipLabel: "", alsoLabel: "Also:", busyLabel: "Extracting" };

const CUSTOM = "custom";

function isFramesSettings(value: unknown): value is FramesSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FramesSettings>;
  return typeof candidate.everySeconds === "number" && candidate.everySeconds >= 0.1 && (candidate.image === "jpg" || candidate.image === "png");
}

/** Frames every so many seconds, one file each. */
export function ExtractFramesApp() {
  const [settings, setSettings] = useState<FramesSettings>(DEFAULT_FRAMES_SETTINGS);
  const [choice, setChoice] = useState<string>(String(DEFAULT_FRAMES_SETTINGS.everySeconds));
  const [customText, setCustomText] = useState("15");

  useStoredSettings(
    storageKey("settings", "extract-frames"),
    settings,
    (stored) => {
      setSettings(stored);
      const preset = FRAME_INTERVALS.some((entry) => entry.seconds === stored.everySeconds);
      setChoice(preset ? String(stored.everySeconds) : CUSTOM);
      if (!preset) setCustomText(String(stored.everySeconds));
    },
    isFramesSettings,
  );

  const customSeconds = customText.trim() === "" ? null : parseInterval(Number(customText));
  const customInvalid = choice === CUSTOM && customSeconds === null;

  const queue = useMemo<QueueOptions>(
    () => ({
      key: "extract-frames",
      formats: frameFormats(settings),
      defaultFormatIds: [],
      formatsForFile: frameFormatIds(settings),
      expects: "video",
      openWithoutOutputs: true,
      waveform: false,
      phase: ({ label }) => `Lifting ${label.toLowerCase()}...`,
    }),
    [settings],
  );

  const toolSettings: ToolSettings = {
    title: "How often & what as",
    defaultOpen: true,
    invalid: () => (customInvalid ? "An interval of at least a tenth of a second is needed." : null),
    summary: () => (customInvalid ? "no interval" : `every ${settings.everySeconds} s, ${settings.image.toUpperCase()}`),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Interval</legend>
          <p className={styles.intro}>A frame at the start, then one every interval, up to {MAX_FRAMES} per file; a longer file yields its first {MAX_FRAMES}.</p>
          <RadioCards
            aria-label="Interval"
            value={choice}
            onValueChange={(value) => {
              setChoice(value);
              if (value !== CUSTOM) setSettings((previous) => ({ ...previous, everySeconds: Number(value) }));
              else if (customSeconds !== null) setSettings((previous) => ({ ...previous, everySeconds: customSeconds }));
            }}
            options={[...FRAME_INTERVALS.map((entry) => ({ value: String(entry.seconds), label: entry.label })), { value: CUSTOM, label: "Custom", blurb: "Any number of seconds" }]}
          />
          {choice === CUSTOM && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Seconds between frames</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.1}
                  step="0.5"
                  value={customText}
                  aria-invalid={customInvalid}
                  onChange={(event) => {
                    setCustomText(event.target.value);
                    const seconds = parseInterval(Number(event.target.value));
                    if (seconds !== null) setSettings((previous) => ({ ...previous, everySeconds: seconds }));
                  }}
                  className={styles.input}
                />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Picture</legend>
          <RadioCards
            aria-label="Picture"
            value={settings.image}
            onValueChange={(image) => setSettings((previous) => ({ ...previous, image: image as FramesSettings["image"] }))}
            options={[
              { value: "jpg", label: "JPEG", blurb: "Small, and what a frame usually wants to be" },
              { value: "png", label: "PNG", blurb: "Lossless, for a frame that will be edited" },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video and get a picture from it every second, every ten seconds or every minute, each named by its moment: for a storyboard, a contact sheet of your own, or the one frame that was somewhere in there. Nothing is uploaded, however large the file."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: customInvalid ? "Choose an interval below before adding a video" : `Frames every ${settings.everySeconds} seconds from each video you drop - change it below` }}
      note="Each frame is a seek straight to its moment and one picture out, so a frame from the end of a three-hour file costs no more than one from the start. The moment is the nearest decodable frame at or after the time asked. For one frame at a moment you pick off a preview, the thumbnail tool has a start marker; for many frames in one picture, it has the contact sheet."
    />
  );
}
