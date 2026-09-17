"use client";

import { useMemo, useState } from "react";

import { describeSize, fitLongestSide, IMAGE_ACCEPT, MIME_LABELS, QUALITY_PRESETS, rejectNonImage, sameFormatMime } from "@/lib/images/canvas";
import { ASPECTS, centredCrop, drawCrop, isAlreadyShape } from "@/lib/images/edit";
import { pictureName, readPicture } from "@/lib/images/run";
import { encodeCanvas, mayHaveTransparency } from "@/lib/images/canvas";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("crop-image");

interface CropSettings {
  aspect: string;
  /** Longest side to scale the crop to, or null to keep its pixels. */
  longest: number | null;
}

const LONGEST_OPTIONS = [
  { value: "keep", label: "Keep the pixels", blurb: "The crop at the picture's own resolution" },
  { value: "1080", label: "1080 px", blurb: "Longest side 1080: a feed post" },
  { value: "1920", label: "1920 px", blurb: "Longest side 1920: full HD" },
];

function isCropSettings(value: unknown): value is CropSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CropSettings>;
  return ASPECTS.some((aspect) => aspect.id === candidate.aspect) && (candidate.longest === null || (typeof candidate.longest === "number" && candidate.longest > 0));
}

/** Pictures cropped to a shape, centred. */
export function CropImageApp() {
  const [settings, setSettings] = useState<CropSettings>({ aspect: "1:1", longest: null });
  useStoredSettings(storageKey("settings", "crop-image"), settings, setSettings, isCropSettings);

  const aspect = ASPECTS.find((entry) => entry.id === settings.aspect) ?? ASPECTS[0];

  const queue = useMemo<PlainQueueOptions<CropSettings>>(
    () => ({
      key: "crop-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        const shape = ASPECTS.find((entry) => entry.id === current.aspect) ?? ASPECTS[0];
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          const rect = centredCrop(source, shape);
          const size = current.longest ? fitLongestSide(rect, current.longest) : { width: rect.width, height: rect.height };
          if (isAlreadyShape(source, shape) && size.width === rect.width) {
            return { facts: [describeSize(source)], outputs: [], nothing: { message: `This picture is already ${shape.label.toLowerCase()}.`, hint: `It is ${describeSize(source)}.` } };
          }
          const mime = sameFormatMime(file);
          report(`Cropping to ${describeSize(rect)}...`, null);
          const canvas = drawCrop(image, rect, size, mime === "image/jpeg" && mayHaveTransparency(file) ? "#ffffff" : null);
          const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
          return {
            facts: [describeSize(source)],
            outputs: [{ label: `${shape.label} ${MIME_LABELS[mime]}`, fileName: pictureName(file, mime, `-${shape.id.replace(":", "x")}`), blob, kind: "image", note: `${describeSize(size)} from ${describeSize(source)}` }],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Shape & size",
    defaultOpen: true,
    summary: () => `${aspect.label}${settings.longest ? `, longest side ${settings.longest} px` : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Shape</legend>
          <p className={styles.intro}>The largest piece of that shape, taken from the middle of the picture.</p>
          <RadioCards aria-label="Shape" value={settings.aspect} onValueChange={(aspect) => setSettings((previous) => ({ ...previous, aspect }))} options={ASPECTS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Then</legend>
          <RadioCards aria-label="Then" value={settings.longest === null ? "keep" : String(settings.longest)} onValueChange={(value) => setSettings((previous) => ({ ...previous, longest: value === "keep" ? null : Number(value) }))} options={LONGEST_OPTIONS} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop pictures and get them back cropped to a shape - square for a profile, 4:5 or 9:16 for a feed or a story, 16:9 for a thumbnail, 3:2 for a print - taken from the middle of each, as many at once as you like, in the format they came in. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Cropping"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: `Cropped ${aspect.label.toLowerCase()} as they land - change it below` }}
      note="The crop is centred, which is right for most photos and wrong for the one where the subject stands at the edge; that one wants an editor. JPEG and WebP are written at high quality, PNG losslessly; what comes out carries none of the source's metadata."
    />
  );
}
