/**
 * 3D model files read into one mesh and written back out: STL (binary and
 * ASCII), OBJ, PLY (ASCII and binary), glTF 2.0 (a .glb, or a .gltf with
 * its buffers embedded) and 3MF.
 *
 * Only geometry travels. Colours, materials, textures, UVs, animation and
 * scene cameras have no place in STL and no common meaning across the
 * rest, so they are dropped; glTF's node transforms and 3MF's build
 * transforms are applied, so the shape lands where the file put it.
 */
import { unzipSync, zipSync, strToU8 } from "fflate";

import { faceNormal, type Mesh, type MeshPart } from "./mesh";

export class ModelError extends Error {
  constructor(
    message: string,
    readonly hint = "",
  ) {
    super(message);
  }
}

export type ModelFormat = "stl" | "obj" | "ply" | "glb" | "gltf" | "3mf";

class Builder {
  positions: number[] = [];
  triangles: number[] = [];
  parts: MeshPart[] = [];
  private partStart = 0;
  private partName: string | null = null;

  vertex(x: number, y: number, z: number): number {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }

  /** A polygon of vertex indices, fanned into triangles. */
  polygon(indices: number[]): void {
    for (let index = 1; index + 1 < indices.length; index += 1) this.triangles.push(indices[0], indices[index], indices[index + 1]);
  }

  part(name: string): void {
    this.closePart();
    this.partName = name;
    this.partStart = this.triangles.length / 3;
  }

  private closePart(): void {
    const count = this.triangles.length / 3 - this.partStart;
    if (this.partName !== null && count > 0) this.parts.push({ name: this.partName, start: this.partStart, count });
  }

  build(up: Mesh["up"], unit: string | null = null): Mesh {
    this.closePart();
    const vertexCount = this.positions.length / 3;
    for (const index of this.triangles) if (index >= vertexCount) throw new ModelError("A face refers to a vertex the file does not have.", "The file is damaged or cut short.");
    return { positions: Float64Array.from(this.positions), triangles: Uint32Array.from(this.triangles), parts: this.parts, up, unit };
  }
}

/* ---- STL ----------------------------------------------------------------- */

export function readStl(bytes: Uint8Array): Mesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binaryCount = bytes.length >= 84 ? view.getUint32(80, true) : -1;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  const binary = binaryCount >= 0 && 84 + binaryCount * 50 === bytes.length;
  const builder = new Builder();
  if (binary || !/^\s*solid\b/.test(head) || !/facet|endsolid/.test(new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096))))) {
    if (binaryCount < 0 || 84 + binaryCount * 50 > bytes.length) throw new ModelError("This STL is cut short.", "Its header promises more triangles than the file holds.");
    for (let triangle = 0; triangle < binaryCount; triangle += 1) {
      const at = 84 + triangle * 50 + 12;
      const indices: number[] = [];
      for (let corner = 0; corner < 3; corner += 1) indices.push(builder.vertex(view.getFloat32(at + corner * 12, true), view.getFloat32(at + corner * 12 + 4, true), view.getFloat32(at + corner * 12 + 8, true)));
      builder.triangles.push(...indices);
    }
    return builder.build("z");
  }
  const text = new TextDecoder("latin1").decode(bytes);
  const solid = /^\s*solid[ \t]*(.*)$/m.exec(text)?.[1]?.trim();
  if (solid) builder.part(solid);
  const pattern = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let corners: number[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    corners.push(builder.vertex(Number(match[1]), Number(match[2]), Number(match[3])));
    if (corners.length === 3) {
      builder.triangles.push(...corners);
      corners = [];
    }
  }
  return builder.build("z");
}

export function writeStl(mesh: Mesh, name = "key.is"): Uint8Array {
  const count = mesh.triangles.length / 3;
  const out = new Uint8Array(84 + count * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(`Binary STL written by ${name}`.slice(0, 80)));
  view.setUint32(80, count, true);
  for (let triangle = 0; triangle < count; triangle += 1) {
    const at = 84 + triangle * 50;
    const normal = faceNormal(mesh, triangle);
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    for (let axis = 0; axis < 3; axis += 1) view.setFloat32(at + axis * 4, normal[axis] / length, true);
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.triangles[triangle * 3 + corner] * 3;
      for (let axis = 0; axis < 3; axis += 1) view.setFloat32(at + 12 + corner * 12 + axis * 4, mesh.positions[vertex + axis], true);
    }
  }
  return out;
}

/* ---- OBJ ----------------------------------------------------------------- */

export function readObj(text: string): Mesh {
  const builder = new Builder();
  let vertices = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      builder.vertex(Number(x), Number(y), Number(z));
      vertices += 1;
    } else if (line.startsWith("f ")) {
      const indices = line
        .split(/\s+/)
        .slice(1)
        .map((token) => {
          const index = parseInt(token.split("/")[0], 10);
          return index < 0 ? vertices + index : index - 1;
        });
      if (indices.some((index) => Number.isNaN(index) || index < 0)) throw new ModelError("A face in this OBJ refers to a vertex that is not there.", "The file is damaged or cut short.");
      builder.polygon(indices);
    } else if (line.startsWith("o ") || line.startsWith("g ")) {
      builder.part(line.slice(2).trim() || "part");
    }
  }
  return builder.build("y");
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6);
}

export function writeObj(mesh: Mesh): string {
  const lines = ["# Written by key.is", `# ${mesh.positions.length / 3} vertices, ${mesh.triangles.length / 3} triangles`];
  for (let index = 0; index < mesh.positions.length; index += 3) lines.push(`v ${number(mesh.positions[index])} ${number(mesh.positions[index + 1])} ${number(mesh.positions[index + 2])}`);
  const parts = mesh.parts.length > 0 ? mesh.parts : [{ name: "model", start: 0, count: mesh.triangles.length / 3 }];
  for (const part of parts) {
    lines.push(`o ${part.name.replace(/\s+/g, "_")}`);
    for (let triangle = part.start; triangle < part.start + part.count; triangle += 1) lines.push(`f ${mesh.triangles[triangle * 3] + 1} ${mesh.triangles[triangle * 3 + 1] + 1} ${mesh.triangles[triangle * 3 + 2] + 1}`);
  }
  return `${lines.join("\n")}\n`;
}

/* ---- PLY ----------------------------------------------------------------- */

const PLY_TYPES: Record<string, [number, (view: DataView, at: number, little: boolean) => number]> = {
  char: [1, (view, at) => view.getInt8(at)],
  int8: [1, (view, at) => view.getInt8(at)],
  uchar: [1, (view, at) => view.getUint8(at)],
  uint8: [1, (view, at) => view.getUint8(at)],
  short: [2, (view, at, little) => view.getInt16(at, little)],
  int16: [2, (view, at, little) => view.getInt16(at, little)],
  ushort: [2, (view, at, little) => view.getUint16(at, little)],
  uint16: [2, (view, at, little) => view.getUint16(at, little)],
  int: [4, (view, at, little) => view.getInt32(at, little)],
  int32: [4, (view, at, little) => view.getInt32(at, little)],
  uint: [4, (view, at, little) => view.getUint32(at, little)],
  uint32: [4, (view, at, little) => view.getUint32(at, little)],
  float: [4, (view, at, little) => view.getFloat32(at, little)],
  float32: [4, (view, at, little) => view.getFloat32(at, little)],
  double: [8, (view, at, little) => view.getFloat64(at, little)],
  float64: [8, (view, at, little) => view.getFloat64(at, little)],
};

interface PlyProperty {
  name: string;
  type: string;
  list: { count: string } | null;
}

export function readPly(bytes: Uint8Array): Mesh {
  const headText = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const end = headText.indexOf("end_header");
  if (!headText.startsWith("ply") || end < 0) throw new ModelError("This is not a PLY file.", "A PLY file starts with the line ply.");
  const bodyStart = headText.indexOf("\n", end) + 1;
  const elements: { name: string; count: number; properties: PlyProperty[] }[] = [];
  let format = "ascii";
  for (const line of headText.slice(0, end).split(/\r?\n/)) {
    const words = line.trim().split(/\s+/);
    if (words[0] === "format") format = words[1];
    else if (words[0] === "element") elements.push({ name: words[1], count: Number(words[2]), properties: [] });
    else if (words[0] === "property" && elements.length > 0) {
      const element = elements[elements.length - 1];
      if (words[1] === "list") element.properties.push({ name: words[4], type: words[3], list: { count: words[2] } });
      else element.properties.push({ name: words[2], type: words[1], list: null });
    }
  }
  const builder = new Builder();
  const vertexElement = elements.find((element) => element.name === "vertex");
  if (!vertexElement) throw new ModelError("This PLY file has no vertices.", "It may be a point cloud of another kind.");
  if (format === "ascii") {
    const tokens = new TextDecoder("latin1").decode(bytes.subarray(bodyStart)).trim().split(/\s+/);
    let at = 0;
    for (const element of elements) {
      for (let row = 0; row < element.count; row += 1) {
        const values: Record<string, number | number[]> = {};
        for (const property of element.properties) {
          if (property.list) {
            const count = Number(tokens[at++]);
            values[property.name] = tokens.slice(at, at + count).map(Number);
            at += count;
          } else values[property.name] = Number(tokens[at++]);
        }
        if (element.name === "vertex") builder.vertex(values.x as number, values.y as number, values.z as number);
        else if (element.name === "face") builder.polygon((values.vertex_indices ?? values.vertex_index ?? []) as number[]);
      }
    }
    return builder.build("z");
  }
  const little = format === "binary_little_endian";
  if (!little && format !== "binary_big_endian") throw new ModelError(`PLY format ${format} is not one the standard defines.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = bodyStart;
  for (const element of elements) {
    for (let row = 0; row < element.count; row += 1) {
      let x = 0;
      let y = 0;
      let z = 0;
      let face: number[] | null = null;
      for (const property of element.properties) {
        const type = PLY_TYPES[property.type];
        if (!type) throw new ModelError(`PLY property type ${property.type} is not one the standard defines.`);
        if (property.list) {
          const countType = PLY_TYPES[property.list.count];
          if (at + countType[0] > bytes.length) throw new ModelError("This PLY file is cut short.");
          const count = countType[1](view, at, little);
          at += countType[0];
          const list: number[] = [];
          for (let index = 0; index < count; index += 1, at += type[0]) list.push(type[1](view, at, little));
          if (property.name === "vertex_indices" || property.name === "vertex_index") face = list;
        } else {
          if (at + type[0] > bytes.length) throw new ModelError("This PLY file is cut short.");
          const value = type[1](view, at, little);
          at += type[0];
          if (property.name === "x") x = value;
          else if (property.name === "y") y = value;
          else if (property.name === "z") z = value;
        }
      }
      if (element.name === "vertex") builder.vertex(x, y, z);
      else if (element.name === "face" && face) builder.polygon(face);
    }
  }
  return builder.build("z");
}

export function writePly(mesh: Mesh): Uint8Array {
  const vertices = mesh.positions.length / 3;
  const faces = mesh.triangles.length / 3;
  const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment Written by key.is\nelement vertex ${vertices}\nproperty float x\nproperty float y\nproperty float z\nelement face ${faces}\nproperty list uchar int vertex_indices\nend_header\n`);
  const out = new Uint8Array(header.length + vertices * 12 + faces * 13);
  out.set(header);
  const view = new DataView(out.buffer);
  let at = header.length;
  for (let index = 0; index < mesh.positions.length; index += 1, at += 4) view.setFloat32(at, mesh.positions[index], true);
  for (let face = 0; face < faces; face += 1) {
    out[at++] = 3;
    for (let corner = 0; corner < 3; corner += 1, at += 4) view.setInt32(at, mesh.triangles[face * 3 + corner], true);
  }
  return out;
}

/* ---- glTF ---------------------------------------------------------------- */

type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4 x 4 product, as glTF stores matrices. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) for (let k = 0; k < 4; k += 1) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  return out;
}

function nodeMatrix(node: Record<string, unknown>): Matrix {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix as number[];
  const [tx, ty, tz] = (node.translation as number[] | undefined) ?? [0, 0, 0];
  const [qx, qy, qz, qw] = (node.rotation as number[] | undefined) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (node.scale as number[] | undefined) ?? [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx,
    2 * (qx * qy + qz * qw) * sx,
    2 * (qx * qz - qy * qw) * sx,
    0,
    2 * (qx * qy - qz * qw) * sy,
    (1 - 2 * (qx * qx + qz * qz)) * sy,
    2 * (qy * qz + qx * qw) * sy,
    0,
    2 * (qx * qz + qy * qw) * sz,
    2 * (qy * qz - qx * qw) * sz,
    (1 - 2 * (qx * qx + qy * qy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGltf(bytes: Uint8Array): Mesh {
  let json: Record<string, unknown>;
  const buffers: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let binaryChunk: Uint8Array | null = null;
  if (bytes.length >= 12 && view.getUint32(0, true) === 0x46546c67) {
    if (view.getUint32(4, true) !== 2) throw new ModelError("Only glTF 2.0 binaries are read.", "This .glb says it is another version.");
    let at = 12;
    let jsonText = "";
    while (at + 8 <= bytes.length) {
      const length = view.getUint32(at, true);
      const type = view.getUint32(at + 4, true);
      const chunk = bytes.subarray(at + 8, at + 8 + length);
      if (type === 0x4e4f534a) jsonText = new TextDecoder().decode(chunk);
      else if (type === 0x004e4942) binaryChunk = chunk;
      at += 8 + length;
    }
    json = JSON.parse(jsonText) as Record<string, unknown>;
  } else {
    try {
      json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    } catch {
      throw new ModelError("This is neither a .glb nor a glTF JSON file.");
    }
  }
  const required = (json.extensionsRequired as string[] | undefined) ?? [];
  if (required.includes("KHR_draco_mesh_compression") || required.includes("EXT_meshopt_compression")) throw new ModelError("This model's geometry is compressed with Draco or meshopt, which this cannot unpack.", "Export it again without mesh compression.");
  for (const [index, buffer] of ((json.buffers as { uri?: string }[] | undefined) ?? []).entries()) {
    if (buffer.uri === undefined) {
      if (index === 0 && binaryChunk) buffers.push(binaryChunk);
      else throw new ModelError("A buffer has no data.");
    } else if (buffer.uri.startsWith("data:")) {
      const base64 = buffer.uri.slice(buffer.uri.indexOf(",") + 1);
      buffers.push(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
    } else throw new ModelError(`This .gltf keeps its geometry in a separate file, ${buffer.uri}.`, "Export a .glb, which carries everything in one file, or a .gltf with embedded buffers.");
  }
  const accessors = (json.accessors as Record<string, unknown>[] | undefined) ?? [];
  const views = (json.bufferViews as Record<string, unknown>[] | undefined) ?? [];
  const read = (index: number): { values: Float64Array; size: number } => {
    const accessor = accessors[index];
    if (!accessor) throw new ModelError("A mesh refers to data the file does not have.");
    if (accessor.sparse) throw new ModelError("This model uses sparse accessors, which this does not read.");
    const size = TYPE_COUNT[accessor.type as string];
    const componentType = accessor.componentType as number;
    const component = COMPONENT_SIZE[componentType];
    const count = accessor.count as number;
    const values = new Float64Array(count * size);
    if (accessor.bufferView === undefined) return { values, size };
    const bufferView = views[accessor.bufferView as number];
    const buffer = buffers[bufferView.buffer as number];
    const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const stride = (bufferView.byteStride as number | undefined) ?? size * component;
    const base = ((bufferView.byteOffset as number | undefined) ?? 0) + ((accessor.byteOffset as number | undefined) ?? 0);
    const normalized = accessor.normalized === true;
    for (let element = 0; element < count; element += 1) {
      for (let part = 0; part < size; part += 1) {
        const at = base + element * stride + part * component;
        let value: number;
        switch (componentType) {
          case 5126:
            value = data.getFloat32(at, true);
            break;
          case 5125:
            value = data.getUint32(at, true);
            break;
          case 5123:
            value = data.getUint16(at, true);
            if (normalized) value /= 65535;
            break;
          case 5122:
            value = data.getInt16(at, true);
            if (normalized) value = Math.max(value / 32767, -1);
            break;
          case 5121:
            value = data.getUint8(at);
            if (normalized) value /= 255;
            break;
          default:
            value = data.getInt8(at);
            if (normalized) value = Math.max(value / 127, -1);
        }
        values[element * size + part] = value;
      }
    }
    return { values, size };
  };
  const builder = new Builder();
  const nodes = (json.nodes as Record<string, unknown>[] | undefined) ?? [];
  const meshes = (json.meshes as Record<string, unknown>[] | undefined) ?? [];
  const addMesh = (meshIndex: number, matrix: Matrix, name: string) => {
    const mesh = meshes[meshIndex];
    if (!mesh) return;
    builder.part((mesh.name as string | undefined) ?? name);
    for (const primitive of (mesh.primitives as Record<string, unknown>[]) ?? []) {
      const mode = (primitive.mode as number | undefined) ?? 4;
      if (mode < 4) continue;
      const attributes = primitive.attributes as Record<string, number>;
      if (attributes.POSITION === undefined) continue;
      const { values } = read(attributes.POSITION);
      const offset = builder.positions.length / 3;
      for (let index = 0; index < values.length; index += 3) {
        const [x, y, z] = [values[index], values[index + 1], values[index + 2]];
        builder.vertex(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]);
      }
      const indices = primitive.indices !== undefined ? Array.from(read(primitive.indices as number).values) : Array.from({ length: values.length / 3 }, (_, index) => index);
      // A mirroring transform turns the triangles inside out; swapping two corners puts them back.
      const determinant = matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6]) - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2]) + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);
      const push = (a: number, b: number, c: number) => {
        if (determinant < 0) builder.triangles.push(offset + a, offset + c, offset + b);
        else builder.triangles.push(offset + a, offset + b, offset + c);
      };
      if (mode === 4) for (let index = 0; index + 2 < indices.length; index += 3) push(indices[index], indices[index + 1], indices[index + 2]);
      else if (mode === 5) {
        for (let index = 0; index + 2 < indices.length; index += 1) {
          if (index % 2 === 0) push(indices[index], indices[index + 1], indices[index + 2]);
          else push(indices[index + 1], indices[index], indices[index + 2]);
        }
      }
      else for (let index = 1; index + 1 < indices.length; index += 1) push(indices[0], indices[index], indices[index + 1]);
    }
  };
  const visit = (index: number, parent: Matrix, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 64) return;
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) addMesh(node.mesh as number, matrix, (node.name as string | undefined) ?? `mesh ${node.mesh}`);
    for (const childIndex of (node.children as number[] | undefined) ?? []) visit(childIndex, matrix, depth + 1);
  };
  const scenes = (json.scenes as { nodes?: number[] }[] | undefined) ?? [];
  const scene = scenes[(json.scene as number | undefined) ?? 0];
  if (scene?.nodes) for (const index of scene.nodes) visit(index, IDENTITY, 0);
  else meshes.forEach((_, index) => addMesh(index, IDENTITY, `mesh ${index}`));
  if (builder.triangles.length === 0) throw new ModelError("This glTF file has no triangles in it.", "It may hold only points, lines, cameras or an animation.");
  return builder.build("y", "meter");
}

export function writeGlb(mesh: Mesh): Uint8Array {
  const vertices = mesh.positions.length / 3;
  const wide = vertices > 65535;
  const positions = Float32Array.from(mesh.positions);
  const indices = wide ? Uint32Array.from(mesh.triangles) : Uint16Array.from(mesh.triangles);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 1) {
    min[index % 3] = Math.min(min[index % 3], positions[index]);
    max[index % 3] = Math.max(max[index % 3], positions[index]);
  }
  const positionBytes = positions.byteLength;
  const indexBytes = indices.byteLength;
  const indexPadding = (4 - (indexBytes % 4)) % 4;
  const binLength = positionBytes + indexBytes + indexPadding;
  const json = {
    asset: { version: "2.0", generator: "key.is" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: mesh.parts[0]?.name ?? "model" }],
    meshes: [{ name: mesh.parts[0]?.name ?? "model", primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [{ byteLength: binLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes, byteLength: indexBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertices, type: "VEC3", min: vertices ? min : [0, 0, 0], max: vertices ? max : [0, 0, 0] },
      { bufferView: 1, componentType: wide ? 5125 : 5123, count: mesh.triangles.length, type: "SCALAR" },
    ],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  jsonBytes = Uint8Array.from([...jsonBytes, ...new Array<number>(jsonPadding).fill(0x20)]);
  const total = 12 + 8 + jsonBytes.length + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const bin = 20 + jsonBytes.length;
  view.setUint32(bin, binLength, true);
  view.setUint32(bin + 4, 0x004e4942, true);
  out.set(new Uint8Array(positions.buffer), bin + 8);
  out.set(new Uint8Array(indices.buffer), bin + 8 + positionBytes);
  return out;
}

/* ---- 3MF ----------------------------------------------------------------- */

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /([\w:]+)\s*=\s*"([^"]*)"|([\w:]+)\s*=\s*'([^']*)'/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) out[match[1] ?? match[3]] = match[2] ?? match[4];
  return out;
}

/** A 3MF transform, "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32", as a column-major 4 x 4 matrix. */
function threeMfMatrix(text: string | undefined): Matrix {
  if (!text) return IDENTITY;
  const m = text.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || m.some((value) => Number.isNaN(value))) return IDENTITY;
  // 3MF multiplies row vectors on the left: x' = x m00 + y m10 + z m20 + m30.
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, m[9], m[10], m[11], 1];
}

interface ThreeMfObject {
  name: string;
  positions: number[];
  triangles: number[];
  components: { objectId: string; path: string | null; matrix: Matrix }[];
}

function parseModel(text: string, path: string, into: Map<string, ThreeMfObject>): { unit: string; build: { objectId: string; path: string | null; matrix: Matrix }[] } {
  const unit = attributes(/<model\b([^>]*)>/.exec(text)?.[1] ?? "").unit ?? "millimeter";
  const objectPattern = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  for (let match = objectPattern.exec(text); match; match = objectPattern.exec(text)) {
    const attrs = attributes(match[1]);
    const body = match[2];
    const object: ThreeMfObject = { name: attrs.name ?? `object ${attrs.id}`, positions: [], triangles: [], components: [] };
    const vertexPattern = /<vertex\b([^>]*)\/?>/g;
    for (let vertex = vertexPattern.exec(body); vertex; vertex = vertexPattern.exec(body)) {
      const v = attributes(vertex[1]);
      object.positions.push(Number(v.x), Number(v.y), Number(v.z));
    }
    const trianglePattern = /<triangle\b([^>]*)\/?>/g;
    for (let triangle = trianglePattern.exec(body); triangle; triangle = trianglePattern.exec(body)) {
      const t = attributes(triangle[1]);
      object.triangles.push(Number(t.v1), Number(t.v2), Number(t.v3));
    }
    const componentPattern = /<component\b([^>]*)\/?>/g;
    for (let component = componentPattern.exec(body); component; component = componentPattern.exec(body)) {
      const c = attributes(component[1]);
      object.components.push({ objectId: c.objectid, path: c["p:path"] ?? null, matrix: threeMfMatrix(c.transform) });
    }
    into.set(`${path}#${attrs.id}`, object);
  }
  const build: { objectId: string; path: string | null; matrix: Matrix }[] = [];
  const buildBody = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(text)?.[1] ?? "";
  const itemPattern = /<item\b([^>]*)\/?>/g;
  for (let item = itemPattern.exec(buildBody); item; item = itemPattern.exec(buildBody)) {
    const i = attributes(item[1]);
    if (i.printable === "0") continue;
    build.push({ objectId: i.objectid, path: i["p:path"] ?? null, matrix: threeMfMatrix(i.transform) });
  }
  return { unit, build };
}

export function read3mf(bytes: Uint8Array): Mesh {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ModelError("This 3MF file is not a readable ZIP archive.", "A 3MF file is a ZIP; this one is damaged.");
  }
  const decoder = new TextDecoder();
  const rels = files["_rels/.rels"] ? decoder.decode(files["_rels/.rels"]) : "";
  const target = /Target="\/?([^"]+)"[^>]*Type="[^"]*3dmodel"|Type="[^"]*3dmodel"[^>]*Target="\/?([^"]+)"/.exec(rels);
  const mainPath = target?.[1] ?? target?.[2] ?? "3D/3dmodel.model";
  if (!files[mainPath]) throw new ModelError("This 3MF file has no 3D model in it.", "It may be a slicer project with only settings.");
  const objects = new Map<string, ThreeMfObject>();
  const parsed = new Set<string>();
  const load = (path: string) => {
    if (parsed.has(path) || !files[path]) return null;
    parsed.add(path);
    return parseModel(decoder.decode(files[path]), path, objects);
  };
  const main = load(mainPath)!;
  const builder = new Builder();
  const place = (path: string, objectId: string, matrix: Matrix, depth: number) => {
    const key = `${path}#${objectId}`;
    if (!objects.has(key)) load(path);
    const object = objects.get(key);
    if (!object || depth > 32) return;
    if (object.triangles.length > 0) {
      builder.part(object.name);
      const offset = builder.positions.length / 3;
      for (let index = 0; index < object.positions.length; index += 3) {
        const [x, y, z] = [object.positions[index], object.positions[index + 1], object.positions[index + 2]];
        builder.vertex(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]);
      }
      for (const index of object.triangles) builder.triangles.push(index + offset);
    }
    for (const component of object.components) {
      const componentPath = component.path ? component.path.replace(/^\//, "") : path;
      place(componentPath, component.objectId, multiply(matrix, component.matrix), depth + 1);
    }
  };
  for (const item of main.build) place(item.path ? item.path.replace(/^\//, "") : mainPath, item.objectId, item.matrix, 0);
  if (builder.triangles.length === 0) throw new ModelError("This 3MF file's build has no triangles in it.");
  return builder.build("z", main.unit);
}

export function write3mf(mesh: Mesh): Uint8Array {
  const vertices: string[] = [];
  for (let index = 0; index < mesh.positions.length; index += 3) vertices.push(`<vertex x="${number(mesh.positions[index])}" y="${number(mesh.positions[index + 1])}" z="${number(mesh.positions[index + 2])}"/>`);
  const triangles: string[] = [];
  for (let index = 0; index < mesh.triangles.length; index += 3) triangles.push(`<triangle v1="${mesh.triangles[index]}" v2="${mesh.triangles[index + 1]}" v3="${mesh.triangles[index + 2]}"/>`);
  const name = (mesh.parts[0]?.name ?? "model").replace(/[<>&"]/g, "");
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="${mesh.unit ?? "millimeter"}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<metadata name="Application">key.is</metadata>\n<resources>\n<object id="1" type="model" name="${name}">\n<mesh>\n<vertices>\n${vertices.join("\n")}\n</vertices>\n<triangles>\n${triangles.join("\n")}\n</triangles>\n</mesh>\n</object>\n</resources>\n<build>\n<item objectid="1"/>\n</build>\n</model>\n`;
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n'),
    "3D/3dmodel.model": [strToU8(model), { level: 6 }],
  });
}

/* ---- Dispatch ------------------------------------------------------------ */

/** The format of a model file, from its bytes first and its name second. */
export function detectFormat(bytes: Uint8Array, name: string): ModelFormat | null {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) return "glb";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "3mf";
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 256));
  if (head.startsWith("ply")) return "ply";
  if (extension === "stl") return "stl";
  if (extension === "obj") return "obj";
  if (extension === "gltf" || /^\s*\{/.test(head)) return "gltf";
  if (/^\s*solid\b/.test(head)) return "stl";
  if (/^\s*(#|v |o |g |mtllib)/m.test(head)) return "obj";
  if (bytes.length >= 84 && 84 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) * 50 === bytes.length) return "stl";
  return null;
}

export function readModel(bytes: Uint8Array, name: string): { mesh: Mesh; format: ModelFormat } {
  const format = detectFormat(bytes, name);
  switch (format) {
    case "stl":
      return { mesh: readStl(bytes), format };
    case "obj":
      return { mesh: readObj(new TextDecoder().decode(bytes)), format };
    case "ply":
      return { mesh: readPly(bytes), format };
    case "glb":
    case "gltf":
      return { mesh: readGltf(bytes), format };
    case "3mf":
      return { mesh: read3mf(bytes), format };
    default:
      throw new ModelError("This is not a 3D model this reads.", "Drop an STL, OBJ, PLY, glTF (.glb or embedded .gltf) or 3MF file.");
  }
}

export const MODEL_ACCEPT = ".stl,.obj,.ply,.glb,.gltf,.3mf,model/stl,model/obj,model/gltf-binary,model/gltf+json,model/3mf";

export const FORMAT_LABELS: Record<ModelFormat, string> = { stl: "STL", obj: "OBJ", ply: "PLY", glb: "glTF binary (.glb)", gltf: "glTF", "3mf": "3MF" };

