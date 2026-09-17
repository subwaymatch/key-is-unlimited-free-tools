"use client";

import { useMemo, useState } from "react";

import { formatDb, MAX_VOLUME_DB, MIN_VOLUME_DB, parseVolumeDb, PEAK_TARGET_DB, VOLUME_PRESETS, volumeFormat, type VolumeChoice } from "@/lib/engine/level";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("change-volume");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Change this clip:",
  alsoLabel: "Also:",
  busyLabel: "Adjusting",
};

const PEAK = "peak";
const CUSTOM = "custom";

const CHOICE_OPTIONS = [
  { value: PEAK, label: "As loud as possible", blurb: `Measured first, then lifted until the loudest moment sits at ${PEAK_TARGET_DB} dB. Never clips` },
  ...VOLUME_PRESETS.map((preset) => ({ value: String(preset.db), label: formatDb(preset.db), blurb: preset.blurb })),
  { value: CUSTOM, label: "Custom", blurb: `Any change from ${MIN_VOLUME_DB} to +${MAX_VOLUME_DB} dB` },
];

function isVolumeChoice(value: unknown): value is VolumeChoice {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<{ kind: string; db: number }>;
  if (candidate.kind === "peak") return true;
  return candidate.kind === "db" && typeof candidate.db === "number" && parseVolumeDb(candidate.db) === candidate.db;
}

function choiceFor(choice: VolumeChoice): string {
  if (choice.kind === "peak") return PEAK;
  return VOLUME_PRESETS.some((preset) => preset.db === choice.db) ? String(choice.db) : CUSTOM;
}

/**
 * Louder or quieter.
 *
 * One choice shapes the plan, so it is baked into the format when a file is
 * queued; the presets sit on the card so a file that is still too quiet at
 * +6 can be taken to +12 from there, or straight to its peak.
 */
export function ChangeVolumeApp() {
  const [choice, setChoice] = useState<VolumeChoice>({ kind: "peak" });
  const [selection, setSelection] = useState<string>(PEAK);
  const [customText, setCustomText] = useState("9");

  useStoredSettings(
    storageKey("settings", "change-volume"),
    choice,
    (stored) => {
      setChoice(stored);
      setSelection(choiceFor(stored));
      if (stored.kind === "db" && choiceFor(stored) === CUSTOM) setCustomText(String(stored.db));
    },
    isVolumeChoice,
  );

  const customDb = customText.trim() === "" ? null : parseVolumeDb(Number(customText));
  const customInvalid = selection === CUSTOM && customDb === null;

  const queue = useMemo<QueueOptions>(() => {
    const current = volumeFormat(choice);
    const others = [volumeFormat({ kind: "peak" }), ...VOLUME_PRESETS.map((preset) => volumeFormat({ kind: "db", db: preset.db }))].filter(
      (format) => format.id !== current.id,
    );
    return {
      key: "change-volume",
      formats: [current, ...others],
      defaultFormatIds: [current.id],
      expects: "audio",
      waveform: true,
      phase: ({ label }) => (label === "As loud as possible" ? "Measuring, then lifting..." : `Changing the level by ${label}...`),
    };
  }, [choice]);

  const select = (value: string) => {
    setSelection(value);
    if (value === PEAK) setChoice({ kind: "peak" });
    else if (value === CUSTOM) {
      if (customDb !== null) setChoice({ kind: "db", db: customDb });
    } else setChoice({ kind: "db", db: Number(value) });
  };

  const summary = choice.kind === "peak" ? "as loud as possible" : formatDb(choice.db);

  const toolSettings: ToolSettings = {
    title: "Level",
    defaultOpen: true,
    invalid: () => (customInvalid ? `A change between ${MIN_VOLUME_DB} and +${MAX_VOLUME_DB} dB, and not zero, is needed before a file can be adjusted.` : null),
    summary: () => (customInvalid ? "no change chosen" : summary),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Change</legend>
        <p className={styles.intro}>
          Decibels: +6 doubles the amplitude and +10 sounds about twice as loud. Turning a file up
          past its own peak clips it, which is what the first choice avoids by measuring first.
          Applied to files you add next; each file&apos;s card offers the others.
        </p>
        <RadioCards aria-label="Change" value={selection} onValueChange={select} options={CHOICE_OPTIONS} />
        {selection === CUSTOM && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Decibels, negative for quieter</span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_VOLUME_DB}
                max={MAX_VOLUME_DB}
                step="0.5"
                value={customText}
                aria-invalid={customInvalid}
                onChange={(event) => {
                  setCustomText(event.target.value);
                  const db = parseVolumeDb(Number(event.target.value));
                  if (db !== null) setChoice({ kind: "db", db });
                }}
                className={styles.input}
              />
            </label>
            <p className={styles.panelNote}>
              {customInvalid ? "Type a number of decibels other than zero. Nothing will start until you do." : `Changing the level by ${summary}.`}
            </p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop an audio file, or a video, and turn its sound up or down: by a number of decibels, or as loud as it can go without clipping, measured first. An audio file comes back in its own format; a video keeps its picture copied and gets its soundtrack re-encoded. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio or video files here",
        subhead: customInvalid ? "Choose a change below before adding a file" : `The level will be changed: ${summary} - change it below`,
      }}
      note={`"As loud as possible" is peak normalisation: the loudest sample is found in a pass of its own and the whole file lifted so it lands at ${PEAK_TARGET_DB} dB, the most gain the file can take without clipping anywhere. It makes a quiet recording usable; it does not make a loud one louder, because a recording that already touches full scale has no room. For a target loudness in LUFS, the kind streaming platforms measure, use the loudness normaliser instead.`}
    />
  );
}
