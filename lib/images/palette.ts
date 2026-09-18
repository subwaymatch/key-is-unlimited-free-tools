/**
 * The colours a picture is mostly made of.
 *
 * Median cut: every opaque pixel goes in one box, the box is split at the
 * median of whichever channel varies most, the widest box is split again,
 * and so on until there are as many boxes as colours wanted; each box's
 * average is a colour and its pixel count is how much of the picture it
 * covers. Simple, forty years old, and what most palette extractors do.
 *
 * Pure, on pixel arrays; the picture is decoded and sampled by the caller.
 */

export interface Swatch {
  r: number;
  g: number;
  b: number;
  hex: string;
  /** Share of the opaque pixels, 0 to 1. */
  share: number;
}

export const PALETTE_SIZES: readonly { count: number; label: string; blurb: string }[] = [
  { count: 5, label: "5 colours", blurb: "The main ones" },
  { count: 8, label: "8 colours", blurb: "The usual choice" },
  { count: 12, label: "12 colours", blurb: "With the accents" },
];

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

/** Black or white, whichever reads on this colour. */
export function contrastingText(r: number, g: number, b: number): "#000000" | "#ffffff" {
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.4 ? "#000000" : "#ffffff";
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

interface Box {
  /** Indexes into the pixel list. */
  pixels: Uint32Array;
  ranges: [number, number, number];
}

function rangesOf(pixels: Uint32Array, colours: Uint8ClampedArray): [number, number, number] {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const index of pixels) {
    for (let c = 0; c < 3; c += 1) {
      const value = colours[index * 4 + c];
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/**
 * The palette of RGBA pixels, largest share first.
 *
 * Pixels more than half transparent are left out, so a logo on nothing is
 * described by the logo. A picture with fewer distinct colours than asked
 * for gets fewer back.
 */
export function medianCut(colours: Uint8ClampedArray, count: number): Swatch[] {
  const opaque: number[] = [];
  for (let index = 0; index < colours.length / 4; index += 1) if (colours[index * 4 + 3] >= 128) opaque.push(index);
  if (opaque.length === 0) return [];
  const boxes: Box[] = [{ pixels: Uint32Array.from(opaque), ranges: rangesOf(Uint32Array.from(opaque), colours) }];
  while (boxes.length < count) {
    // The box with the widest spread on any channel, if it has anything to split.
    let widest = -1;
    let spread = 0;
    boxes.forEach((box, index) => {
      const range = Math.max(...box.ranges);
      if (box.pixels.length > 1 && range > spread) {
        spread = range;
        widest = index;
      }
    });
    if (widest === -1) break;
    const box = boxes[widest];
    const channelIndex = box.ranges.indexOf(Math.max(...box.ranges));
    const sorted = Array.from(box.pixels).sort((a, b) => colours[a * 4 + channelIndex] - colours[b * 4 + channelIndex]);
    const middle = Math.floor(sorted.length / 2);
    const left = Uint32Array.from(sorted.slice(0, middle));
    const right = Uint32Array.from(sorted.slice(middle));
    boxes.splice(widest, 1, { pixels: left, ranges: rangesOf(left, colours) }, { pixels: right, ranges: rangesOf(right, colours) });
  }
  const swatches = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const index of box.pixels) {
      r += colours[index * 4];
      g += colours[index * 4 + 1];
      b += colours[index * 4 + 2];
    }
    const n = box.pixels.length;
    const [ar, ag, ab] = [r / n, g / n, b / n].map(Math.round);
    return { r: ar, g: ag, b: ab, hex: toHex(ar, ag, ab), share: n / opaque.length };
  });
  return mergeAlike(swatches).sort((a, b) => b.share - a.share);
}

/** Two boxes that ended up the same colour become one entry. */
function mergeAlike(swatches: Swatch[]): Swatch[] {
  const byHex = new Map<string, Swatch>();
  for (const swatch of swatches) {
    const existing = byHex.get(swatch.hex);
    if (existing) existing.share += swatch.share;
    else byHex.set(swatch.hex, { ...swatch });
  }
  return [...byHex.values()];
}

/** The palette as text: one line per colour with its share, then CSS custom properties to paste. */
export function paletteText(swatches: readonly Swatch[], name: string): string {
  const lines = [`Colours of ${name}`, ""];
  for (const swatch of swatches) {
    lines.push(`${swatch.hex}  rgb(${swatch.r}, ${swatch.g}, ${swatch.b})  ${Math.round(swatch.share * 100)}%`);
  }
  lines.push("", ":root {");
  swatches.forEach((swatch, index) => lines.push(`  --colour-${index + 1}: ${swatch.hex};`));
  lines.push("}", "");
  return lines.join("\n");
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The palette drawn as a strip of blocks, each labelled with its hex code. */
export function drawSwatches(swatches: readonly Swatch[], width = 960, height = 160): AnyCanvas {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const cell = width / Math.max(1, swatches.length);
  const fontSize = Math.max(10, Math.min(18, Math.floor(cell / 6)));
  context.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "bottom";
  swatches.forEach((swatch, index) => {
    const x = Math.round(index * cell);
    const next = Math.round((index + 1) * cell);
    context.fillStyle = swatch.hex;
    context.fillRect(x, 0, next - x, height);
    context.fillStyle = contrastingText(swatch.r, swatch.g, swatch.b);
    context.fillText(swatch.hex, x + (next - x) / 2, height - 10, next - x - 8);
  });
  return canvas;
}
