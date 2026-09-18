"use client";

import { useMemo, useState } from "react";

import { describeSize, drawImage, encodeCanvas, IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { readPicture } from "@/lib/images/run";
import { describeShare, DIFF_TOLERANCES, diffPixels, type DiffTolerance } from "@/lib/images/shape";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("compare-images");

/** Two pictures of this many pixels each is what a tab can hold as raw pixels at once. */
const MAX_PIXELS = 40_000_000;

interface CompareSettings {
  tolerance: DiffTolerance;
}

function isCompareSettings(value: unknown): value is CompareSettings {
  return typeof value === "object" && value !== null && DIFF_TOLERANCES.some((option) => option.id === (value as Partial<CompareSettings>).tolerance);
}

/** The pixels of a picture, at its own size, over a region from its top-left corner. */
async function pixelsOf(file: File, width: number, height: number): Promise<Uint8ClampedArray> {
  const image = await readPicture(file);
  try {
    const canvas = drawImage(image, { width: image.width, height: image.height }, null);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    return context.getImageData(0, 0, width, height).data;
  } finally {
    image.close();
  }
}

/** Two pictures, and where they differ. */
export function CompareImagesApp() {
  const [settings, setSettings] = useState<CompareSettings>({ tolerance: "small" });
  useStoredSettings(storageKey("settings", "compare-images"), settings, setSettings, isCompareSettings);

  const queue = useMemo<CombineOptions<CompareSettings>>(
    () => ({
      key: "compare-images",
      settings,
      reject: rejectNonImage,
      inspect: async (file) => {
        const image = await readPicture(file);
        try {
          return { facts: [describeSize({ width: image.width, height: image.height })], previewUrl: URL.createObjectURL(file) };
        } finally {
          image.close();
        }
      },
      run: async (files, current, report) => {
        if (files.length !== 2) throw new PlainError("Drop exactly two pictures.", `There are ${files.length} in the list; remove the extra ones.`);
        const [a, b] = files;
        report("Decoding...", null);
        const first = await readPicture(a);
        const sizeA = { width: first.width, height: first.height };
        first.close();
        const second = await readPicture(b);
        const sizeB = { width: second.width, height: second.height };
        second.close();
        const width = Math.min(sizeA.width, sizeB.width);
        const height = Math.min(sizeA.height, sizeB.height);
        if (width * height > MAX_PIXELS) throw new PlainError("These pictures are too large to compare in a browser tab.", `Both are held as raw pixels; this compares pictures up to ${(MAX_PIXELS / 1_000_000).toFixed(0)} megapixels.`);
        const sameSize = sizeA.width === sizeB.width && sizeA.height === sizeB.height;
        report("Comparing...", null);
        const tolerance = DIFF_TOLERANCES.find((option) => option.id === current.tolerance)?.value ?? 0;
        const diff = diffPixels(await pixelsOf(a, width, height), await pixelsOf(b, width, height), width, height, tolerance);
        const notes: string[] = [];
        if (!sameSize) notes.push(`The pictures are different sizes, ${describeSize(sizeA)} against ${describeSize(sizeB)}; the ${describeSize({ width, height })} they share from the top-left corner was compared.`);
        if (diff.changed === 0) {
          return { outputs: [], notes, nothing: { message: sameSize ? "The two pictures are the same." : "The part the two pictures share is the same.", hint: tolerance > 0 ? `No pixel differs by more than ${tolerance} on any channel.` : "Every pixel matches exactly." } };
        }
        report("Drawing the difference...", null);
        const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
        const context = canvas.getContext("2d") as CanvasRenderingContext2D;
        context.putImageData(new ImageData(diff.out, width, height), 0, 0);
        const blob = await encodeCanvas(canvas, "image/png");
        const where = diff.bounds ? `within ${describeSize(diff.bounds)} from (${diff.bounds.x}, ${diff.bounds.y})` : "";
        const summary = `${diff.changed.toLocaleString("en")} of ${diff.total.toLocaleString("en")} pixels differ: ${describeShare(diff.changed, diff.total)}`;
        return {
          notes: [...notes, `${summary}, ${where}. The picture below is the first one faded, with every pixel that differs painted red.`],
          outputs: [{ label: "Difference", fileName: `${fileStem(a.name, "a")}-vs-${fileStem(b.name, "b")}.png`, blob, kind: "image", note: summary }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What counts as a change",
    summary: () => DIFF_TOLERANCES.find((option) => option.id === settings.tolerance)?.label.toLowerCase() ?? settings.tolerance,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Tolerance</legend>
        <RadioCards aria-label="Tolerance" value={settings.tolerance} onValueChange={(tolerance) => setSettings({ tolerance: tolerance as DiffTolerance })} options={DIFF_TOLERANCES.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop two versions of a picture - two screenshots, a design and its render, a photo before and after an edit - and get back a picture of where they differ, with every changed pixel in red over a faded copy of the first, and a count. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Compare the two pictures"
      minFiles={2}
      noun="pictures"
      busyLabel="Comparing"
      summary={(files) => (files.length === 2 ? `${files[0].file.name} against ${files[1].file.name}.` : files.length > 2 ? `${files.length} pictures: a comparison takes two. Remove the extra ones.` : null)}
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose two pictures", headline: "Drop two pictures here", subhead: "The first is the reference, the second the one to check" }}
      note="Pictures are compared pixel for pixel at their own size, so two that differ only in size or scale show as almost entirely changed; resize one first if that is the case. A picture saved twice as JPEG differs in grain everywhere, which is what the tolerance is for. Pictures of different sizes are compared over the part they share from the top-left corner, and the card says so."
    />
  );
}
