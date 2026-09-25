import { describe, expect, it } from "vitest";

import { detectFormat, read3mf, readGltf, readModel, readObj, readPly, readStl, write3mf, writeGlb, writeObj, writePly, writeStl } from "@/lib/geometry/formats";
import { analyzeMesh, convertUp, repairMesh, weld, type Mesh } from "@/lib/geometry/mesh";
import { renderMesh } from "@/lib/geometry/render";

const decode = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

// Written by trimesh 4: a 10 mm cube and a 4 mm cube turned 45 degrees and moved 30 mm along x,
// as a two-node scene. trimesh measures the pair at 1064 mm3 and 696 mm2.
const SCENE_GLB = decode(
    "Z2xURgIAAADEBQAAWAQAAEpTT057InNjZW5lIjowLCJzY2VuZXMiOlt7Im5vZGVzIjpbMCwxXX1dLCJhc3NldCI6eyJ2ZXJzaW9uIjoiMi4wIi" +
    "wiZ2VuZXJhdG9yIjoiaHR0cHM6Ly9naXRodWIuY29tL21pa2VkaC90cmltZXNoIn0sImFjY2Vzc29ycyI6W3siY29tcG9uZW50VHlwZSI6NTEy" +
    "NSwidHlwZSI6IlNDQUxBUiIsImJ1ZmZlclZpZXciOjAsImNvdW50IjozNiwibWF4IjpbN10sIm1pbiI6WzBdfSx7ImNvbXBvbmVudFR5cGUiOj" +
    "UxMjYsInR5cGUiOiJWRUMzIiwiYnl0ZU9mZnNldCI6MCwiYnVmZmVyVmlldyI6MSwiY291bnQiOjgsIm1heCI6WzUuMCw1LjAsNS4wXSwibWlu" +
    "IjpbLTUuMCwtNS4wLC01LjBdfSx7ImNvbXBvbmVudFR5cGUiOjUxMjYsInR5cGUiOiJWRUMzIiwiYnl0ZU9mZnNldCI6MCwiYnVmZmVyVmlldy" +
    "I6MiwiY291bnQiOjgsIm1heCI6WzIuMCwyLjAsMi4wXSwibWluIjpbLTIuMCwtMi4wLC0yLjBdfV0sIm1lc2hlcyI6W3sibmFtZSI6ImJpZyIs" +
    "ImV4dHJhcyI6eyJzaGFwZSI6ImJveCIsImV4dGVudHMiOlsxMC4wLDEwLjAsMTAuMF19LCJwcmltaXRpdmVzIjpbeyJhdHRyaWJ1dGVzIjp7Il" +
    "BPU0lUSU9OIjoxfSwiaW5kaWNlcyI6MCwibW9kZSI6NH1dfSx7Im5hbWUiOiJzbWFsbCIsImV4dHJhcyI6eyJzaGFwZSI6ImJveCIsImV4dGVu" +
    "dHMiOls0LjAsNC4wLDQuMF19LCJwcmltaXRpdmVzIjpbeyJhdHRyaWJ1dGVzIjp7IlBPU0lUSU9OIjoyfSwiaW5kaWNlcyI6MCwibW9kZSI6NH" +
    "1dfV0sIm5vZGVzIjpbeyJuYW1lIjoiYmlnIiwibWVzaCI6MH0seyJuYW1lIjoic21hbGwiLCJtZXNoIjoxLCJtYXRyaXgiOlswLjcwNzEwNjc4" +
    "MTE4NjU0NzYsMC43MDcxMDY3ODExODY1NDc1LDAuMCwwLjAsLTAuNzA3MTA2NzgxMTg2NTQ3NSwwLjcwNzEwNjc4MTE4NjU0NzYsMC4wLDAuMC" +
    "wwLjAsMC4wLDEuMCwwLjAsMzAuMCwwLjAsMC4wLDEuMF19XSwiYnVmZmVycyI6W3siYnl0ZUxlbmd0aCI6MzM2fV0sImJ1ZmZlclZpZXdzIjpb" +
    "eyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjAsImJ5dGVMZW5ndGgiOjE0NH0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjE0NCwiYnl0ZUxlbm" +
    "d0aCI6OTZ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjoyNDAsImJ5dGVMZW5ndGgiOjk2fV19ICAgIFABAABCSU4AAQAAAAMAAAAAAAAABAAA" +
    "AAEAAAAAAAAAAAAAAAMAAAACAAAAAgAAAAQAAAAAAAAAAQAAAAcAAAADAAAABQAAAAEAAAAEAAAABQAAAAcAAAABAAAAAwAAAAcAAAACAAAABg" +
    "AAAAQAAAACAAAAAgAAAAcAAAAGAAAABgAAAAUAAAAEAAAABwAAAAUAAAAGAAAAAACgwAAAoMAAAKDAAACgwAAAoMAAAKBAAACgwAAAoEAAAKDA" +
    "AACgwAAAoEAAAKBAAACgQAAAoMAAAKDAAACgQAAAoMAAAKBAAACgQAAAoEAAAKDAAACgQAAAoEAAAKBAAAAAwAAAAMAAAADAAAAAwAAAAMAAAA" +
    "BAAAAAwAAAAEAAAADAAAAAwAAAAEAAAABAAAAAQAAAAMAAAADAAAAAQAAAAMAAAABAAAAAQAAAAEAAAADAAAAAQAAAAEAAAABA",
);
const SCENE_3MF = decode(
    "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" +
    "BLBQYAAAAAAwADALgAAADCBAAAAAA=",
);

/** A cube of side `side`, corners shared, faces counter-clockwise from outside. */
function cube(side = 10): Mesh {
  const positions: number[] = [];
  for (let index = 0; index < 8; index += 1) positions.push(index & 1 ? side : 0, index & 2 ? side : 0, index & 4 ? side : 0);
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const triangles = faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles), parts: [], up: "z", unit: null };
}

describe("analysis", () => {
  it("measures a closed cube", () => {
    const report = analyzeMesh(cube());
    expect(report).toMatchObject({ triangles: 12, vertices: 8, area: 600, shells: 1, boundaryEdges: 0, nonManifoldEdges: 0, flippedEdges: 0, watertight: true });
    expect(report.volume).toBeCloseTo(1000, 9);
    expect(report.size).toEqual([10, 10, 10]);
  });

  it("finds holes, flipped faces, degenerate and duplicate triangles", () => {
    const broken = cube();
    const triangles = Array.from(broken.triangles);
    triangles.splice(0, 6);
    [triangles[1], triangles[2]] = [triangles[2], triangles[1]];
    triangles.push(4, 5, 7, 0, 0, 1);
    const report = analyzeMesh({ ...broken, triangles: Uint32Array.from(triangles) });
    expect(report).toMatchObject({ holes: 1, boundaryEdges: 4, degenerate: 1, duplicates: 1, watertight: false });
    expect(report.flippedEdges + report.nonManifoldEdges).toBeGreaterThan(0);
  });
});

describe("repair", () => {
  it("welds, drops bad triangles, turns faces outwards and fills a hole", () => {
    // As STL stores it: every triangle with its own three vertices.
    const solid = cube();
    const loose: number[] = [];
    for (const index of solid.triangles) loose.push(...solid.positions.subarray(index * 3, index * 3 + 3));
    const unwelded: Mesh = { ...solid, positions: Float64Array.from(loose), triangles: Uint32Array.from(loose.map((_, index) => index).filter((index) => index % 3 === 0).map((index) => index / 3)) };
    const triangles = Array.from(unwelded.triangles);
    triangles.splice(3, 3);
    [triangles[4], triangles[5]] = [triangles[5], triangles[4]];
    triangles.push(triangles[6], triangles[7], triangles[8]);
    const damaged = { ...unwelded, triangles: Uint32Array.from(triangles) };
    expect(analyzeMesh(damaged).watertight).toBe(false);
    const result = repairMesh(damaged);
    expect(result).toMatchObject({ welded: 28, removedDuplicates: 1, holesFilled: 1 });
    const after = analyzeMesh(result.mesh);
    expect(after).toMatchObject({ watertight: true, flippedEdges: 0, shells: 1 });
    expect(after.volume).toBeCloseTo(1000, 6);
  });

  it("turns a cube that faces inwards the right way out", () => {
    const inside = cube();
    for (let index = 0; index < inside.triangles.length; index += 3) [inside.triangles[index + 1], inside.triangles[index + 2]] = [inside.triangles[index + 2], inside.triangles[index + 1]];
    expect(analyzeMesh(inside).volume).toBeCloseTo(-1000, 9);
    expect(analyzeMesh(repairMesh(inside).mesh).volume).toBeCloseTo(1000, 9);
  });
});

describe("formats", () => {
  it("writes every format and reads each back as the same solid", () => {
    const mesh = cube(12.5);
    const outputs: [string, Uint8Array][] = [
      ["cube.stl", writeStl(mesh)],
      ["cube.obj", new TextEncoder().encode(writeObj(mesh))],
      ["cube.ply", writePly(mesh)],
      ["cube.glb", writeGlb(mesh)],
      ["cube.3mf", write3mf(mesh)],
    ];
    for (const [name, bytes] of outputs) {
      const { mesh: read } = readModel(bytes, name);
      const report = analyzeMesh(read);
      expect(report.watertight, name).toBe(true);
      expect(report.volume, name).toBeCloseTo(12.5 ** 3, 3);
      expect(report.area, name).toBeCloseTo(6 * 12.5 ** 2, 3);
    }
    expect(outputs.map(([name, bytes]) => detectFormat(bytes, name.replace(/\..*$/, "")))).toEqual(["stl", "obj", "ply", "glb", "3mf"]);
  });

  it("reads ASCII STL, OBJ with polygons and negative indices, and ASCII PLY", () => {
    const stl = readStl(new TextEncoder().encode("solid tri\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid tri\n"));
    expect(Array.from(stl.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(stl.parts[0].name).toBe("tri");
    const obj = readObj("o square\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4/1/1 -3/2/1 -2/3/1 -1/4/1\n");
    expect(Array.from(obj.triangles)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(obj.up).toBe("y");
    const ply = readPly(new TextEncoder().encode("ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n2 0 0\n0 2 0\n3 0 1 2\n"));
    expect(analyzeMesh(ply).area).toBe(2);
  });

  it("reads trimesh's glTF and 3MF with their transforms, as trimesh measures them", () => {
    for (const mesh of [readGltf(SCENE_GLB), read3mf(SCENE_3MF)]) {
      const report = analyzeMesh(mesh);
      expect(report).toMatchObject({ triangles: 24, shells: 2, watertight: true });
      expect(report.volume).toBeCloseTo(1064, 6);
      expect(report.area).toBeCloseTo(696, 6);
      expect(report.bounds.max[0]).toBeCloseTo(32.82842712474619, 6);
      expect(mesh.parts.map((part) => part.name)).toEqual(["big", "small"]);
    }
    expect(read3mf(SCENE_3MF).unit).toBe("millimeter");
  });

  it("turns Y-up to Z-up and back", () => {
    const mesh: Mesh = { ...cube(), up: "y" };
    const turned = convertUp(mesh, "z");
    expect(turned.up).toBe("z");
    expect(Array.from(convertUp(turned, "y").positions)).toEqual(Array.from(mesh.positions).map((value) => value + 0));
    expect(analyzeMesh(turned).volume).toBeCloseTo(1000, 9);
    expect(weld(turned).positions.length).toBe(24);
  });
});

describe("the preview", () => {
  it("draws the model in the middle and leaves the corners empty", () => {
    const pixels = renderMesh(cube(), { size: 64 });
    const at = (x: number, y: number) => Array.from(pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3));
    expect(at(0, 0)).toEqual([246, 247, 249]);
    expect(at(32, 32)).not.toEqual([246, 247, 249]);
    // Three faces show, each lit differently.
    const colours = new Set<string>();
    for (let index = 0; index < 64 * 64; index += 1) colours.add(Array.from(pixels.subarray(index * 4, index * 4 + 3)).join(","));
    expect(colours.size).toBe(4);
  });
});
