/**
 * Writing cues back out as SRT, WebVTT, ASS or a plain transcript.
 */
import { targetFor, type Cue, type SubtitleTarget } from "./types";

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

export function toSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`,
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
    .map((cue) => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${escapeVtt(cue.text)}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/**
 * A plain, readable default style: white text with a thin dark outline at the
 * bottom of a 1280x720 frame. Renderers scale it to the video.
 */
const ASS_HEADER = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "PlayResX: 1280",
  "PlayResY: 720",
  "WrapStyle: 0",
  "ScaledBorderAndShadow: yes",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,40,1",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
].join("\n");

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

export function toAss(cues: readonly Cue[]): string {
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},Default,,0,0,0,,${assText(cue.text)}`,
  );
  return `${ASS_HEADER}\n${events.join("\n")}\n`;
}

/** A transcript: the words of each cue on one line, without markup or times. */
export function toText(cues: readonly Cue[]): string {
  return cues
    .map((cue) => stripMarkup(cue.text).replace(/\n/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .concat("\n");
}

export function serialize(cues: readonly Cue[], target: SubtitleTarget): string {
  switch (target) {
    case "srt":
      return toSrt(cues);
    case "vtt":
      return toVtt(cues);
    case "ass":
      return toAss(cues);
    case "txt":
      return toText(cues);
  }
}

/** The bytes a download of this target would be, as a Blob. */
export function subtitleBlob(cues: readonly Cue[], target: SubtitleTarget): Blob {
  return new Blob([serialize(cues, target)], { type: `${targetFor(target).mimeType};charset=utf-8` });
}
