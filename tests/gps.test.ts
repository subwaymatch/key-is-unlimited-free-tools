import { describe, expect, it } from "vitest";

import { describeDistance, detectGeoFormat, distance, geoStats, hideEnds, parsePlaces, readGeo, toGeoCsv, toGeoJson, toGpx, toKml, type GeoData } from "@/lib/geo/gps";

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Morning ride</name></metadata>
  <wpt lat="51.5" lon="-0.1"><name>Caf&#233;</name><desc>Coffee</desc></wpt>
  <rte><name>Plan</name><rtept lat="51.0" lon="0.0"/><rtept lat="51.1" lon="0.0"/></rte>
  <trk><name>Ride</name>
    <trkseg>
      <trkpt lat="50.0" lon="0.0"><ele>10</ele><time>2026-09-01T08:00:00Z</time></trkpt>
      <trkpt lat="50.001" lon="0.0"><ele>11</ele><time>2026-09-01T08:01:00Z</time></trkpt>
      <trkpt lat="50.002" lon="0.0"><ele>20</ele><time>2026-09-01T08:02:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="50.01" lon="0.0"><ele>15</ele><time>2026-09-01T08:10:00Z</time></trkpt>
      <trkpt lat="50.02" lon="0.0"><ele>12</ele><time>2026-09-01T08:20:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

function summary(data: GeoData) {
  return {
    name: data.name,
    waypoints: data.waypoints.map((entry) => [entry.name, entry.point.lat, entry.point.lon]),
    tracks: data.tracks.map((track) => [track.name, track.kind, track.segments.map((segment) => segment.map((point) => [point.lat, point.lon, point.ele, point.time]))]),
  };
}

describe("reading GPS files", () => {
  it("reads GPX tracks, routes and waypoints", () => {
    const { data, format } = readGeo(GPX, "ride.gpx");
    expect(format).toBe("gpx");
    expect(data.name).toBe("Morning ride");
    expect(data.waypoints).toEqual([{ point: { lat: 51.5, lon: -0.1, ele: null, time: null }, name: "Caf\u00e9", description: "Coffee" }]);
    expect(data.tracks.map((track) => [track.name, track.kind, track.segments.map((segment) => segment.length)])).toEqual([["Plan", "route", [2]], ["Ride", "track", [3, 2]]]);
  });

  it("round-trips through every format it writes", () => {
    const { data } = readGeo(GPX, "ride.gpx");
    const viaGpx = readGeo(toGpx(data), "x.gpx").data;
    expect(summary(viaGpx)).toEqual(summary(data));
    const viaGeoJson = readGeo(toGeoJson(data), "x.geojson").data;
    expect(summary(viaGeoJson).tracks[1]).toEqual(summary(data).tracks[1]);
    expect(viaGeoJson.waypoints[0].name).toBe("Caf\u00e9");
    const viaKml = readGeo(toKml(data), "x.kml").data;
    expect(viaKml.tracks[1].segments.map((segment) => segment.map((point) => [point.lat, point.lon, point.ele]))).toEqual(data.tracks[1].segments.map((segment) => segment.map((point) => [point.lat, point.lon, point.ele])));
    const viaCsv = readGeo(toGeoCsv(data), "x.csv").data;
    expect(summary(viaCsv)).toEqual({ ...summary(data), name: null });
  });

  it("reads KML points, lines, tracks and polygons", () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Trip</name>
      <Placemark><name>Home</name><Point><coordinates>-0.12,51.5,0</coordinates></Point></Placemark>
      <Placemark><name>Walk</name><LineString><coordinates>-0.1,51.5 -0.2,51.6,30
        -0.3,51.7</coordinates></LineString></Placemark>
      <Placemark><name>Logged</name><gx:Track><when>2026-01-01T00:00:00Z</when><when>2026-01-01T00:01:00Z</when><gx:coord>1 2 3</gx:coord><gx:coord>1.1 2.1 4</gx:coord></gx:Track></Placemark>
      <Placemark><name>Park</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    </Document></kml>`;
    const { data } = readGeo(kml, "trip.kml");
    expect(data.name).toBe("Trip");
    expect(data.waypoints[0]).toMatchObject({ name: "Home", point: { lat: 51.5, lon: -0.12, ele: 0 } });
    expect(data.tracks[0].segments[0].map((point) => [point.lat, point.lon, point.ele])).toEqual([[51.5, -0.1, null], [51.6, -0.2, 30], [51.7, -0.3, null]]);
    expect(data.tracks[1].segments[0][1]).toEqual({ lat: 2.1, lon: 1.1, ele: 4, time: "2026-01-01T00:01:00Z" });
    expect(data.polygons[0].rings[0]).toHaveLength(4);
    expect(readGeo(toGpx(data), "x.gpx").data.tracks.length).toBe(3);
  });

  it("reads Garmin TCX and GeoJSON with times", () => {
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>2026-09-01T07:00:00Z</Id><Lap><Track>
      <Trackpoint><Time>2026-09-01T07:00:00Z</Time><Position><LatitudeDegrees>40</LatitudeDegrees><LongitudeDegrees>-70</LongitudeDegrees></Position><AltitudeMeters>5</AltitudeMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
      <Trackpoint><Time>2026-09-01T07:00:05Z</Time></Trackpoint>
      <Trackpoint><Time>2026-09-01T07:00:10Z</Time><Position><LatitudeDegrees>40.001</LatitudeDegrees><LongitudeDegrees>-70</LongitudeDegrees></Position></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const { data, format } = readGeo(tcx, "run.tcx");
    expect(format).toBe("tcx");
    expect(data.tracks[0].segments[0]).toEqual([{ lat: 40, lon: -70, ele: 5, time: "2026-09-01T07:00:00Z" }, { lat: 40.001, lon: -70, ele: null, time: "2026-09-01T07:00:10Z" }]);
    const geojson = JSON.stringify({ type: "Feature", properties: { name: "Line", coordTimes: ["a", "b"] }, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4, 5]] } });
    expect(readGeo(geojson, "x.json").data.tracks[0].segments[0]).toEqual([{ lat: 2, lon: 1, ele: null, time: "a" }, { lat: 4, lon: 3, ele: 5, time: "b" }]);
  });

  it("reads a CSV of points, and says when the columns are missing", () => {
    const { data } = readGeo("Latitude,Longitude,Elevation,Time\n10,20,1,t1\n10.1,20.1,2,t2\n", "points.csv");
    expect(data.tracks[0].segments[0]).toEqual([{ lat: 10, lon: 20, ele: 1, time: "t1" }, { lat: 10.1, lon: 20.1, ele: 2, time: "t2" }]);
    expect(() => readGeo("a,b\n1,2\n", "x.csv")).toThrow(/latitude and longitude/);
    expect(detectGeoFormat("<svg/>", "x.svg")).toBeNull();
  });
});

describe("measuring", () => {
  it("measures distance, climb and time", () => {
    expect(distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -1);
    const stats = geoStats(readGeo(GPX, "ride.gpx").data);
    expect(stats.points).toBe(7);
    expect(stats.climb).toBe(10);
    // Heights are followed segment by segment: 20 m then 15 m after a gap is not a descent.
    expect(stats.descent).toBe(3);
    expect(stats.seconds).toBe(20 * 60);
    expect(stats.metres).toBeGreaterThan(11_119 + 222 + 1111 - 5);
    expect(describeDistance(12_345)).toBe("12.35 km (7.67 mi)");
    expect(describeDistance(850)).toBe("850 m");
  });
});

describe("hiding the ends of a track", () => {
  const line: GeoData = {
    name: null,
    polygons: [],
    waypoints: [{ point: { lat: 50, lon: 0.00001, ele: null, time: null }, name: "Home", description: null }, { point: { lat: 50.005, lon: 0, ele: null, time: null }, name: "Park", description: null }],
    tracks: [{ name: "Run", kind: "track", segments: [Array.from({ length: 101 }, (_, index) => ({ lat: 50 + index * 0.0001, lon: 0, ele: 100 + index, time: `t${index}` }))] }],
  };

  it("removes the points and waypoints near the start and the end, times and heights too if asked", () => {
    const result = hideEnds(line, { radius: 200, vary: false, places: [], dropTimes: true, dropElevation: false }, () => 0);
    const kept = result.data.tracks[0].segments[0];
    // Points are 11.1 m apart, so 200 m takes the first and last 18 each.
    expect(kept.length).toBe(101 - 2 * 18);
    expect(distance(line.tracks[0].segments[0][0], kept[0])).toBeGreaterThan(200);
    expect(kept[0].time).toBeNull();
    expect(kept[0].ele).not.toBeNull();
    expect(result.removedPoints).toBe(36);
    expect(result.data.waypoints.map((waypoint) => waypoint.name)).toEqual(["Park"]);
    expect(result.removedWaypoints).toBe(1);
  });

  it("splits a track that passes through a place named", () => {
    const result = hideEnds(line, { radius: 100, vary: false, places: [{ lat: 50.005, lon: 0 }], dropTimes: false, dropElevation: true }, () => 0);
    expect(result.data.tracks[0].segments.length).toBe(2);
    expect(result.data.tracks[0].segments[0][0].ele).toBeNull();
    expect(result.data.waypoints).toHaveLength(0);
  });

  it("varies the radius when asked", () => {
    const fixed = hideEnds(line, { radius: 200, vary: false, places: [], dropTimes: false, dropElevation: false });
    const varied = hideEnds(line, { radius: 200, vary: true, places: [], dropTimes: false, dropElevation: false }, () => 0.99);
    expect(varied.removedPoints).toBeGreaterThan(fixed.removedPoints);
  });

  it("reads places typed one to a line", () => {
    expect(parsePlaces("51.5007, -0.1246\n40.7 -74.0\nnowhere")).toEqual({ places: [{ lat: 51.5007, lon: -0.1246 }, { lat: 40.7, lon: -74 }], bad: ["nowhere"] });
  });
});
