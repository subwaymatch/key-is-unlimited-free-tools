"use client";

import { CHAPTER_FORMATS, chapterFormatIds } from "@/lib/engine/split";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("split-chapters");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also cut out:",
  busyLabel: "Splitting",
};

/**
 * The outputs come from the file: one per chapter, known only once it has
 * been read, so the queue opens every file and takes its formats from the
 * probe.
 */
const QUEUE: QueueOptions = {
  key: "split-chapters",
  formats: CHAPTER_FORMATS,
  defaultFormatIds: [],
  formatsForFile: chapterFormatIds,
  expects: "chapters",
  openWithoutOutputs: true,
  waveform: false,
  phase: ({ label }) => `Cutting ${label}...`,
};

/** Splitting at chapters: nothing to set, every chapter on arrival. */
export function SplitChaptersApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a podcast, an audiobook or a video that carries chapter markers and get one file per chapter, each named after its chapter, every stream copied as it is. A three-hour audiobook comes apart in the time it takes to read it. Nothing is uploaded."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio or video files with chapters here",
        subhead: "Every chapter comes out as its own file",
      }}
      note="The chapters are read from the file: the ones a podcast app shows, an audiobook's parts, a video's sections. A file without any is refused with a pointer to the chapter tool, which writes a list you type. Pieces are cut without re-encoding, so a video piece starts on the keyframe before its chapter and can begin a few seconds early; sound is cut to the frame."
    />
  );
}
