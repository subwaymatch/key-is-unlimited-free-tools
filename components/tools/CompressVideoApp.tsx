"use client";

import { useMemo, useState } from "react";

import {
  COMPRESS_PRESETS,
  compressFormat,
  DEFAULT_COMPRESS_SETTINGS,
  formatMegabytes,
  MIN_TARGET_MEGABYTES,
  targetBytesFromMegabytes,
  type CompressResolution,
  type CompressSettings,
} from "@/lib/engine/video";
import { storageKey, useStoredSettings } from "@/lib/persist";
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
  clipLabel: "Compress this clip to:",
  alsoLabel: "Compress to:",
  busyLabel: "Compressing",
};

/** Guards a stored settings object, which may be from an older build. */
function isCompressSettings(value: unknown): value is CompressSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompressSettings>;
  const resolution = candidate.resolution;
  return (
    typeof candidate.targetBytes === "number" &&
    candidate.targetBytes > 0 &&
    typeof candidate.twoPass === "boolean" &&
    (resolution === "auto" || resolution === "source" || typeof resolution === "number")
  );
}

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
    formatMegabytes(DEFAULT_COMPRESS_SETTINGS.targetBytes),
  );
  const [customText, setCustomText] = useState("15");

  useStoredSettings(
    storageKey("settings", "compress-video"),
    settings,
    (stored) => {
      setSettings(stored);
      const storedSize = formatMegabytes(stored.targetBytes);
      const isPreset = COMPRESS_PRESETS.some((preset) => String(preset.megabytes) === storedSize);
      setSizeChoice(isPreset ? storedSize : CUSTOM);
      if (!isPreset) setCustomText(storedSize);
    },
    isCompressSettings,
  );

  const megabytes = formatMegabytes(settings.targetBytes);

  /*
   * Whatever the custom field says right now, or null when it does not say a
   * usable size. Everything that reads the target - the summary, the chips,
   * the job itself - goes through this, so the number on the button cannot
   * drift from the number the encoder is given, which is exactly what an
   * `<input type=number min=1>` with no step did: 0 was ignored and the last
   * good value ran silently, and 2.5 was rounded *up* to 3 MB, handing someone
   * with a 2.5 MB limit a file their form would reject.
   */
  const customBytes =
    customText.trim() === "" ? null : targetBytesFromMegabytes(Number(customText));
  const customInvalid = sizeChoice === CUSTOM && customBytes === null;

  const queue = useMemo<QueueOptions>(() => {
    const current = compressFormat(settings);
    /*
     * Every preset smaller than this file, as well as the chosen size. A file
     * already under the target is not a failure and not a dead end: its card
     * offers the sizes that would actually shrink it, one click each. The
     * formats filter themselves by `offer`, so only the useful ones appear.
     */
    const presets = COMPRESS_PRESETS.map((preset) =>
      compressFormat({ ...settings, targetBytes: preset.megabytes * 1_000_000 }),
    ).filter((format) => format.id !== current.id);

    return {
      key: "compress-video",
      formats: [current, ...presets],
      defaultFormatIds: [current.id],
      expects: "video",
      waveform: false,
      sourcePreview: true,
      phase: ({ label, trim }) => `Compressing ${trim ? "the clip" : "the video"} to ${label}...`,
    };
  }, [settings]);

  const applyMegabytes = (size: number) => {
    const targetBytes = targetBytesFromMegabytes(size);
    if (targetBytes === null) return;
    setSettings((previous) => ({ ...previous, targetBytes }));
  };

  const chooseSize = (value: string) => {
    setSizeChoice(value);
    applyMegabytes(Number(value === CUSTOM ? customText : value));
  };

  const chooseCustom = (text: string) => {
    setCustomText(text);
    applyMegabytes(Number(text));
  };

  const toolSettings: ToolSettings = {
    title: "Target size & quality",
    defaultOpen: true,
    invalid: () =>
      customInvalid
        ? `A target size of at least ${MIN_TARGET_MEGABYTES} MB is needed before a file can be compressed.`
        : null,
    summary: () =>
      customInvalid
        ? "no size chosen"
        : `${megabytes} MB, ${resolutionSummary(settings.resolution)}, ${
            settings.twoPass ? "two passes" : "one pass"
          }`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Target size</legend>
          <p className={styles.intro}>
            The file will come out just under this. MB here means 1,000,000 bytes, the same unit
            your file manager shows. Applied to files you add next; each file can be compressed
            again to another size from its own card afterwards.
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
                  inputMode="decimal"
                  min={MIN_TARGET_MEGABYTES}
                  step="0.1"
                  value={customText}
                  aria-invalid={customInvalid}
                  aria-describedby="compress-custom-note"
                  onChange={(event) => chooseCustom(event.target.value)}
                  className={styles.input}
                />
              </label>
              <p id="compress-custom-note" className={styles.panelNote}>
                {customInvalid
                  ? `Type a size of at least ${MIN_TARGET_MEGABYTES} MB. Nothing will start until you do.`
                  : `Decimals are fine, and the number is never rounded up: 2.5 means a file under 2.5 MB, not under 3. Using ${megabytes} MB.`}
              </p>
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
      dropZone={{
        subhead: customInvalid
          ? "Choose a target size below before adding a file"
          : `Compression starts automatically at ${megabytes} MB - change it below`,
      }}
      note="Encoding runs on one core in your browser, so expect real time or slower for 1080p, and twice that with two passes. A smaller resolution is much faster as well as much smaller, which is why Auto is the default. A file that is already under the target is left alone and its card offers the smaller sizes."
    />
  );
}
