"use client";

import { useMemo, useState } from "react";

import {
  ASPECT_CROPS,
  DEFAULT_RESIZE_SETTINGS,
  RESIZE_HEIGHTS,
  resizeFormat,
  resizeLabel,
  type AspectCrop,
  type ResizeSettings,
  type ResizeTarget,
} from "@/lib/engine/picture";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("resize-video");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  clipLabel: "Resize this clip to:",
  alsoLabel: "Also at:",
  busyLabel: "Resizing",
};

const TARGETS: readonly ResizeTarget[] = [...RESIZE_HEIGHTS, "half", "quarter"];

function isResizeSettings(value: unknown): value is ResizeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ResizeSettings>;
  return (
    candidate.target !== undefined &&
    TARGETS.includes(candidate.target) &&
    ASPECT_CROPS.some((aspect) => aspect.id === candidate.aspect)
  );
}

const SIZE_OPTIONS = TARGETS.map((target) => ({
  value: String(target),
  label: resizeLabel(target),
  blurb:
    target === "half"
      ? "Half the width and height"
      : target === "quarter"
        ? "A quarter of the width and height"
        : target >= 2160
          ? "4K"
          : target >= 1080
            ? "Full HD"
            : target >= 720
              ? "HD: the usual choice for sharing"
              : "Small, for messaging",
}));

const ASPECT_OPTIONS = ASPECT_CROPS.map((aspect) => ({
  value: aspect.id,
  label: aspect.label,
  blurb: aspect.blurb,
}));

function parseTarget(value: string): ResizeTarget {
  return value === "half" || value === "quarter" ? value : Number(value);
}

/**
 * The resizer: a size and, optionally, a shape.
 *
 * The chosen size is baked into the format when a file is queued; the
 * other sizes at the same shape are on the card, and only the ones smaller
 * than the file appear, since nothing is ever enlarged.
 */
export function ResizeVideoApp() {
  const [settings, setSettings] = useState<ResizeSettings>(DEFAULT_RESIZE_SETTINGS);

  useStoredSettings(storageKey("settings", "resize-video"), settings, setSettings, isResizeSettings);

  const queue = useMemo<QueueOptions>(() => {
    const current = resizeFormat(settings);
    const others = TARGETS.map((target) => resizeFormat({ ...settings, target })).filter(
      (format) => format.id !== current.id,
    );
    return {
      key: "resize-video",
      formats: [current, ...others],
      defaultFormatIds: [current.id],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label, trim }) => `Resizing ${trim ? "the clip" : "the video"} to ${label}...`,
    };
  }, [settings]);

  const summary =
    settings.aspect === "keep"
      ? resizeLabel(settings.target)
      : `${resizeLabel(settings.target)}, cropped to ${settings.aspect}`;

  const toolSettings: ToolSettings = {
    title: "Size & shape",
    defaultOpen: true,
    summary: () => summary,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <p className={styles.intro}>
            A height is the most the short side of the picture will be: a portrait clip at 720p is
            720 wide. Nothing is ever enlarged. Applied to files you add next; each file offers the
            smaller sizes from its own card afterwards.
          </p>
          <RadioCards
            aria-label="Size"
            value={String(settings.target)}
            onValueChange={(value) =>
              setSettings((previous) => ({ ...previous, target: parseTarget(value) }))
            }
            options={SIZE_OPTIONS}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Shape</legend>
          <p className={styles.intro}>
            Cropped from the centre before it is scaled, so a landscape clip becomes a vertical one
            by keeping its middle.
          </p>
          <RadioCards
            aria-label="Shape"
            value={settings.aspect}
            onValueChange={(value) =>
              setSettings((previous) => ({ ...previous, aspect: value as AspectCrop }))
            }
            options={ASPECT_OPTIONS}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video and get it back smaller - 1080p, 720p, half size - or cropped to a shape: vertical for Stories and Shorts, square for a feed, 16:9 for everything else. The picture is scaled cleanly and never enlarged; the audio is copied untouched. Nothing is uploaded, however large the file."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: `Resizing to ${summary} starts automatically - change it below` }}
      note="Resizing is a full re-encode of the picture, at a quality a notch above the converter's; expect about real time for 1080p. A crop keeps the centre of the frame, which suits most footage and not a subject standing at the edge. The container is kept where it can be: an MP4 stays an MP4 and a MOV a MOV."
    />
  );
}
