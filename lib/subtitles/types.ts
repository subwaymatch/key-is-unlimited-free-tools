/**
 * The subtitle tools' model.
 *
 * A subtitle file, whatever its format, is a list of cues: a start, an end,
 * and some text. Everything the formats disagree about - how times are
 * written, what a block looks like, how italics are marked - is handled on
 * the way in and the way out, so the middle is one shape.
 */

/** The formats read and written. Plain text is written only. */
export type SubtitleFormat = "srt" | "vtt" | "ass";

export type SubtitleTarget = SubtitleFormat | "txt";

export interface Cue {
  /** Seconds from the start of the media. */
  start: number;
  end: number;
  /**
   * The text, lines separated by "\n". The only markup kept is `<i>`, `<b>`
   * and `<u>`, with matching closing tags; every format can express those,
   * and everything else - fonts, colours, positions - is dropped.
   */
  text: string;
  /**
   * Shown at the top of the picture rather than the bottom.
   *
   * The one position worth carrying: a second language stacked above the
   * first. SRT and ASS take it as an `{\an8}` tag, WebVTT as a `line` setting.
   */
  position?: "top";
  /**
   * The cue exactly as an ASS file wrote it, kept so that ASS back out again
   * is the file that came in with new times, rather than this model's idea
   * of it.
   *
   * Only the times are ever rewritten; the style name, the margins, the
   * effect and every inline override tag are the source's own.
   */
  ass?: AssEvent;
}

/** One `Dialogue:` line, split into the fields that are not its times. */
export interface AssEvent {
  /** The keyword the line started with: "Dialogue" or, rarely, "Comment". */
  kind: string;
  layer: string;
  style: string;
  name: string;
  marginL: string;
  marginR: string;
  marginV: string;
  effect: string;
  /** The text with its override blocks and `\N` breaks exactly as written. */
  text: string;
}

/**
 * The parts of an ASS script that are not its events: what a file needs to
 * look the way it looked when it arrived.
 */
export interface AssScript {
  /** `[Script Info]`, including PlayResX and PlayResY, line by line. */
  info: string[];
  /** `[V4+ Styles]` or `[V4 Styles]`, line by line, including its Format row. */
  styles: string[];
  /** That section's heading as the file wrote it: SSA's v4 styles are not v4+. */
  stylesHeading: string;
  /** The `Format:` row of `[Events]`, so the columns come back in that order. */
  eventFormat: string[];
}

export interface ParsedSubtitles {
  format: SubtitleFormat;
  cues: Cue[];
  /** Things skipped or guessed on the way in, worth a line on the card. */
  warnings: string[];
  /** For an ASS source: its own header, for writing ASS back out. */
  script?: AssScript;
}

/** Thrown for a file that is not a subtitle file in any format this reads. */
export class SubtitleError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "SubtitleError";
    this.hint = hint;
  }
}

export const SUBTITLE_TARGETS: readonly {
  id: SubtitleTarget;
  label: string;
  extension: string;
  mimeType: string;
  blurb: string;
}[] = [
  {
    id: "srt",
    label: "SRT",
    extension: "srt",
    mimeType: "application/x-subrip",
    blurb: "SubRip. The one every player and editor reads",
  },
  {
    id: "vtt",
    label: "WebVTT",
    extension: "vtt",
    mimeType: "text/vtt",
    blurb: "For the web: HTML video, YouTube, Vimeo",
  },
  {
    id: "ass",
    label: "ASS",
    extension: "ass",
    mimeType: "text/x-ssa",
    blurb: "Advanced SubStation Alpha. An ASS source keeps its own styles; anything else gets a plain default",
  },
  {
    id: "txt",
    label: "Plain text",
    extension: "txt",
    mimeType: "text/plain",
    blurb: "A transcript: the words, one cue per line, no times",
  },
];

export function targetFor(id: SubtitleTarget) {
  const target = SUBTITLE_TARGETS.find((entry) => entry.id === id);
  if (!target) throw new Error(`Unknown subtitle target "${id}".`);
  return target;
}
