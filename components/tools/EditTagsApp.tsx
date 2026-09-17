"use client";

import { useCallback, useMemo, useState } from "react";

import { fileKey, imageMimeType, readFileBytes } from "@/lib/chosenFile";
import { countTags, EMPTY_TAGS, MAX_COVER_BYTES, tagsFormat, type CoverSource, type TagValues } from "@/lib/engine/tags";
import { IMAGE_ACCEPT, MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { FileField } from "../ui/FileField";
import settingsStyles from "../Settings.module.css";
import styles from "./EditTagsApp.module.css";

const tool = requireTool("edit-tags");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Produce:",
  busyLabel: "Writing tags",
};

const FIELDS: { key: keyof TagValues; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "title", label: "Title", placeholder: "The name of the track", wide: true },
  { key: "artist", label: "Artist", placeholder: "Who performed it" },
  { key: "albumArtist", label: "Album artist", placeholder: "Who the album is by, if different" },
  { key: "album", label: "Album", placeholder: "The album or the show" },
  { key: "date", label: "Year", placeholder: "2024" },
  { key: "genre", label: "Genre", placeholder: "Podcast, Rock, Lecture" },
  { key: "track", label: "Track", placeholder: "3, or 3/12" },
  { key: "comment", label: "Comment", placeholder: "Anything else", wide: true },
];

function isTagValues(value: unknown): value is TagValues {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(EMPTY_TAGS).every((key) => typeof candidate[key] === "string");
}

/**
 * The tag editor.
 *
 * The fields are the panel; the format is the fields baked in. Every file
 * added gets the same tags, which is what an album's worth of files with one
 * artist and one year wants; the title is left blank for those, or typed
 * for a single file.
 */
export function EditTagsApp() {
  const [tags, setTags] = useState<TagValues>(EMPTY_TAGS);
  const [cover, setCover] = useState<CoverSource | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);

  useStoredSettings(storageKey("settings", "edit-tags"), tags, setTags, isTagValues);

  const chooseCover = useCallback((file: File) => {
    setCoverError(null);
    const mimeType = imageMimeType(file);
    if (!mimeType) {
      setCoverError("A cover has to be a JPEG or a PNG; every tagging format takes those two and little else.");
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      setCoverError(`${file.name} is ${Math.round(file.size / 1_000_000)} MB; covers are capped at ${Math.round(MAX_COVER_BYTES / 1_000_000)} MB, and a 1500 px JPEG is plenty.`);
      return;
    }
    void readFileBytes(file)
      .then((bytes) => setCover({ name: file.name, bytes, mimeType, key: fileKey(file) }))
      .catch(() => setCoverError("This file could not be read."));
  }, []);

  const count = countTags(tags);

  const queue = useMemo<QueueOptions>(() => {
    const format = tagsFormat(tags, cover);
    return {
      key: "edit-tags",
      formats: [format],
      defaultFormatIds: [format.id],
      expects: "media",
      waveform: false,
      // Off here: the switch means "clear the file's other tags first".
      stripMetadataDefault: false,
      phase: () => "Writing the tags...",
    };
  }, [tags, cover]);

  const toolSettings: ToolSettings = {
    title: "Tags & cover",
    defaultOpen: true,
    invalid: () => (count === 0 && !cover ? "Fill in at least one tag, or choose a cover, before adding a file." : null),
    summary: () => `${count === 0 ? "no tags" : `${count} ${count === 1 ? "tag" : "tags"}`}${cover ? `, cover ${cover.name}` : ""}`,
    render: () => (
      <>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Tags</legend>
          <p className={settingsStyles.intro}>
            Written into every file you add. A field left empty is left alone in the file, so an
            album&apos;s worth of tracks can share an artist and a year and keep their own titles.
          </p>
          <div className={styles.grid}>
            {FIELDS.map((field) => (
              <label key={field.key} className={`${styles.field} ${field.wide ? styles.wide : ""}`}>
                <span className={settingsStyles.fieldLabel}>{field.label}</span>
                <input
                  type="text"
                  value={tags[field.key]}
                  placeholder={field.placeholder}
                  spellCheck={field.key === "comment"}
                  onChange={(event) => setTags((previous) => ({ ...previous, [field.key]: event.target.value }))}
                  className={styles.input}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Cover</legend>
          <p className={settingsStyles.intro}>
            A JPEG or PNG for the front cover, replacing any the file has. MP3, M4A and FLAC take
            one; Ogg, WAV and video files do not, and say so.
          </p>
          <FileField
            id="edit-tags-cover"
            accept={IMAGE_ACCEPT}
            chosen={cover ? `${cover.name} (${Math.round(cover.bytes.length / 1000)} KB)` : null}
            onChoose={chooseCover}
            onClear={() => setCover(null)}
            error={coverError}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Type the title, artist, album, year, genre, track number or comment, choose a cover picture if you like, then drop the file: the tags are written into it with the audio copied untouched, so a whole album is re-tagged in the time it takes to read it. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      metadataIntro="Off by default here. Off, the tags a file already has stay and the ones above are written over them; on, the file is cleared first and only the ones above remain. It is remembered for this tool alone."
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio or video files",
        headline: "Drop audio files here",
        subhead: count === 0 && !cover ? "Fill in a tag above before adding a file" : "The tags above will be written into each file you drop",
      }}
      note='The metadata switch under the tags is off here and decides what happens to the tags a file already has: off, they stay and these are written over them; on, the file is cleared first and only these remain. ffmpeg maps the names onto whatever the format uses - ID3 frames in an MP3, iTunes atoms in an M4A, Vorbis comments in a FLAC or an Ogg - and writes ID3v2.3 for an MP3, which Windows and older players read where 2.4 they do not. A file whose tags are already right needs nothing here.'
    />
  );
}
