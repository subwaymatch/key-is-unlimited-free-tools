import { describe, expect, it } from "vitest";

import { layoutSprites, spriteClass, spriteCss, spriteJson, uniqueClasses, type SpriteFrame } from "@/lib/images/sprites";

const overlaps = (a: SpriteFrame, b: SpriteFrame) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inputs = [
  { name: "a.png", width: 32, height: 32 },
  { name: "b.png", width: 64, height: 16 },
  { name: "c.png", width: 16, height: 48 },
  { name: "d.png", width: 32, height: 32 },
  { name: "e.png", width: 8, height: 8 },
];

describe("laying out a sheet", () => {
  for (const layout of ["packed", "grid", "row", "column"] as const) {
    it(`${layout}: every picture on the sheet, none overlapping, padding kept`, () => {
      const sheet = layoutSprites(inputs, layout, 2);
      expect(sheet.frames.map((frame) => frame.name)).toEqual(inputs.map((input) => input.name));
      for (const frame of sheet.frames) {
        expect(frame.x).toBeGreaterThanOrEqual(2);
        expect(frame.y).toBeGreaterThanOrEqual(2);
        expect(frame.x + frame.width).toBeLessThanOrEqual(sheet.width - 2);
        expect(frame.y + frame.height).toBeLessThanOrEqual(sheet.height - 2);
      }
      for (const [index, a] of sheet.frames.entries()) for (const b of sheet.frames.slice(index + 1)) expect(overlaps(a, b), `${a.name} and ${b.name}`).toBe(false);
    });
  }

  it("packs tighter than a grid of largest-sized cells", () => {
    const packed = layoutSprites(inputs, "packed", 0);
    const grid = layoutSprites(inputs, "grid", 0);
    expect(packed.width * packed.height).toBeLessThan(grid.width * grid.height);
    expect(layoutSprites(inputs, "row", 0)).toMatchObject({ width: 152, height: 48 });
  });
});

describe("the CSS and the JSON", () => {
  it("names classes from file names, uniquely", () => {
    expect(spriteClass("icons/Arrow Left@2x.png")).toBe("arrow-left-2x");
    expect(spriteClass("2.png")).toBe("s-2");
    expect(uniqueClasses(["a.png", "A.gif", "b.png"])).toEqual(["a", "a-2", "b"]);
  });

  it("writes background positions and TexturePacker's hash format", () => {
    const sheet = layoutSprites(inputs.slice(0, 2), "row", 0);
    const css = spriteCss(sheet, "sheet.png");
    expect(css).toContain('background-image: url("sheet.png");');
    expect(css).toContain(".sprite-b {\n  width: 64px;\n  height: 16px;\n  background-position: -32px 0;\n}");
    const json = JSON.parse(spriteJson(sheet, "sheet.png"));
    expect(json.frames["b.png"].frame).toEqual({ x: 32, y: 0, w: 64, h: 16 });
    expect(json.meta.size).toEqual({ w: 96, h: 32 });
  });
});
