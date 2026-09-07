import { describe, expect, it } from "vitest";

import { reducePeaks } from "@/lib/engine/ffmpegEngine";

/** Builds mono 16-bit PCM from sample values. */
function pcm(samples: number[]): Uint8Array {
  const view = new Int16Array(samples);
  return new Uint8Array(view.buffer.slice(0));
}

describe("reducePeaks", () => {
  it("returns nothing for an empty decode", () => {
    expect(reducePeaks(pcm([]))).toEqual([]);
  });

  it("takes the peak of each bucket, not the average", () => {
    // Two buckets: the first holds one loud sample among quiet ones. Averaging
    // would bury it; a waveform has to show it.
    const peaks = reducePeaks(pcm([0, 0, 0, 32000, 100, 100, 100, 100]), 2);

    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBe(1);
    expect(peaks[1]).toBeCloseTo(100 / 32000, 5);
  });

  it("uses magnitude, so troughs count as much as crests", () => {
    const positive = reducePeaks(pcm([16000, 0, 0, 0]), 1);
    const negative = reducePeaks(pcm([-16000, 0, 0, 0]), 1);

    expect(negative).toEqual(positive);
  });

  /*
   * Normalising against the loudest bucket rather than full scale is what lets
   * a quietly recorded file fill the panel instead of drawing a flat line.
   */
  it("scales against the loudest bucket, so a quiet file still fills the height", () => {
    const quiet = reducePeaks(pcm([100, 100, 50, 50]), 2);
    const loud = reducePeaks(pcm([32000, 32000, 16000, 16000]), 2);

    expect(quiet).toEqual([1, 0.5]);
    expect(quiet).toEqual(loud);
  });

  it("reports zeros for silence rather than dividing by it", () => {
    const peaks = reducePeaks(pcm([0, 0, 0, 0]), 2);

    expect(peaks).toEqual([0, 0]);
    expect(peaks.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("never returns more buckets than asked for", () => {
    const samples = Array.from({ length: 1000 }, (_, i) => i * 30);
    expect(reducePeaks(pcm(samples), 16)).toHaveLength(16);
  });

  it("copes with fewer samples than buckets", () => {
    const peaks = reducePeaks(pcm([1000, 2000, 3000]), 64);

    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks.length).toBeLessThanOrEqual(64);
    expect(Math.max(...peaks)).toBe(1);
  });

  it("keeps every value inside 0..1", () => {
    const samples = Array.from({ length: 5000 }, (_, i) => Math.round(30000 * Math.sin(i / 7)));
    for (const value of reducePeaks(pcm(samples), 100)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
