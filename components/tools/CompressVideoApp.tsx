"use client";

import { useMemo, useState } from "react";

import {
  COMPRESS_PRESETS,
  compressFormat,
  DEFAULT_COMPRESS_SETTINGS,
  type CompressResolution,
  type CompressSettings,
} from "@/lib/engine/video";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import { Select } from "../ui/Select";
import styles from "../Settings.module.css";

const tool = requireTool("compress-video");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: false,
  requireTrim: false,
  wholeLabel: "Compress to:",
  clipLabel: "Compress this clip to:",
  alsoLabel: "Also compress to:",
};

const CUSTOM = "custom";

const SIZE_OPTIONS = [
  ...COMPRESS_PRESETS.map((preset) => ({
    value: String(preset.megabytes),
    label: `${preset.megabytes} MB`,
    blurb: preset.blurb,
  })),
  { value: CUSTOM, label: "Custom", blurb: "Any size in megabytes" },
];

const RESOLUTION_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto: as large as the bitrate can fill" },
  { value: "source", label: "Keep the source size" },
  { value: "1080", label: "Up to 1080p" },
  { value: "720", label: "Up to 720p" },
  { value: "480", label: "Up to 480p" },
  { value: "360", label: "Up to 360p" },
];

const PASS_OPTIONS = [
  {
    value: "two",
    label: "Two passes",
    blurb: "Lands on the size. Reads the video twice, so it takes twice as long",
  },
  {
    value: "one",
    label: "One pass",
    blurb: "Half the time, and close to the size with a little more headroom",
  },
];

function parseResolution(value: string): CompressResolution {
  if (value === "auto" || value === "source") return value;
  return Number(value) as CompressResolution;
}

function resolutionSummary(resolution: CompressResolution): string {
  if (resolution === "auto") return "auto resolution";
  if (resolution === "source") return "source resolution";
  return `up to ${resolution}p`;
}

/**
 * The compressor with an explicit target size.
 *
 * The highest search volume in the catalogue, and the framing that solves the
 * output ceiling by construction: the target is an input, so the bitrate is
 * computed from the probed length and the size is known before encoding.
 * The settings are baked into the format, so a file queued at 25 MB stays a
 * 25 MB job however the panel changes afterwards.
 */
export function CompressVideoApp() {
  const [settings, setSettings] = useState<CompressSettings>(DEFAULT_COMPRESS_SETTINGS);
  const [sizeChoice, setSizeChoice] = useState<string>(
    String(DEFAULT_COMPRESS_SETTINGS.targetBytes / 1_000_000),
  );
  const [customText, setCustomText] = useState("15");

  const megabytes = Math.round(settings.targetBytes / 1_000_000);

  const queue = useMemo<QueueOptions>(() => {
    const format = compressFormat(settings);
    return {
      formats: [format],
      defaultFormatIds: [format.id],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label, trim }) => `Compressing ${trim ? "the clip" : "the video"} to ${label}...`,
    };
  }, [settings]);

  const chooseSize = (value: string) => {
    setSizeChoice(value);
    const mb = value === CUSTOM ? Number(customText) : Number(value);
    if (Number.isFinite(mb) && mb >= 1) {
      setSettings((previous) => ({ ...previous, targetBytes: Math.round(mb) * 1_000_000 }));
    }
  };

  const chooseCustom = (text: string) => {
    setCustomText(text);
    const mb = Number(text);
    if (Number.isFinite(mb) && mb >= 1) {
      setSettings((previous) => ({ ...previous, targetBytes: Math.round(mb) * 1_000_000 }));
    }
  };

  const toolSettings: ToolSettings = {
    title: "Target size & quality",
    summary: () =>
      `${megabytes} MB, ${resolutionSummary(settings.resolution)}, ${
        settings.twoPass ? "two passes" : "one pass"
      }`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Target size</legend>
          <p className={styles.intro}>
            The file will come out just under this. Applied to files you add next; each file can be
            compressed again to another size afterwards.
          </p>
          <RadioCards
            aria-label="Target size"
            value={sizeChoice}
            onValueChange={chooseSize}
            options={SIZE_OPTIONS}
          />
          {sizeChoice === CUSTOM && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Size in megabytes</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={customText}
                  onChange={(event) => chooseCustom(event.target.value)}
                  className={styles.input}
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Resolution</legend>
          <p className={styles.intro}>
            A small target at full size is a blocky picture. Auto picks the largest frame the
            bitrate can keep clean, and never enlarges.
          </p>
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Largest frame</span>
              <Select
                aria-label="Largest frame"
                value={String(settings.resolution)}
                options={RESOLUTION_OPTIONS}
                onValueChange={(value) =>
                  setSettings((previous) => ({ ...previous, resolution: parseResolution(value) }))
                }
              />
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Passes</legend>
          <RadioCards
            aria-label="Passes"
            value={settings.twoPass ? "two" : "one"}
            onValueChange={(value) =>
              setSettings((previous) => ({ ...previous, twoPass: value === "two" }))
            }
            options={PASS_OPTIONS}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video and say how big it may be - 8 MB for a chat app, 25 MB for an email, or any number - and it comes out just under that. The bitrate is worked out from the length of the video, so the size is known before the encode starts rather than hoped for at the end. Nothing is uploaded, so there is no cap on the file you start from."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{ subhead: "Compression starts automatically at the size chosen below" }}
      note="Encoding runs on one core in your browser, so expect real time or slower for 1080p, and twice that with two passes. A smaller resolution is much faster as well as much smaller, which is why Auto is the default."
    />
  );
}
