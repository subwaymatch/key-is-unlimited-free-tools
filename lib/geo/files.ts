/**
 * What the GPS pages share: taking a file, reading it, and saying what is
 * in it on a card.
 */
import { formatDuration } from "../format-utils";
import { PlainError, type FileRejection } from "../plainQueue";
import { XmlError } from "../text/xml";
import { describeDistance, GeoError, geoStats, readGeo, type GeoData, type GeoFormat } from "./gps";

export const GPS_ACCEPT = ".gpx,.kml,.geojson,.json,.tcx,.csv,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json";

/** Past this a track is not a track. */
const MAX_BYTES = 256 * 1024 * 1024;

export function rejectNonGps(file: File): FileRejection | null {
  if (file.size === 0) return { message: "This file is empty.", hint: "It is 0 bytes, so there is no track in it." };
  if (file.size > MAX_BYTES) return { message: "This file is too large to read in a browser tab.", hint: "This reads GPS files up to 256 MB." };
  if (file.name.toLowerCase().endsWith(".kmz")) return { message: "This is a KMZ, a zipped KML.", hint: "Unzip it with Extract ZIP and drop the doc.kml inside." };
  if (file.name.toLowerCase().endsWith(".fit")) return { message: "This is a Garmin FIT file, which is binary.", hint: "Export the activity as GPX or TCX from Garmin Connect or Strava instead." };
  return null;
}

export async function readGpsFile(file: File): Promise<{ data: GeoData; format: GeoFormat }> {
  const text = new TextDecoder("utf-8").decode(new Uint8Array(await file.arrayBuffer()));
  try {
    return readGeo(text, file.name);
  } catch (error) {
    if (error instanceof GeoError) throw new PlainError("This file could not be read as GPS data.", error.message);
    if (error instanceof XmlError) throw new PlainError("This file is not well-formed XML.", `Line ${error.line}, column ${error.column}: ${error.message}`);
    if (error instanceof SyntaxError) throw new PlainError("This file is not valid JSON.", error.message);
    throw error;
  }
}

export function gpsFacts(data: GeoData, format: GeoFormat): string[] {
  const stats = geoStats(data);
  const facts = [format === "geojson" ? "GeoJSON" : format.toUpperCase()];
  if (data.name) facts.push(`Name: ${data.name}`);
  if (stats.tracks > 0) facts.push(`Tracks: ${stats.tracks}, ${stats.points.toLocaleString("en")} points, ${describeDistance(stats.metres)}`);
  if (stats.climb > 0 || stats.descent > 0) facts.push(`Climb: ${Math.round(stats.climb)} m up, ${Math.round(stats.descent)} m down`);
  if (stats.seconds !== null) facts.push(`Time: ${formatDuration(stats.seconds)}`);
  if (stats.waypoints > 0) facts.push(`Waypoints: ${stats.waypoints}`);
  if (stats.polygons > 0) facts.push(`Areas: ${stats.polygons}`);
  return facts;
}

export function isEmpty(data: GeoData): boolean {
  return data.tracks.length === 0 && data.waypoints.length === 0 && data.polygons.length === 0;
}
