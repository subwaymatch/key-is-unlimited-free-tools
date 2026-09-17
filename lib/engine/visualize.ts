/**
 * An audio file as a video, for the sites that only take video.
 *
 * YouTube has no upload button for a podcast, a song or a lecture recording,
 * so the audio goes in under a picture: a plain colour, an image the visitor
 * chose, or the waveform drawn as it plays. The sound is copied when the MP4
 * can hold it and made AAC when it cannot; the picture is H.264 at a low
 * frame rate for a still, since a still at 30 frames a second is thirty
 * copies of the same frame.
 */
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult, ScratchFile } from "./types";
import { formatSeconds, trimDuration } from "./trim";
import { containerHolds, H264_ENCODE, MP4, MP4_FASTSTART, sizeBlocker } from "./video";

export type BackdropKind = "colour" | "image" | "waveform";

/** An image the visitor chose for the backdrop. */
export interface BackdropImage {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
  key: string;
}

export type FrameSize = "720p" | "1080p" | "square";

export interface AudioVideoSettings {
  backdrop: BackdropKind;
  colour: string;
  size: FrameSize;
}

export const BACKDROP_COLOURS: readonly { id: string; label: string; hex: string }[] = [
  { id: "black", label: "Black", hex: "0x000000" },
  { id: "white", label: "White", hex: "0xffffff" },
  { id: "grey", label: "Dark grey", hex: "0x1a1a1a" },
  { id: "navy", label: "Navy", hex: "0x0b1a33" },
];

export const FRAME_SIZES: readonly { id: FrameSize; width: number; height: number; label: string; blurb: string }[] = [
  { id: "720p", width: 1280, height: 720, label: "1280 x 720", blurb: "HD, and quick to make" },
  { id: "1080p", width: 1920, height: 1080, label: "1920 x 1080", blurb: "Full HD" },
  { id: "square", width: 1080, height: 1080, label: "1080 x 1080", blurb: "Square, for a feed" },
];

export const DEFAULT_AUDIO_VIDEO_SETTINGS: AudioVideoSettings = { backdrop: "colour", colour: "black", size: "720p" };

/** The most an image may weigh. */
export const MAX_BACKDROP_BYTES = 20_000_000;

/** Frames a second for a still picture: enough for every player, cheap to encode. */
export const STILL_FPS = 5;
/** And for the waveform, which moves. */
export const WAVEFORM_FPS = 25;

/** Where the image is written for the run. */
export function backdropPath(image: BackdropImage): string {
  return `/backdrop.${image.mimeType === "image/png" ? "png" : "jpg"}`;
}

function frame(size: FrameSize) {
  return FRAME_SIZES.find((entry) => entry.id === size) ?? FRAME_SIZES[0];
}

/** The picture scaled into the frame with black bars where its shape differs. */
export function backdropImageFilter(size: FrameSize): string {
  const { width, height } = frame(size);
  return (
    `[1:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[v]`
  );
}

/** The waveform drawn from the sound as it plays. */
export function waveformVideoFilter(size: FrameSize): string {
  const { width, height } = frame(size);
  return `[0:a:0]showwaves=s=${width}x${height}:mode=cline:rate=${WAVEFORM_FPS}:colors=white,format=yuv420p[v]`;
}

/** Bits per pixel per frame a still or a waveform costs; both are mostly flat. */
const STILL_BITS_PER_PIXEL = 0.01;

/** The video for one backdrop and one frame size. */
export function audioVideoFormat(settings: AudioVideoSettings, image: BackdropImage | null): OutputFormat {
  const size = frame(settings.size);
  const colour = BACKDROP_COLOURS.find((entry) => entry.id === settings.colour) ?? BACKDROP_COLOURS[0];
  const still = settings.backdrop !== "waveform";
  const backdrop = settings.backdrop === "image" ? (image ? `image-${image.key}` : "image-none") : settings.backdrop === "colour" ? `colour-${colour.id}` : "waveform";
  const label = settings.backdrop === "image" ? `MP4 with ${image?.name ?? "an image"}` : settings.backdrop === "colour" ? `MP4 on ${colour.label.toLowerCase()}` : "MP4 with a waveform";
  return {
    id: `audio-video-${backdrop}-${settings.size}`,
    label,
    blurb: `${size.label}, H.264, ${still ? "a still picture" : "the waveform drawn as it plays"}, the sound copied or made AAC`,
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe: ProbeResult, context?: PlanContext) {
      const audioCodec = probe.audio?.codec.toLowerCase() ?? null;
      const copyAudio = audioCodec !== null && containerHolds(MP4, "h264", audioCodec);
      const scratchFiles: ScratchFile[] = settings.backdrop === "image" && image ? [{ path: backdropPath(image), contents: image.bytes }] : [];
      /*
       * A still source never ends on its own, and `-shortest` alone is not
       * enough to end it with the sound: the pinned core buffers frames of
       * the cheap, endless picture past the end of the audio and writes them
       * out, so a six-second song came back under nine seconds of colour.
       * Giving the source the sound's own length bounds it at the source.
       */
      const seconds = trimDuration(context?.trim ?? null, probe.durationSeconds);
      const length = seconds !== null && seconds > 0 ? formatSeconds(seconds) : null;
      const picture =
        settings.backdrop === "image" && image
          ? [
              "-loop",
              "1",
              "-framerate",
              String(STILL_FPS),
              ...(length ? ["-t", length] : []),
              "-i",
              backdropPath(image),
              "-filter_complex",
              backdropImageFilter(settings.size),
              "-map",
              "[v]",
            ]
          : settings.backdrop === "waveform"
            ? ["-filter_complex", waveformVideoFilter(settings.size), "-map", "[v]"]
            : ["-f", "lavfi", "-i", `color=c=${colour.hex}:s=${size.width}x${size.height}:r=${STILL_FPS}${length ? `:d=${length}` : ""}`, "-map", "1:v:0"];
      return {
        args: [
          ...picture,
          "-map",
          "0:a:0",
          "-sn",
          "-dn",
          ...H264_ENCODE,
          ...(still ? ["-tune", "stillimage"] : []),
          "-crf",
          "23",
          ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]),
          // The picture never ends on its own; the sound decides the length.
          "-shortest",
          ...MP4_FASTSTART,
        ],
        scratchFiles,
        ...MP4,
        mode: "encode",
        kind: "video",
        fileSuffix: "-video",
      };
    },
    blocker(probe, context: PlanContext): FormatBlocker | null {
      if (!probe.audio) {
        return { message: "This file has no sound.", hint: "There is no audio stream in it.", retryable: false };
      }
      if (settings.backdrop === "image" && !image) {
        return { message: "No image has been chosen.", hint: "Choose one in the panel above, or pick a colour or the waveform instead.", retryable: false };
      }
      if (image && image.bytes.length > MAX_BACKDROP_BYTES) {
        return { message: `${image.name} is too large.`, hint: `Images are capped at ${Math.round(MAX_BACKDROP_BYTES / 1_000_000)} MB.`, retryable: false };
      }
      const seconds = trimDuration(context.trim, probe.durationSeconds);
      if (seconds === null) return null;
      const fps = still ? STILL_FPS : WAVEFORM_FPS;
      const videoBits = size.width * size.height * fps * seconds * STILL_BITS_PER_PIXEL;
      return sizeBlocker(Math.round(videoBits / 8 + (192_000 * seconds) / 8), "The video");
    },
  };
}
