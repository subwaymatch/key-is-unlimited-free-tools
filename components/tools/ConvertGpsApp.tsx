"use client";

import { useMemo, useState } from "react";

import { gpsFacts, GPS_ACCEPT, isEmpty, readGpsFile, rejectNonGps } from "@/lib/geo/files";
import { OUTPUT_FORMATS, writeGeo, type GeoFormat } from "@/lib/geo/gps";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainOutputSpec, PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("convert-gps");

type OutputFormat = Exclude<GeoFormat, "tcx">;

interface ConvertSettings {
  formats: OutputFormat[];
}

function isConvertSettings(value: unknown): value is ConvertSettings {
  if (typeof value !== "object" || value === null) return false;
  const formats = (value as Partial<ConvertSettings>).formats;
  return Array.isArray(formats) && formats.every((format) => OUTPUT_FORMATS.some((entry) => entry.id === format));
}

/** GPS files turned into each other: GPX, KML, GeoJSON, TCX and CSV. */
export function ConvertGpsApp() {
  const [settings, setSettings] = useState<ConvertSettings>({ formats: ["gpx", "kml", "geojson"] });
  useStoredSettings(storageKey("settings", "convert-gps"), settings, setSettings, isConvertSettings);

  const queue = useMemo<PlainQueueOptions<ConvertSettings>>(
    () => ({
      key: "convert-gps",
      settings,
      reject: rejectNonGps,
      run: async (file, current, report) => {
        report("Reading...", null);
        const { data, format } = await readGpsFile(file);
        const facts = gpsFacts(data, format);
        if (isEmpty(data)) return { facts, outputs: [], nothing: { message: "No tracks, routes or places were found in this file.", hint: "It reads as the right format but holds no points with a latitude and longitude." } };
        const wanted = current.formats.filter((entry) => entry !== format);
        if (wanted.length === 0) return { facts, outputs: [], nothing: { message: `This file is already ${format.toUpperCase()}.`, hint: "Tick another format in the settings above." } };
        const outputs: PlainOutputSpec[] = wanted.map((entry) => {
          const spec = OUTPUT_FORMATS.find((option) => option.id === entry)!;
          const text = writeGeo(data, entry);
          return { label: spec.label, fileName: `${fileStem(file.name, "track")}.${spec.extension}`, blob: new Blob([text], { type: `${spec.mime};charset=utf-8` }), kind: "file", note: spec.blurb };
        });
        const notes: string[] = [];
        if (format === "tcx") notes.push("Heart rate, cadence, power and laps are Garmin's own and have no place in the other formats; the track, its heights and its times come across.");
        if (data.polygons.length > 0 && wanted.includes("gpx")) notes.push("GPX has no areas, so each area is written as a closed track.");
        return { facts, notes, outputs };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Convert to",
    defaultOpen: true,
    invalid: () => (settings.formats.length === 0 ? "Tick at least one format." : null),
    summary: () => settings.formats.map((format) => OUTPUT_FORMATS.find((entry) => entry.id === format)?.label).join(", "),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Formats</legend>
        <CheckboxCards aria-label="Formats" value={settings.formats} onValueChange={(next) => setSettings({ formats: OUTPUT_FORMATS.map((entry) => entry.id).filter((id) => next.includes(id)) })} options={OUTPUT_FORMATS.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a GPX, KML, GeoJSON, TCX or CSV file and get it back in the others: a Strava ride for Google Earth, a My Maps export for a GPS watch, a track for a web map, every point in a spreadsheet. Distance, climb and time are on the card. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: GPS_ACCEPT, inputLabel: "Choose GPS files", headline: "Drop GPX, KML, GeoJSON, TCX or CSV files here", subhead: "Converted as they land" }}
      note="Tracks, routes, waypoints and areas come across with their names, heights and times. A CSV is read by its column names - lat and lon, or latitude and longitude, with ele and time if there are any. Climb counts a rise only once it passes 3 metres, so the jitter in a GPS's heights is not added up; distance is along the ground between points."
    />
  );
}
