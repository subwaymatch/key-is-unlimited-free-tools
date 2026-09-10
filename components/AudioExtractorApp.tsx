"use client";

import { OUTPUT_FORMATS } from "@/lib/engine/formats";
import { AUDIO_FEATURES } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import { AUDIO_QUEUE_OPTIONS } from "@/lib/useConversionQueue";

import { FormatPicker } from "./FormatPicker";
import { ToolApp, type ToolSettings } from "./ToolApp";
import { TrimPicker } from "./TrimPicker";

const tool = requireTool("extract-audio");

const SETTINGS: ToolSettings = {
  title: "Output formats & trim",
  summary: ({ selectedFormats, trimSettings }) =>
    (selectedFormats.length > 0
      ? selectedFormats.length === 1
        ? "1 format"
        : `${selectedFormats.length} formats`
      : "no format") + (trimSettings.mode === "silence" ? " - trim silence" : ""),
  render: ({ selectedFormats, setSelectedFormats, engineState, trimSettings, setTrimSettings }) => (
    <>
      <FormatPicker
        formats={OUTPUT_FORMATS}
        selected={selectedFormats}
        onChange={setSelectedFormats}
        capabilities={engineState.capabilities}
      />
      <TrimPicker settings={trimSettings} onChange={setTrimSettings} />
    </>
  ),
};

/** The first tool: the audio extractor, as one configuration of ToolApp. */
export function AudioExtractorApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop one or more videos and the audio comes out the other side - MP3, M4A, WAV, FLAC or Opus, whole or clipped to a range. Everything runs in your browser through WebAssembly, so nothing is uploaded and there is no file size limit to speak of."
      queue={AUDIO_QUEUE_OPTIONS}
      features={AUDIO_FEATURES}
      settings={SETTINGS}
    />
  );
}
