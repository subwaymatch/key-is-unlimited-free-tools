"use client";

import { useMemo, useState } from "react";

import { describeSync, MAX_SYNC_MS, parseSyncMs, SYNC_PRESETS_MS, syncFormat } from "@/lib/engine/soundtrack";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("sync-audio");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also try:",
  busyLabel: "Shifting",
};

const CUSTOM = "custom";

const OFFSET_OPTIONS = [
  ...SYNC_PRESETS_MS.map((ms) => ({
    value: String(ms),
    label: describeSync(ms),
    blurb: ms > 0 ? "For sound that runs ahead of the picture" : "For sound that lags behind the picture",
  })),
  { value: CUSTOM, label: "Custom", blurb: `Any shift up to ${MAX_SYNC_MS / 1000} seconds either way` },
];

interface SyncSettings {
  offsetMs: number;
}

function isSyncSettings(value: unknown): value is SyncSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SyncSettings>;
  return typeof candidate.offsetMs === "number" && parseSyncMs(candidate.offsetMs) === candidate.offsetMs;
}

/**
 * Lip sync, fixed.
 *
 * One number shapes the plan, so it is baked into the format when a file is
 * queued, and the other presets sit on the card for a second try when the
 * first guess was close but not right.
 */
export function SyncAudioApp() {
  const [settings, setSettings] = useState<SyncSettings>({ offsetMs: 250 });
  const [choice, setChoice] = useState<string>("250");
  const [customText, setCustomText] = useState("150");

  useStoredSettings(
    storageKey("settings", "sync-audio"),
    settings,
    (stored) => {
      setSettings(stored);
      const isPreset = SYNC_PRESETS_MS.includes(stored.offsetMs);
      setChoice(isPreset ? String(stored.offsetMs) : CUSTOM);
      if (!isPreset) setCustomText(String(stored.offsetMs));
    },
    isSyncSettings,
  );

  const customOffset = customText.trim() === "" ? null : parseSyncMs(Number(customText));
  const customInvalid = choice === CUSTOM && customOffset === null;

  const queue = useMemo<QueueOptions>(() => {
    const current = syncFormat(settings.offsetMs);
    const presets = SYNC_PRESETS_MS.map((ms) => syncFormat(ms)).filter((format) => format.id !== current.id);
    return {
      key: "sync-audio",
      formats: [current, ...presets],
      defaultFormatIds: [current.id],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label }) => `Moving the sound ${label}...`,
    };
  }, [settings]);

  const applyOffset = (value: number) => {
    const offsetMs = parseSyncMs(value);
    if (offsetMs !== null) setSettings({ offsetMs });
  };

  const toolSettings: ToolSettings = {
    title: "Shift",
    defaultOpen: true,
    invalid: () => (customInvalid ? `A shift between -${MAX_SYNC_MS} and ${MAX_SYNC_MS} milliseconds, and not zero, is needed before a file can be fixed.` : null),
    summary: () => (customInvalid ? "no shift chosen" : `sound ${describeSync(settings.offsetMs)}`),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Move the sound</legend>
        <p className={styles.intro}>
          If the words arrive before the lips move, the sound is early: move it later. If the lips
          move first, the sound is late: move it earlier. Most files are out by a quarter of a
          second or less, and the card offers the other amounts for a second try.
        </p>
        <RadioCards
          aria-label="Shift"
          value={choice}
          onValueChange={(value) => {
            setChoice(value);
            applyOffset(Number(value === CUSTOM ? customText : value));
          }}
          options={OFFSET_OPTIONS}
        />
        {choice === CUSTOM && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Milliseconds, negative for earlier</span>
              <input
                type="number"
                inputMode="numeric"
                min={-MAX_SYNC_MS}
                max={MAX_SYNC_MS}
                step="10"
                value={customText}
                aria-invalid={customInvalid}
                aria-describedby="sync-custom-note"
                onChange={(event) => {
                  setCustomText(event.target.value);
                  applyOffset(Number(event.target.value));
                }}
                className={styles.input}
              />
            </label>
            <p id="sync-custom-note" className={styles.panelNote}>
              {customInvalid
                ? "Type a number of milliseconds other than zero. Nothing will start until you do."
                : `1000 is a second. Moving the sound ${describeSync(settings.offsetMs)}.`}
            </p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video whose sound is out of step with its picture, say how far and which way, and get it back in sync: every stream is copied and only the timing changes, so a two-hour film takes as long as reading it. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: customInvalid ? "Choose a shift below before adding a file" : `The sound will be moved ${describeSync(settings.offsetMs)} - change it below` }}
      note="The shift is written into the timing rather than the streams, so nothing is re-encoded and nothing is lost. Sound moved later leaves the first fraction of a second silent; sound moved earlier makes the picture start that much later, which players show as a moment of the first frame. A file whose sync drifts, in step at the start and out by the end, has a different problem: its picture and sound run at different rates, and a fixed shift will not cure it."
    />
  );
}
