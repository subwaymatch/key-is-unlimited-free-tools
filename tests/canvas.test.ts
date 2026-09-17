import { describe, expect, it } from "vitest";

import {
  describeSize,
  findQualityUnder,
  fitInside,
  fitLongestSide,
  looksLikeImage,
  MAX_QUALITY,
  MIN_QUALITY,
  mayHaveTransparency,
  rejectNonImage,
  sameFormatMime,
  scaleSize,
  shrinkFactor,
} from "@/lib/images/canvas";

const file = (name: string, type = "") => new File([new Uint8Array(10)], name, { type });

describe("image sizes", () => {
  it("fits the longest side without enlarging", () => {
    expect(fitLongestSide({ width: 4000, height: 3000 }, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitLongestSide({ width: 3000, height: 4000 }, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitLongestSide({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 });
    expect(scaleSize({ width: 4000, height: 3000 }, 0.5)).toEqual({ width: 2000, height: 1500 });
    expect(scaleSize({ width: 1, height: 1 }, 0.1)).toEqual({ width: 1, height: 1 });
    expect(fitInside({ width: 4000, height: 3000 }, { width: 1000, height: 1000 })).toEqual({ width: 1000, height: 750 });
    expect(fitInside({ width: 400, height: 300 }, { width: 1000, height: 1000 })).toEqual({ width: 400, height: 300 });
    expect(describeSize({ width: 1600, height: 1200 })).toBe("1600x1200");
  });
});

describe("finding a quality under a size", () => {
  const encoder = (bytesPerQuality: number) => async (quality: number) => Math.round(quality * bytesPerQuality);

  it("takes the top quality when it already fits", async () => {
    expect(await findQualityUnder(encoder(100_000), 200_000)).toEqual({ quality: MAX_QUALITY, bytes: 95_000 });
  });

  it("bisects to the highest quality that fits", async () => {
    const found = await findQualityUnder(encoder(100_000), 60_000);
    expect(found).not.toBeNull();
    expect(found!.bytes).toBeLessThanOrEqual(60_000);
    expect(found!.quality).toBeGreaterThanOrEqual(0.58);
    expect(found!.quality).toBeLessThanOrEqual(0.6);
  });

  it("gives up when even the lowest quality is too large, and says how far to shrink", async () => {
    expect(await findQualityUnder(encoder(1_000_000), 100_000)).toBeNull();
    expect(shrinkFactor(MIN_QUALITY * 1_000_000, 100_000)).toBeCloseTo(0.475, 3);
    expect(shrinkFactor(110_000, 100_000)).toBe(0.9);
  });
});

describe("what a picture is", () => {
  it("recognises pictures by type or extension", () => {
    expect(looksLikeImage(file("photo.HEIC"))).toBe(true);
    expect(looksLikeImage(file("x", "image/avif"))).toBe(true);
    expect(looksLikeImage(file("clip.mp4", "video/mp4"))).toBe(false);
    expect(rejectNonImage(file("clip.mp4"))?.message).toBe("This is not an image.");
    expect(rejectNonImage(new File([], "empty.png"))?.message).toBe("This file is empty.");
    expect(rejectNonImage(file("photo.png"))).toBeNull();
  });

  it("keeps JPEG and WebP as themselves and writes everything else as PNG", () => {
    expect(sameFormatMime(file("photo.jpeg"))).toBe("image/jpeg");
    expect(sameFormatMime(file("x", "image/webp"))).toBe("image/webp");
    expect(sameFormatMime(file("shot.gif"))).toBe("image/png");
    expect(sameFormatMime(file("shot.bmp"))).toBe("image/png");
    expect(mayHaveTransparency(file("a.jpg"))).toBe(false);
    expect(mayHaveTransparency(file("a.png"))).toBe(true);
  });
});
