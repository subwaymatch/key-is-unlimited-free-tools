"use client";

import { MUTE_FORMAT } from "@/lib/engine/video";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("remove-audio");

const QUEUE: QueueOptions = {
  formats: [MUTE_FORMAT],
  defaultFormatIds: [MUTE_FORMAT.id],
  expects: "video",
  waveform: false,
  phase: () => "Removing the audio...",
};

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  wholeLabel: "",
  clipLabel: "",
  alsoLabel: "Produce:",
};

/** `-an` with a stream copy on the video: the cheapest tool in the catalogue. */
export function RemoveAudioApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a video and get the same video with no sound. The video stream is copied bit for bit rather than re-encoded, so it takes seconds, loses nothing, and works on a file of any size without uploading it."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{ subhead: "The audio is removed automatically; multi-gigabyte files supported" }}
      note="The output keeps the source container where it can: an MP4 stays an MP4, a WebM stays a WebM, and anything unusual is repackaged as MKV."
    />
  );
}
