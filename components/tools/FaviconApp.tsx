"use client";

import { useMemo, useState } from "react";

import { encodeCanvas, IMAGE_ACCEPT, rejectNonImage } from "@/lib/images/canvas";
import { centredCrop, drawCrop, FAVICON_PNGS, faviconSnippet, ICO_SIZES, icoFromPngs, isHexColour } from "@/lib/images/edit";
import { readPicture } from "@/lib/images/run";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("favicon");

const TILE = "tile";

interface FaviconSettings {
  /** What the iOS home-screen icon is painted onto, or null to keep it transparent. */
  iosBackground: string | null;
}

const DEFAULT_SETTINGS: FaviconSettings = { iosBackground: "#ffffff" };

function isFaviconSettings(value: unknown): value is FaviconSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FaviconSettings>;
  return candidate.iosBackground === null || (typeof candidate.iosBackground === "string" && isHexColour(candidate.iosBackground));
}

/** Every icon a site needs, from one picture. */
export function FaviconApp() {
  const [settings, setSettings] = useState<FaviconSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "favicon"), settings, setSettings, isFaviconSettings);

  const queue = useMemo<PlainQueueOptions<FaviconSettings>>(
    () => ({
      key: "favicon",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const rect = centredCrop({ width: image.width, height: image.height }, { width: 1, height: 1 });
          const pngAt = async (size: number, background: string | null = null) =>
            new Uint8Array(await (await encodeCanvas(drawCrop(image, rect, { width: size, height: size }, background), "image/png")).arrayBuffer());
          report("Drawing the ICO sizes...", 0.2);
          const icoEntries = [];
          for (const size of ICO_SIZES) icoEntries.push({ size, bytes: await pngAt(size) });
          const ico = icoFromPngs(icoEntries);
          report("Drawing the PNG sizes...", 0.6);
          const pngs = [];
          for (const entry of FAVICON_PNGS) pngs.push({ ...entry, bytes: await pngAt(entry.size, entry.flatten ? current.iosBackground : null) });
          const snippet = faviconSnippet();
          return {
            facts: [`${image.width}x${image.height}${rect.width !== image.width || rect.height !== image.height ? ", cropped square from the middle" : ""}`],
            outputs: [
              { label: "favicon.ico", fileName: "favicon.ico", blob: new Blob([ico as BlobPart], { type: "image/x-icon" }), kind: "file", note: `${ICO_SIZES.join(", ")} pixel entries` },
              ...pngs.map((entry) => ({
                label: entry.fileName,
                fileName: entry.fileName,
                blob: new Blob([entry.bytes as BlobPart], { type: "image/png" }),
                kind: "image" as const,
                note: `${entry.size}x${entry.size}, ${entry.purpose}${entry.flatten && current.iosBackground ? `, on ${current.iosBackground}` : ""}`,
              })),
              { label: "Lines for the page's head", fileName: "favicon-snippet.html", blob: new Blob([snippet], { type: "text/html" }), kind: "text", text: snippet },
            ],
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const background = settings.iosBackground;
  const preset = background === null ? "transparent" : background === "#ffffff" ? "#ffffff" : background === "#000000" ? "#000000" : TILE;

  const toolSettings: PlainSettings = {
    title: "The iOS icon's background",
    summary: () => (background === null ? "kept transparent" : background === "#ffffff" ? "white" : background === "#000000" ? "black" : background),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>apple-touch-icon.png</legend>
        <p className={styles.intro}>
          iOS puts a home-screen icon on its tile exactly as the file is, with nothing behind it, so a logo
          with a transparent background comes out on black. This one file is painted onto a colour; the
          favicon and the Android icons keep their transparency.
        </p>
        <RadioCards
          aria-label="The iOS icon's background"
          value={preset}
          onValueChange={(value) => setSettings({ iosBackground: value === "transparent" ? null : value === TILE ? "#4f46e5" : value })}
          options={[
            { value: "#ffffff", label: "White", blurb: "The usual choice, and what most app icons sit on" },
            { value: "#000000", label: "Black", blurb: "For a light mark that has to stay light" },
            { value: TILE, label: "A colour I pick", blurb: "Any colour, for a mark that needs its own" },
            { value: "transparent", label: "Keep it transparent", blurb: "iOS will show it on black" },
          ]}
          columns={2}
        />
        {preset === TILE && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Colour</span>
              <input type="color" value={background ?? "#4f46e5"} onChange={(event) => setSettings({ iosBackground: event.target.value })} className={styles.input} />
            </label>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      settings={toolSettings}
      lead="Drop a logo or any picture and get every icon a site needs: a favicon.ico with 16, 32 and 48 pixel entries, the 180 pixel icon iOS shows on the home screen, and the 192 and 512 pixel icons a web app manifest wants, with the lines to paste into your page. Nothing is uploaded."
      queue={queue}
      busyLabel="Drawing"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose an image", headline: "Drop a picture here", subhead: "A square is best; anything else is cropped square from the middle" }}
      note="The ICO holds PNG entries, which every browser and every Windows since 7 read; older Windows wanted bitmaps. Transparency is kept in the favicon and the Android icons; the iOS home-screen icon is painted onto the colour chosen above, because iOS composites nothing behind it. A picture with fine detail turns to mush at 16 pixels, as every favicon does; a simple mark at high contrast survives."
    />
  );
}
