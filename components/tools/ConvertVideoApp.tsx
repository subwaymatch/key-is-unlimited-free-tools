"use client";

import { CONVERT_FORMATS, DEFAULT_CONVERT_FORMAT_IDS } from "@/lib/engine/video";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { FormatPicker } from "../FormatPicker";
import { ToolApp, type ToolSettings } from "../ToolApp";

const tool = requireTool("convert-video");

const QUEUE: QueueOptions = {
  formats: CONVERT_FORMATS,
  defaultFormatIds: DEFAULT_CONVERT_FORMAT_IDS,
  expects: "video",
  waveform: false,
  sourcePreview: true,
  verb: "Converting to",
};

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  wholeLabel: "Convert to:",
  clipLabel: "Convert this clip to:",
  alsoLabel: "Also convert to:",
};

const SETTINGS: ToolSettings = {
  title: "Output formats",
  summary: ({ selectedFormats }) =>
    selectedFormats.length === 1 ? "1 format" : `${selectedFormats.length} formats`,
  render: ({ selectedFormats, setSelectedFormats, engineState }) => (
    <FormatPicker
      formats={CONVERT_FORMATS}
      selected={selectedFormats}
      onChange={setSelectedFormats}
      capabilities={engineState.capabilities}
    />
  ),
};

/**
 * "Make this video work": the converter that copies what already fits.
 *
 * The first item in the build order, because people know their file is
 * broken but not which conversion fixes it. The MP4 format works that out
 * from the probe: an H.264 track and an AAC track are copied, anything else
 * is encoded, and a MOV or MKV that only needed repackaging takes seconds.
 */
export function ConvertVideoApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a MOV, MKV, AVI, WebM or anything else ffmpeg can read, and get an MP4 that plays anywhere. Streams that already fit are copied rather than re-encoded, so a file that only needs repackaging takes seconds; only what does not fit is encoded. Nothing is uploaded, so there is no upload limit."
      queue={QUEUE}
      features={FEATURES}
      settings={SETTINGS}
      dropZone={{ subhead: "Conversion starts automatically; multi-gigabyte files supported" }}
      note="Outputs are built in memory, so one output file caps out near 1.5 GB. Each job is sized up front and refused before it starts rather than after an hour; for anything larger, convert a range at a time, or compress it to a target size instead."
    />
  );
}
