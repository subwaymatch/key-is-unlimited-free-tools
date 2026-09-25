/**
 * A mesh drawn as a picture: an orthographic view from above and to one
 * side, each triangle lit by its angle to a light over the viewer's
 * shoulder, hidden surfaces removed with a depth buffer.
 *
 * A software rasteriser rather than WebGL: a preview is one frame, a
 * million triangles fill a 900-pixel square in about a second, and the
 * same code runs in the tests.
 */
import { convertUp, type Mesh } from "./mesh";

export interface RenderOptions {
  size: number;
  /** Turn about the vertical axis, in degrees. */
  yaw?: number;
  /** Tilt looking down, in degrees. */
  pitch?: number;
  background?: [number, number, number];
  colour?: [number, number, number];
}

/** RGBA pixels, `size` square. */
export function renderMesh(input: Mesh, options: RenderOptions): Uint8ClampedArray {
  const mesh = convertUp(input, "z");
  const { size } = options;
  const yaw = ((options.yaw ?? -35) * Math.PI) / 180;
  const pitch = ((options.pitch ?? 28) * Math.PI) / 180;
  const background = options.background ?? [246, 247, 249];
  const colour = options.colour ?? [70, 125, 205];
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index += 1) pixels.set([...background, 255], index * 4);
  const count = mesh.triangles.length / 3;
  if (count === 0) return pixels;

  // View space: turn about Z, then tilt about X, so Z-up models stand upright on screen.
  const vertices = mesh.positions.length / 3;
  const view = new Float64Array(vertices * 3);
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const used = new Uint8Array(vertices);
  for (const index of mesh.triangles) used[index] = 1;
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const x = mesh.positions[vertex * 3];
    const y = mesh.positions[vertex * 3 + 1];
    const z = mesh.positions[vertex * 3 + 2];
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    // Screen x right, screen y down, depth towards the viewer.
    const sx = x1;
    const sz = y1 * cp - z * sp;
    const syScreen = -(y1 * sp + z * cp);
    view.set([sx, syScreen, -sz], vertex * 3);
    if (!used[vertex]) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], view[vertex * 3 + axis]);
      max[axis] = Math.max(max[axis], view[vertex * 3 + axis]);
    }
  }
  const span = Math.max(max[0] - min[0], max[1] - min[1]) || 1;
  const scale = (size * 0.86) / span;
  const offsetX = size / 2 - ((min[0] + max[0]) / 2) * scale;
  const offsetY = size / 2 - ((min[1] + max[1]) / 2) * scale;
  const depth = new Float32Array(size * size).fill(-Infinity);
  const light = [-0.35, -0.55, 0.76];
  const lightLength = Math.hypot(light[0], light[1], light[2]);

  for (let triangle = 0; triangle < count; triangle += 1) {
    const a = mesh.triangles[triangle * 3] * 3;
    const b = mesh.triangles[triangle * 3 + 1] * 3;
    const c = mesh.triangles[triangle * 3 + 2] * 3;
    const ax = view[a] * scale + offsetX;
    const ay = view[a + 1] * scale + offsetY;
    const bx = view[b] * scale + offsetX;
    const by = view[b + 1] * scale + offsetY;
    const cx = view[c] * scale + offsetX;
    const cyy = view[c + 1] * scale + offsetY;
    const area = (bx - ax) * (cyy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    // Lighting from the face normal in view space; both sides are lit, so a mesh facing inwards still shows.
    const ux = view[b] - view[a];
    const uy = view[b + 1] - view[a + 1];
    const uz = view[b + 2] - view[a + 2];
    const vx = view[c] - view[a];
    const vy = view[c + 1] - view[a + 1];
    const vz = view[c + 2] - view[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    const lambert = Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / (length * lightLength));
    const shade = 0.28 + 0.72 * lambert;
    const r = Math.round(colour[0] * shade);
    const g = Math.round(colour[1] * shade);
    const bl = Math.round(colour[2] * shade);
    const left = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const right = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const top = Math.max(0, Math.floor(Math.min(ay, by, cyy)));
    const bottom = Math.min(size - 1, Math.ceil(Math.max(ay, by, cyy)));
    const za = view[a + 2];
    const zb = view[b + 2];
    const zc = view[c + 2];
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        const x = px + 0.5;
        const y = py + 0.5;
        const w0 = ((bx - x) * (cyy - y) - (by - y) * (cx - x)) / area;
        const w1 = ((cx - x) * (ay - y) - (cyy - y) * (ax - x)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * za + w1 * zb + w2 * zc;
        const at = py * size + px;
        if (z <= depth[at]) continue;
        depth[at] = z;
        pixels[at * 4] = r;
        pixels[at * 4 + 1] = g;
        pixels[at * 4 + 2] = bl;
      }
    }
  }
  return pixels;
}

/** The preview as a PNG, through a canvas; null where there is no canvas, as in tests. */
export async function previewPng(mesh: Mesh, size = 720): Promise<Blob | null> {
  const pixels = renderMesh(mesh, { size });
  const image = new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, size, size);
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(size, size);
    canvas.getContext("2d")!.putImageData(image, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}
