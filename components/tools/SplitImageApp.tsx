"use client";

import { useMemo, useState } from "react";

import { describeSize, encodeCanvas, IMAGE_ACCEPT, MIME_LABELS, mayHaveTransparency, QUALITY_PRESETS, rejectNonImage, sameFormatMime } from "@/lib/images/canvas";
import { pictureName, readPicture } from "@/lib/images/run";
import { drawTile, MAX_TILES_PER_SIDE, TILE_PRESETS, tilePlan, tileSuffix } from "@/lib/images/shape";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("split-image");

interface TileSettings {
  preset: string;
  rows: number;
  columns: number;
  square: boolean;
}

const DEFAULT_SETTINGS: TileSettings = { preset: "3x3", rows: 2, columns: 2, square: true };

function isTileSettings(value: unknown): value is TileSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TileSettings>;
  return TILE_PRESETS.some((preset) => preset.id === candidate.preset) && typeof candidate.rows === "number" && typeof candidate.columns === "number" && typeof candidate.square === "boolean";
}

function gridOf(settings: TileSettings): { rows: number; columns: number } {
  const preset = TILE_PRESETS.find((entry) => entry.id === settings.preset);
  if (preset && preset.id !== "custom") return { rows: preset.rows, columns: preset.columns };
  return { rows: settings.rows, columns: settings.columns };
}

function clampSide(value: string): number {
  return Math.max(1, Math.min(MAX_TILES_PER_SIDE, Math.round(Number(value)) || 1));
}

/** A picture cut into a grid of tiles. */
export function SplitImageApp() {
  const [settings, setSettings] = useState<TileSettings>(DEFAULT_SETTINGS);
  useStoredSettings(storageKey("settings", "split-image"), settings, setSettings, isTileSettings);

  const grid = gridOf(settings);

  const queue = useMemo<PlainQueueOptions<TileSettings>>(
    () => ({
      key: "split-image",
      settings,
      reject: rejectNonImage,
      preview: true,
      run: async (file, current, report) => {
        report("Decoding...", null);
        const image = await readPicture(file);
        try {
          const source = { width: image.width, height: image.height };
          const { rows, columns } = gridOf(current);
          const plan = tilePlan(source, rows, columns, current.square);
          const mime = sameFormatMime(file);
          const background = mime === "image/jpeg" && mayHaveTransparency(file) ? "#ffffff" : null;
          const outputs = [];
          for (const [index, tile] of plan.tiles.entries()) {
            report(`Cutting tile ${index + 1} of ${plan.tiles.length}...`, index / plan.tiles.length);
            const canvas = drawTile(image, tile, background);
            const blob = await encodeCanvas(canvas, mime, mime === "image/png" ? undefined : QUALITY_PRESETS[0].quality);
            outputs.push({ label: plan.rows === 1 ? `Tile ${tile.column + 1}` : plan.columns === 1 ? `Tile ${tile.row + 1}` : `Row ${tile.row + 1}, column ${tile.column + 1}`, fileName: pictureName(file, mime, tileSuffix(tile, plan)), blob, kind: "image" as const, note: describeSize(tile) });
          }
          const cropped = plan.crop.width !== source.width || plan.crop.height !== source.height;
          return {
            facts: [describeSize(source), `${plan.rows} x ${plan.columns}: ${plan.tiles.length} tiles of ${MIME_LABELS[mime]}`],
            notes: cropped ? [`The picture was first cropped to ${describeSize(plan.crop)} about its centre so every tile is square.`] : [],
            outputs,
          };
        } finally {
          image.close();
        }
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Grid",
    defaultOpen: true,
    summary: () => `${grid.rows} x ${grid.columns}${settings.square ? ", square tiles" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Grid</legend>
          <RadioCards aria-label="Grid" value={settings.preset} onValueChange={(preset) => setSettings((previous) => ({ ...previous, preset }))} options={TILE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label, blurb: preset.blurb }))} />
          {settings.preset === "custom" && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Rows</span>
                <input type="number" inputMode="numeric" min={1} max={MAX_TILES_PER_SIDE} step="1" value={settings.rows} onChange={(event) => setSettings((previous) => ({ ...previous, rows: clampSide(event.target.value) }))} className={styles.input} style={{ width: "6rem" }} />
              </label>{" "}
              <label>
                <span className={styles.fieldLabel}>Columns</span>
                <input type="number" inputMode="numeric" min={1} max={MAX_TILES_PER_SIDE} step="1" value={settings.columns} onChange={(event) => setSettings((previous) => ({ ...previous, columns: clampSide(event.target.value) }))} className={styles.input} style={{ width: "6rem" }} />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Tile shape</legend>
          <RadioCards
            aria-label="Tile shape"
            value={settings.square ? "square" : "any"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, square: value === "square" }))}
            options={[
              { value: "square", label: "Square tiles", blurb: "The picture is cropped about its centre first, as a profile grid wants" },
              { value: "any", label: "Whatever the picture gives", blurb: "Nothing cropped; tiles the shape of the picture's share" },
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
      lead="Drop a picture and get it back cut into tiles - nine squares for a profile grid, three across for a carousel, halves, quarters or any grid you type - numbered so they post or print in order. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Cutting"
      dropZone={{ accept: IMAGE_ACCEPT, inputLabel: "Choose image files", headline: "Drop image files here", subhead: `Cut ${grid.rows} x ${grid.columns} as they land - choose the grid above` }}
      note="Tiles are named by row and column, top left first, so a 3 x 3 grid posts in order from the last tile to the first on a feed that shows newest first. Every pixel lands in exactly one tile; when the picture does not divide evenly the last row or column is a pixel larger. Tiles come out in the picture's own format, drawn afresh by the canvas, without the source's metadata. Download all as a ZIP saves the set at once."
    />
  );
}
