"use client";

import { useMemo, useState } from "react";

import { canEncode, describeSize, drawImage, encodeCanvas, IMAGE_ACCEPT, MIME_LABELS, rejectNonImage, type ImageMime } from "@/lib/images/canvas";
import { pictureName, readPicture } from "@/lib/images/run";
import { describeShare, hexOf, KEY_TARGETS, KEY_TOLERANCES, keyOut, parseHexColour, samplePixel, type Colour, type KeyTarget, type KeyTolerance } from "@/lib/images/shape";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("make-transparent");

interface KeySettings {
  target: KeyTarget;
  hex: string;
  tolerance: KeyTolerance;
  contiguous: boolean;
  mime: Exclude<ImageMime, "image/jpeg">;
}

const DEFAULT_SETTINGS: KeySettings = { target: "white", hex: "#ffffff", tolerance: "normal", contiguous: true, mime: "image/png" };

function isKeySettings(value: unknown): value is KeySettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<KeySettings>;
  return (
    KEY_TARGETS.some((option) => option.id === candidate.target) &&
    typeof candidate.hex === "string" &&
    KEY_TOLERANCES.some((option) => option.id === candidate.tolerance) &&
    typeof candidate.contiguous === "boolean" &&
    (candidate.mime === "image/png" || candidate.mime === "image/webp")
  );
}

/** One colour of a picture made see-through. */
export function MakeTransparentApp() {
  const [settings, setSettings] = useState<KeySettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "make-transparent"), settings, setSettings, isKeySettings);

  const hexInvalid = settings.target === "custom" && parseHexColour(settings.hex) === null;

  const queue = useMemo<PlainQueueOptions<KeySettings>>(
    () => ({
      key: "make-transparent",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const size = { width: image.width, height: image.height };
          const canvas = drawImage(image, size, null);
          const context = canvas.getContext("2d") as CanvasRenderingContext2D;
          const pixels = context.getImageData(0, 0, size.width, size.height);
          const colour: Colour =
            current.target === "white" ? { r: 255, g: 255, b: 255 }
            : current.target === "black" ? { r: 0, g: 0, b: 0 }
            : current.target === "corner" ? samplePixel(pixels.data, size.width, 0, 0)
            : (parseHexColour(current.hex) ?? { r: 255, g: 255, b: 255 });
          report("Keying...", null);
          const tolerance = KEY_TOLERANCES.find((option) => option.id === current.tolerance)?.value ?? 40;
          const removed = keyOut(pixels.data, size.width, size.height, colour, tolerance, current.contiguous);
          const facts = [describeSize(size), `Colour keyed: ${hexOf(colour)}`];
          if (removed === 0) return { facts, outputs: [], nothing: { message: "No pixels are that colour.", hint: current.contiguous ? "None that touch the edges, at least. Try keying the colour everywhere, or a looser match." : "Try a looser match, or the top-left pixel's colour." } };
          context.putImageData(pixels, 0, 0);
          const blob = await encodeCanvas(canvas, current.mime);
          return {
            facts,
            outputs: [{ label: `${MIME_LABELS[current.mime]} with transparency`, fileName: pictureName(file, current.mime, "-transparent"), blob, kind: "image", note: `${describeShare(removed, size.width * size.height)} made see-through` }],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Colour & match",
    defaultOpen: true,
    invalid: () => (hexInvalid ? "Type the colour as a hex code, such as #00ff00." : settings.mime === "image/webp" && !canEncode("image/webp") ? "This browser cannot write WebP; choose PNG." : null),
    summary: () => `${settings.target === "custom" ? settings.hex : KEY_TARGETS.find((option) => option.id === settings.target)?.label.toLowerCase()}, ${KEY_TOLERANCES.find((option) => option.id === settings.tolerance)?.label.toLowerCase()}, ${settings.contiguous ? "from the edges in" : "everywhere"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>The colour to remove</legend>
          <RadioCards aria-label="The colour to remove" value={settings.target} onValueChange={(target) => setSettings((previous) => ({ ...previous, target: target as KeyTarget }))} options={KEY_TARGETS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} columns={2} />
          {settings.target === "custom" && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Hex code</span>
                <input type="text" value={settings.hex} aria-invalid={hexInvalid} placeholder="#00ff00" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, hex: event.target.value.trim() }))} className={styles.input} style={{ width: "9rem" }} />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>How close a match</legend>
          <RadioCards aria-label="How close a match" value={settings.tolerance} onValueChange={(tolerance) => setSettings((previous) => ({ ...previous, tolerance: tolerance as KeyTolerance }))} options={KEY_TOLERANCES.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Where</legend>
          <RadioCards
            aria-label="Where"
            value={settings.contiguous ? "edges" : "everywhere"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, contiguous: value === "edges" }))}
            options={[
              { value: "edges", label: "From the edges in", blurb: "Only the background: a white shirt in the middle stays" },
              { value: "everywhere", label: "Everywhere", blurb: "Every pixel of that colour, wherever it is" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime: mime as KeySettings["mime"] }))}
            options={[
              { value: "image/png", label: "PNG", blurb: "Lossless; what a logo wants" },
              { value: "image/webp", label: "WebP", blurb: "Smaller; not written by Safari" },
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
      lead="Drop a logo on a white background, a scan, a sticker on a flat colour, and get it back with that colour see-through, as a PNG or WebP, as many at once as you like. Pick the colour, how close a match counts, and whether only the background around the edges goes or every pixel of that colour. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Keying"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: "The colour chosen above is made transparent as they land" }}
      note="A pixel matches when none of its red, green and blue is further from the colour than the match allows, and the pixels a shade past that are faded rather than cut, which softens the edge. This keys a flat colour; it does not find the subject of a photograph, which is a different job and a large model. A JPEG's background is never quite one colour, so a looser match usually suits one."
    />
  );
}
