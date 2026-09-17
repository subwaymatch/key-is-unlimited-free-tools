"use client";

import { useMemo, useState } from "react";

import { canEncode, describeSize, fitLongestSide, IMAGE_ACCEPT, MIME_LABELS, QUALITY_PRESETS, rejectNonImage, sameFormatMime, scaleSize, type ImageMime } from "@/lib/images/canvas";
import { encodePicture, pictureName, readPicture } from "@/lib/images/run";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("resize-image");

const LONGEST_SIDES: readonly number[] = [1920, 1280, 1024, 800, 640];
const FRACTIONS: readonly { factor: number; label: string }[] = [
  { factor: 0.5, label: "Half" },
  { factor: 0.25, label: "Quarter" },
];
const CUSTOM = "custom";

type ResizeRule = { kind: "longest"; pixels: number } | { kind: "fraction"; factor: number };

interface ResizeSettings {
  rule: ResizeRule;
  mime: ImageMime | "same";
}

const DEFAULT_SETTINGS: ResizeSettings = { rule: { kind: "longest", pixels: 1920 }, mime: "same" };

function isResizeSettings(value: unknown): value is ResizeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ResizeSettings>;
  const rule = candidate.rule as Partial<{ kind: string; pixels: number; factor: number }> | undefined;
  if (!rule) return false;
  const validRule = (rule.kind === "longest" && typeof rule.pixels === "number" && rule.pixels >= 16) || (rule.kind === "fraction" && typeof rule.factor === "number" && rule.factor > 0 && rule.factor < 1);
  return validRule && (candidate.mime === "same" || candidate.mime === "image/jpeg" || candidate.mime === "image/png" || candidate.mime === "image/webp");
}

function choiceFor(rule: ResizeRule): string {
  if (rule.kind === "fraction") return `f${rule.factor}`;
  return LONGEST_SIDES.includes(rule.pixels) ? `p${rule.pixels}` : CUSTOM;
}

function describeRule(rule: ResizeRule): string {
  return rule.kind === "fraction" ? `${FRACTIONS.find((entry) => entry.factor === rule.factor)?.label.toLowerCase() ?? rule.factor} size` : `longest side ${rule.pixels} px`;
}

/** The resizer: a longest side or a fraction, never enlarged, in the format the picture came in. */
export function ResizeImageApp() {
  const [settings, setSettings] = useState<ResizeSettings>(DEFAULT_SETTINGS);
  const [choice, setChoice] = useState<string>(choiceFor(DEFAULT_SETTINGS.rule));
  const [customText, setCustomText] = useState("1500");

  useStoredSettings(
    storageKey("settings", "resize-image"),
    settings,
    (stored) => {
      setSettings(stored);
      setChoice(choiceFor(stored.rule));
      if (stored.rule.kind === "longest" && choiceFor(stored.rule) === CUSTOM) setCustomText(String(stored.rule.pixels));
    },
    isResizeSettings,
  );

  const customPixels = customText.trim() === "" ? null : Number.isInteger(Number(customText)) && Number(customText) >= 16 ? Number(customText) : null;
  const customInvalid = choice === CUSTOM && customPixels === null;
  const webpUnsupported = typeof document !== "undefined" && !canEncode("image/webp");

  const queue = useMemo<PlainQueueOptions<ResizeSettings>>(
    () => ({
      key: "resize-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          const size = current.rule.kind === "longest" ? fitLongestSide(source, current.rule.pixels) : scaleSize(source, current.rule.factor);
          const mime = current.mime === "same" ? sameFormatMime(file) : current.mime;
          if (size.width === source.width && size.height === source.height && current.mime === "same") {
            return { facts: [describeSize(source)], outputs: [], nothing: { message: `This picture is already within ${describeRule(current.rule)}.`, hint: `It is ${describeSize(source)}, and pictures are never enlarged.` } };
          }
          report(`Drawing at ${describeSize(size)}...`, null);
          const lossy = mime !== "image/png";
          const { blob } = await encodePicture(image, file, size, mime, lossy ? QUALITY_PRESETS[0].quality : null);
          return {
            facts: [describeSize(source)],
            outputs: [{ label: MIME_LABELS[mime], fileName: pictureName(file, mime, `-${size.width}x${size.height}`), blob, kind: "image", note: `${describeSize(size)} from ${describeSize(source)}` }],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Size & format",
    defaultOpen: true,
    invalid: () => (customInvalid ? "A longest side of at least 16 pixels is needed before a picture can be resized." : settings.mime === "image/webp" && webpUnsupported ? "This browser cannot write WebP. Choose another format." : null),
    summary: () => (customInvalid ? "no size chosen" : `${describeRule(settings.rule)}, ${settings.mime === "same" ? "same format" : MIME_LABELS[settings.mime]}`),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Size</legend>
          <p className={styles.intro}>
            The longest side bounds the picture whichever way it was taken: 1920 is full HD for a
            landscape photo and 1920 tall for a portrait one. Pictures are never enlarged.
          </p>
          <RadioCards
            aria-label="Size"
            value={choice}
            onValueChange={(value) => {
              setChoice(value);
              if (value.startsWith("p")) setSettings((previous) => ({ ...previous, rule: { kind: "longest", pixels: Number(value.slice(1)) } }));
              else if (value.startsWith("f")) setSettings((previous) => ({ ...previous, rule: { kind: "fraction", factor: Number(value.slice(1)) } }));
              else if (customPixels !== null) setSettings((previous) => ({ ...previous, rule: { kind: "longest", pixels: customPixels } }));
            }}
            options={[
              ...LONGEST_SIDES.map((pixels) => ({ value: `p${pixels}`, label: `${pixels} px`, blurb: pixels === 1920 ? "Full HD; the usual choice for the web" : pixels === 1280 ? "HD" : pixels === 800 ? "A blog post or an email" : `Longest side ${pixels} pixels` })),
              ...FRACTIONS.map((entry) => ({ value: `f${entry.factor}`, label: entry.label, blurb: `${entry.label} the width and height` })),
              { value: CUSTOM, label: "Custom", blurb: "Any longest side in pixels" },
            ]}
          />
          {choice === CUSTOM && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Longest side, in pixels</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={16}
                  step="1"
                  value={customText}
                  aria-invalid={customInvalid}
                  onChange={(event) => {
                    setCustomText(event.target.value);
                    const pixels = Number(event.target.value);
                    if (Number.isInteger(pixels) && pixels >= 16) setSettings((previous) => ({ ...previous, rule: { kind: "longest", pixels } }));
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
              { value: "same" as const, label: "As it came", blurb: "JPEG stays JPEG, PNG stays PNG, WebP stays WebP; anything else becomes PNG" },
              { value: "image/jpeg" as const, label: "JPEG", blurb: "Photos; transparency painted white" },
              { value: "image/png" as const, label: "PNG", blurb: "Lossless, with transparency" },
              { value: "image/webp" as const, label: "WebP", blurb: "Small, with transparency" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop pictures and get them back scaled down to a longest side of 1920, 1280, 1024 or 800 pixels, to half or a quarter, or to a number you type - never enlarged, in the format they came in or another, as many at once as you like. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Resizing"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: customInvalid ? "Choose a size below before adding a picture" : `Each picture is scaled to ${describeRule(settings.rule)} - change it below` }}
      note="Scaling is done in halves down to the size asked for, so every step averages the pixels it drops and a 6000-pixel photo scaled to 800 stays smooth. JPEG and WebP are written at high quality; what comes out carries none of the source's metadata, and a rotated photo is turned the right way up on the way through."
    />
  );
}
