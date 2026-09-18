/**
 * Pictures turned, padded to a shape, adjusted pixel by pixel, and SVGs
 * measured for drawing.
 *
 * The arithmetic is pure and tested; the drawing needs a canvas.
 */
import { drawImage, type DecodedImage, type Size } from "./canvas";

/* ---- Turns -------------------------------------------------------------- */

export type Turn = "cw" | "ccw" | "half" | "flip-h" | "flip-v";

export const TURN_OPTIONS: readonly { id: Turn; label: string; blurb: string }[] = [
  { id: "cw", label: "Quarter turn right", blurb: "90 degrees clockwise" },
  { id: "ccw", label: "Quarter turn left", blurb: "90 degrees anticlockwise" },
  { id: "half", label: "Half turn", blurb: "Upside down" },
  { id: "flip-h", label: "Mirror", blurb: "Flipped left to right" },
  { id: "flip-v", label: "Flip vertically", blurb: "Flipped top to bottom" },
];

/** The size of the picture after a turn: swapped for a quarter, the same otherwise. */
export function turnedSize(size: Size, turn: Turn): Size {
  return turn === "cw" || turn === "ccw" ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

/**
 * The canvas transform that puts the picture in the turned frame, as the
 * six numbers `setTransform` takes: x' = a x + c y + e, y' = b x + d y + f,
 * in canvas coordinates where y runs down the page.
 */
export function turnMatrix(size: Size, turn: Turn): [number, number, number, number, number, number] {
  switch (turn) {
    case "cw":
      return [0, 1, -1, 0, size.height, 0];
    case "ccw":
      return [0, -1, 1, 0, 0, size.width];
    case "half":
      return [-1, 0, 0, -1, size.width, size.height];
    case "flip-h":
      return [-1, 0, 0, 1, size.width, 0];
    case "flip-v":
      return [1, 0, 0, -1, 0, size.height];
  }
}

/** Where a point of the picture lands after the turn, for checking the matrix. */
export function turnPoint(size: Size, turn: Turn, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = turnMatrix(size, turn);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The picture drawn turned, on a background for the formats without transparency. */
export function drawTurned(image: DecodedImage, turn: Turn, background: string | null): AnyCanvas {
  const size = { width: image.width, height: image.height };
  const turned = turnedSize(size, turn);
  const canvas = makeCanvas(turned.width, turned.height);
  const context = canvas.getContext("2d") as AnyContext;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, turned.width, turned.height);
  }
  context.setTransform(...turnMatrix(size, turn));
  context.drawImage(image.source, 0, 0);
  context.resetTransform();
  return canvas;
}

/* ---- Padding to a shape ------------------------------------------------- */

export interface PadPlan extends Size {
  /** Where the picture sits, centred. */
  x: number;
  y: number;
}

/**
 * The smallest frame of the shape that holds the whole picture: as wide
 * as the picture when the picture is the wider, as tall when it is the
 * taller, with the picture centred and nothing cut off.
 */
export function padPlan(size: Size, aspect: { width: number; height: number }): PadPlan {
  const target = aspect.width / aspect.height;
  const current = size.width / size.height;
  let width = size.width;
  let height = size.height;
  if (current > target) height = Math.round(size.width / target);
  else width = Math.round(size.height * target);
  return { width, height, x: Math.round((width - size.width) / 2), y: Math.round((height - size.height) / 2) };
}

export type PadBackground = "white" | "black" | "blur" | "transparent";

export const PAD_BACKGROUNDS: readonly { id: PadBackground; label: string; blurb: string }[] = [
  { id: "white", label: "White", blurb: "Plain white bars" },
  { id: "black", label: "Black", blurb: "Plain black bars" },
  { id: "blur", label: "Blurred picture", blurb: "The picture itself, blown up and blurred, behind it: the feed look" },
  { id: "transparent", label: "Transparent", blurb: "Nothing, as PNG or WebP" },
];

/**
 * The picture on its padded frame.
 *
 * The blur needs no filter support: the picture is drawn tiny and then
 * drawn back up to fill the frame, which the scaler smooths into a blur
 * on every browser.
 */
export function drawPadded(image: DecodedImage, plan: PadPlan, background: PadBackground): AnyCanvas {
  const canvas = makeCanvas(plan.width, plan.height);
  const context = canvas.getContext("2d") as AnyContext;
  if (background === "white" || background === "black") {
    context.fillStyle = background === "white" ? "#ffffff" : "#000000";
    context.fillRect(0, 0, plan.width, plan.height);
  } else if (background === "blur") {
    const cover = Math.max(plan.width / image.width, plan.height / image.height);
    const tiny = makeCanvas(Math.max(1, Math.round(image.width / 24)), Math.max(1, Math.round(image.height / 24)));
    const tinyContext = tiny.getContext("2d") as AnyContext;
    tinyContext.imageSmoothingQuality = "high";
    tinyContext.drawImage(image.source, 0, 0, tiny.width, tiny.height);
    const width = image.width * cover;
    const height = image.height * cover;
    context.imageSmoothingQuality = "high";
    context.drawImage(tiny, (plan.width - width) / 2, (plan.height - height) / 2, width, height);
    // A touch of dark over the blur, so the picture in front stands off it.
    context.fillStyle = "rgba(0, 0, 0, 0.18)";
    context.fillRect(0, 0, plan.width, plan.height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, plan.x, plan.y, image.width, image.height);
  return canvas;
}

/* ---- Adjustments -------------------------------------------------------- */

export type Adjustment = "grayscale" | "sepia" | "invert" | "brighter" | "darker" | "more-contrast" | "less-contrast";

export const ADJUSTMENTS: readonly { id: Adjustment; label: string; blurb: string }[] = [
  { id: "grayscale", label: "Black and white", blurb: "Colour taken out, by how bright each pixel is" },
  { id: "sepia", label: "Sepia", blurb: "The warm brown of an old photograph" },
  { id: "invert", label: "Negative", blurb: "Every colour inverted" },
  { id: "brighter", label: "Brighter", blurb: "A fifth lighter" },
  { id: "darker", label: "Darker", blurb: "A fifth darker" },
  { id: "more-contrast", label: "More contrast", blurb: "Lights lighter, darks darker" },
  { id: "less-contrast", label: "Less contrast", blurb: "Flatter, for text over a picture" },
];

const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

/** The pixels changed in place; alpha is left alone. */
export function adjustPixels(data: Uint8ClampedArray, adjustment: Adjustment): void {
  for (let at = 0; at < data.length; at += 4) {
    const r = data[at];
    const g = data[at + 1];
    const b = data[at + 2];
    switch (adjustment) {
      case "grayscale": {
        const luma = clamp(0.299 * r + 0.587 * g + 0.114 * b);
        data[at] = luma;
        data[at + 1] = luma;
        data[at + 2] = luma;
        break;
      }
      case "sepia":
        data[at] = clamp(0.393 * r + 0.769 * g + 0.189 * b);
        data[at + 1] = clamp(0.349 * r + 0.686 * g + 0.168 * b);
        data[at + 2] = clamp(0.272 * r + 0.534 * g + 0.131 * b);
        break;
      case "invert":
        data[at] = 255 - r;
        data[at + 1] = 255 - g;
        data[at + 2] = 255 - b;
        break;
      case "brighter":
      case "darker": {
        const factor = adjustment === "brighter" ? 1.2 : 0.8;
        data[at] = clamp(r * factor);
        data[at + 1] = clamp(g * factor);
        data[at + 2] = clamp(b * factor);
        break;
      }
      case "more-contrast":
      case "less-contrast": {
        const factor = adjustment === "more-contrast" ? 1.3 : 0.75;
        data[at] = clamp((r - 128) * factor + 128);
        data[at + 1] = clamp((g - 128) * factor + 128);
        data[at + 2] = clamp((b - 128) * factor + 128);
        break;
      }
    }
  }
}

/** The picture drawn at its own size and adjusted. */
export function drawAdjusted(image: DecodedImage, adjustment: Adjustment, background: string | null): AnyCanvas {
  const size = { width: image.width, height: image.height };
  const canvas = drawImage(image, size, background);
  const context = canvas.getContext("2d") as AnyContext;
  const pixels = context.getImageData(0, 0, size.width, size.height);
  adjustPixels(pixels.data, adjustment);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/* ---- SVG ---------------------------------------------------------------- */

/** CSS pixels per unit, for the lengths an SVG's width and height may carry. */
const UNITS: Record<string, number> = { "": 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

/** A length attribute as CSS pixels, or null for a percentage or nonsense. */
export function svgLength(value: string | null): number | null {
  if (value === null) return null;
  const match = value.trim().match(/^([0-9]*\.?[0-9]+)(px|pt|pc|mm|cm|in)?$/);
  if (!match) return null;
  const number = Number(match[1]) * UNITS[match[2] ?? ""];
  return number > 0 ? number : null;
}

/** The root `<svg>` tag's attributes, or null when there is no such tag. */
function rootAttributes(text: string): string | null {
  const match = text.match(/<svg\b([^>]*)>/i);
  return match ? match[1] : null;
}

function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3]) : null;
}

/**
 * The size an SVG draws at: its width and height when it states them, else
 * its viewBox, else null for a picture with no size of its own.
 */
export function svgSize(text: string): Size | null {
  const attributes = rootAttributes(text);
  if (attributes === null) return null;
  const width = svgLength(attribute(attributes, "width"));
  const height = svgLength(attribute(attributes, "height"));
  if (width && height) return { width, height };
  const viewBox = attribute(attributes, "viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    if (width) return { width, height: (width * viewBox[3]) / viewBox[2] };
    if (height) return { width: (height * viewBox[2]) / viewBox[3], height };
    return { width: viewBox[2], height: viewBox[3] };
  }
  return null;
}

/** The SVG with its root told to draw at a size, and the namespace it needs to be an image. */
export function svgAtSize(text: string, width: number, height: number): string {
  return text.replace(/<svg\b([^>]*)>/i, (_match, attributes: string) => {
    const selfClosing = /\/\s*$/.test(attributes);
    let next = attributes.replace(/\/\s*$/, "").replace(/\s+(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    if (!/xmlns\s*=/.test(next)) next += ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${next} width="${width}" height="${height}"${selfClosing ? "/" : ""}>`;
  });
}

/** Whether the text is plausibly an SVG document. */
export function looksLikeSvg(text: string): boolean {
  return /<svg\b/i.test(text.slice(0, 64 * 1024));
}
