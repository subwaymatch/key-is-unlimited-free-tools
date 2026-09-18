import { describe, expect, it } from "vitest";

import { adjustPixels, looksLikeSvg, padPlan, svgAtSize, svgLength, svgSize, turnedSize, turnPoint } from "@/lib/images/transform";

describe("turning a picture", () => {
  const size = { width: 200, height: 100 };

  it("swaps the sides for a quarter turn and keeps them otherwise", () => {
    expect(turnedSize(size, "cw")).toEqual({ width: 100, height: 200 });
    expect(turnedSize(size, "ccw")).toEqual({ width: 100, height: 200 });
    expect(turnedSize(size, "half")).toEqual(size);
    expect(turnedSize(size, "flip-h")).toEqual(size);
  });

  it("moves the corners where each turn should", () => {
    // Clockwise: the left edge becomes the top edge.
    expect(turnPoint(size, "cw", 0, 0)).toEqual({ x: 100, y: 0 });
    expect(turnPoint(size, "cw", 0, 100)).toEqual({ x: 0, y: 0 });
    expect(turnPoint(size, "cw", 200, 0)).toEqual({ x: 100, y: 200 });
    // Anticlockwise: the top edge becomes the left edge.
    expect(turnPoint(size, "ccw", 0, 0)).toEqual({ x: 0, y: 200 });
    expect(turnPoint(size, "ccw", 200, 0)).toEqual({ x: 0, y: 0 });
    expect(turnPoint(size, "half", 0, 0)).toEqual({ x: 200, y: 100 });
    expect(turnPoint(size, "flip-h", 0, 0)).toEqual({ x: 200, y: 0 });
    expect(turnPoint(size, "flip-h", 0, 100)).toEqual({ x: 200, y: 100 });
    expect(turnPoint(size, "flip-v", 0, 0)).toEqual({ x: 0, y: 100 });
  });
});

describe("padding to a shape", () => {
  it("makes the smallest frame of the shape that holds the whole picture, centred", () => {
    expect(padPlan({ width: 400, height: 200 }, { width: 1, height: 1 })).toEqual({ width: 400, height: 400, x: 0, y: 100 });
    expect(padPlan({ width: 200, height: 400 }, { width: 16, height: 9 })).toEqual({ width: 711, height: 400, x: 256, y: 0 });
    expect(padPlan({ width: 300, height: 300 }, { width: 1, height: 1 })).toEqual({ width: 300, height: 300, x: 0, y: 0 });
  });
});

describe("adjusting pixels", () => {
  const pixels = () => new Uint8ClampedArray([255, 0, 0, 255, 100, 150, 200, 128]);

  it("greys, inverts, brightens and stretches, leaving alpha alone", () => {
    const grey = pixels();
    adjustPixels(grey, "grayscale");
    expect(Array.from(grey)).toEqual([76, 76, 76, 255, 141, 141, 141, 128]);
    const negative = pixels();
    adjustPixels(negative, "invert");
    expect(Array.from(negative.subarray(0, 4))).toEqual([0, 255, 255, 255]);
    const brighter = pixels();
    adjustPixels(brighter, "brighter");
    expect(Array.from(brighter.subarray(0, 8))).toEqual([255, 0, 0, 255, 120, 180, 240, 128]);
    const contrast = pixels();
    adjustPixels(contrast, "more-contrast");
    expect(Array.from(contrast.subarray(4, 7))).toEqual([92, 157, 222]);
    const sepia = pixels();
    adjustPixels(sepia, "sepia");
    expect(Array.from(sepia.subarray(0, 3))).toEqual([100, 89, 69]);
  });
});

describe("SVG sizes", () => {
  it("reads lengths in their units", () => {
    expect(svgLength("100")).toBe(100);
    expect(svgLength("72pt")).toBe(96);
    expect(svgLength("25.4mm")).toBe(96);
    expect(svgLength("1in")).toBe(96);
    expect(svgLength("50%")).toBeNull();
    expect(svgLength(null)).toBeNull();
    expect(svgLength("0")).toBeNull();
  });

  it("takes the width and height, or the viewBox, or gives up", () => {
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect/></svg>')).toEqual({ width: 300, height: 150 });
    expect(svgSize('<?xml version="1.0"?>\n<!-- c -->\n<svg viewBox="0 0 40 20"></svg>')).toEqual({ width: 40, height: 20 });
    expect(svgSize('<svg width="80" viewBox="0 0 40 20"></svg>')).toEqual({ width: 80, height: 40 });
    expect(svgSize("<svg></svg>")).toBeNull();
    expect(svgSize("<div></div>")).toBeNull();
    expect(looksLikeSvg("<svg>")).toBe(true);
    expect(looksLikeSvg("<p>no</p>")).toBe(false);
  });

  it("sets the size on the root and adds the namespace", () => {
    expect(svgAtSize('<svg width="10" height="5" viewBox="0 0 10 5"><rect/></svg>', 400, 200)).toBe('<svg viewBox="0 0 10 5" xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect/></svg>');
    expect(svgAtSize('<svg xmlns="http://www.w3.org/2000/svg"/>', 1, 2)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="2"/>');
    expect(svgAtSize("<svg/>", 1, 2)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="2"/>');
  });
});
