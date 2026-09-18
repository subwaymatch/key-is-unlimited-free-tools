"use client";

import { useMemo, useState } from "react";

import { describeSize, encodeCanvas, IMAGE_ACCEPT, MIME_LABELS, QUALITY_PRESETS, rejectNonImage, sameFormatMime, type ImageMime } from "@/lib/images/canvas";
import { ASPECTS, isAlreadyShape } from "@/lib/images/edit";
import { pictureName, readPicture } from "@/lib/images/run";
import { drawPadded, PAD_BACKGROUNDS, padPlan, type PadBackground } from "@/lib/images/transform";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("pad-image");

interface PadSettings {
  aspect: string;
  background: PadBackground;
}

function isPadSettings(value: unknown): value is PadSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PadSettings>;
  return ASPECTS.some((aspect) => aspect.id === candidate.aspect) && PAD_BACKGROUNDS.some((option) => option.id === candidate.background);
}

/** Pictures fitted to a shape by adding to them rather than cutting. */
export function PadImageApp() {
  const [settings, setSettings] = useState<PadSettings>({ aspect: "1:1", background: "blur" });
  useStoredSettings(storageKey("settings", "pad-image"), settings, setSettings, isPadSettings);

  const aspect = ASPECTS.find((entry) => entry.id === settings.aspect) ?? ASPECTS[0];

  const queue = useMemo<PlainQueueOptions<PadSettings>>(
    () => ({
      key: "pad-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        const shape = ASPECTS.find((entry) => entry.id === current.aspect) ?? ASPECTS[0];
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          if (isAlreadyShape(source, shape)) {
            return { facts: [describeSize(source)], outputs: [], nothing: { message: `This picture is already ${shape.label.toLowerCase()}.`, hint: `It is ${describeSize(source)}.` } };
          }
          // A see-through frame needs a format that has transparency.
          const own = sameFormatMime(file);
          const mime: ImageMime = current.background === "transparent" && own === "image/jpeg" ? "image/png" : own;
          const plan = padPlan(source, shape);
          report(`Padding to ${describeSize(plan)}...`, null);
          const canvas = drawPadded(image, plan, current.background);
          const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
          return {
            facts: [describeSize(source)],
            outputs: [{ label: `${shape.label} ${MIME_LABELS[mime]}`, fileName: pictureName(file, mime, `-${shape.id.replace(":", "x")}-padded`), blob, kind: "image", note: `${describeSize(plan)} from ${describeSize(source)}` }],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Shape & background",
    defaultOpen: true,
    summary: () => `${aspect.label}, ${PAD_BACKGROUNDS.find((option) => option.id === settings.background)?.label.toLowerCase()}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Shape</legend>
          <p className={styles.intro}>The smallest frame of this shape that holds the whole picture, with the picture in the middle.</p>
          <RadioCards aria-label="Shape" value={settings.aspect} onValueChange={(next) => setSettings((previous) => ({ ...previous, aspect: next }))} options={ASPECTS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Background</legend>
          <RadioCards aria-label="Background" value={settings.background} onValueChange={(background) => setSettings((previous) => ({ ...previous, background: background as PadBackground }))} options={PAD_BACKGROUNDS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} columns={2} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop pictures and get them back fitted to a shape without cropping: square for a feed, 4:5 or 9:16 for a story, 16:9 for a thumbnail, with the picture whole in the middle and the rest filled with white, black, nothing, or a blurred blow-up of the picture itself. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Padding"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: `Padded ${aspect.label.toLowerCase()} as they land - change it below` }}
      note="Nothing is cut off and nothing is enlarged: the frame grows to the shape around the picture at its own size, which is the opposite of the crop tool. A transparent frame needs a format that can hold one, so a JPEG comes back as a PNG. The blurred background is the picture drawn tiny and back up again, which every browser can do without a filter. What comes out carries none of the source's metadata."
    />
  );
}
