"use client";

import { useCallback, useMemo, useState } from "react";

import {
  DEFAULT_SUBTITLE_TRACK_SETTINGS,
  isLanguageCode,
  SUBTITLE_LANGUAGES,
  subtitleTrackFormat,
  type SubtitleTrackSettings,
  type SubtitleTrackSource,
} from "@/lib/engine/softsubs";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { decodeSubtitleBytes, parseSubtitles, SubtitleError } from "@/lib/subtitles";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { FileField } from "../ui/FileField";
import { RadioCards } from "../ui/RadioCards";
import { Select } from "../ui/Select";
import settingsStyles from "../Settings.module.css";
import styles from "./AddFadeApp.module.css";

const tool = requireTool("add-subtitles");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also:",
  busyLabel: "Adding the track",
};

const SUBTITLE_ACCEPT = ".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/plain";
const OTHER = "other";

const LANGUAGE_OPTIONS = [...SUBTITLE_LANGUAGES.map((entry) => ({ value: entry.code, label: `${entry.label} (${entry.code})` })), { value: OTHER, label: "Another language..." }];

const DEFAULT_OPTIONS = [
  { value: "default", label: "Shown by default", blurb: "Players that honour the flag turn the track on when the file opens" },
  { value: "optional", label: "Off until chosen", blurb: "The track sits in the subtitle menu until someone picks it" },
];

function isTrackSettings(value: unknown): value is SubtitleTrackSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SubtitleTrackSettings>;
  return typeof candidate.language === "string" && typeof candidate.title === "string" && typeof candidate.makeDefault === "boolean";
}

/**
 * Subtitles as a track.
 *
 * The subtitle file is read in the browser into cues, the way the burn-in
 * tool reads it, and written for ffmpeg as whatever the video's container
 * wants. Every video added gets the same file and the same tags.
 */
export function AddSubtitlesApp() {
  const [settings, setSettings] = useState<SubtitleTrackSettings>(DEFAULT_SUBTITLE_TRACK_SETTINGS);
  const [languageChoice, setLanguageChoice] = useState<string>(DEFAULT_SUBTITLE_TRACK_SETTINGS.language);
  const [otherLanguage, setOtherLanguage] = useState("");
  const [source, setSource] = useState<SubtitleTrackSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useStoredSettings(
    storageKey("settings", "add-subtitles"),
    settings,
    (stored) => {
      setSettings(stored);
      const listed = SUBTITLE_LANGUAGES.some((entry) => entry.code === stored.language);
      setLanguageChoice(listed ? stored.language : OTHER);
      if (!listed) setOtherLanguage(stored.language);
    },
    isTrackSettings,
  );

  const chooseSubtitles = useCallback((file: File) => {
    setLoadError(null);
    void file
      .arrayBuffer()
      .then((bytes) => {
        const { text } = decodeSubtitleBytes(bytes);
        const parsed = parseSubtitles(text, file.name);
        setSource({ name: file.name, cues: parsed.cues, ass: parsed.format === "ass" ? text : null });
      })
      .catch((error: unknown) => {
        setSource(null);
        setLoadError(error instanceof SubtitleError ? `${error.message}${error.hint ? ` ${error.hint}` : ""}` : "This file could not be read.");
      });
  }, []);

  const languageInvalid = languageChoice === OTHER && !isLanguageCode(otherLanguage.trim().toLowerCase());

  const queue = useMemo<QueueOptions>(() => {
    if (!source) return { key: "add-subtitles", formats: [], defaultFormatIds: [], expects: "video", waveform: false };
    const current = subtitleTrackFormat(source, settings);
    const other = subtitleTrackFormat(source, { ...settings, makeDefault: !settings.makeDefault });
    return {
      key: "add-subtitles",
      formats: [current, other],
      defaultFormatIds: [current.id],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label }) => `${label} as a track...`,
    };
  }, [source, settings]);

  const chooseLanguage = (value: string) => {
    setLanguageChoice(value);
    if (value !== OTHER) setSettings((previous) => ({ ...previous, language: value }));
    else if (isLanguageCode(otherLanguage.trim().toLowerCase())) setSettings((previous) => ({ ...previous, language: otherLanguage.trim().toLowerCase() }));
  };

  const toolSettings: ToolSettings = {
    title: "Subtitle file & track",
    defaultOpen: true,
    invalid: () => (source ? (languageInvalid ? "Type a three-letter language code, such as swe or vie, before adding a video." : null) : "Choose a subtitle file above before adding a video."),
    summary: () => (source ? `${source.name}, ${settings.language}${settings.title ? `, "${settings.title}"` : ""}, ${settings.makeDefault ? "on by default" : "off until chosen"}` : "no subtitle file yet"),
    render: () => (
      <>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Subtitle file</legend>
          <p className={settingsStyles.intro}>
            An SRT, WebVTT or ASS file to add to every video you drop. It is timed as it is; the
            subtitle converter can shift or stretch it first.
          </p>
          <FileField
            id="add-subtitles-file"
            accept={SUBTITLE_ACCEPT}
            chosen={source ? `${source.name} (${source.cues.length} cues)` : null}
            onChoose={chooseSubtitles}
            onClear={() => setSource(null)}
            error={loadError}
          />
        </fieldset>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Language & name</legend>
          <p className={settingsStyles.intro}>
            The language is what a player&apos;s subtitle menu lists the track under; the name is
            optional and shows beside it: &quot;English (SDH)&quot;, &quot;Director&apos;s commentary&quot;.
          </p>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={settingsStyles.fieldLabel}>Language</span>
              <Select aria-label="Language" value={languageChoice} options={LANGUAGE_OPTIONS} onValueChange={chooseLanguage} />
            </label>
            {languageChoice === OTHER && (
              <label className={styles.field}>
                <span className={settingsStyles.fieldLabel}>ISO 639-2 code</span>
                <input
                  type="text"
                  value={otherLanguage}
                  placeholder="swe"
                  maxLength={3}
                  aria-invalid={languageInvalid}
                  onChange={(event) => {
                    setOtherLanguage(event.target.value);
                    const code = event.target.value.trim().toLowerCase();
                    if (isLanguageCode(code)) setSettings((previous) => ({ ...previous, language: code }));
                  }}
                  className={settingsStyles.input}
                />
              </label>
            )}
            <label className={styles.field}>
              <span className={settingsStyles.fieldLabel}>Name (optional)</span>
              <input
                type="text"
                value={settings.title}
                placeholder="English (SDH)"
                onChange={(event) => setSettings((previous) => ({ ...previous, title: event.target.value }))}
                className={settingsStyles.input}
                style={{ width: "14rem" }}
              />
            </label>
          </div>
        </fieldset>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>When the file opens</legend>
          <RadioCards
            aria-label="When the file opens"
            value={settings.makeDefault ? "default" : "optional"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, makeDefault: value === "default" }))}
            options={DEFAULT_OPTIONS}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Choose a subtitle file, drop a video, and get the video back with the subtitles inside it as a track: listed in the player's subtitle menu under its language, switchable on and off, with the picture and sound copied untouched so a two-hour film takes seconds. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: source ? `${source.name} will be added to each video you drop` : "Choose a subtitle file above before adding a video" }}
      note="Each container has its own kind of track: an MP4 or MOV gets MOV text, an MKV gets the SRT or ASS as it is, a WebM gets WebVTT, and a container with no place for text, such as AVI, comes back as an MKV. Text tracks the video already has ride along; an image-based one, the kind a disc rip carries, cannot travel with a text track and is left out with a note. The track can be switched off, which is the point; to make subtitles that cannot be, burn them in instead."
    />
  );
}
