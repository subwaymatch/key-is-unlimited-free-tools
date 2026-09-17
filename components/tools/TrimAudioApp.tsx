"use client";

import { TRIM_AUDIO_FORMATS } from "@/lib/engine/cut";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("trim-audio");

const QUEUE: QueueOptions = {
  key: "trim-audio",
  formats: TRIM_AUDIO_FORMATS,
  defaultFormatIds: [],
  expects: "audio",
  openWithoutOutputs: true,
  waveform: true,
  phase: ({ label }) => `Cutting the clip (${label.toLowerCase()})...`,
};

const FEATURES: ToolFeatures = {
  trim: true,
  silence: true,
  requireTrim: true,
  clipLabel: "Cut this range as:",
  alsoLabel: "",
  busyLabel: "Cutting",
};

/**
 * The audio cutter.
 *
 * The trimmer's shape for sound: the file is read on arrival so the waveform
 * is there to choose a range from, nothing is produced until one is chosen,
 * and the file's own format is offered first, cut without re-encoding.
 */
export function TrimAudioApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop an MP3, a WAV, an M4A or any audio file - or a video, whose soundtrack is taken - set the start and the end on the waveform, and cut. The file's own format is cut without re-encoding, so nothing is lost; or take the range as MP3, M4A, WAV, FLAC or Opus. Nothing is uploaded, however long the recording."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio files here",
        subhead: "The file is read first; then set the range to keep on its waveform",
      }}
      note="A cut in the file's own format lands on a frame of the codec - about a fortieth of a second for MP3 and AAC, a sample for WAV and FLAC - which is closer than an ear can tell. Silence detection finds where the recording really starts and stops, for the range that cuts the dead air at either end."
    />
  );
}
