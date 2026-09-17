"use client";

import { useMemo, useState } from "react";

import { canEncode, describeSize, findQualityUnder, IMAGE_ACCEPT, MIME_LABELS, rejectNonImage, sameFormatMime, scaleSize, shrinkFactor, MIN_QUALITY, type Size } from "@/lib/images/canvas";
import { encodePicture, pictureName, readPicture } from "@/lib/images/run";
import { formatBytes } from "@/lib/format-utils";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("compress-image");

const SIZE_PRESETS: readonly { bytes: number; label: string; blurb: string }[] = [
  { bytes: 100_000, label: "100 KB", blurb: "A thumbnail, or a strict upload form" },
  { bytes: 200_000, label: "200 KB", blurb: "Profile pictures and most web forms" },
  { bytes: 500_000, label: "500 KB", blurb: "A photo on a page that has to load fast" },
  { bytes: 1_000_000, label: "1 MB", blurb: "Email and chat, at a size that still looks like a photo" },
  { bytes: 2_000_000, label: "2 MB", blurb: "Roomy: little visible loss" },
];

const CUSTOM = "custom";

interface CompressSettings {
  targetBytes: number;
  mime: "image/jpeg" | "image/webp";
  downscale: boolean;
}

const DEFAULT_SETTINGS: CompressSettings = { targetBytes: 500_000, mime: "image/jpeg", downscale: true };

function isCompressSettings(value: unknown): value is CompressSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompressSettings>;
  return typeof candidate.targetBytes === "number" && candidate.targetBytes >= 10_000 && (candidate.mime === "image/jpeg" || candidate.mime === "image/webp") && typeof candidate.downscale === "boolean";
}

/** The largest quality under the target, shrinking the frame only when the lowest quality is still too large. */
async function compressUnder(
  file: File,
  settings: CompressSettings,
  report: (phase: string) => void,
): Promise<{ blob: Blob; size: Size; quality: number; source: Size }> {
  const image = await readPicture(file);
  try {
    const source = { width: image.width, height: image.height };
    let size = source;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      report(`Trying ${describeSize(size)}...`);
      const encoded = new Map<number, Blob>();
      const sizeAt = async (quality: number) => {
        const { blob } = await encodePicture(image, file, size, settings.mime, quality);
        encoded.set(quality, blob);
        return blob.size;
      };
      const found = await findQualityUnder(sizeAt, settings.targetBytes);
      if (found) return { blob: encoded.get(found.quality)!, size, quality: found.quality, source };
      const atMin = encoded.get(MIN_QUALITY)?.size ?? settings.targetBytes * 2;
      if (!settings.downscale) {
        throw new PlainError(
          `This picture cannot get under ${formatBytes(settings.targetBytes)} at ${describeSize(size)}.`,
          `At the lowest quality it is still ${formatBytes(atMin)}. Allow scaling down in the panel, or choose a larger size.`,
        );
      }
      size = scaleSize(size, shrinkFactor(atMin, settings.targetBytes));
      if (size.width < 16 || size.height < 16) break;
    }
    throw new PlainError(`This picture cannot get under ${formatBytes(settings.targetBytes)}.`, "Even scaled down to nothing it would not fit. Choose a larger size.");
  } finally {
    image.close();
  }
}

/** The compressor: a picture under a size, by quality first and by scaling down second. */
export function CompressImageApp() {
  const [settings, setSettings] = useState<CompressSettings>(DEFAULT_SETTINGS);
  const [choice, setChoice] = useState<string>(String(DEFAULT_SETTINGS.targetBytes));
  const [customText, setCustomText] = useState("300");

  useStoredSettings(
    storageKey("settings", "compress-image"),
    settings,
    (stored) => {
      setSettings(stored);
      const preset = SIZE_PRESETS.some((entry) => entry.bytes === stored.targetBytes);
      setChoice(preset ? String(stored.targetBytes) : CUSTOM);
      if (!preset) setCustomText(String(Math.round(stored.targetBytes / 1000)));
    },
    isCompressSettings,
  );

  const customBytes = customText.trim() === "" ? null : Number(customText) >= 10 ? Math.round(Number(customText)) * 1000 : null;
  const customInvalid = choice === CUSTOM && customBytes === null;
  const webpUnsupported = typeof document !== "undefined" && !canEncode("image/webp");

  const queue = useMemo<PlainQueueOptions<CompressSettings>>(
    () => ({
      key: "compress-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        if (file.size <= current.targetBytes && sameFormatMime(file) === current.mime) {
          return { outputs: [], nothing: { message: `This picture is already under ${formatBytes(current.targetBytes)}.`, hint: `It is ${formatBytes(file.size)}. Choose a smaller size to shrink it further.` } };
        }
        report("Decoding...", null);
        const result = await compressUnder(file, current, (phase) => report(phase, null));
        const scaled = result.size.width !== result.source.width;
        return {
          facts: [describeSize(result.source)],
          outputs: [
            {
              label: MIME_LABELS[current.mime],
              fileName: pictureName(file, current.mime, "-compressed"),
              blob: result.blob,
              kind: "image",
              note: `${describeSize(result.size)}${scaled ? " (scaled down)" : ""}, quality ${Math.round(result.quality * 100)}, ${formatBytes(result.blob.size)} from ${formatBytes(file.size)}`,
            },
          ],
        };
      },
    }),
    [settings],
  );

  const target = formatBytes(settings.targetBytes);

  const toolSettings: PlainSettings = {
    title: "Target size",
    defaultOpen: true,
    invalid: () => (customInvalid ? "A size of at least 10 KB is needed before a picture can be compressed." : settings.mime === "image/webp" && webpUnsupported ? "This browser cannot write WebP. Choose JPEG." : null),
    summary: () => (customInvalid ? "no size chosen" : `under ${target}, ${MIME_LABELS[settings.mime]}${settings.downscale ? "" : ", never scaled"}`),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Under</legend>
          <p className={styles.intro}>
            The highest quality that fits is found first; only when the lowest quality is still too
            large is the picture scaled down, and then only as far as it has to be.
          </p>
          <RadioCards
            aria-label="Target size"
            value={choice}
            onValueChange={(value) => {
              setChoice(value);
              if (value !== CUSTOM) setSettings((previous) => ({ ...previous, targetBytes: Number(value) }));
              else if (customBytes !== null) setSettings((previous) => ({ ...previous, targetBytes: customBytes }));
            }}
            options={[...SIZE_PRESETS.map((preset) => ({ value: String(preset.bytes), label: preset.label, blurb: preset.blurb })), { value: CUSTOM, label: "Custom", blurb: "Any size in kilobytes" }]}
          />
          {choice === CUSTOM && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Kilobytes</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={10}
                  step="10"
                  value={customText}
                  aria-invalid={customInvalid}
                  onChange={(event) => {
                    setCustomText(event.target.value);
                    const bytes = Number(event.target.value) >= 10 ? Math.round(Number(event.target.value)) * 1000 : null;
                    if (bytes !== null) setSettings((previous) => ({ ...previous, targetBytes: bytes }));
                  }}
                  className={styles.input}
                />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime }))}
            options={[
              { value: "image/jpeg" as const, label: "JPEG", blurb: "Opens everywhere. Transparency is painted white" },
              { value: "image/webp" as const, label: "WebP", blurb: "Smaller at the same quality, keeps transparency; every current browser opens it" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Scaling</legend>
          <RadioCards
            aria-label="Scaling"
            value={settings.downscale ? "allow" : "never"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, downscale: value === "allow" }))}
            options={[
              { value: "allow", label: "Scale down if it must", blurb: "A smaller, clean picture rather than a full-size, blocky one" },
              { value: "never", label: "Keep the size", blurb: "Quality alone; a picture that cannot fit says so" },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop photos and get them back under a size you choose - 200 KB for a form, 1 MB for an email - at the highest quality that fits, scaled down only when the lowest quality is still too large. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Compressing"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: customInvalid ? "Choose a size below before adding a picture" : `Each picture is brought under ${target} - change it below` }}
      note="The picture is encoded several times at different qualities to find the one that fits, which takes a moment for a large photo. What comes out carries none of the source's metadata, and a rotated photo is turned the right way up. A PNG is written as JPEG or WebP here, since a PNG's size cannot be chosen; anything transparent is painted white in a JPEG and kept in a WebP."
    />
  );
}
