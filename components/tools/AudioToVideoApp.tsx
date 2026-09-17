"use client";

import { useCallback, useMemo, useState } from "react";

import { fileKey, imageMimeType, readFileBytes } from "@/lib/chosenFile";
import {
  audioVideoFormat,
  BACKDROP_COLOURS,
  DEFAULT_AUDIO_VIDEO_SETTINGS,
  FRAME_SIZES,
  MAX_BACKDROP_BYTES,
  STILL_FPS,
  WAVEFORM_FPS,
  type AudioVideoSettings,
  type BackdropImage,
} from "@/lib/engine/visualize";
import { IMAGE_ACCEPT, MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { FileField } from "../ui/FileField";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("audio-to-video");

const FEATURES: ToolFeatures = {
  trim: true,
  silence: true,
  requireTrim: false,
  clipLabel: "Make a video of this clip:",
  alsoLabel: "Also:",
  busyLabel: "Encoding",
};

function isAudioVideoSettings(value: unknown): value is AudioVideoSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AudioVideoSettings>;
  return (
    (candidate.backdrop === "colour" || candidate.backdrop === "image" || candidate.backdrop === "waveform") &&
    BACKDROP_COLOURS.some((colour) => colour.id === candidate.colour) &&
    FRAME_SIZES.some((size) => size.id === candidate.size)
  );
}

const BACKDROP_OPTIONS = [
  { value: "colour", label: "A plain colour", blurb: "The quickest: a still frame under the sound" },
  { value: "image", label: "A picture", blurb: "Cover art or a photo, fitted to the frame with black bars where its shape differs" },
  { value: "waveform", label: "The waveform", blurb: "Drawn as the sound plays. Slower to make, since every frame differs" },
];

/**
 * An MP3 as an MP4.
 *
 * The backdrop is chosen once; every audio file added gets it under it. An
 * image is read into memory and written for the run, the way a cover is.
 */
export function AudioToVideoApp() {
  const [settings, setSettings] = useState<AudioVideoSettings>(DEFAULT_AUDIO_VIDEO_SETTINGS);
  const [image, setImage] = useState<BackdropImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useStoredSettings(storageKey("settings", "audio-to-video"), settings, setSettings, isAudioVideoSettings);

  const chooseImage = useCallback((file: File) => {
    setImageError(null);
    const mimeType = imageMimeType(file);
    if (!mimeType) {
      setImageError("The picture has to be a JPEG or a PNG.");
      return;
    }
    if (file.size > MAX_BACKDROP_BYTES) {
      setImageError(`${file.name} is ${Math.round(file.size / 1_000_000)} MB; pictures are capped at ${Math.round(MAX_BACKDROP_BYTES / 1_000_000)} MB.`);
      return;
    }
    void readFileBytes(file)
      .then((bytes) => setImage({ name: file.name, bytes, mimeType, key: fileKey(file) }))
      .catch(() => setImageError("This file could not be read."));
  }, []);

  const needsImage = settings.backdrop === "image" && image === null;

  const queue = useMemo<QueueOptions>(() => {
    const current = audioVideoFormat(settings, image);
    const others = (["colour", "waveform"] as const)
      .map((backdrop) => audioVideoFormat({ ...settings, backdrop }, image))
      .filter((format) => format.id !== current.id);
    return {
      key: "audio-to-video",
      formats: [current, ...others],
      defaultFormatIds: needsImage ? [] : [current.id],
      expects: "audio",
      waveform: true,
      phase: ({ label }) => `Encoding the ${label.replace(/^MP4 /, "")} video...`,
    };
  }, [settings, image, needsImage]);

  const size = FRAME_SIZES.find((entry) => entry.id === settings.size) ?? FRAME_SIZES[0];

  const toolSettings: ToolSettings = {
    title: "Backdrop & size",
    defaultOpen: true,
    invalid: () => (needsImage ? "Choose a picture above, or another backdrop, before adding a file." : null),
    summary: () =>
      `${settings.backdrop === "image" ? (image ? image.name : "no picture yet") : settings.backdrop === "colour" ? (BACKDROP_COLOURS.find((colour) => colour.id === settings.colour)?.label.toLowerCase() ?? settings.colour) : "waveform"}, ${size.label}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Backdrop</legend>
          <RadioCards
            aria-label="Backdrop"
            value={settings.backdrop}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, backdrop: value as AudioVideoSettings["backdrop"] }))}
            options={BACKDROP_OPTIONS}
          />
          {settings.backdrop === "colour" && (
            <div className={styles.panel}>
              <span className={styles.fieldLabel}>Colour</span>
              <RadioCards
                aria-label="Colour"
                value={settings.colour}
                onValueChange={(colour) => setSettings((previous) => ({ ...previous, colour }))}
                options={BACKDROP_COLOURS.map((colour) => ({ value: colour.id, label: colour.label }))}
              />
            </div>
          )}
          {settings.backdrop === "image" && (
            <FileField
              id="audio-to-video-image"
              accept={IMAGE_ACCEPT}
              chosen={image ? `${image.name} (${Math.round(image.bytes.length / 1000)} KB)` : null}
              onChoose={chooseImage}
              onClear={() => setImage(null)}
              error={imageError}
              note="A JPEG or PNG. It is scaled to fit the frame and centred, never cropped."
            />
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Frame</legend>
          <RadioCards
            aria-label="Frame"
            value={settings.size}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, size: value as AudioVideoSettings["size"] }))}
            options={FRAME_SIZES.map((entry) => ({ value: entry.id, label: entry.label, blurb: entry.blurb }))}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop an MP3, a WAV, an M4A or any audio file and get it back as an MP4 for YouTube or a feed: the sound under a plain colour, a picture you choose, or a waveform drawn as it plays. The sound is copied as it is when the MP4 can hold it. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose audio files",
        headline: "Drop audio files here",
        subhead: needsImage ? "Choose a picture above before adding a file" : `Each file becomes a ${size.label} MP4 - change the backdrop below`,
      }}
      note={`A still backdrop is written at ${STILL_FPS} frames a second, which every player and every upload form accepts and which keeps an hour of podcast to a few minutes of encoding and a few tens of megabytes; the waveform runs at ${WAVEFORM_FPS} and costs about real time. MP3 and AAC go into the MP4 as they are; WAV, FLAC, Opus and the rest are encoded to AAC at 192 kbps.`}
    />
  );
}
