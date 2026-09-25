"use client";

import { useMemo, useState } from "react";

import { formatDuration } from "@/lib/format-utils";
import { GPS_ACCEPT, gpsFacts, isEmpty, readGpsFile, rejectNonGps } from "@/lib/geo/files";
import { describeDistance, geoStats, mergeGeo, OUTPUT_FORMATS, writeGeo, type GeoFormat, type MergeMode } from "@/lib/geo/gps";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type CombineOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("merge-gps");

type Output = Exclude<GeoFormat, "tcx">;

interface MergeSettings {
  mode: MergeMode;
  format: Output;
}

const MODES: { value: MergeMode; label: string; blurb: string }[] = [
  { value: "join", label: "One track", blurb: "The legs of a trip joined, in the order they were ridden or walked" },
  { value: "separate", label: "Each its own track", blurb: "Several routes in one file, for a map or a device" },
];

function isSettings(value: unknown): value is MergeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MergeSettings>;
  return MODES.some((mode) => mode.value === candidate.mode) && OUTPUT_FORMATS.some((format) => format.id === candidate.format);
}

/** Several GPS files as one: the legs of a trip joined, or routes gathered. */
export function MergeGpsApp() {
  const [settings, setSettings] = useState<MergeSettings>({ mode: "join", format: "gpx" });
  useStoredSettings(storageKey("settings", "merge-gps"), settings, setSettings, isSettings);

  const queue = useMemo<CombineOptions<MergeSettings>>(
    () => ({
      key: "merge-gps",
      settings,
      reject: rejectNonGps,
      inspect: async (file) => {
        const { data, format } = await readGpsFile(file);
        return { facts: gpsFacts(data, format).slice(0, 2) };
      },
      run: async (files, current, report) => {
        const inputs = [];
        for (const [index, file] of files.entries()) {
          report(`Reading ${file.name} (${index + 1} of ${files.length})...`, index / files.length);
          const { data } = await readGpsFile(file);
          if (isEmpty(data)) throw new PlainError(`${file.name} has no tracks, waypoints or areas in it.`, "Remove it from the list and merge the rest.");
          inputs.push({ data, name: fileStem(file.name, "track") });
        }
        report("Merging...", null);
        const merged = mergeGeo(inputs, current.mode);
        const format = OUTPUT_FORMATS.find((entry) => entry.id === current.format)!;
        const text = writeGeo(merged, current.format);
        const stats = geoStats(merged);
        const joinedByTime = current.mode === "join" && merged.tracks[0]?.segments.every((segment) => segment[0]?.time);
        const notes = [`${stats.tracks} ${stats.tracks === 1 ? "track" : "tracks"}, ${stats.points.toLocaleString("en")} points, ${describeDistance(stats.metres)}${stats.seconds !== null ? `, ${formatDuration(stats.seconds)} from first point to last` : ""}${stats.waypoints > 0 ? `, ${stats.waypoints} waypoints` : ""}.`];
        if (current.mode === "join" && inputs.reduce((sum, input) => sum + input.data.tracks.length, 0) > 1) {
          notes.push(joinedByTime ? "The legs are in time order, each kept as a segment of its own so no straight line is drawn across the gap between them." : "Not every leg has times, so they are joined in the order the files were added; move the files up or down to reorder them.");
        }
        return {
          notes,
          outputs: [{ label: `Merged ${format.label}`, fileName: `${fileStem(files[0].name, "track")}-merged.${format.extension}`, blob: new Blob([text], { type: `${format.mime};charset=utf-8` }), kind: "file", note: `${files.length} files merged` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Merge & format",
    summary: () => `${MODES.find((mode) => mode.value === settings.mode)?.label.toLowerCase()}, as ${OUTPUT_FORMATS.find((format) => format.id === settings.format)?.label}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Tracks</legend>
          <RadioCards aria-label="Tracks" value={settings.mode} onValueChange={(mode) => setSettings((previous) => ({ ...previous, mode }))} options={MODES} columns={2} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Save as</legend>
          <RadioCards aria-label="Save as" value={settings.format} onValueChange={(format) => setSettings((previous) => ({ ...previous, format }))} options={OUTPUT_FORMATS.map((format) => ({ value: format.id, label: format.label, blurb: format.blurb }))} columns={2} />
        </fieldset>
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop the GPX, KML, GeoJSON, TCX or CSV files of a trip - the days of a tour, the legs of a ride, a watch that stopped and started - and get one file: joined into a single track in time order, or kept as separate tracks side by side. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Merge the files"
      minFiles={2}
      noun="files"
      busyLabel="Merging"
      summary={(files) => (files.length >= 2 ? `${files.length} files to merge.` : null)}
      dropZone={{ accept: GPS_ACCEPT, inputLabel: "Choose GPS files", headline: "Drop GPS files here", subhead: "GPX, KML, GeoJSON, TCX and CSV, mixed freely" }}
      note="Joined tracks keep each leg as a segment, the way GPX and GeoJSON mean a gap in recording, so maps and devices do not draw a straight line from where one leg ended to where the next began. Legs with times are put in time order whatever order the files were added in. Waypoints from every file are gathered, one kept where several files mark the same place with the same name."
    />
  );
}
