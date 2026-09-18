"use client";

import { useMemo, useState } from "react";

import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { decodeSubtitleBytes, parseSubtitles, SubtitleError } from "@/lib/subtitles";
import { transcript, TRANSCRIPT_STYLES, wordCount, type TranscriptStyle } from "@/lib/subtitles/transcript";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("subtitles-to-text");

const ACCEPT = ".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/plain";

/** A subtitle file past this is not a subtitle file. */
const MAX_BYTES = 64 * 1024 * 1024;

interface TranscriptSettings {
  style: TranscriptStyle;
}

function isTranscriptSettings(value: unknown): value is TranscriptSettings {
  return typeof value === "object" && value !== null && TRANSCRIPT_STYLES.some((style) => style.id === (value as Partial<TranscriptSettings>).style);
}

/** The words of a subtitle file without the timing. */
export function SubtitlesToTextApp() {
  const [settings, setSettings] = useState<TranscriptSettings>({ style: "paragraphs" });
  useStoredSettings(storageKey("settings", "subtitles-to-text"), settings, setSettings, isTranscriptSettings);

  const queue = useMemo<PlainQueueOptions<TranscriptSettings>>(
    () => ({
      key: "subtitles-to-text",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there are no cues in it." } : file.size > MAX_BYTES ? { message: "This file is too large to be a subtitle file.", hint: "Subtitle files are a few hundred kilobytes at most." } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const { text, encoding } = decodeSubtitleBytes(await file.arrayBuffer());
        let parsed;
        try {
          parsed = parseSubtitles(text, file.name);
        } catch (error) {
          if (error instanceof SubtitleError) throw new PlainError(error.message, error.hint, { cause: error });
          throw error;
        }
        report("Writing...", null);
        const style = TRANSCRIPT_STYLES.find((entry) => entry.id === current.style) ?? TRANSCRIPT_STYLES[0];
        const out = transcript(parsed.cues, current.style);
        const words = wordCount(parsed.cues);
        const last = parsed.cues[parsed.cues.length - 1];
        const minutes = last ? Math.round(Math.max(last.end, last.start) / 60) : 0;
        return {
          facts: [`${parsed.format.toUpperCase()}, ${encoding}`, `${parsed.cues.length.toLocaleString("en")} cues, ${words.toLocaleString("en")} words, about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`],
          notes: parsed.warnings,
          outputs: [{ label: style.label, fileName: `${fileStem(file.name, "transcript")}-transcript.${style.extension}`, blob: new Blob([out], { type: `${style.mimeType};charset=utf-8` }), kind: "file", note: `${words.toLocaleString("en")} words, ${style.blurb.toLowerCase()}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Layout",
    defaultOpen: true,
    summary: () => TRANSCRIPT_STYLES.find((style) => style.id === settings.style)?.label.toLowerCase() ?? settings.style,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Write the words as</legend>
        <RadioCards aria-label="Write the words as" value={settings.style} onValueChange={(style) => setSettings({ style: style as TranscriptStyle })} options={TRANSCRIPT_STYLES.map((style) => ({ value: style.id, label: style.label, blurb: style.blurb }))} columns={2} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an SRT, WebVTT or ASS file and get the words back as a transcript: run into paragraphs where the speech pauses, one cue per line, with a timestamp before each cue for quoting, or as a CSV of start, end and text for a spreadsheet. The words of a lecture, an interview, a film. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Reading"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose subtitle files", headline: "Drop subtitle files here", subhead: "SRT, WebVTT or ASS; the transcript is a click away" }}
      note="Italics, bold and the position and style tags of each format are dropped, and a cue's line breaks are joined, since they were made for a screen and not a page. Paragraphs break where the gap between cues is two seconds or more, or after a sentence's end with most of a second's pause. The file is read in whatever encoding it turns out to be in: UTF-8, UTF-16 or the Windows-1252 of older files."
    />
  );
}
