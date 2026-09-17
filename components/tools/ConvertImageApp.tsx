"use client";

import { useMemo, useState } from "react";

import { canEncode, describeSize, IMAGE_ACCEPT, MIME_LABELS, QUALITY_PRESETS, rejectNonImage, type ImageMime } from "@/lib/images/canvas";
import { encodePicture, pictureName, readPicture } from "@/lib/images/run";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("convert-image");

interface ConvertSettings {
  mime: ImageMime;
  qualityId: string;
}

const DEFAULT_SETTINGS: ConvertSettings = { mime: "image/jpeg", qualityId: "good" };

function isConvertSettings(value: unknown): value is ConvertSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ConvertSettings>;
  return (candidate.mime === "image/jpeg" || candidate.mime === "image/png" || candidate.mime === "image/webp") && QUALITY_PRESETS.some((preset) => preset.id === candidate.qualityId);
}

const FORMAT_OPTIONS: { value: ImageMime; label: string; blurb: string }[] = [
  { value: "image/jpeg", label: "JPEG", blurb: "Photos. Opens everywhere; no transparency, which is painted white" },
  { value: "image/png", label: "PNG", blurb: "Screenshots, graphics and anything with transparency. Lossless, and large for photos" },
  { value: "image/webp", label: "WebP", blurb: "Smaller than JPEG at the same quality, with transparency; every current browser opens it" },
];

/** The converter: any picture the browser opens, out as JPEG, PNG or WebP. */
export function ConvertImageApp() {
  const [settings, setSettings] = useState<ConvertSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "convert-image"), settings, setSettings, isConvertSettings);

  const quality = QUALITY_PRESETS.find((preset) => preset.id === settings.qualityId) ?? QUALITY_PRESETS[1];
  const webpUnsupported = typeof document !== "undefined" && !canEncode("image/webp");

  const queue = useMemo<PlainQueueOptions<ConvertSettings>>(
    () => ({
      key: "convert-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const size = { width: image.width, height: image.height };
          report(`Writing the ${MIME_LABELS[current.mime]}...`, null);
          const lossy = current.mime !== "image/png";
          const preset = QUALITY_PRESETS.find((entry) => entry.id === current.qualityId) ?? QUALITY_PRESETS[1];
          const { blob } = await encodePicture(image, file, size, current.mime, lossy ? preset.quality : null);
          return {
            facts: [describeSize(size)],
            outputs: [
              {
                label: MIME_LABELS[current.mime],
                fileName: pictureName(file, current.mime),
                blob,
                kind: "image",
                note: `${describeSize(size)}${lossy ? `, quality ${Math.round(preset.quality * 100)}` : ""}`,
              },
            ],
            notes: ["Written without the source's metadata: no camera, date or location."],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Format & quality",
    defaultOpen: true,
    invalid: () => (settings.mime === "image/webp" && webpUnsupported ? "This browser cannot write WebP. Choose JPEG or PNG." : null),
    summary: () => `${MIME_LABELS[settings.mime]}${settings.mime === "image/png" ? "" : `, ${quality.label.toLowerCase()} quality`}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards aria-label="Format" value={settings.mime} onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime }))} options={FORMAT_OPTIONS} />
          {webpUnsupported && <p className={styles.warning}>This browser can open WebP but not write it; Safari is the usual case.</p>}
        </fieldset>
        {settings.mime !== "image/png" && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Quality</legend>
            <RadioCards
              aria-label="Quality"
              value={settings.qualityId}
              onValueChange={(qualityId) => setSettings((previous) => ({ ...previous, qualityId }))}
              options={QUALITY_PRESETS.map((preset) => ({ value: preset.id, label: preset.label, blurb: preset.blurb }))}
            />
          </fieldset>
        )}
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop pictures in any format your browser can open - JPEG, PNG, WebP, GIF, BMP, AVIF, and HEIC in Safari - and get them back as JPEG, PNG or WebP at the quality you choose, as many at once as you like. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: `Converted to ${MIME_LABELS[settings.mime]} as they land - change it below` }}
      note="The picture is decoded and drawn again by the browser, so what comes out carries none of the source's metadata: no camera, date or location, and no embedded colour profile either, so a photo in a wide-gamut profile is converted to the ordinary sRGB most screens show. A rotated photo is turned the right way up on the way through. Which formats can be opened is up to the browser: HEIC from an iPhone opens in Safari and not elsewhere."
    />
  );
}
