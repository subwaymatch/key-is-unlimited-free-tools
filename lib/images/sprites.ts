/**
 * Many small pictures laid out on one sheet, with the CSS and the JSON
 * that say where each one is: the sprite sheet games and websites load as
 * one file instead of hundreds.
 *
 * Packed layout places the pictures tallest first along shelves as wide as
 * a square of their total area would be; a grid gives every picture a cell
 * the size of the largest; a row or a column puts them side by side. The
 * JSON follows TexturePacker's hash format, which Phaser, PixiJS and most
 * engines read.
 */

export type SpriteLayout = "packed" | "grid" | "row" | "column";

export interface SpriteInput {
  name: string;
  width: number;
  height: number;
}

export interface SpriteFrame extends SpriteInput {
  x: number;
  y: number;
}

export interface SpriteSheet {
  width: number;
  height: number;
  frames: SpriteFrame[];
}

/** Where every picture goes. Frames come back in the order the pictures were given. */
export function layoutSprites(inputs: readonly SpriteInput[], layout: SpriteLayout, padding: number): SpriteSheet {
  if (inputs.length === 0) return { width: 0, height: 0, frames: [] };
  const frames: SpriteFrame[] = inputs.map((input) => ({ ...input, x: 0, y: 0 }));
  if (layout === "row" || layout === "column") {
    let at = padding;
    for (const frame of frames) {
      if (layout === "row") {
        frame.x = at;
        frame.y = padding;
        at += frame.width + padding;
      } else {
        frame.x = padding;
        frame.y = at;
        at += frame.height + padding;
      }
    }
    const across = Math.max(...frames.map((frame) => (layout === "row" ? frame.height : frame.width))) + padding * 2;
    return layout === "row" ? { width: at, height: across, frames } : { width: across, height: at, frames };
  }
  if (layout === "grid") {
    const cellWidth = Math.max(...frames.map((frame) => frame.width));
    const cellHeight = Math.max(...frames.map((frame) => frame.height));
    const columns = Math.ceil(Math.sqrt(frames.length));
    const rows = Math.ceil(frames.length / columns);
    frames.forEach((frame, index) => {
      // Each picture centred in its cell, so frames of mixed sizes line up by their middles.
      frame.x = padding + (index % columns) * (cellWidth + padding) + Math.floor((cellWidth - frame.width) / 2);
      frame.y = padding + Math.floor(index / columns) * (cellHeight + padding) + Math.floor((cellHeight - frame.height) / 2);
    });
    return { width: padding + columns * (cellWidth + padding), height: padding + rows * (cellHeight + padding), frames };
  }
  // Shelves, tallest first, as wide as the square the pictures would fill, and never narrower than the widest.
  const area = frames.reduce((sum, frame) => sum + (frame.width + padding) * (frame.height + padding), 0);
  const shelfWidth = Math.max(Math.ceil(Math.sqrt(area)), Math.max(...frames.map((frame) => frame.width)) + padding * 2);
  const order = frames.map((_, index) => index).sort((a, b) => frames[b].height - frames[a].height || frames[b].width - frames[a].width);
  let x = padding;
  let y = padding;
  let shelf = 0;
  let width = 0;
  for (const index of order) {
    const frame = frames[index];
    if (x + frame.width + padding > shelfWidth && x > padding) {
      y += shelf + padding;
      x = padding;
      shelf = 0;
    }
    frame.x = x;
    frame.y = y;
    x += frame.width + padding;
    shelf = Math.max(shelf, frame.height);
    width = Math.max(width, x);
  }
  return { width, height: y + shelf + padding, frames };
}

/** A CSS class name from a file name: "icons/Arrow Left@2x.png" to "arrow-left-2x". */
export function spriteClass(name: string): string {
  const stem = name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return (
    stem
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^(\d)/, "s-$1") || "sprite"
  );
}

/** Class names made unique, in order. */
export function uniqueClasses(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const base = spriteClass(name);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}

export function spriteCss(sheet: SpriteSheet, imageName: string, prefix = "sprite"): string {
  const classes = uniqueClasses(sheet.frames.map((frame) => frame.name));
  const lines = [`/* ${sheet.frames.length} sprites on a ${sheet.width} x ${sheet.height} sheet, written by key.is */`, `.${prefix} {`, `  display: inline-block;`, `  background-image: url("${imageName}");`, `  background-repeat: no-repeat;`, `}`, ""];
  sheet.frames.forEach((frame, index) => {
    lines.push(`.${prefix}-${classes[index]} {`, `  width: ${frame.width}px;`, `  height: ${frame.height}px;`, `  background-position: ${frame.x === 0 ? "0" : `-${frame.x}px`} ${frame.y === 0 ? "0" : `-${frame.y}px`};`, `}`, "");
  });
  return lines.join("\n");
}

export function spriteJson(sheet: SpriteSheet, imageName: string): string {
  const frames: Record<string, unknown> = {};
  for (const frame of sheet.frames) {
    frames[frame.name] = { frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: frame.width, h: frame.height }, sourceSize: { w: frame.width, h: frame.height } };
  }
  return `${JSON.stringify({ frames, meta: { app: "https://key.is", version: "1.0", image: imageName, format: "RGBA8888", size: { w: sheet.width, h: sheet.height }, scale: "1" } }, null, 2)}\n`;
}
