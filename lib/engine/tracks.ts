/**
 * Every audio track of a file as its own file.
 *
 * A film's MKV carries a language per track and a commentary besides, and
 * every other tool here works on the first. One format per track, offered
 * for as many as the file has, each a stream copy into the container its
 * codec belongs in and named by its language.
 */
import { copyTargetForCodec } from "./formats";
import type { AudioStreamInfo, FormatBlocker, OutputFormat, ProbeResult } from "./types";
import { containerArgs, sizeBlocker } from "./video";

/** How many tracks are on offer; a film with more than eight is a curiosity. */
export const MAX_AUDIO_TRACKS = 8;

/** "Track 2: Commentary, eng, AAC stereo": whatever the track says of itself, then its codec. */
export function describeAudioTrack(stream: AudioStreamInfo | undefined, index: number): string {
  if (!stream) return `Track ${index + 1}`;
  const codec = `${stream.codec.toUpperCase()}${stream.channelLayout ? ` ${stream.channelLayout}` : ""}`;
  const parts = [stream.title, stream.language, codec].filter((part): part is string => Boolean(part));
  return `Track ${index + 1}: ${parts.join(", ")}`;
}

/** "-track2-eng": the number keeps two tracks in one language apart. */
function trackSuffix(stream: AudioStreamInfo | undefined, index: number): string {
  const language = stream?.language?.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return language ? `-track${index + 1}-${language}` : `-track${index + 1}`;
}

/** Roughly what the track alone weighs: its rate over the length, else its share of the file. */
function estimateTrackBytes(probe: ProbeResult, stream: AudioStreamInfo, fileBytes: number): number {
  if (stream.bitrateKbps && probe.durationSeconds) {
    return Math.round((stream.bitrateKbps * 1000 * probe.durationSeconds) / 8);
  }
  return Math.round(fileBytes / Math.max(1, probe.audioStreams.length));
}

/** One track as one format. */
export function audioTrackFormat(index: number): OutputFormat {
  return {
    id: `audio-track-${index + 1}`,
    label: `Track ${index + 1}`,
    blurb: "This track as its own file, copied without re-encoding",
    lossless: true,
    requiredEncoder: null,
    describe(probe) {
      return describeAudioTrack(probe.audioStreams[index], index);
    },
    offer(probe) {
      return probe.audioStreams.length > index;
    },
    plan(probe) {
      const stream = probe.audioStreams[index];
      const target = copyTargetForCodec(stream?.codec ?? null);
      return {
        args: [
          "-map",
          `0:a:${index}`,
          "-vn",
          "-sn",
          "-dn",
          "-c:a",
          "copy",
          // Restated from the probe: the stripping the engine appends when the
          // switch is on takes every tag with it, and a track's language and
          // title are what this tool is for, not what the switch is for.
          ...(stream?.language ? ["-metadata:s:a:0", `language=${stream.language}`] : []),
          ...(stream?.title ? ["-metadata:s:a:0", `title=${stream.title}`] : []),
          ...containerArgs(target),
        ],
        ...target,
        mode: "copy",
        kind: "audio",
        fileSuffix: trackSuffix(stream, index),
      };
    },
    blocker(probe, context): FormatBlocker | null {
      const stream = probe.audioStreams[index];
      if (!stream) {
        return {
          message: `This file has no audio track ${index + 1}.`,
          hint: `It has ${probe.audioStreams.length}.`,
          retryable: false,
        };
      }
      return sizeBlocker(estimateTrackBytes(probe, stream, context.fileBytes), "This track");
    },
  };
}

/** Every track as a format; `offer` hides the ones a file lacks. */
export const AUDIO_TRACK_FORMATS: readonly OutputFormat[] = Array.from(
  { length: MAX_AUDIO_TRACKS },
  (_, index) => audioTrackFormat(index),
);

/** The formats a file gets on arrival: one per track it has. */
export function audioTrackFormatIds(probe: ProbeResult): string[] {
  return probe.audioStreams.slice(0, MAX_AUDIO_TRACKS).map((_, index) => `audio-track-${index + 1}`);
}
