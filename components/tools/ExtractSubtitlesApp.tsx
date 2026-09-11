"use client";

import { useMemo, useState } from "react";

import { CAPTION_FORMATS, type CaptionTarget } from "@/lib/engine/captions";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("extract-subtitles");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also extract:",
  busyLabel: "Extracting",
};

const TARGET_OPTIONS: { value: CaptionTarget; label: string; blurb: string }[] = [
  { value: "srt", label: "SRT", blurb: "SubRip: the file every player and editor reads" },
  { value: "vtt", label: "WebVTT", blurb: "For HTML video and the web" },
];

function isTarget(value: unknown): value is CaptionTarget {
  return value === "srt" || value === "vtt";
}

/**
 * Subtitle extraction: the first track on arrival, the rest from the card.
 *
 * Every track of a file is on offer as SRT and as WebVTT, and the card only
 * shows the ones the file has. The format chosen here is what the first track
 * comes out as automatically.
 */
export function ExtractSubtitlesApp() {
  const [target, setTarget] = useState<CaptionTarget>("srt");

  useStoredSettings(storageKey("settings", "extract-subtitles"), target, setTarget, isTarget);

  const queue = useMemo<QueueOptions>(
    () => ({
      key: "extract-subtitles",
      // The chosen format first, so the card's chips lead with it.
      formats: [
        ...CAPTION_FORMATS.filter((format) => format.id.endsWith(`-${target}`)),
        ...CAPTION_FORMATS.filter((format) => !format.id.endsWith(`-${target}`)),
      ],
      defaultFormatIds: [`subtitles-1-${target}`],
      expects: "subtitles",
      waveform: false,
      phase: ({ label }) => `Extracting ${label.toLowerCase()}...`,
    }),
    [target],
  );

  const toolSettings: ToolSettings = {
    title: "Subtitle format",
    summary: () => (target === "srt" ? "SRT" : "WebVTT"),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Format</legend>
        <p className={styles.intro}>
          The first track comes out in this format as soon as the file is read. Every other track,
          in either format, is one click away on the card.
        </p>
        <RadioCards
          aria-label="Format"
          value={target}
          onValueChange={setTarget}
          options={TARGET_OPTIONS}
          columns={2}
        />
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop an MKV or MP4 that carries its own subtitle tracks and get them out as SRT or WebVTT files, one per track, in seconds and without touching the video. Nothing is uploaded, however large the file."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: "The first subtitle track is extracted automatically; the rest from the card" }}
      note="Only subtitles stored as a track can be extracted: text tracks such as SubRip, ASS and MOV text. Subtitles burned into the picture are pixels, and Blu-ray or DVD subtitles are pictures of words rather than words, so those are refused with a reason rather than written out empty. The converter next door turns the result into any other format, or shifts its timing."
    />
  );
}
