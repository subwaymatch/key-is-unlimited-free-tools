"use client";

import { useMemo, useState } from "react";

import { canEncode, decodeImage, describeSize, drawImage, encodeCanvas, MIME_EXTENSIONS, MIME_LABELS, type ImageMime } from "@/lib/images/canvas";
import { looksLikeSvg, svgAtSize, svgSize } from "@/lib/images/transform";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("svg-to-png");

const ACCEPT = ".svg,.svgz,image/svg+xml";

/** The most a side may be; browsers refuse a canvas much past this. */
const MAX_SIDE = 8192;

type Background = "transparent" | "white" | "black";

interface SvgSettings {
  width: number;
  background: Background;
  mime: ImageMime;
}

const WIDTH_OPTIONS = [
  { value: "512", label: "512 px", blurb: "An icon or a favicon source" },
  { value: "1024", label: "1024 px", blurb: "A logo for a page" },
  { value: "2048", label: "2048 px", blurb: "Print, or a large display" },
  { value: "4096", label: "4096 px", blurb: "As large as most uses want" },
];

function isSvgSettings(value: unknown): value is SvgSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SvgSettings>;
  return typeof candidate.width === "number" && candidate.width > 0 && candidate.width <= MAX_SIDE && (candidate.background === "transparent" || candidate.background === "white" || candidate.background === "black") && (candidate.mime === "image/png" || candidate.mime === "image/jpeg" || candidate.mime === "image/webp");
}

/** An SVG drawn as pixels at a chosen width. */
export function SvgToPngApp() {
  const [settings, setSettings] = useState<SvgSettings>({ width: 1024, background: "transparent", mime: "image/png" });
  useStoredSettings(storageKey("settings", "svg-to-png"), settings, setSettings, isSvgSettings);

  const queue = useMemo<PlainQueueOptions<SvgSettings>>(
    () => ({
      key: "svg-to-png",
      settings,
      reject: (file) => {
        if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing in it to draw." };
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension === "svg" || file.type === "image/svg+xml") return null;
        return { message: "This is not an SVG.", hint: "Drop an .svg file. Other pictures are already pixels; the convert tool takes those." };
      },
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await file.text();
        if (!looksLikeSvg(text)) throw new PlainError("This file has no SVG in it.", "It does not contain an <svg> element in its first 64 KB.");
        const own = svgSize(text);
        const width = current.width;
        const height = own ? Math.max(1, Math.round((width * own.height) / own.width)) : Math.round((width * 3) / 4);
        if (height > MAX_SIDE) throw new PlainError("That would be too tall to draw.", `At ${width} pixels wide this picture is ${height} tall; the most a canvas takes is ${MAX_SIDE}. Choose a smaller width.`);
        report(`Drawing at ${width}x${height}...`, null);
        const sized = new File([svgAtSize(text, width, height)], file.name, { type: "image/svg+xml" });
        let image;
        try {
          image = await decodeImage(sized);
        } catch (error) {
          throw new PlainError("The browser could not draw this SVG.", "It may reference outside files, use features the browser lacks, or not be well-formed XML. Opening it in the browser on its own will show what is wrong.", { cause: error });
        }
        try {
          const mime: ImageMime = current.background === "transparent" && current.mime === "image/jpeg" ? "image/png" : current.mime;
          const background = current.background === "transparent" ? (mime === "image/jpeg" ? "#ffffff" : null) : current.background === "white" ? "#ffffff" : "#000000";
          const canvas = drawImage(image, { width, height }, background);
          const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : 0.92);
          return {
            facts: [own ? `Drawn size: ${Math.round(own.width)}x${Math.round(own.height)}` : "No size of its own: drawn 4:3"],
            notes: own ? [] : ["The SVG states neither a size nor a viewBox, so it was drawn at four by three. Add a viewBox to get its true proportions."],
            outputs: [{ label: `${MIME_LABELS[mime]}, ${width} px wide`, fileName: `${fileStem(file.name, "picture")}-${width}px.${MIME_EXTENSIONS[mime]}`, blob, kind: "image", note: describeSize({ width, height }) }],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Size, background & format",
    defaultOpen: true,
    invalid: () => (settings.mime === "image/webp" && !canEncode("image/webp") ? "This browser cannot write WebP; choose PNG or JPEG." : null),
    summary: () => `${settings.width} px wide, ${settings.background}, ${MIME_LABELS[settings.mime]}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Width</legend>
          <p className={styles.intro}>The height follows from the picture&apos;s own proportions.</p>
          <RadioCards aria-label="Width" value={String(settings.width)} onValueChange={(value) => setSettings((previous) => ({ ...previous, width: Number(value) }))} options={WIDTH_OPTIONS} />
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Or any width, in pixels</span>
              <input type="number" inputMode="numeric" min={1} max={MAX_SIDE} step="1" value={settings.width} onChange={(event) => setSettings((previous) => ({ ...previous, width: Math.max(1, Math.min(MAX_SIDE, Math.round(Number(event.target.value)) || 1)) }))} className={styles.input} />
            </label>
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Background</legend>
          <RadioCards
            aria-label="Background"
            value={settings.background}
            onValueChange={(background) => setSettings((previous) => ({ ...previous, background: background as Background, mime: background === "transparent" && previous.mime === "image/jpeg" ? "image/png" : previous.mime }))}
            options={[
              { value: "transparent", label: "Transparent", blurb: "PNG or WebP only" },
              { value: "white", label: "White" },
              { value: "black", label: "Black" },
            ]}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Format</legend>
          <RadioCards
            aria-label="Format"
            value={settings.mime}
            onValueChange={(mime) => setSettings((previous) => ({ ...previous, mime: mime as ImageMime, background: mime === "image/jpeg" && previous.background === "transparent" ? "white" : previous.background }))}
            options={[
              { value: "image/png", label: "PNG", blurb: "Lossless, with transparency: the usual choice for a logo" },
              { value: "image/jpeg", label: "JPEG", blurb: "Smaller, no transparency" },
              { value: "image/webp", label: "WebP", blurb: "Smaller than both; not written by Safari" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an SVG and get it as a PNG, JPEG or WebP at the width you choose - 512, 1024, 2048 pixels or any number - on a transparent, white or black background, drawn by the browser's own renderer, which is the one that draws it on a page. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Drawing"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose SVG files", headline: "Drop SVG files here", subhead: `Drawn ${settings.width} pixels wide as they land - change it above` }}
      note="The browser draws the SVG the way it draws one on a page, fonts from the system and all, so what comes out is what you see. An SVG that references pictures or fonts by URL draws without them, since nothing here fetches anything, and one without a viewBox or a size is drawn four by three. The height follows the picture's proportions; a canvas caps out near 8192 pixels a side."
    />
  );
}
