/**
 * Burning subtitles into the picture.
 *
 * The one Tier A tool the catalogue asked to verify before promising: it
 * needs the `subtitles` filter, which needs libass, which needs a font. The
 * pinned core is built with libass, freetype and fribidi but without
 * fontconfig, so it cannot find a font on its own; one is shipped with the
 * site and written into the core's filesystem for the run, and every style
 * is told to use it by name.
 *
 * Two sources: a subtitle file the visitor adds, converted to ASS in the
 * style they chose, or one of the video's own text tracks, which the filter
 * reads straight out of the mounted input.
 */
import { isBitmapSubtitle } from "./captions";
import { pictureAudioArgs, pictureContainer } from "./picture";
import type { FormatBlocker, OutputFormat, PlanContext, ProbeResult, ScratchFile } from "./types";
import { containerArgs, estimateEncodedBytes, H264_ENCODE, SELECT_VIDEO, sizeBlocker } from "./video";

/** Where the font lives, on the site and in the core alike. */
export const BURN_FONT_URL = "/fonts/DejaVuSans.ttf";
export const BURN_FONT_DIR = "/fonts";
export const BURN_FONT_PATH = `${BURN_FONT_DIR}/DejaVuSans.ttf`;
/** The family name libass finds in that file. */
export const BURN_FONT_NAME = "DejaVu Sans";

/** Where a subtitle file the visitor added is written for the run. */
export const BURN_SUBTITLE_PATH = "/subtitles.ass";

/** A subtitle file to burn: its name, and its text as ASS, ready to render. */
export interface BurnSource {
  name: string;
  ass: string;
}

/**
 * The filter, with the font directory and the family forced.
 *
 * `force_style` applies to every style in the script, so a file that names
 * a font this build cannot see - all of them - renders in the shipped one
 * rather than in nothing. The single quotes are the filter graph's own, and
 * keep the space in the family name from ending the option.
 */
export function subtitlesFilter(filename: string, streamIndex?: number): string {
  return (
    `subtitles=filename=${filename}` +
    (streamIndex === undefined ? "" : `:si=${streamIndex}`) +
    `:fontsdir=${BURN_FONT_DIR}:force_style='FontName=${BURN_FONT_NAME}'`
  );
}

/** A short, stable id for a subtitle file's text, so two files are two formats. */
export function textFingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function burnArgs(filter: string, probe: ProbeResult, context: PlanContext | undefined) {
  const container = pictureContainer(probe, context);
  return {
    args: [
      ...SELECT_VIDEO,
      "-vf",
      filter,
      ...H264_ENCODE,
      "-crf",
      "20",
      ...pictureAudioArgs(probe, container),
      ...containerArgs(container),
    ],
    container,
  };
}

/** The subtitle file the visitor added, burned in. */
export function burnFileFormat(source: BurnSource, font: Uint8Array): OutputFormat {
  const scratchFiles: ScratchFile[] = [
    { path: BURN_SUBTITLE_PATH, contents: source.ass },
    { path: BURN_FONT_PATH, contents: font },
  ];
  return {
    id: `burn-file-${textFingerprint(source.ass)}`,
    label: `Burn ${source.name}`,
    blurb: "The subtitles drawn into every frame, so they show in any player and cannot be turned off",
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe, context) {
      const { args, container } = burnArgs(subtitlesFilter(BURN_SUBTITLE_PATH), probe, context);
      return {
        args,
        scratchFiles,
        ...container,
        mode: "encode",
        kind: "video",
        fileSuffix: "-subtitled",
      };
    },
    blocker(probe, context) {
      return sizeBlocker(estimateEncodedBytes(probe, context, 160), "The subtitled video");
    },
  };
}

/** One of the video's own text tracks, burned in. */
export function burnTrackFormat(track: number, font: Uint8Array): OutputFormat {
  return {
    id: `burn-track-${track + 1}`,
    label: `Burn track ${track + 1}`,
    blurb: "One of the file's own subtitle tracks, drawn into the picture",
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe, context) {
      const { args, container } = burnArgs(
        subtitlesFilter(context?.inputPath ?? "", track),
        probe,
        context,
      );
      return {
        args,
        scratchFiles: [{ path: BURN_FONT_PATH, contents: font }],
        ...container,
        mode: "encode",
        kind: "video",
        fileSuffix: `-subtitled-track${track + 1}`,
      };
    },
    offer(probe) {
      const stream = probe.subtitleStreams[track];
      return stream !== undefined && !isBitmapSubtitle(stream.codec);
    },
    blocker(probe, context): FormatBlocker | null {
      const stream = probe.subtitleStreams[track];
      if (!stream) {
        return {
          message: `This file has no subtitle track ${track + 1}.`,
          hint: "Add a subtitle file in the panel above to burn one in.",
          retryable: false,
        };
      }
      if (isBitmapSubtitle(stream.codec)) {
        return {
          message: `Track ${track + 1} is image-based (${stream.codec}), which this cannot draw.`,
          hint: "Only text tracks can be rendered with the shipped font.",
          retryable: false,
        };
      }
      return sizeBlocker(estimateEncodedBytes(probe, context, 160), "The subtitled video");
    },
  };
}

/** The most embedded tracks a card offers to burn. */
export const MAX_BURN_TRACKS = 4;
