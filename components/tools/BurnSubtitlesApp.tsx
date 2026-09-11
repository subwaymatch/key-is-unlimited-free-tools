"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BURN_FONT_NAME,
  BURN_FONT_URL,
  burnFileFormat,
  burnTrackFormat,
  MAX_BURN_TRACKS,
  type BurnSource,
} from "@/lib/engine/burn";
import { storageKey, useStoredSettings } from "@/lib/persist";
import {
  decodeSubtitleBytes,
  parseSubtitles,
  SubtitleError,
  toAss,
  type AssStyle,
  type Cue,
} from "@/lib/subtitles";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { Button } from "../ui/Button";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("burn-subtitles");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Burn into this clip:",
  alsoLabel: "Also burn:",
  busyLabel: "Burning",
};

const SUBTITLE_ACCEPT = ".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/plain";

type TextSize = "small" | "medium" | "large";
type Position = "bottom" | "top";

interface BurnSettings {
  size: TextSize;
  position: Position;
  box: boolean;
}

const DEFAULT_SETTINGS: BurnSettings = { size: "medium", position: "bottom", box: false };

const FONT_SIZES: Record<TextSize, number> = { small: 36, medium: 48, large: 64 };

function isBurnSettings(value: unknown): value is BurnSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BurnSettings>;
  return (
    (candidate.size === "small" || candidate.size === "medium" || candidate.size === "large") &&
    (candidate.position === "bottom" || candidate.position === "top") &&
    typeof candidate.box === "boolean"
  );
}

const SIZE_OPTIONS = [
  { value: "small", label: "Small", blurb: "Out of the way; fine on a large screen" },
  { value: "medium", label: "Medium", blurb: "The usual choice" },
  { value: "large", label: "Large", blurb: "Readable on a phone held at arm's length" },
];

const POSITION_OPTIONS = [
  { value: "bottom", label: "Bottom", blurb: "Where subtitles usually sit" },
  { value: "top", label: "Top", blurb: "Out of the way of captions already in the picture" },
];

const STYLE_OPTIONS = [
  { value: "outline", label: "Outline", blurb: "White text with a thin dark edge and shadow" },
  { value: "box", label: "Box", blurb: "White text on a dark band; readable over anything" },
];

/** A subtitle file as loaded: its cues, or its own ASS text when it is already ASS. */
interface LoadedSubtitles {
  name: string;
  cues: Cue[] | null;
  ass: string | null;
  format: string;
}

/**
 * Burning subtitles into the picture.
 *
 * The subtitle file is read here rather than by ffmpeg: SRT and WebVTT are
 * turned into ASS in the chosen style, and an ASS file is passed through in
 * its own, so what the filter renders is always something the shipped font
 * can draw. The font itself is fetched once and handed to every format.
 */
export function BurnSubtitlesApp() {
  const [settings, setSettings] = useState<BurnSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState<LoadedSubtitles | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [font, setFont] = useState<Uint8Array | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);

  useStoredSettings(storageKey("settings", "burn-subtitles"), settings, setSettings, isBurnSettings);

  // The font is 740 KB and fetched once per page, from this origin.
  useEffect(() => {
    let cancelled = false;
    fetch(BURN_FONT_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return new Uint8Array(await response.arrayBuffer());
      })
      .then((bytes) => {
        if (!cancelled) setFont(bytes);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFontError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseSubtitles = useCallback((file: File | undefined) => {
    if (!file) return;
    setLoadError(null);
    void file
      .arrayBuffer()
      .then((bytes) => {
        const { text } = decodeSubtitleBytes(bytes);
        const parsed = parseSubtitles(text, file.name);
        setLoaded(
          parsed.format === "ass"
            ? { name: file.name, cues: null, ass: text, format: "ASS" }
            : { name: file.name, cues: parsed.cues, ass: null, format: parsed.format.toUpperCase() },
        );
      })
      .catch((error: unknown) => {
        setLoaded(null);
        setLoadError(
          error instanceof SubtitleError
            ? `${error.message}${error.hint ? ` ${error.hint}` : ""}`
            : "This file could not be read.",
        );
      });
  }, []);

  /** The subtitle file as ASS in the current style, ready to burn. */
  const source = useMemo<BurnSource | null>(() => {
    if (!loaded) return null;
    if (loaded.ass !== null) return { name: loaded.name, ass: loaded.ass };
    const style: AssStyle = {
      fontName: BURN_FONT_NAME,
      fontSize: FONT_SIZES[settings.size],
      alignment: settings.position === "top" ? 8 : 2,
      borderStyle: settings.box ? 3 : 1,
    };
    return { name: loaded.name, ass: toAss(loaded.cues ?? [], style) };
  }, [loaded, settings]);

  const queue = useMemo<QueueOptions>(() => {
    const bytes = font ?? new Uint8Array();
    const fileFormat = source ? burnFileFormat(source, bytes) : null;
    const trackFormats = Array.from({ length: MAX_BURN_TRACKS }, (_, track) => burnTrackFormat(track, bytes));
    return {
      key: "burn-subtitles",
      formats: fileFormat ? [fileFormat, ...trackFormats] : trackFormats,
      // A file the visitor added is what they want burned; otherwise the
      // video's own first track, when it has one, and the card offers the rest.
      defaultFormatIds: fileFormat ? [fileFormat.id] : ["burn-track-1"],
      expects: "video",
      openWithoutOutputs: true,
      waveform: false,
      sourcePreview: true,
      phase: ({ label, trim }) => `Burning subtitles into ${trim ? "the clip" : "the video"} (${label.toLowerCase()})...`,
    };
  }, [font, source]);

  const invalid = fontError
    ? `The subtitle font could not be loaded (${fontError}), so nothing can be burned.`
    : font === null
      ? "Loading the subtitle font..."
      : null;

  const toolSettings: ToolSettings = {
    title: "Subtitle file & style",
    defaultOpen: true,
    invalid: () => invalid,
    summary: () =>
      `${loaded ? loaded.name : "the video's own track"}, ${settings.size}, ${settings.position}${settings.box ? ", boxed" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Subtitle file</legend>
          <p className={styles.intro}>
            An SRT, WebVTT or ASS file to burn into every video you add. Leave it out to burn a
            subtitle track the video already carries.
          </p>
          <div className={styles.panel}>
            <label className={styles.fieldLabel} htmlFor="burn-subtitle-file">
              {loaded ? `${loaded.name} (${loaded.format}${loaded.cues ? `, ${loaded.cues.length} cues` : ""})` : "No file chosen"}
            </label>
            <div className={styles.fileRow}>
              <input
                id="burn-subtitle-file"
                type="file"
                accept={SUBTITLE_ACCEPT}
                onChange={(event) => {
                  chooseSubtitles(event.target.files?.[0]);
                  event.target.value = "";
                }}
                className={styles.fileInput}
              />
              {loaded && (
                <Button onClick={() => setLoaded(null)} variant="ghost">
                  Clear
                </Button>
              )}
            </div>
            {loadError && (
              <p role="alert" className={styles.warning}>
                {loadError}
              </p>
            )}
            {loaded?.ass !== null && loaded && (
              <p className={styles.panelNote}>
                An ASS file keeps its own styling; the size and position below do not apply to it.
                Its fonts are replaced by the one this site ships, since no others are available.
              </p>
            )}
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <RadioCards
            aria-label="Size"
            value={settings.size}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, size: value as TextSize }))}
            options={SIZE_OPTIONS}
          />
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Position</legend>
          <RadioCards
            aria-label="Position"
            value={settings.position}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, position: value as Position }))}
            options={POSITION_OPTIONS}
            columns={2}
          />
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Style</legend>
          <RadioCards
            aria-label="Style"
            value={settings.box ? "box" : "outline"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, box: value === "box" }))}
            options={STYLE_OPTIONS}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Choose a subtitle file, drop a video, and get the video back with the subtitles drawn into every frame: they show in any player, on any site, and cannot be switched off. A video that already carries a subtitle track can have that burned in instead. Nothing is uploaded, however large the file."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        subhead: source
          ? `${source.name} will be burned into each video you add`
          : "Add a subtitle file above, or drop a video with its own subtitle track",
      }}
      note={`Burning is a full re-encode of the picture, at a quality a notch above the converter's, so expect about real time for 1080p. The text is set in ${BURN_FONT_NAME}, the one font this site ships, which covers Latin, Greek and Cyrillic scripts and not Chinese, Japanese, Korean or Arabic. Timing comes from the file as it is; the subtitle converter next door can shift or stretch it first.`}
    />
  );
}
