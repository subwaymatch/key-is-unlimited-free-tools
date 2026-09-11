"use client";

import { OUTPUT_FORMATS } from "@/lib/engine/formats";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { FormatPicker } from "../FormatPicker";
import { ToolApp, type ToolSettings } from "../ToolApp";
import { TrimPicker } from "../TrimPicker";

const tool = requireTool("convert-audio");

const QUEUE: QueueOptions = {
  key: "convert-audio",
  formats: OUTPUT_FORMATS,
  defaultFormatIds: ["mp3"],
  formatPicker: true,
  expects: "audio",
  waveform: true,
  verb: "Converting to",
};

const FEATURES: ToolFeatures = {
  trim: true,
  silence: true,
  requireTrim: false,
  clipLabel: "Convert this clip to:",
  alsoLabel: "Convert to:",
  busyLabel: "Converting",
};

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

/**
 * The audio converter: the extractor's catalogue, pointed at audio files.
 *
 * The same formats and the same machinery; what differs is what the page
 * says and what the drop zone takes. A WAV to MP3 is the most searched-for
 * audio job there is, and it deserves a page that says so rather than one
 * about videos that happens to accept a WAV.
 */
export function ConvertAudioApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a WAV, FLAC, M4A, OGG, Opus, MP3 or any other audio file - or a video, whose soundtrack is taken - and get it back as MP3, M4A, WAV, FLAC or Opus, whole or clipped to a range. A file already in the format you ask for is copied rather than re-encoded, so nothing is lost. Nothing is uploaded, however large the file."
      queue={QUEUE}
      features={FEATURES}
      settings={SETTINGS}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio files here",
        subhead: "Conversion starts automatically; a video's soundtrack is taken as the audio",
      }}
      note="Converting from one lossy format to another - MP3 to Opus, say - loses a little more each time, which is why a source already in the target format is copied untouched. WAV and FLAC are lossless in both directions. A WAV of a very long recording can reach the output ceiling; the card says so and offers FLAC at half the size."
    />
  );
}
