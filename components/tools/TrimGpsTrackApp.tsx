"use client";

import { useMemo, useState } from "react";

import { gpsFacts, GPS_ACCEPT, isEmpty, readGpsFile, rejectNonGps } from "@/lib/geo/files";
import { hideEnds, OUTPUT_FORMATS, parsePlaces, writeGeo } from "@/lib/geo/gps";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("trim-gps-track");

const RADII = [
  { value: 200, label: "200 m", blurb: "A city street" },
  { value: 500, label: "500 m", blurb: "A neighbourhood; what Strava suggests" },
  { value: 1000, label: "1 km", blurb: "Somewhere rural" },
];

interface TrimSettings {
  radius: number;
  vary: boolean;
  places: string;
  dropTimes: boolean;
  dropElevation: boolean;
}

function isTrimSettings(value: unknown): value is TrimSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TrimSettings>;
  return RADII.some((radius) => radius.value === candidate.radius) && typeof candidate.vary === "boolean" && typeof candidate.places === "string" && typeof candidate.dropTimes === "boolean" && typeof candidate.dropElevation === "boolean";
}

/** A GPS track with its ends cut off, so sharing it does not share a home address. */
export function TrimGpsTrackApp() {
  const [settings, setSettings] = useState<TrimSettings>({ radius: 500, vary: true, places: "", dropTimes: false, dropElevation: false });
  useStoredSettings(storageKey("settings", "trim-gps-track"), settings, setSettings, isTrimSettings);
  const places = parsePlaces(settings.places);
  const extras = (["vary", "dropTimes", "dropElevation"] as const).filter((key) => settings[key]);

  const queue = useMemo<PlainQueueOptions<TrimSettings>>(
    () => ({
      key: "trim-gps-track",
      settings,
      reject: rejectNonGps,
      run: async (file, current, report) => {
        report("Reading...", null);
        const { data, format } = await readGpsFile(file);
        const facts = gpsFacts(data, format);
        if (isEmpty(data)) return { facts, outputs: [], nothing: { message: "No tracks or places were found in this file.", hint: "It reads as the right format but holds no points with a latitude and longitude." } };
        report("Trimming...", null);
        const result = hideEnds(data, { radius: current.radius, vary: current.vary, places: parsePlaces(current.places).places, dropTimes: current.dropTimes, dropElevation: current.dropElevation });
        const target = format === "tcx" ? "gpx" : format;
        const spec = OUTPUT_FORMATS.find((entry) => entry.id === target)!;
        const notes = [`${result.removedPoints.toLocaleString("en")} ${result.removedPoints === 1 ? "point" : "points"}${result.removedWaypoints > 0 ? ` and ${result.removedWaypoints} ${result.removedWaypoints === 1 ? "waypoint" : "waypoints"}` : ""} removed within ${current.radius} m${current.vary ? " or a little more" : ""} of where each track starts and ends${parsePlaces(current.places).places.length > 0 ? " and of the places named" : ""}.`];
        if (format === "tcx") notes.push("A TCX comes back as GPX, without its heart rate, cadence and laps.");
        if (result.data.tracks.length === 0 && result.data.waypoints.length === 0) notes.push("Nothing was left: the whole track is inside the circles. Try a smaller radius.");
        const text = writeGeo(result.data, target);
        return {
          facts,
          notes,
          outputs: [{ label: `Trimmed ${spec.label}`, fileName: `${fileStem(file.name, "track")}-trimmed.${spec.extension}`, blob: new Blob([text], { type: `${spec.mime};charset=utf-8` }), kind: "file", note: [current.dropTimes ? "no times" : "", current.dropElevation ? "no heights" : ""].filter(Boolean).join(", ") || "Times and heights kept" }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "What to hide",
    defaultOpen: true,
    invalid: () => (places.bad.length > 0 ? `Not a latitude and longitude: ${places.bad[0]}. Write places as 51.5007, -0.1246, one to a line.` : null),
    summary: () => `${settings.radius} m around the ends${places.places.length > 0 ? ` and ${places.places.length} ${places.places.length === 1 ? "place" : "places"}` : ""}${settings.dropTimes ? ", times removed" : ""}${settings.dropElevation ? ", heights removed" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Hide within</legend>
          <RadioCards aria-label="Hide within" value={String(settings.radius)} onValueChange={(value) => setSettings((previous) => ({ ...previous, radius: Number(value) }))} options={RADII.map((radius) => ({ value: String(radius.value), label: radius.label, blurb: radius.blurb }))} columns={3} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Also hide around (optional)</legend>
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Places, as latitude, longitude, one to a line</span>
              <textarea value={settings.places} rows={2} placeholder="51.5007, -0.1246" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, places: event.target.value }))} className={styles.textarea} aria-invalid={places.bad.length > 0} />
            </label>
            <p className={styles.panelNote}>A workplace or a school a route passes, for instance. A map app gives a place&apos;s coordinates when you press and hold on it.</p>
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>And</legend>
          <CheckboxCards
            aria-label="And"
            value={extras}
            onValueChange={(next) => setSettings((previous) => ({ ...previous, vary: next.includes("vary"), dropTimes: next.includes("dropTimes"), dropElevation: next.includes("dropElevation") }))}
            options={[
              { value: "vary", label: "Vary the circle a little", blurb: "Up to a quarter wider on each file, so many tracks do not all end on one circle around your door" },
              { value: "dropTimes", label: "Remove the times", blurb: "When you were where, and so when you are usually out" },
              { value: "dropElevation", label: "Remove the heights", blurb: "Rarely identifying, but not needed to share a route" },
            ]}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a GPX, KML, GeoJSON or TCX track before sharing it and get it back with the start and the end cut off, so a run, a ride or a walk does not show where you live. Nothing is uploaded, which is rather the point."
      queue={queue}
      settings={toolSettings}
      busyLabel="Trimming"
      dropZone={{ accept: GPS_ACCEPT, inputLabel: "Choose GPS files", headline: "Drop GPX, KML, GeoJSON or TCX files here", subhead: "Trimmed as they land" }}
      note="Every point inside a circle around where each track starts and ends is removed, the way Strava's privacy zones work; a track that passes back through a circle is split there rather than joined across it, and waypoints inside one go too. The file comes back in its own format. Photos taken along the way carry their own location: Remove image metadata takes that out."
    />
  );
}
