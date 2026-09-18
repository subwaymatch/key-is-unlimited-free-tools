"use client";

import { useMemo, useState } from "react";

import { describeSize, encodeCanvas, IMAGE_ACCEPT, MIME_LABELS, mayHaveTransparency, QUALITY_PRESETS, rejectNonImage, sameFormatMime } from "@/lib/images/canvas";
import { pictureName, readPicture } from "@/lib/images/run";
import { drawTurned, TURN_OPTIONS, turnedSize, type Turn } from "@/lib/images/transform";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("rotate-image");

interface TurnSettings {
  turn: Turn;
}

const SUFFIX: Record<Turn, string> = { cw: "-rotated-right", ccw: "-rotated-left", half: "-upside-down", "flip-h": "-mirrored", "flip-v": "-flipped" };

function isTurnSettings(value: unknown): value is TurnSettings {
  return typeof value === "object" && value !== null && TURN_OPTIONS.some((option) => option.id === (value as Partial<TurnSettings>).turn);
}

/** Pictures turned a quarter or a half, or flipped, in bulk. */
export function RotateImageApp() {
  const [settings, setSettings] = useState<TurnSettings>({ turn: "cw" });
  useStoredSettings(storageKey("settings", "rotate-image"), settings, setSettings, isTurnSettings);

  const queue = useMemo<PlainQueueOptions<TurnSettings>>(
    () => ({
      key: "rotate-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          const mime = sameFormatMime(file);
          report("Turning...", null);
          const canvas = drawTurned(image, current.turn, mime === "image/jpeg" && mayHaveTransparency(file) ? "#ffffff" : null);
          const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
          const label = TURN_OPTIONS.find((option) => option.id === current.turn)?.label ?? "Turned";
          return { facts: [describeSize(source)], outputs: [{ label: `${label}, ${MIME_LABELS[mime]}`, fileName: pictureName(file, mime, SUFFIX[current.turn]), blob, kind: "image", note: describeSize(turnedSize(source, current.turn)) }] };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Turn",
    defaultOpen: true,
    summary: () => TURN_OPTIONS.find((option) => option.id === settings.turn)?.label.toLowerCase() ?? settings.turn,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Turn</legend>
        <RadioCards aria-label="Turn" value={settings.turn} onValueChange={(turn) => setSettings({ turn: turn as Turn })} options={TURN_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop pictures and get them back turned a quarter either way, upside down, mirrored or flipped, as many at once as you like, in the format they came in. A photo that only looks the right way up because of its orientation tag is written the right way up for good. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Turning"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: "Turned as they land - choose how above" }}
      note="The turn is applied to the picture as it is shown, so a phone photo stored sideways with an orientation tag is read upright first and then turned. The pixels are redrawn, which loses nothing for PNG and a little for JPEG and WebP, written at high quality; what comes out carries none of the source's metadata."
    />
  );
}
