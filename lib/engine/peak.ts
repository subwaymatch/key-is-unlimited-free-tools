/**
 * Reading `volumedetect`'s report.
 *
 * Two tools need the loudest sample in a file: the volume change, which
 * lifts everything until that sample sits just under full scale, and the
 * waveform picture, which draws to the file's own peak rather than to a
 * height nothing reaches. Both run the same first pass, so the parsing
 * lives here rather than in either of them - and here, rather than in
 * level.ts, so that the picture does not have to import the tool that
 * changes the level.
 *
 * Pure, so it is tested against sample logs with no engine in sight.
 */

/** Where a peak-normalised file's loudest sample lands, in dBFS. Under zero, so lossy encoders do not clip it. */
export const PEAK_TARGET_DB = -1;

/** True for the one line of volumedetect's report the second pass reads. */
export function isPeakLine(line: string): boolean {
  return /max_volume:\s*-?\d/.test(line);
}

/**
 * Reads the loudest sample out of volumedetect's report:
 *
 *   [Parsed_volumedetect_0 @ 0x...] max_volume: -12.3 dB
 *
 * Null when it is missing, which is the case for a silent file.
 */
export function parsePeak(lines: readonly string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i].match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
    if (match) return Number(match[1]);
  }
  return null;
}

/** The gain that brings a measured peak to the target, to a tenth of a decibel. */
export function peakGainDb(peakDb: number | null): number {
  if (peakDb === null) return 0;
  return Math.round((PEAK_TARGET_DB - peakDb) * 10) / 10;
}
