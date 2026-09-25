/**
 * Triangle meshes: the one shape every 3D format here is read into and
 * written from, and the checks a 3D printer's slicer cares about.
 *
 * A mesh is a list of vertex positions and a list of triangles indexing
 * them. Whether it is printable comes down to its edges: in a closed,
 * "watertight" solid every edge is shared by exactly two triangles that
 * run along it in opposite directions. An edge used once is the rim of a
 * hole; an edge used three times or more is non-manifold; two triangles
 * running an edge the same way means one of them faces inwards. Repair
 * welds duplicate vertices, drops degenerate and duplicate triangles,
 * turns every shell to face one way and outwards, and fills holes.
 */

export interface MeshPart {
  name: string;
  /** First triangle of the part. */
  start: number;
  count: number;
}

export interface Mesh {
  /** x, y, z for each vertex. */
  positions: Float64Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  triangles: Uint32Array;
  parts: MeshPart[];
  /** The up axis the source format uses: glTF is Y-up, printers are Z-up. */
  up: "y" | "z";
  /** The length unit, when the file names one; 3MF does, STL never does. */
  unit: string | null;
}

export function emptyMesh(up: Mesh["up"] = "z"): Mesh {
  return { positions: new Float64Array(0), triangles: new Uint32Array(0), parts: [], up, unit: null };
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function bounds(mesh: Mesh): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const used = new Uint8Array(mesh.positions.length / 3);
  for (const index of mesh.triangles) used[index] = 1;
  for (let vertex = 0; vertex < used.length; vertex += 1) {
    if (!used[vertex]) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[vertex * 3 + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Vertices at the same place, to within `tolerance`, made one. */
export function weld(mesh: Mesh, tolerance?: number): Mesh {
  const box = bounds(mesh);
  const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) || 1;
  const step = tolerance ?? diagonal * 1e-7;
  const map = new Map<string, number>();
  const remap = new Uint32Array(mesh.positions.length / 3);
  const positions: number[] = [];
  for (let vertex = 0; vertex < remap.length; vertex += 1) {
    const x = mesh.positions[vertex * 3];
    const y = mesh.positions[vertex * 3 + 1];
    const z = mesh.positions[vertex * 3 + 2];
    const key = `${Math.round(x / step)},${Math.round(y / step)},${Math.round(z / step)}`;
    let index = map.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      map.set(key, index);
      positions.push(x, y, z);
    }
    remap[vertex] = index;
  }
  const triangles = new Uint32Array(mesh.triangles.length);
  for (let index = 0; index < triangles.length; index += 1) triangles[index] = remap[mesh.triangles[index]];
  return { ...mesh, positions: Float64Array.from(positions), triangles };
}

function triangleVectors(mesh: Mesh, triangle: number): [number[], number[], number[]] {
  const at = (corner: number) => {
    const vertex = mesh.triangles[triangle * 3 + corner] * 3;
    return [mesh.positions[vertex], mesh.positions[vertex + 1], mesh.positions[vertex + 2]];
  };
  return [at(0), at(1), at(2)];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** The unnormalised normal of a triangle: its direction, and twice its area as length. */
export function faceNormal(mesh: Mesh, triangle: number): number[] {
  const [a, b, c] = triangleVectors(mesh, triangle);
  return cross(sub(b, a), sub(c, a));
}

export interface MeshReport {
  triangles: number;
  vertices: number;
  bounds: Bounds;
  size: [number, number, number];
  area: number;
  /** Signed: negative when the triangles face inwards. Meaningful only for a closed mesh. */
  volume: number;
  shells: number;
  /** Edges used by one triangle: the rims of holes. */
  boundaryEdges: number;
  holes: number;
  /** Edges used by three or more triangles. */
  nonManifoldEdges: number;
  /** Edges two triangles run the same way: one of them faces inwards. */
  flippedEdges: number;
  degenerate: number;
  duplicates: number;
  watertight: boolean;
}

const edgeKey = (a: number, b: number) => a * 67108864 + b;

interface EdgeInfo {
  /** Triangles using the edge, whichever way. */
  count: number;
  /** Triangles running it from the lower index to the higher. */
  forward: number;
  triangles: number[];
}

function edgeMap(mesh: Mesh): Map<number, EdgeInfo> {
  const edges = new Map<number, EdgeInfo>();
  const count = mesh.triangles.length / 3;
  for (let triangle = 0; triangle < count; triangle += 1) {
    const [p, q, r] = [mesh.triangles[triangle * 3], mesh.triangles[triangle * 3 + 1], mesh.triangles[triangle * 3 + 2]];
    // A triangle with a corner repeated is a line, and joins nothing.
    if (p === q || q === r || p === r) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const a = mesh.triangles[triangle * 3 + corner];
      const b = mesh.triangles[triangle * 3 + ((corner + 1) % 3)];
      const key = a < b ? edgeKey(a, b) : edgeKey(b, a);
      let info = edges.get(key);
      if (!info) {
        info = { count: 0, forward: 0, triangles: [] };
        edges.set(key, info);
      }
      info.count += 1;
      if (a < b) info.forward += 1;
      info.triangles.push(triangle);
    }
  }
  return edges;
}

function isDegenerate(mesh: Mesh, triangle: number, epsilon: number): boolean {
  const a = mesh.triangles[triangle * 3];
  const b = mesh.triangles[triangle * 3 + 1];
  const c = mesh.triangles[triangle * 3 + 2];
  if (a === b || b === c || a === c) return true;
  const normal = faceNormal(mesh, triangle);
  return Math.hypot(normal[0], normal[1], normal[2]) <= epsilon;
}

function shellsOf(mesh: Mesh): Int32Array {
  const parent = new Int32Array(mesh.positions.length / 3).map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const a = find(mesh.triangles[index]);
    parent[find(mesh.triangles[index + 1])] = a;
    parent[find(mesh.triangles[index + 2])] = a;
  }
  const shell = new Int32Array(mesh.triangles.length / 3);
  for (let triangle = 0; triangle < shell.length; triangle += 1) shell[triangle] = find(mesh.triangles[triangle * 3]);
  return shell;
}

/** Boundary edges joined into loops, each a list of vertices in order. */
function boundaryLoops(mesh: Mesh, edges: Map<number, EdgeInfo>): number[][] {
  // Each boundary edge, directed as its one triangle runs it, reversed: the hole runs the other way.
  const next = new Map<number, number[]>();
  for (const info of edges.values()) {
    if (info.count !== 1) continue;
    const triangle = info.triangles[0];
    for (let corner = 0; corner < 3; corner += 1) {
      const a = mesh.triangles[triangle * 3 + corner];
      const b = mesh.triangles[triangle * 3 + ((corner + 1) % 3)];
      const key = a < b ? edgeKey(a, b) : edgeKey(b, a);
      if (edges.get(key) === info) next.set(b, [...(next.get(b) ?? []), a]);
    }
  }
  const loops: number[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop = [start];
      let current = next.get(start)!.pop()!;
      while (current !== start && loop.length <= next.size + 1) {
        loop.push(current);
        const options = next.get(current);
        if (!options || options.length === 0) break;
        current = options.pop()!;
      }
      if (current === start && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** What a slicer would say about the mesh. */
export function analyzeMesh(input: Mesh): MeshReport {
  const mesh = weld(input);
  const box = bounds(mesh);
  const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) || 1;
  const count = mesh.triangles.length / 3;
  let area = 0;
  let volume = 0;
  let degenerate = 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (let triangle = 0; triangle < count; triangle += 1) {
    const [a, b, c] = triangleVectors(mesh, triangle);
    const normal = cross(sub(b, a), sub(c, a));
    area += Math.hypot(normal[0], normal[1], normal[2]) / 2;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    if (isDegenerate(mesh, triangle, diagonal * diagonal * 1e-14)) degenerate += 1;
    const key = Array.from(mesh.triangles.subarray(triangle * 3, triangle * 3 + 3)).sort((x, y) => x - y).join(",");
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  const edges = edgeMap(mesh);
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let flippedEdges = 0;
  for (const info of edges.values()) {
    if (info.count === 1) boundaryEdges += 1;
    else if (info.count > 2) nonManifoldEdges += 1;
    else if (info.forward !== 1) flippedEdges += 1;
  }
  const used = new Set(mesh.triangles);
  const shells = new Set(shellsOf(mesh)).size;
  return {
    triangles: count,
    vertices: used.size,
    bounds: box,
    size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]],
    area,
    volume,
    shells: count === 0 ? 0 : shells,
    boundaryEdges,
    holes: boundaryEdges > 0 ? boundaryLoops(mesh, edges).length : 0,
    nonManifoldEdges,
    flippedEdges,
    degenerate,
    duplicates,
    watertight: count > 0 && boundaryEdges === 0 && nonManifoldEdges === 0,
  };
}

export interface RepairResult {
  mesh: Mesh;
  welded: number;
  removedDegenerate: number;
  removedDuplicates: number;
  flipped: number;
  holesFilled: number;
}

/** The mesh made printable, as far as that can be done without guessing at shapes. */
export function repairMesh(input: Mesh, fillHoles = true): RepairResult {
  const before = input.positions.length / 3;
  const welded = weld(input);
  const box = bounds(welded);
  const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) || 1;
  const count = welded.triangles.length / 3;
  const kept: number[] = [];
  const seen = new Set<string>();
  let removedDegenerate = 0;
  let removedDuplicates = 0;
  for (let triangle = 0; triangle < count; triangle += 1) {
    if (isDegenerate(welded, triangle, diagonal * diagonal * 1e-14)) {
      removedDegenerate += 1;
      continue;
    }
    const corners = Array.from(welded.triangles.subarray(triangle * 3, triangle * 3 + 3));
    const key = corners.slice().sort((x, y) => x - y).join(",");
    if (seen.has(key)) {
      removedDuplicates += 1;
      continue;
    }
    seen.add(key);
    kept.push(...corners);
  }
  let mesh: Mesh = { ...welded, triangles: Uint32Array.from(kept), parts: [] };

  // Turn every triangle to agree with its neighbours, shell by shell, walking across shared edges.
  const edges = edgeMap(mesh);
  const total = mesh.triangles.length / 3;
  const visited = new Uint8Array(total);
  let flipped = 0;
  const flip = (triangle: number) => {
    const at = triangle * 3;
    const swap = mesh.triangles[at + 1];
    mesh.triangles[at + 1] = mesh.triangles[at + 2];
    mesh.triangles[at + 2] = swap;
  };
  const runs = (triangle: number, a: number, b: number) => {
    for (let corner = 0; corner < 3; corner += 1) if (mesh.triangles[triangle * 3 + corner] === a && mesh.triangles[triangle * 3 + ((corner + 1) % 3)] === b) return true;
    return false;
  };
  for (let seed = 0; seed < total; seed += 1) {
    if (visited[seed]) continue;
    const queue = [seed];
    visited[seed] = 1;
    while (queue.length > 0) {
      const triangle = queue.pop()!;
      for (let corner = 0; corner < 3; corner += 1) {
        const a = mesh.triangles[triangle * 3 + corner];
        const b = mesh.triangles[triangle * 3 + ((corner + 1) % 3)];
        const info = edges.get(a < b ? edgeKey(a, b) : edgeKey(b, a));
        if (!info || info.count !== 2) continue;
        const other = info.triangles[0] === triangle ? info.triangles[1] : info.triangles[0];
        if (visited[other]) continue;
        // A neighbour facing the same way runs the shared edge the other way round.
        if (runs(other, a, b)) {
          flip(other);
          flipped += 1;
        }
        visited[other] = 1;
        queue.push(other);
      }
    }
  }

  let holesFilled = 0;
  if (fillHoles) {
    const loops = boundaryLoops(mesh, edgeMap(mesh));
    const positions = Array.from(mesh.positions);
    const triangles = Array.from(mesh.triangles);
    for (const loop of loops) {
      // A fan from the loop's centre: exact for a flat hole, a fair patch for a curved one.
      const centre = [0, 0, 0];
      for (const vertex of loop) for (let axis = 0; axis < 3; axis += 1) centre[axis] += positions[vertex * 3 + axis] / loop.length;
      const middle = positions.length / 3;
      positions.push(...centre);
      for (let index = 0; index < loop.length; index += 1) triangles.push(loop[index], loop[(index + 1) % loop.length], middle);
      holesFilled += 1;
    }
    mesh = { ...mesh, positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) };
  }

  // Shells that face inwards as a whole, their volume negative, are turned outwards.
  const shells = shellsOf(mesh);
  const volumes = new Map<number, number>();
  for (let triangle = 0; triangle < mesh.triangles.length / 3; triangle += 1) {
    const [a, b, c] = triangleVectors(mesh, triangle);
    const signed = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    volumes.set(shells[triangle], (volumes.get(shells[triangle]) ?? 0) + signed);
  }
  for (let triangle = 0; triangle < mesh.triangles.length / 3; triangle += 1) {
    if ((volumes.get(shells[triangle]) ?? 0) < 0) {
      flip(triangle);
      flipped += 1;
    }
  }
  return { mesh, welded: before - welded.positions.length / 3, removedDegenerate, removedDuplicates, flipped, holesFilled };
}

/** Coordinates turned from one up axis to the other: a quarter turn about X. */
export function convertUp(mesh: Mesh, up: Mesh["up"]): Mesh {
  if (mesh.up === up) return mesh;
  const positions = new Float64Array(mesh.positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = [mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]];
    if (up === "z") positions.set([x, -z, y], index);
    else positions.set([x, z, -y], index);
  }
  return { ...mesh, positions, up };
}

/** Every coordinate multiplied by `factor`, for a change of units. */
export function scaleMesh(mesh: Mesh, factor: number): Mesh {
  if (factor === 1) return mesh;
  return { ...mesh, positions: mesh.positions.map((value) => value * factor) };
}

/** Several meshes as one, parts kept. */
export function joinMeshes(meshes: Mesh[]): Mesh {
  const positions: number[] = [];
  const triangles: number[] = [];
  const parts: MeshPart[] = [];
  for (const mesh of meshes) {
    const offset = positions.length / 3;
    const start = triangles.length / 3;
    for (const value of mesh.positions) positions.push(value);
    for (const index of mesh.triangles) triangles.push(index + offset);
    for (const part of mesh.parts) parts.push({ ...part, start: part.start + start });
  }
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles), parts, up: meshes[0]?.up ?? "z", unit: meshes[0]?.unit ?? null };
}
