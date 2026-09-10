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
  /** Label before the clip panel's chips when no range is set: "Extract as:". */
  wholeLabel: string;
  /** The same label once a range is set: "Extract this clip as:". */
  clipLabel: string;
  /** Label before the whole-file chips on the card: "Also convert to:". */
  alsoLabel: string;
}

/** The audio extractor's features, and a sensible default for any tool. */
export const AUDIO_FEATURES: ToolFeatures = {
  trim: true,
  silence: true,
  requireTrim: false,
  wholeLabel: "Extract as:",
  clipLabel: "Extract this clip as:",
  alsoLabel: "Also convert to:",
};
