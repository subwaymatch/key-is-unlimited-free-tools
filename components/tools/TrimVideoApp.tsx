"use client";

import { TRIM_FORMATS } from "@/lib/engine/video";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("trim-video");

const QUEUE: QueueOptions = {
  formats: TRIM_FORMATS,
  defaultFormatIds: [],
  expects: "video",
  openWithoutOutputs: true,
  // The envelope is what finds a cut in a file the browser cannot preview.
  waveform: true,
  sourcePreview: true,
  phase: ({ label }) => `Cutting the clip (${label.toLowerCase()})...`,
};

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: true,
  wholeLabel: "",
  clipLabel: "Cut this range:",
  alsoLabel: "",
};

/**
 * The trimmer.
 *
 * The file is read on arrival so the length, a preview and the audio envelope
 * are there to choose a range from, and nothing is produced until one is
 * chosen. Two cuts are offered, because a keyframe-aligned copy and a
 * frame-accurate re-encode are different products with different costs.
 */
export function TrimVideoApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a video, set the start and the end, and cut. A fast cut copies the streams and lands on the nearest keyframe in seconds, losing nothing; a precise cut re-encodes to land on the exact frame. Nothing is uploaded, however large the file."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{ subhead: "The file is read first; then set the range to keep" }}
      note="A fast cut can start up to a few seconds before the start marker, because a copied stream can only begin on a keyframe. If the exact frame matters, use the precise cut."
    />
  );
}
