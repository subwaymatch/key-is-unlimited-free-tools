/**
 * What a tool's cards show, beyond the formats in its catalogue.
 *
 * The queue decides what runs; this decides what the file card offers. It is
 * plain data so the tool apps can declare it next to their queue options and
 * the card components can read it without knowing which tool they serve.
 */
export interface ToolFeatures {
  /** Show the clip panel: markers, the waveform when there is one, a preview. */
  trim: boolean;
  /** Offer silence detection in the clip panel. Audio only. */
  silence: boolean;
  /**
   * Only produce clips. Hides the whole-file chips and makes the panel insist
   * on a range, for the trimmer and the GIF maker.
   */
  requireTrim: boolean;
  /** The clip panel's label once a range is set: "Extract this clip as:". */
  clipLabel: string;
  /** Label before the whole-file chips on the card: "Also convert to:". */
  alsoLabel: string;
  /**
   * Word for what the tool is doing while a file runs: "Compressing".
   *
   * The status badge said "Converting" on every tool, which reads as the wrong
   * tool entirely on the one that compresses. Defaults to "Converting".
   */
  busyLabel?: string;
  /** The tool works on every audio track, so the card must not say it uses the first. */
  everyAudioTrack?: boolean;
  /**
   * Longest source, in seconds, that a clip-only tool will offer whole.
   *
   * The GIF maker insists on a range because a GIF of a whole film would be
   * absurd - but a four-second clip is exactly what someone wants a GIF of,
   * and making them set two markers that mean "all of it" is a chore. Null,
   * the default, keeps the tool strictly clip-only.
   */
  wholeClipSeconds?: number | null;
}

/** The audio extractor's features, and a sensible default for any tool. */
export const AUDIO_FEATURES: ToolFeatures = {
  trim: true,
  silence: true,
  requireTrim: false,
  clipLabel: "Extract this clip as:",
  alsoLabel: "Extract as:",
  busyLabel: "Extracting",
};
