/**
 * GPS tracks, routes and places read from GPX, KML, GeoJSON, TCX and CSV,
 * and written back as any of them but TCX.
 *
 * Every format is read into one model - tracks of segments of points, with
 * an elevation and a time where the file has them, waypoints, and polygons
 * - and written out from it. GPX is what devices and Strava export, KML is
 * Google Earth's, GeoJSON is what web maps and GIS tools read, TCX is
 * Garmin's training format and CSV is a spreadsheet's. Heart rate, cadence
 * and the other sensor extensions have no place in the model and are not
 * carried across.
 */
import { CsvParser, csvLine, detectDelimiter } from "../data/csv";
import { attribute, child, children, descendants, escapeText, localName, parseXml, textContent, type XmlElement } from "../text/xml";

export interface GeoPoint {
  lat: number;
  lon: number;
  ele: number | null;
  /** ISO 8601, as the file wrote it. */
  time: string | null;
}

export interface GeoTrack {
  name: string | null;
  kind: "track" | "route";
  segments: GeoPoint[][];
}

export interface GeoWaypoint {
  point: GeoPoint;
  name: string | null;
  description: string | null;
}

export interface GeoPolygon {
  name: string | null;
  rings: GeoPoint[][];
}

export interface GeoData {
  name: string | null;
  tracks: GeoTrack[];
  waypoints: GeoWaypoint[];
  polygons: GeoPolygon[];
}

export type GeoFormat = "gpx" | "kml" | "geojson" | "tcx" | "csv";

export const OUTPUT_FORMATS: readonly { id: Exclude<GeoFormat, "tcx">; label: string; blurb: string; extension: string; mime: string }[] = [
  { id: "gpx", label: "GPX", blurb: "Garmin, Strava, Komoot, OsmAnd and most devices", extension: "gpx", mime: "application/gpx+xml" },
  { id: "kml", label: "KML", blurb: "Google Earth and Google My Maps", extension: "kml", mime: "application/vnd.google-earth.kml+xml" },
  { id: "geojson", label: "GeoJSON", blurb: "Web maps, QGIS and geojson.io", extension: "geojson", mime: "application/geo+json" },
  { id: "csv", label: "CSV", blurb: "One row per point, for a spreadsheet", extension: "csv", mime: "text/csv" },
];

export class GeoError extends Error {}

function number(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text.trim() === "") return null;
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : null;
}

function validPoint(lat: number | null, lon: number | null): boolean {
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function elementText(element: XmlElement, name: string): string | null {
  const found = child(element, name);
  const text = found ? textContent(found).trim() : "";
  return text === "" ? null : text;
}

/* ---- Reading ------------------------------------------------------------- */

function gpxPoint(element: XmlElement): GeoPoint | null {
  const lat = number(attribute(element, "lat"));
  const lon = number(attribute(element, "lon"));
  if (!validPoint(lat, lon)) return null;
  return { lat: lat!, lon: lon!, ele: number(elementText(element, "ele")), time: elementText(element, "time") };
}

export function readGpx(root: XmlElement): GeoData {
  const metadata = child(root, "metadata");
  const data: GeoData = { name: (metadata && elementText(metadata, "name")) ?? elementText(root, "name"), tracks: [], waypoints: [], polygons: [] };
  for (const waypoint of children(root, "wpt")) {
    const point = gpxPoint(waypoint);
    if (point) data.waypoints.push({ point, name: elementText(waypoint, "name"), description: elementText(waypoint, "desc") });
  }
  for (const route of children(root, "rte")) {
    const points = children(route, "rtept").map(gpxPoint).filter((point): point is GeoPoint => point !== null);
    data.tracks.push({ name: elementText(route, "name"), kind: "route", segments: [points] });
  }
  for (const track of children(root, "trk")) {
    const segments = children(track, "trkseg").map((segment) => children(segment, "trkpt").map(gpxPoint).filter((point): point is GeoPoint => point !== null));
    data.tracks.push({ name: elementText(track, "name"), kind: "track", segments: segments.filter((segment) => segment.length > 0) });
  }
  return data;
}

/** KML's "lon,lat[,alt]" tuples, separated by whitespace. */
function kmlCoordinates(text: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    const [lon, lat, ele] = tuple.split(",").map((part) => number(part));
    if (validPoint(lat ?? null, lon ?? null)) points.push({ lat: lat!, lon: lon!, ele: ele ?? null, time: null });
  }
  return points;
}

export function readKml(root: XmlElement): GeoData {
  const documentElement = descendants(root, "Document")[0] ?? root;
  const data: GeoData = { name: elementText(documentElement, "name"), tracks: [], waypoints: [], polygons: [] };
  for (const placemark of descendants(root, "Placemark")) {
    const name = elementText(placemark, "name");
    const description = elementText(placemark, "description");
    for (const point of descendants(placemark, "Point")) {
      const coordinates = child(point, "coordinates");
      const [first] = coordinates ? kmlCoordinates(textContent(coordinates)) : [];
      if (first) data.waypoints.push({ point: first, name, description });
    }
    const segments: GeoPoint[][] = [];
    for (const line of descendants(placemark, "LineString")) {
      const coordinates = child(line, "coordinates");
      if (coordinates) segments.push(kmlCoordinates(textContent(coordinates)));
    }
    for (const track of descendants(placemark, "Track")) {
      const whens = children(track, "when").map((entry) => textContent(entry).trim());
      const coords = children(track, "coord").map((entry) => textContent(entry).trim().split(/\s+/).map((part) => number(part)));
      const points: GeoPoint[] = [];
      coords.forEach(([lon, lat, ele], index) => {
        if (validPoint(lat ?? null, lon ?? null)) points.push({ lat: lat!, lon: lon!, ele: ele ?? null, time: whens[index] || null });
      });
      segments.push(points);
    }
    const kept = segments.filter((segment) => segment.length > 0);
    if (kept.length > 0) data.tracks.push({ name, kind: "track", segments: kept });
    for (const polygon of descendants(placemark, "Polygon")) {
      const rings: GeoPoint[][] = [];
      for (const boundary of [...children(polygon, "outerBoundaryIs"), ...children(polygon, "innerBoundaryIs")]) {
        const coordinates = descendants(boundary, "coordinates")[0];
        if (coordinates) rings.push(kmlCoordinates(textContent(coordinates)));
      }
      if (rings.length > 0) data.polygons.push({ name, rings });
    }
  }
  return data;
}

export function readTcx(root: XmlElement): GeoData {
  const data: GeoData = { name: null, tracks: [], waypoints: [], polygons: [] };
  const containers = [...descendants(root, "Activity"), ...descendants(root, "Course")];
  for (const container of containers) {
    const name = elementText(container, "Id") ?? elementText(container, "Name") ?? elementText(container, "Notes");
    const segments: GeoPoint[][] = [];
    for (const track of descendants(container, "Track")) {
      const points: GeoPoint[] = [];
      for (const trackpoint of children(track, "Trackpoint")) {
        const position = child(trackpoint, "Position");
        const lat = position ? number(elementText(position, "LatitudeDegrees")) : null;
        const lon = position ? number(elementText(position, "LongitudeDegrees")) : null;
        if (validPoint(lat, lon)) points.push({ lat: lat!, lon: lon!, ele: number(elementText(trackpoint, "AltitudeMeters")), time: elementText(trackpoint, "Time") });
      }
      if (points.length > 0) segments.push(points);
    }
    if (segments.length > 0) data.tracks.push({ name, kind: "track", segments });
  }
  return data;
}

function geoJsonPosition(position: unknown, time: string | null = null): GeoPoint | null {
  if (!Array.isArray(position) || position.length < 2) return null;
  const [lon, lat, ele] = position as unknown[];
  if (typeof lon !== "number" || typeof lat !== "number" || !validPoint(lat, lon)) return null;
  return { lat, lon, ele: typeof ele === "number" ? ele : null, time };
}

function positions(list: unknown, times?: unknown): GeoPoint[] {
  if (!Array.isArray(list)) return [];
  const stamps = Array.isArray(times) ? times : [];
  return list.map((position, index) => geoJsonPosition(position, typeof stamps[index] === "string" ? (stamps[index] as string) : null)).filter((point): point is GeoPoint => point !== null);
}

export function readGeoJson(value: unknown): GeoData {
  const data: GeoData = { name: null, tracks: [], waypoints: [], polygons: [] };
  const features: { geometry: unknown; properties: Record<string, unknown> }[] = [];
  const collect = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    const object = entry as Record<string, unknown>;
    if (object.type === "FeatureCollection" && Array.isArray(object.features)) {
      if (typeof object.name === "string") data.name = object.name;
      for (const feature of object.features) collect(feature);
    } else if (object.type === "Feature") features.push({ geometry: object.geometry, properties: (object.properties as Record<string, unknown>) ?? {} });
    else if (typeof object.type === "string") features.push({ geometry: object, properties: {} });
  };
  collect(value);
  if (features.length === 0) throw new GeoError("This JSON is not GeoJSON: it has no features or geometry.");
  for (const { geometry, properties } of features) {
    const name = typeof properties.name === "string" ? properties.name : typeof properties.title === "string" ? properties.title : null;
    const description = typeof properties.description === "string" ? properties.description : typeof properties.desc === "string" ? properties.desc : null;
    const times = properties.coordTimes ?? properties.times;
    const add = (shape: unknown) => {
      if (!shape || typeof shape !== "object") return;
      const { type, coordinates, geometries } = shape as { type?: string; coordinates?: unknown; geometries?: unknown };
      if (type === "Point") {
        const point = geoJsonPosition(coordinates, typeof properties.time === "string" ? properties.time : null);
        if (point) data.waypoints.push({ point, name, description });
      } else if (type === "MultiPoint" && Array.isArray(coordinates)) {
        for (const point of positions(coordinates)) data.waypoints.push({ point, name, description });
      } else if (type === "LineString") {
        data.tracks.push({ name, kind: "track", segments: [positions(coordinates, times)] });
      } else if (type === "MultiLineString" && Array.isArray(coordinates)) {
        data.tracks.push({ name, kind: "track", segments: coordinates.map((line, index) => positions(line, Array.isArray(times) ? times[index] : undefined)).filter((segment) => segment.length > 0) });
      } else if (type === "Polygon" && Array.isArray(coordinates)) {
        data.polygons.push({ name, rings: coordinates.map((ring) => positions(ring)) });
      } else if (type === "MultiPolygon" && Array.isArray(coordinates)) {
        for (const polygon of coordinates) if (Array.isArray(polygon)) data.polygons.push({ name, rings: polygon.map((ring) => positions(ring)) });
      } else if (type === "GeometryCollection" && Array.isArray(geometries)) {
        for (const part of geometries) add(part);
      }
    };
    add(geometry);
  }
  return data;
}

/** Points from a CSV with latitude and longitude columns, found by name. */
export function readGeoCsv(text: string): GeoData {
  const parser = new CsvParser(detectDelimiter(text.slice(0, 64 * 1024)));
  const rows = [...parser.push(text), ...parser.end()];
  const header = (rows[0] ?? []).map((name) => name.trim().toLowerCase());
  const find = (names: string[]) => header.findIndex((name) => names.includes(name));
  const lat = find(["lat", "latitude", "y"]);
  const lon = find(["lon", "lng", "long", "longitude", "x"]);
  if (lat < 0 || lon < 0) throw new GeoError("The CSV has no latitude and longitude columns. Name them lat and lon, or latitude and longitude.");
  const ele = find(["ele", "elevation", "alt", "altitude", "z"]);
  const time = find(["time", "timestamp", "datetime", "date"]);
  const name = find(["name", "title", "label"]);
  const segment = find(["segment", "track", "trip"]);
  // The type column this module's own CSV carries: waypoint, track or route.
  const type = find(["type", "kind"]);
  const data: GeoData = { name: null, tracks: [], waypoints: [], polygons: [] };
  const tracks = new Map<string, { track: GeoTrack; segments: Map<string, GeoPoint[]> }>();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const y = number(row[lat]);
    const x = number(row[lon]);
    if (!validPoint(y, x)) continue;
    const point: GeoPoint = { lat: y!, lon: x!, ele: ele >= 0 ? number(row[ele]) : null, time: time >= 0 ? row[time]?.trim() || null : null };
    const label = name >= 0 ? row[name]?.trim() || null : null;
    const kind = type >= 0 ? (row[type] ?? "").trim().toLowerCase() : "";
    if (kind === "waypoint" || (type < 0 && label && segment < 0)) {
      data.waypoints.push({ point, name: label, description: null });
      continue;
    }
    const trackKey = type >= 0 ? `${kind}\u0000${label ?? ""}` : segment >= 0 ? (row[segment] ?? "") : "";
    let entry = tracks.get(trackKey);
    if (!entry) {
      entry = { track: { name: type >= 0 ? label : trackKey || null, kind: kind === "route" ? "route" : "track", segments: [] }, segments: new Map() };
      tracks.set(trackKey, entry);
    }
    const segmentKey = type >= 0 && segment >= 0 ? (row[segment] ?? "") : "";
    const list = entry.segments.get(segmentKey);
    if (list) list.push(point);
    else entry.segments.set(segmentKey, [point]);
  }
  for (const { track, segments } of tracks.values()) data.tracks.push({ ...track, segments: [...segments.values()] });
  return data;
}

/** The format a file is in, from its first characters, with its name as the tie-break. */
export function detectGeoFormat(text: string, fileName: string): GeoFormat | null {
  const start = text.replace(/^\ufeff/, "").trimStart().slice(0, 4000);
  if (start.startsWith("{") || start.startsWith("[")) return "geojson";
  if (start.startsWith("<")) {
    if (/<gpx[\s>]/.test(start)) return "gpx";
    if (/<kml[\s>]/.test(start)) return "kml";
    if (/<TrainingCenterDatabase[\s>]/.test(start)) return "tcx";
  }
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "tsv" || extension === "txt") return "csv";
  if (extension === "gpx" || extension === "kml" || extension === "tcx") return extension;
  if (extension === "geojson" || extension === "json") return "geojson";
  return null;
}

export function readGeo(text: string, fileName: string): { data: GeoData; format: GeoFormat } {
  const format = detectGeoFormat(text, fileName);
  if (!format) throw new GeoError("This is not a GPS file this reads. GPX, KML, GeoJSON, TCX and CSV with latitude and longitude columns are read.");
  if (format === "geojson") return { data: readGeoJson(JSON.parse(text.replace(/^\ufeff/, ""))), format };
  if (format === "csv") return { data: readGeoCsv(text), format };
  const root = parseXml(text).root;
  const name = localName(root.name);
  if (format === "gpx" && name === "gpx") return { data: readGpx(root), format };
  if (format === "kml" && name === "kml") return { data: readKml(root), format };
  if (format === "tcx" && name === "TrainingCenterDatabase") return { data: readTcx(root), format };
  throw new GeoError(`The file is XML, but its root is <${root.name}>, not what a ${format.toUpperCase()} file has.`);
}

/* ---- Measuring ----------------------------------------------------------- */

const EARTH_RADIUS = 6_371_008.8;

/** The distance between two points in metres, by the haversine formula. */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeoStats {
  points: number;
  metres: number;
  /** Metres climbed, counting a rise only once it passes 3 m, so GPS jitter is not summed. */
  climb: number;
  descent: number;
  seconds: number | null;
  tracks: number;
  waypoints: number;
  polygons: number;
}

export function geoStats(data: GeoData): GeoStats {
  let points = 0;
  let metres = 0;
  let climb = 0;
  let descent = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const track of data.tracks) {
    for (const segment of track.segments) {
      let anchor: number | null = null;
      for (const [index, point] of segment.entries()) {
        points += 1;
        if (index > 0) metres += distance(segment[index - 1], point);
        if (point.ele !== null) {
          if (anchor === null) anchor = point.ele;
          else if (point.ele - anchor >= 3) {
            climb += point.ele - anchor;
            anchor = point.ele;
          } else if (anchor - point.ele >= 3) {
            descent += anchor - point.ele;
            anchor = point.ele;
          }
        }
        const time = point.time ? Date.parse(point.time) : Number.NaN;
        if (!Number.isNaN(time)) {
          if (first === null || time < first) first = time;
          if (last === null || time > last) last = time;
        }
      }
    }
  }
  return { points, metres, climb, descent, seconds: first !== null && last !== null && last > first ? (last - first) / 1000 : null, tracks: data.tracks.length, waypoints: data.waypoints.length, polygons: data.polygons.length };
}

export function describeDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 100_000 ? 0 : 2)} km (${(metres / 1609.344).toFixed(metres >= 160_934 ? 0 : 2)} mi)` : `${Math.round(metres)} m`;
}

/* ---- Writing ------------------------------------------------------------- */

const round = (value: number, places: number) => Number(value.toFixed(places));

export function toGpx(data: GeoData): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="key.is" xmlns="http://www.topografix.com/GPX/1/1">'];
  if (data.name) lines.push(`  <metadata><name>${escapeText(data.name)}</name></metadata>`);
  const point = (tag: string, entry: GeoPoint, indent: string, extra = "") => {
    const inner = `${entry.ele !== null ? `<ele>${round(entry.ele, 2)}</ele>` : ""}${entry.time ? `<time>${escapeText(entry.time)}</time>` : ""}${extra}`;
    return `${indent}<${tag} lat="${round(entry.lat, 7)}" lon="${round(entry.lon, 7)}"${inner ? `>${inner}</${tag}>` : "/>"}`;
  };
  for (const waypoint of data.waypoints) lines.push(point("wpt", waypoint.point, "  ", `${waypoint.name ? `<name>${escapeText(waypoint.name)}</name>` : ""}${waypoint.description ? `<desc>${escapeText(waypoint.description)}</desc>` : ""}`));
  for (const track of data.tracks) {
    if (track.kind === "route" && track.segments.length === 1) {
      lines.push("  <rte>");
      if (track.name) lines.push(`    <name>${escapeText(track.name)}</name>`);
      for (const entry of track.segments[0]) lines.push(point("rtept", entry, "    "));
      lines.push("  </rte>");
      continue;
    }
    lines.push("  <trk>");
    if (track.name) lines.push(`    <name>${escapeText(track.name)}</name>`);
    for (const segment of track.segments) {
      lines.push("    <trkseg>");
      for (const entry of segment) lines.push(point("trkpt", entry, "      "));
      lines.push("    </trkseg>");
    }
    lines.push("  </trk>");
  }
  for (const polygon of data.polygons) {
    lines.push("  <trk>");
    if (polygon.name) lines.push(`    <name>${escapeText(polygon.name)}</name>`);
    for (const ring of polygon.rings) {
      lines.push("    <trkseg>");
      for (const entry of ring) lines.push(point("trkpt", entry, "      "));
      lines.push("    </trkseg>");
    }
    lines.push("  </trk>");
  }
  lines.push("</gpx>", "");
  return lines.join("\n");
}

function kmlTuple(point: GeoPoint): string {
  return `${round(point.lon, 7)},${round(point.lat, 7)}${point.ele !== null ? `,${round(point.ele, 2)}` : ""}`;
}

export function toKml(data: GeoData): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', "<Document>"];
  if (data.name) lines.push(`  <name>${escapeText(data.name)}</name>`);
  const heading = (name: string | null, description: string | null = null) => `${name ? `<name>${escapeText(name)}</name>` : ""}${description ? `<description>${escapeText(description)}</description>` : ""}`;
  for (const waypoint of data.waypoints) lines.push(`  <Placemark>${heading(waypoint.name, waypoint.description)}<Point><coordinates>${kmlTuple(waypoint.point)}</coordinates></Point></Placemark>`);
  for (const track of data.tracks) {
    const strings = track.segments.map((segment) => `<LineString><tessellate>1</tessellate><coordinates>${segment.map(kmlTuple).join(" ")}</coordinates></LineString>`);
    lines.push(`  <Placemark>${heading(track.name)}${strings.length === 1 ? strings[0] : `<MultiGeometry>${strings.join("")}</MultiGeometry>`}</Placemark>`);
  }
  for (const polygon of data.polygons) {
    const [outer, ...inner] = polygon.rings;
    const ring = (points: GeoPoint[]) => `<LinearRing><coordinates>${points.map(kmlTuple).join(" ")}</coordinates></LinearRing>`;
    lines.push(`  <Placemark>${heading(polygon.name)}<Polygon><outerBoundaryIs>${ring(outer ?? [])}</outerBoundaryIs>${inner.map((points) => `<innerBoundaryIs>${ring(points)}</innerBoundaryIs>`).join("")}</Polygon></Placemark>`);
  }
  lines.push("</Document>", "</kml>", "");
  return lines.join("\n");
}

function position(point: GeoPoint): number[] {
  return point.ele !== null ? [round(point.lon, 7), round(point.lat, 7), round(point.ele, 2)] : [round(point.lon, 7), round(point.lat, 7)];
}

export function toGeoJson(data: GeoData): string {
  const features: unknown[] = [];
  for (const waypoint of data.waypoints) {
    const properties: Record<string, string> = {};
    if (waypoint.name) properties.name = waypoint.name;
    if (waypoint.description) properties.description = waypoint.description;
    if (waypoint.point.time) properties.time = waypoint.point.time;
    features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: position(waypoint.point) } });
  }
  for (const track of data.tracks) {
    const properties: Record<string, unknown> = {};
    if (track.name) properties.name = track.name;
    const timed = track.segments.some((segment) => segment.some((point) => point.time));
    if (track.segments.length === 1) {
      if (timed) properties.coordTimes = track.segments[0].map((point) => point.time);
      features.push({ type: "Feature", properties, geometry: { type: "LineString", coordinates: track.segments[0].map(position) } });
    } else {
      if (timed) properties.coordTimes = track.segments.map((segment) => segment.map((point) => point.time));
      features.push({ type: "Feature", properties, geometry: { type: "MultiLineString", coordinates: track.segments.map((segment) => segment.map(position)) } });
    }
  }
  for (const polygon of data.polygons) features.push({ type: "Feature", properties: polygon.name ? { name: polygon.name } : {}, geometry: { type: "Polygon", coordinates: polygon.rings.map((ring) => ring.map(position)) } });
  const collection: Record<string, unknown> = { type: "FeatureCollection" };
  if (data.name) collection.name = data.name;
  collection.features = features;
  return `${JSON.stringify(collection, null, 2)}\n`;
}

export function toGeoCsv(data: GeoData): string {
  const rows: string[] = [csvLine(["type", "name", "segment", "lat", "lon", "ele", "time"], ",")];
  for (const waypoint of data.waypoints) rows.push(csvLine(["waypoint", waypoint.name ?? "", "", String(waypoint.point.lat), String(waypoint.point.lon), waypoint.point.ele === null ? "" : String(waypoint.point.ele), waypoint.point.time ?? ""], ","));
  for (const track of data.tracks) {
    track.segments.forEach((segment, index) => {
      for (const point of segment) rows.push(csvLine([track.kind, track.name ?? "", String(index + 1), String(point.lat), String(point.lon), point.ele === null ? "" : String(point.ele), point.time ?? ""], ","));
    });
  }
  return `${rows.join("\r\n")}\r\n`;
}

export function writeGeo(data: GeoData, format: Exclude<GeoFormat, "tcx">): string {
  switch (format) {
    case "gpx":
      return toGpx(data);
    case "kml":
      return toKml(data);
    case "geojson":
      return toGeoJson(data);
    case "csv":
      return toGeoCsv(data);
  }
}

/* ---- Privacy ------------------------------------------------------------- */

export interface PrivacyOptions {
  /** Metres around each track's start and end within which points are removed; 0 for none. */
  radius: number;
  /** Vary each circle's radius by up to a quarter, so trimmed tracks do not all end on one circle. */
  vary: boolean;
  /** More places, "lat, lon", to hide around. */
  places: { lat: number; lon: number }[];
  dropTimes: boolean;
  dropElevation: boolean;
}

export interface PrivacyResult {
  data: GeoData;
  removedPoints: number;
  removedWaypoints: number;
}

/** "51.5007, -0.1246" and the like, one place per line, as numbers. */
export function parsePlaces(text: string): { places: { lat: number; lon: number }[]; bad: string[] } {
  const places: { lat: number; lon: number }[] = [];
  const bad: string[] = [];
  for (const line of text.split(/\n|;/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
    const lat = match ? Number(match[1]) : Number.NaN;
    const lon = match ? Number(match[2]) : Number.NaN;
    if (match && validPoint(lat, lon)) places.push({ lat, lon });
    else bad.push(trimmed);
  }
  return { places, bad };
}

/**
 * A track with the parts that give a home away taken out: every point
 * within a circle around where each track starts and ends, and around any
 * place named, with a track that passes through a circle split in two
 * rather than joined across it; waypoints inside a circle go too. Times
 * and elevations can be dropped as well.
 */
export function hideEnds(data: GeoData, options: PrivacyOptions, random: () => number = Math.random): PrivacyResult {
  let removedPoints = 0;
  let removedWaypoints = 0;
  const zones: { lat: number; lon: number; radius: number }[] = [];
  const radiusFor = () => (options.vary ? options.radius * (1 + random() * 0.25) : options.radius);
  if (options.radius > 0) {
    for (const track of data.tracks) {
      const points = track.segments.flat();
      if (points.length === 0) continue;
      zones.push({ ...points[0], radius: radiusFor() });
      zones.push({ ...points[points.length - 1], radius: radiusFor() });
    }
    for (const place of options.places) zones.push({ ...place, radius: radiusFor() });
  }
  const hidden = (point: GeoPoint) => zones.some((zone) => distance(zone, point) <= zone.radius);
  const clean = (point: GeoPoint): GeoPoint => ({ lat: point.lat, lon: point.lon, ele: options.dropElevation ? null : point.ele, time: options.dropTimes ? null : point.time });

  const tracks: GeoTrack[] = [];
  for (const track of data.tracks) {
    const segments: GeoPoint[][] = [];
    for (const segment of track.segments) {
      let current: GeoPoint[] = [];
      for (const point of segment) {
        if (hidden(point)) {
          removedPoints += 1;
          if (current.length > 0) segments.push(current);
          current = [];
        } else current.push(clean(point));
      }
      if (current.length > 0) segments.push(current);
    }
    const kept = segments.filter((segment) => segment.length > 1);
    for (const segment of segments) if (segment.length === 1) removedPoints += 1;
    if (kept.length > 0) tracks.push({ ...track, segments: kept });
  }
  const waypoints: GeoWaypoint[] = [];
  for (const waypoint of data.waypoints) {
    if (hidden(waypoint.point)) removedWaypoints += 1;
    else waypoints.push({ ...waypoint, point: clean(waypoint.point) });
  }
  return { data: { ...data, tracks, waypoints, polygons: data.polygons }, removedPoints, removedWaypoints };
}

