"use client";

import { useMemo, useState } from "react";

import { chaptersFormat, parseChapterList } from "@/lib/engine/chapters";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import styles from "../Settings.module.css";

const tool = requireTool("add-chapters");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Produce:",
  busyLabel: "Writing chapters",
};

const EXAMPLE = "0:00 Intro\n1:23 The first part\n12:40 Questions\n45:10 Closing";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Chapter markers from a typed list.
 *
 * The list is the panel; the format is the list baked in. Every file added
 * gets the same chapters, which is what a series of episodes with one
 * running order wants, and a different list is a different format.
 */
export function AddChaptersApp() {
  const [text, setText] = useState("");

  useStoredSettings(storageKey("settings", "add-chapters"), text, setText, isString);

  const parsed = useMemo(() => parseChapterList(text), [text]);
  const count = parsed.chapters.length;

  const queue = useMemo<QueueOptions>(
    () => ({
      key: "add-chapters",
      formats: [chaptersFormat(text)],
      defaultFormatIds: [chaptersFormat(text).id],
      expects: "media",
      waveform: false,
      phase: () => "Writing the chapters...",
    }),
    [text],
  );

  const toolSettings: ToolSettings = {
    title: "Chapters",
    defaultOpen: true,
    invalid: () => (count === 0 ? "Type at least one chapter before adding a file." : null),
    summary: () => (count === 0 ? "none yet" : `${count} ${count === 1 ? "chapter" : "chapters"}`),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Chapter list</legend>
        <p className={styles.intro}>
          One chapter per line: the time it starts, then its title. Times can be seconds, m:ss or
          h:mm:ss. Each chapter runs to the next one, and the last to the end of the file.
        </p>
        <textarea
          aria-label="Chapter list"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={EXAMPLE}
          rows={8}
          spellCheck={false}
          className={styles.textarea}
        />
        {parsed.warnings.map((warning) => (
          <p key={warning} className={styles.warning}>
            {warning}
          </p>
        ))}
        {count > 0 && (
          <p className={styles.panelNote}>
            {count} {count === 1 ? "chapter" : "chapters"}, starting at{" "}
            {parsed.chapters.map((chapter) => chapter.title).slice(0, 3).join(", ")}
            {count > 3 ? ` and ${count - 3} more` : ""}.
          </p>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Type the chapters - a time and a title per line, the way a podcast's show notes or a video's description already lists them - then drop the file. The markers are written into it with every stream copied untouched, so a two-hour recording takes seconds. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio or video files here",
        subhead: count === 0 ? "Type the chapters above before adding a file" : `${count} chapters will be written into each file you add`,
      }}
      note="MP4, MOV, M4A, MKV, WebM, MP3 and Ogg all carry chapters and every player that shows them reads these: Apple Podcasts and Overcast from an M4A or MP3, VLC and the TV apps from an MP4 or MKV. WAV and FLAC have nowhere to put them, and are refused with a suggestion. Any chapters the file already had are replaced."
    />
  );
}
