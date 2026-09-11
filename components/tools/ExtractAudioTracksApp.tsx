"use client";

import { AUDIO_TRACK_FORMATS, audioTrackFormatIds } from "@/lib/engine/tracks";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("extract-audio-tracks");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also extract:",
  busyLabel: "Extracting",
  everyAudioTrack: true,
};

/** One output per track, known once the file has been read. */
const QUEUE: QueueOptions = {
  key: "extract-audio-tracks",
  formats: AUDIO_TRACK_FORMATS,
  defaultFormatIds: [],
  formatsForFile: audioTrackFormatIds,
  expects: "audio",
  openWithoutOutputs: true,
  waveform: false,
  phase: ({ label }) => `Extracting ${label}...`,
};

/** Every audio track out: nothing to set, every track on arrival. */
export function ExtractAudioTracksApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a film or a recording with several audio tracks - languages, a commentary, a music-only mix - and get each one out as its own file, copied without re-encoding and named by its language. Nothing is uploaded, however large the file."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose video or audio files",
        headline: "Drop video or audio files here",
        subhead: "Every audio track comes out as its own file",
      }}
      note="Each track is copied into the container its codec belongs in: AAC and ALAC into M4A, MP3 as MP3, FLAC as FLAC, Opus and Vorbis into Ogg, AC-3 and E-AC-3 as they are, PCM into WAV, and anything else into a Matroska audio file. The language and title a track carries come along with it. To convert a track rather than copy it, extract it here and drop it on the audio converter."
    />
  );
}
