/**
 * Writing cues back out as SRT, WebVTT, ASS or a plain transcript.
 */
import { targetFor, type AssScript, type Cue, type SubtitleTarget } from "./types";

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function split(seconds: number): { hours: number; minutes: number; secs: number; millis: number } {
  const total = Math.max(0, Math.round(seconds * 1000));
  return {
    hours: Math.floor(total / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000),
    secs: Math.floor((total % 60_000) / 1000),
    millis: total % 1000,
  };
}

/** 3723.456 -> "01:02:03,456" */
export function formatSrtTime(seconds: number): string {
  const { hours, minutes, secs, millis } = split(seconds);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/** 3723.456 -> "01:02:03.456" */
export function formatVttTime(seconds: number): string {
  const { hours, minutes, secs, millis } = split(seconds);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`;
}

/** 3723.456 -> "1:02:03.46": ASS keeps hundredths and one digit of hours. */
export function formatAssTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(total / 360_000);
  const minutes = Math.floor((total % 360_000) / 6000);
  const secs = Math.floor((total % 6000) / 100);
  const hundredths = total % 100;
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(hundredths)}`;
}

/** The model's tags gone, for a transcript. */
export function stripMarkup(text: string): string {
  return text.replace(/<\/?[ibu]>/g, "");
}

/** The tag most players honour for a cue at the top of the picture. */
const TOP_TAG = "{\\an8}";

export function toSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${
          cue.position === "top" ? TOP_TAG : ""
        }${cue.text}`,
    )
    .join("\n\n")
    .concat("\n");
}

/** `&` and `<` mean something in WebVTT text; the model's own tags are let through. */
function escapeVtt(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/<(?!\/?[ibu]>)/g, "&lt;");
}

export function toVtt(cues: readonly Cue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}${
          cue.position === "top" ? " line:0" : ""
        }\n${escapeVtt(cue.text)}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/**
 * How burned-in or exported ASS text looks: a plain, readable default that
 * renderers scale to the video, with the few knobs a burn wants to turn.
 */
export interface AssStyle {
  /** Font family, as the renderer will look it up. */
  fontName?: string;
  /** Size in a 1280x720 frame; scaled with the picture. */
  fontSize?: number;
  /** 2 is bottom centre, 8 is top centre, in ASS's numpad layout. */
  alignment?: 2 | 8;
  /** 1 is an outline and shadow; 3 is an opaque box behind the text. */
  borderStyle?: 1 | 3;
  /** Distance from the edge the text sits against, in the same frame. */
  marginV?: number;
}

export const DEFAULT_ASS_STYLE: Required<AssStyle> = {
  fontName: "Arial",
  fontSize: 48,
  alignment: 2,
  borderStyle: 1,
  marginV: 40,
};

/** The script header: white text with a thin dark outline or a box, in a 1280x720 frame. */
export function assHeader(style: AssStyle = {}): string {
  const { fontName, fontSize, alignment, borderStyle, marginV } = { ...DEFAULT_ASS_STYLE, ...style };
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,${borderStyle},2,${borderStyle === 3 ? 0 : 1},${alignment},40,40,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

function assText(text: string): string {
  return text
    .replace(/<i>/g, "{\\i1}")
    .replace(/<\/i>/g, "{\\i0}")
    .replace(/<b>/g, "{\\b1}")
    .replace(/<\/b>/g, "{\\b0}")
    .replace(/<u>/g, "{\\u1}")
    .replace(/<\/u>/g, "{\\u0}")
    .replace(/\n/g, "\\N");
}

/**
 * The source's own script, with only the times rewritten.
 *
 * An ASS file that arrived with its own frame size, fonts and colours comes
 * back with all of them: the header is the file's, each event keeps its
 * style name, margins, effect and override tags, and the retimer's new
 * start and end are dropped into the two fields that hold them. A cue this
 * app added or a cue whose source was another format has no ASS line of its
 * own and is written in the script's first style.
 */
function toSourceAss(cues: readonly Cue[], script: AssScript): string {
  const columns = script.eventFormat;
  const fallbackStyle = styleNameIn(script) ?? "Default";
  const events = cues.map((cue) => {
    const event = cue.ass;
    const fields = columns.map((column) => {
      switch (column) {
        case "Start":
          return formatAssTime(cue.start);
        case "End":
          return formatAssTime(cue.end);
        case "Layer":
        case "Marked":
          return event?.layer ?? "0";
        case "Style":
          return event?.style || fallbackStyle;
        case "Name":
        case "Actor":
          return event?.name ?? "";
        case "MarginL":
          return event?.marginL ?? "0";
        case "MarginR":
          return event?.marginR ?? "0";
        case "MarginV":
          return event?.marginV ?? "0";
        case "Effect":
          return event?.effect ?? "";
        case "Text":
          return event?.text ?? `${cue.position === "top" ? TOP_TAG : ""}${assText(cue.text)}`;
        default:
          return "";
      }
    });
    // Text is the last column and may hold commas, so it is joined last and
    // never escaped: that is the format's own rule.
    return `${event?.kind ?? "Dialogue"}: ${fields.join(",")}`;
  });
  return [
    "[Script Info]",
    ...script.info,
    "",
    script.stylesHeading,
    ...script.styles,
    "",
    "[Events]",
    `Format: ${columns.join(", ")}`,
    ...events,
    "",
  ].join("\n");
}

/** The name of the first style the script defines, for a cue that names none. */
function styleNameIn(script: AssScript): string | null {
  for (const line of script.styles) {
    const match = line.match(/^Style:\s*([^,]+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

export function toAss(cues: readonly Cue[], style: AssStyle = {}, script?: AssScript): string {
  // A source that brought its own styles keeps them; anything else gets the
  // plain default, which is what SRT and WebVTT have to be given.
  if (script && script.styles.length > 0) return toSourceAss(cues, script);
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},Default,,0,0,0,,${
        cue.position === "top" ? TOP_TAG : ""
      }${assText(cue.text)}`,
  );
  return `${assHeader(style)}\n${events.join("\n")}\n`;
}

/** A transcript: the words of each cue on one line, without markup or times. */
export function toText(cues: readonly Cue[]): string {
  return cues
    .map((cue) => stripMarkup(cue.text).replace(/\n/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .concat("\n");
}

export function serialize(cues: readonly Cue[], target: SubtitleTarget, script?: AssScript): string {
  switch (target) {
    case "srt":
      return toSrt(cues);
    case "vtt":
      return toVtt(cues);
    case "ass":
      return toAss(cues, {}, script);
    case "txt":
      return toText(cues);
  }
}

/** The bytes a download of this target would be, as a Blob. */
export function subtitleBlob(cues: readonly Cue[], target: SubtitleTarget, script?: AssScript): Blob {
  return new Blob([serialize(cues, target, script)], { type: `${targetFor(target).mimeType};charset=utf-8` });
}
