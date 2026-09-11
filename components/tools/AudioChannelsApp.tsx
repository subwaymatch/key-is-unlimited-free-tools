"use client";

import { CHANNEL_FORMATS } from "@/lib/engine/audio";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("audio-channels");

const QUEUE: QueueOptions = {
  key: "audio-channels",
  formats: CHANNEL_FORMATS,
  defaultFormatIds: [],
  expects: "audio",
  openWithoutOutputs: true,
  waveform: true,
  phase: ({ label }) => `Writing: ${label.toLowerCase()}...`,
};

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "From this clip:",
  alsoLabel: "Produce:",
  busyLabel: "Working",
};

/**
 * The sides of a recording.
 *
 * The file is read on arrival so the card knows how many channels it has
 * and offers only what applies: a mono file is offered stereo, a stereo one
 * its left, its right, the two swapped, and the centre cut. Nothing runs
 * until one is chosen.
 */
export function AudioChannelsApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop an audio file, or a video, and take it apart by channel: mix it down to mono, pull out just the left or the right side, swap the two, make a mono file play on both sides, or cancel the centre of a stereo mix to take the vocals out of a song. Written back in the file's own format. Nothing is uploaded."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio files here",
        subhead: "The file is read first; then choose what to produce from its card",
      }}
      note="Vocal removal is the old centre-cut trick: whatever sits identically in both channels - usually the lead voice - cancels when one side is subtracted from the other, and whatever is panned survives. It works well on some mixes, takes the bass and drums with it on others, and does nothing to a mono recording. It is offered honestly, not promised."
    />
  );
}
