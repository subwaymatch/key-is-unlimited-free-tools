"use client";

import { gunzipSync } from "fflate";
import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/format-utils";
import { cleanSvg, describeCleaning, SvgError, type SvgCleanOptions } from "@/lib/images/svgClean";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { XmlError } from "@/lib/text/xml";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("optimize-svg");

const MAX_BYTES = 50 * 1024 * 1024;

const PRECISIONS = [
  { value: "1", label: "1 decimal", blurb: "Smallest; fine for icons drawn on a large grid" },
  { value: "2", label: "2 decimals", blurb: "Small, and accurate for almost anything" },
  { value: "3", label: "3 decimals", blurb: "What SVGO does by default" },
  { value: "none", label: "As they are", blurb: "Numbers left alone" },
];

function isSvgOptions(value: unknown): value is SvgCleanOptions {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SvgCleanOptions>;
  return (candidate.precision === null || [1, 2, 3].includes(candidate.precision as number)) && typeof candidate.sanitize === "boolean" && typeof candidate.keepTitles === "boolean";
}

/** An SVG made smaller, and safe to put on a page. */
export function OptimizeSvgApp() {
  const [settings, setSettings] = useState<SvgCleanOptions>({ precision: 3, sanitize: true, keepTitles: true });
  useStoredSettings(storageKey("settings", "optimize-svg"), settings, setSettings, isSvgOptions);
  const ticked = (["sanitize", "keepTitles"] as const).filter((key) => settings[key]);

  const queue = useMemo<PlainQueueOptions<SvgCleanOptions>>(
    () => ({
      key: "optimize-svg",
      settings,
      preview: true,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there is no picture in it." } : file.size > MAX_BYTES ? { message: "This SVG is too large to clean in a browser tab.", hint: `This reads SVGs up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        // An .svgz is an SVG gzipped; it comes back as a plain SVG.
        const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
        const text = new TextDecoder().decode(gzipped ? gunzipSync(bytes) : bytes);
        let result;
        try {
          result = cleanSvg(text, current);
        } catch (error) {
          if (error instanceof XmlError) throw new PlainError("This SVG is not well-formed XML.", `Line ${error.line}, column ${error.column}: ${error.message}`);
          if (error instanceof SvgError) throw new PlainError("This is not an SVG.", error.message);
          throw error;
        }
        const blob = new Blob([result.svg], { type: "image/svg+xml" });
        const removed = describeCleaning(result.counts);
        const before = gzipped ? new Blob([text]).size : file.size;
        const saved = before - blob.size;
        if (saved <= 0 && removed.length === 0) return { outputs: [], nothing: { message: "This SVG is already as clean as this makes it.", hint: "Nothing to remove, and no smaller written this way." } };
        const notes: string[] = [];
        if (removed.length > 0) notes.push(`Removed: ${removed.join(", ")}.`);
        if (result.counts.scripts + result.counts.handlers > 0) notes.push("This SVG could run code when opened on its own; the copy cannot.");
        return {
          facts: [gzipped ? `gzipped, ${formatBytes(text.length)} unzipped` : `${formatBytes(file.size)} in`],
          notes,
          outputs: [{ label: "Optimised SVG", fileName: `${fileStem(file.name, "picture")}.min.svg`, blob, kind: "image", note: `${formatBytes(blob.size)}, ${saved > 0 ? `${Math.round((saved / before) * 100)}% smaller` : "no smaller"}${gzipped ? " than unzipped" : ""}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Numbers & safety",
    summary: () => `${settings.precision === null ? "numbers as they are" : `${settings.precision} ${settings.precision === 1 ? "decimal" : "decimals"}`}${settings.sanitize ? ", sanitised" : ""}${settings.keepTitles ? ", titles kept" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Round numbers to</legend>
          <RadioCards aria-label="Round numbers to" value={settings.precision === null ? "none" : String(settings.precision)} onValueChange={(value) => setSettings((previous) => ({ ...previous, precision: value === "none" ? null : Number(value) }))} options={PRECISIONS} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Also</legend>
          <CheckboxCards
            aria-label="Also"
            value={ticked}
            onValueChange={(next) => setSettings((previous) => ({ ...previous, sanitize: next.includes("sanitize"), keepTitles: next.includes("keepTitles") }))}
            options={[
              { value: "sanitize", label: "Remove anything that can run", blurb: "Scripts, onload and other handlers, javascript: links, embedded HTML" },
              { value: "keepTitles", label: "Keep the title and description", blurb: "What a screen reader says about the picture" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an SVG from Illustrator, Inkscape, Figma or Sketch and get it back smaller: the editor's own data, metadata and comments taken out, numbers rounded, whitespace gone, and anything that could run code removed so it is safe to put on a page. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Optimising"
      dropZone={{ accept: ".svg,.svgz,image/svg+xml", inputLabel: "Choose SVG files", headline: "Drop SVG files here", subhead: "Optimised as they land" }}
      note="What goes is what a drawing program keeps for itself - Inkscape's and Illustrator's namespaces, metadata, comments - and ids nothing refers to; an SVG with a stylesheet keeps its ids, since the stylesheet may use them. Text keeps its spaces. Rounding to three decimals is invisible at any size a screen shows; one decimal suits icons. Check the result where it will be used before replacing the original."
    />
  );
}
