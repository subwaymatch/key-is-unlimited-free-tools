"use client";

import { STRIP_FORMAT } from "@/lib/engine/video";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("remove-metadata");

const QUEUE: QueueOptions = {
  formats: [STRIP_FORMAT],
  defaultFormatIds: [STRIP_FORMAT.id],
  expects: "media",
  waveform: false,
  phase: () => "Removing the metadata...",
};

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  wholeLabel: "",
  clipLabel: "",
  alsoLabel: "Produce:",
};

/**
 * Metadata removal: `-map_metadata -1` with a stream copy.
 *
 * Near-instant, and one of the few tools where "never leaves your browser" is
 * the product rather than an implementation detail: the file is being cleaned
 * precisely because it says more than its owner wants to share.
 */
export function RemoveMetadataApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a video or audio file and get a copy with the metadata gone: title, artist, comments, the date and time it was recorded, the location, chapters, and any data tracks such as a camera's GPS log. The streams themselves are copied untouched, so it takes seconds. Nothing is uploaded."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{
        inputLabel: "Choose video or audio files",
        headline: "Drop video or audio files here",
        subhead: "The metadata is removed automatically; multi-gigabyte files supported",
      }}
      note="This removes what the container says about the file. It does not alter the picture or the sound, so anything visible or audible - a burned-in timestamp, a name spoken aloud - is still there."
    />
  );
}
