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
}

export interface ParsedSubtitles {
  format: SubtitleFormat;
  cues: Cue[];
  /** Things skipped or guessed on the way in, worth a line on the card. */
  warnings: string[];
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
    blurb: "Advanced SubStation Alpha, with a plain default style",
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
