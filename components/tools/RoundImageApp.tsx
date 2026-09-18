"use client";

import { useMemo, useState } from "react";

import { canEncode, describeSize, encodeCanvas, IMAGE_ACCEPT, MIME_LABELS, QUALITY_PRESETS, rejectNonImage, type ImageMime } from "@/lib/images/canvas";
import { isHexColour } from "@/lib/images/edit";
import { pictureName, readPicture } from "@/lib/images/run";
import { BORDER_OPTIONS, drawRounded, ROUND_OPTIONS, roundPlan, type BorderChoice, type RoundChoice } from "@/lib/images/shape";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("round-image");

interface RoundSettings {
  round: RoundChoice;
  border: BorderChoice;
  colour: string;
  mime: ImageMime;
}

const DEFAULT_SETTINGS: RoundSettings = { round: "medium", border: "none", colour: "#ffffff", mime: "image/png" };

function isRoundSettings(value: unknown): value is RoundSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RoundSettings>;
  return (
    ROUND_OPTIONS.some((option) => option.id === candidate.round) &&
    BORDER_OPTIONS.some((option) => option.id === candidate.border) &&
    typeof candidate.colour === "string" &&
    (candidate.mime === "image/png" || candidate.mime === "image/jpeg" || candidate.mime === "image/webp")
  );
}

/** Corners rounded, or the whole cut to a circle, with a border. */
export function RoundImageApp() {
  const [settings, setSettings] = useState<RoundSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "round-image"), settings, setSettings, isRoundSettings);

  const colourInvalid = settings.border !== "none" && !isHexColour(settings.colour);

  const queue = useMemo<PlainQueueOptions<RoundSettings>>(
    () => ({
      key: "round-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          const plan = roundPlan(source, current.round, current.border);
          report("Drawing...", null);
          const canvas = drawRounded(image, plan, current.colour, current.mime === "image/jpeg" ? "#ffffff" : null);
          const blob = await encodeCanvas(canvas, current.mime, current.mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
          const label = ROUND_OPTIONS.find((option) => option.id === current.round)?.label ?? "Rounded";
          return {
            facts: [describeSize(source)],
            outputs: [{ label: `${label}, ${MIME_LABELS[current.mime]}`, fileName: pictureName(file, current.mime, current.round === "circle" ? "-circle" : "-rounded"), blob, kind: "image", note: `${describeSize(plan)}, corners of ${Math.round(plan.radius)} px${plan.border ? `, a ${plan.border} px border` : ""}` }],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Shape & border",
    defaultOpen: true,
    invalid: () => (colourInvalid ? "Type the border colour as a hex code, such as #ffffff." : settings.mime === "image/webp" && !canEncode("image/webp") ? "This browser cannot write WebP; choose PNG or JPEG." : null),
    summary: () => `${ROUND_OPTIONS.find((option) => option.id === settings.round)?.label.toLowerCase()}, ${settings.border === "none" ? "no border" : `${settings.border} ${settings.colour} border`}, ${MIME_LABELS[settings.mime]}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Shape</legend>
          <RadioCards aria-label="Shape" value={settings.round} onValueChange={(round) => setSettings((previous) => ({ ...previous, round: round as RoundChoice }))} options={ROUND_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Border</legend>
          <RadioCards aria-label="Border" value={settings.border} onValueChange={(border) => setSettings((previous) => ({ ...previous, border: border as BorderChoice }))} options={BORDER_OPTIONS.map((option) => ({ value: option.id, label: option.label, blurb: option.blurb }))} />
          {settings.border !== "none" && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Border colour</span>
                <input type="text" value={settings.colour} aria-invalid={colourInvalid} placeholder="#ffffff" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, colour: event.target.value.trim() }))} className={styles.input} style={{ width: "9rem" }} />
              </label>
              <p className={styles.panelNote}>A hex code: #ffffff is white, #000000 black.</p>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime: mime as ImageMime }))}
            options={[
              { value: "image/png", label: "PNG", blurb: "See-through corners, for use on any background" },
              { value: "image/webp", label: "WebP", blurb: "See-through corners, smaller; not written by Safari" },
              { value: "image/jpeg", label: "JPEG", blurb: "Corners filled white; no transparency" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop pictures and get them back with rounded corners, or cut to a circle for a profile picture, with a border in a colour you choose if you like, as many at once as you like. The corners are see-through in PNG and WebP, so the picture sits on any background. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Drawing"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: "Rounded as they land - choose the shape above" }}
      note="The radius is a share of the picture's shorter side, so a small avatar and a large banner round the same way. A circle is cut from a centred square of the picture's shorter side. The border is drawn just inside the edge, at one or three per cent of the shorter side. What comes out is drawn afresh by the canvas and carries none of the source's metadata."
    />
  );
}
