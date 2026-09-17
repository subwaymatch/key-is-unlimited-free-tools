"use client";

import { useCallback, useMemo, useState } from "react";

import { fileKey, readFileBytes } from "@/lib/chosenFile";
import {
  addAudioFormat,
  DEFAULT_ADD_AUDIO_SETTINGS,
  MAX_ADDED_AUDIO_BYTES,
  MIX_LEVELS,
  type AddAudioSettings,
  type AddedAudio,
} from "@/lib/engine/soundtrack";
import { AUDIO_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { FileField } from "../ui/FileField";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("add-audio");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Add the audio to this clip:",
  alsoLabel: "Also:",
  busyLabel: "Writing",
};

function isAddAudioSettings(value: unknown): value is AddAudioSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AddAudioSettings>;
  return (
    (candidate.mode === "replace" || candidate.mode === "mix") &&
    (candidate.length === "fit" || candidate.length === "loop") &&
    MIX_LEVELS.some((level) => level.db === candidate.mixLevelDb)
  );
}

const MODE_OPTIONS = [
  { value: "replace", label: "Replace the sound", blurb: "The video's own audio dropped and the new track put in its place" },
  { value: "mix", label: "Mix under it", blurb: "The video's own audio kept, with the new track turned down under it" },
];

const LENGTH_OPTIONS = [
  { value: "fit", label: "Fit to the picture", blurb: "A short track ends in silence; a long one is cut where the picture ends" },
  { value: "loop", label: "Loop to the picture", blurb: "A short track repeats until the picture ends" },
];

/**
 * Music or a voiceover under a video.
 *
 * The audio file is chosen once in the panel and read into memory; every
 * video added gets it, in place of its own sound or mixed under it. The
 * picture is copied, so a long film takes as long as reading it plus
 * encoding one audio track.
 */
export function AddAudioApp() {
  const [settings, setSettings] = useState<AddAudioSettings>(DEFAULT_ADD_AUDIO_SETTINGS);
  const [audio, setAudio] = useState<AddedAudio | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  useStoredSettings(storageKey("settings", "add-audio"), settings, setSettings, isAddAudioSettings);

  const chooseAudio = useCallback((file: File) => {
    setAudioError(null);
    if (file.size > MAX_ADDED_AUDIO_BYTES) {
      setAudio(null);
      setAudioError(`${file.name} is ${Math.round(file.size / 1_000_000)} MB; the audio file is held in memory and capped at ${Math.round(MAX_ADDED_AUDIO_BYTES / 1_000_000)} MB. Compress it or convert it to M4A or MP3 first.`);
      return;
    }
    void readFileBytes(file)
      .then((bytes) => setAudio({ name: file.name, bytes, key: fileKey(file) }))
      .catch(() => setAudioError("This file could not be read."));
  }, []);

  const queue = useMemo<QueueOptions>(() => {
    const current = audio ? addAudioFormat(audio, settings) : null;
    const other = audio ? addAudioFormat(audio, { ...settings, mode: settings.mode === "mix" ? "replace" : "mix" }) : null;
    return {
      key: "add-audio",
      formats: current && other ? [current, other] : [],
      defaultFormatIds: current ? [current.id] : [],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label }) => `${label}...`,
    };
  }, [audio, settings]);

  const toolSettings: ToolSettings = {
    title: "Audio file & how it goes in",
    defaultOpen: true,
    invalid: () => (audio ? null : "Choose an audio file above before adding a video."),
    summary: () =>
      audio
        ? `${audio.name}, ${settings.mode === "mix" ? `mixed at ${settings.mixLevelDb} dB` : "replacing the sound"}, ${settings.length === "loop" ? "looped" : "fitted"}`
        : "no audio file yet",
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Audio file</legend>
          <p className={styles.intro}>
            The music, voiceover or soundtrack to put under every video you add. MP3, M4A, WAV,
            FLAC, Opus or anything else; it is encoded to fit the video&apos;s container.
          </p>
          <FileField
            id="add-audio-file"
            accept={AUDIO_ACCEPT}
            chosen={audio ? `${audio.name} (${Math.round(audio.bytes.length / 100_000) / 10} MB)` : null}
            onChoose={chooseAudio}
            onClear={() => setAudio(null)}
            error={audioError}
          />
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>In place of the sound, or under it</legend>
          <RadioCards
            aria-label="Mode"
            value={settings.mode}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, mode: value as AddAudioSettings["mode"] }))}
            options={MODE_OPTIONS}
            columns={2}
          />
          {settings.mode === "mix" && (
            <div className={styles.panel}>
              <span className={styles.fieldLabel}>Level of the new track</span>
              <RadioCards
                aria-label="Mix level"
                value={String(settings.mixLevelDb)}
                onValueChange={(value) => setSettings((previous) => ({ ...previous, mixLevelDb: Number(value) }))}
                options={MIX_LEVELS.map((level) => ({ value: String(level.db), label: level.label, blurb: level.blurb }))}
              />
            </div>
          )}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Length</legend>
          <RadioCards
            aria-label="Length"
            value={settings.length}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, length: value as AddAudioSettings["length"] }))}
            options={LENGTH_OPTIONS}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Choose an audio file, drop a video, and get the video back with that audio under it: in place of its own sound, or mixed under it at a level you choose, padded, cut or looped to the length of the picture. The picture is copied untouched, so it takes seconds however long the film. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        subhead: audio ? `${audio.name} will be added to each video you drop` : "Choose an audio file above before adding a video",
      }}
      note="The picture decides the length: a track shorter than the video ends in silence or, if you ask, starts again; a longer one is cut where the video ends. Mixing leaves the original at its level and turns the new track down under it, which is what background music behind speech wants. The audio file is held in memory while the video is written, so it is capped at 200 MB; the video itself is read in place and has no such limit."
    />
  );
}
