"use client";

import { ROTATE_FORMATS } from "@/lib/engine/picture";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp } from "../ToolApp";

const tool = requireTool("rotate-video");

const QUEUE: QueueOptions = {
  key: "rotate-video",
  formats: ROTATE_FORMATS,
  defaultFormatIds: [],
  expects: "video",
  openWithoutOutputs: true,
  waveform: false,
  sourcePreview: true,
  phase: ({ label }) => `Turning the video: ${label.toLowerCase()}...`,
};

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Turn it:",
  busyLabel: "Rotating",
};

/**
 * The rotator.
 *
 * The file is read on arrival and shown, and nothing runs until a turn is
 * chosen: which way a sideways video needs to go is only obvious once it can
 * be seen, and a quarter turn the wrong way is a full re-encode wasted.
 */
export function RotateVideoApp() {
  return (
    <ToolApp
      tool={tool}
      lead="Drop a video that came out sideways or upside down, see which way it needs to go, and turn it: a quarter turn either way, a half turn, or a mirror. The turn is written into the frames themselves rather than into a tag some players ignore, so it stays turned everywhere. Nothing is uploaded."
      queue={QUEUE}
      features={FEATURES}
      dropZone={{ subhead: "The file is read first; then choose the turn from its card" }}
      note="A phone clip that plays the right way up in one app and sideways in another is carrying a rotation tag that the second app ignores. The turn here is applied to the picture as your browser shows it above, and the output carries no tag, which is what fixes that. It is a full re-encode of the picture; the audio is copied untouched."
    />
  );
}
