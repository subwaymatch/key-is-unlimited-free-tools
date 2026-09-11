/**
 * Joining several videos into one.
 *
 * Two ways, because they cost very different things. When every clip has the
 * same streams - the same codec, frame size, pixel format and frame rate, the
 * same audio - the concat demuxer copies the packets straight through, which
 * is lossless and takes seconds whatever the size. When anything differs, the
 * only honest join is a re-encode: each clip is decoded, fitted to the first
 * clip's frame and rate, and the concat filter writes one H.264 stream.
 *
 * Everything here is pure: the decision, the reasons for it and the argument
 * strings are unit-tested without a browser.
 */
import { isQuarterTurn } from "./probe";
import { fileStem } from "../mediaTypes";
import type { ExtractMode, FormatBlocker, MergePlan, ProbeResult, VideoStreamInfo } from "./types";
import {
  containerArgs,
  containerFor,
  H264_ENCODE,
  MP4,
  MP4_FASTSTART,
  playbackWarning,
  sizeBlocker,
  type Container,
} from "./video";

/** One clip, as the planner sees it: what the engine mounted and found. */
export interface MergeClip {
  fileName: string;
  fileBytes: number;
  probe: ProbeResult;
  /** Where the engine mounted it, for the plan's `-i`. */
  inputPath: string;
}

export type MergeMode = "auto" | "encode";

export interface MergeSettings {
  /**
   * "auto" copies the streams when the clips match and re-encodes when they
   * do not; "encode" always re-encodes, for someone who wants one clean H.264
   * file whatever went in.
   */
  mode: MergeMode;
}

export const DEFAULT_MERGE_SETTINGS: MergeSettings = { mode: "auto" };

/** The frame every clip is fitted to when the join is a re-encode. */
export interface MergeCanvas {
  width: number;
  height: number;
  fps: number;
}

export interface MergeAssessment {
  mode: ExtractMode;
  /**
   * Why the clips cannot simply be concatenated, one line per difference,
   * each naming the clip and what differs from clip 1. Empty when they match.
   */
  mismatches: string[];
  container: Container;
  /** The frame a re-encode writes; null for a copy. */
  canvas: MergeCanvas | null;
  hasAudio: boolean;
  /** 1-based numbers of the clips that have no audio and are given silence. */
  silentClips: number[];
  totalSeconds: number | null;
  estimatedBytes: number | null;
}

/** Where the concat demuxer's list is written before a copy. */
export const CONCAT_LIST_PATH = "/merge.txt";

const FALLBACK_FPS = 30;
const AUDIO_KBPS = 160;
const AUDIO_RATE = 48_000;

/** Bits per pixel per frame the re-encode is sized at; see video.ts. */
const H264_BITS_PER_PIXEL = 0.07;

/** Frame rates within this much of each other count as the same. */
const FPS_TOLERANCE = 0.01;

/** The size a player shows: the coded size, turned for a quarter-turn rotation. */
export function displaySize(video: VideoStreamInfo | null): { width: number; height: number } | null {
  if (!video?.width || !video.height) return null;
  return isQuarterTurn(video.rotationDegrees)
    ? { width: video.height, height: video.width }
    : { width: video.width, height: video.height };
}

const sizeText = (size: { width: number; height: number } | null) =>
  size ? `${size.width}x${size.height}` : "an unknown size";

/**
 * Every way a clip differs from the first, worded for the summary line.
 *
 * Only what a stream copy cannot survive is listed. Different bitrates or
 * encoder settings are fine; a different codec, frame size or pixel format
 * produces a file that plays the first clip and then breaks, and a different
 * audio layout makes the muxer refuse outright.
 */
export function findMismatches(clips: readonly MergeClip[]): string[] {
  if (clips.length < 2) return [];
  const [first, ...rest] = clips;
  const mismatches: string[] = [];
  const firstVideo = first.probe.video;
  const firstAudio = first.probe.audio;

  for (const [offset, clip] of rest.entries()) {
    const n = offset + 2;
    const video = clip.probe.video;
    const audio = clip.probe.audio;

    if (!video || !firstVideo) {
      mismatches.push(`clip ${!video ? n : 1} has no video stream`);
      continue;
    }

    const codec = video.codec.toLowerCase();
    const firstCodec = firstVideo.codec.toLowerCase();
    if (codec !== firstCodec) {
      mismatches.push(`clip ${n} is ${codec.toUpperCase()} while clip 1 is ${firstCodec.toUpperCase()}`);
    } else if (video.profile && firstVideo.profile && video.profile !== firstVideo.profile) {
      mismatches.push(
        `clip ${n} is ${codec.toUpperCase()} ${video.profile} while clip 1 is ${firstCodec.toUpperCase()} ${firstVideo.profile}`,
      );
    }

    if (video.pixelFormat && firstVideo.pixelFormat && video.pixelFormat !== firstVideo.pixelFormat) {
      mismatches.push(`clip ${n} is ${video.pixelFormat} while clip 1 is ${firstVideo.pixelFormat}`);
    }

    const size = displaySize(video);
    const firstSize = displaySize(firstVideo);
    if (!size !== !firstSize) {
      mismatches.push(`clip ${n} is ${sizeText(size)} while clip 1 is ${sizeText(firstSize)}`);
    } else if (size && firstSize && (size.width !== firstSize.width || size.height !== firstSize.height)) {
      mismatches.push(`clip ${n} is ${sizeText(size)} while clip 1 is ${sizeText(firstSize)}`);
    } else if ((video.rotationDegrees ?? 0) !== (firstVideo.rotationDegrees ?? 0)) {
      // Same size on screen, reached by a different rotation in the container:
      // a copy would keep clip 1's rotation and show this clip on its side.
      mismatches.push(`clip ${n} is stored rotated differently from clip 1`);
    }

    if (video.fps && firstVideo.fps && Math.abs(video.fps - firstVideo.fps) > FPS_TOLERANCE) {
      mismatches.push(`clip ${n} runs at ${video.fps} fps while clip 1 runs at ${firstVideo.fps} fps`);
    }

    if (!audio !== !firstAudio) {
      mismatches.push(
        audio ? `clip ${n} has audio while clip 1 has none` : `clip ${n} has no audio while clip 1 does`,
      );
    } else if (audio && firstAudio) {
      const audioCodec = audio.codec.toLowerCase();
      const firstAudioCodec = firstAudio.codec.toLowerCase();
      if (audioCodec !== firstAudioCodec) {
        mismatches.push(
          `clip ${n}'s audio is ${audioCodec.toUpperCase()} while clip 1's is ${firstAudioCodec.toUpperCase()}`,
        );
      }
      if (audio.sampleRate && firstAudio.sampleRate && audio.sampleRate !== firstAudio.sampleRate) {
        mismatches.push(
          `clip ${n}'s audio is ${audio.sampleRate} Hz while clip 1's is ${firstAudio.sampleRate} Hz`,
        );
      }
      const layout = audio.channelLayout ?? (audio.channels ? `${audio.channels} channels` : null);
      const firstLayout =
        firstAudio.channelLayout ?? (firstAudio.channels ? `${firstAudio.channels} channels` : null);
      if (layout && firstLayout && layout !== firstLayout) {
        mismatches.push(`clip ${n}'s audio is ${layout} while clip 1's is ${firstLayout}`);
      }
    }
  }

  return mismatches;
}

function totalSeconds(clips: readonly MergeClip[]): number | null {
  let total = 0;
  for (const clip of clips) {
    const seconds = clip.probe.durationSeconds;
    if (seconds === null) return null;
    total += seconds;
  }
  return total;
}

/** The frame a re-encode writes: the first clip's, as a player shows it, kept even. */
export function mergeCanvas(first: MergeClip | undefined): MergeCanvas | null {
  const size = displaySize(first?.probe.video ?? null);
  if (!size) return null;
  const fps = first?.probe.video?.fps;
  return {
    width: Math.max(2, Math.floor(size.width / 2) * 2),
    height: Math.max(2, Math.floor(size.height / 2) * 2),
    fps: fps && fps > 0 ? Number(fps.toFixed(3)) : FALLBACK_FPS,
  };
}

/** What joining these clips would do, and why. */
export function assessMerge(
  clips: readonly MergeClip[],
  settings: MergeSettings = DEFAULT_MERGE_SETTINGS,
): MergeAssessment {
  const mismatches = findMismatches(clips);
  const copy = settings.mode === "auto" && mismatches.length === 0;
  const first = clips[0];
  const seconds = totalSeconds(clips);
  const silentClips = clips
    .map((clip, index) => (clip.probe.audio ? -1 : index + 1))
    .filter((n) => n > 0);

  if (copy) {
    return {
      mode: "copy",
      mismatches,
      container: containerFor(
        first?.probe.video?.codec ?? null,
        first?.probe.audio?.codec ?? null,
        first ? (first.fileName.split(".").pop()?.toLowerCase() ?? null) : null,
      ),
      canvas: null,
      hasAudio: first?.probe.audio !== null && first?.probe.audio !== undefined,
      silentClips: [],
      totalSeconds: seconds,
      estimatedBytes: clips.reduce((total, clip) => total + clip.fileBytes, 0),
    };
  }

  const canvas = mergeCanvas(first);
  /*
   * Audio goes in when any clip has some; the clips without get silence of
   * their own length, so the sound stays in step. A clip whose length is
   * unknown cannot be given silence of the right length, so if such a clip
   * has no audio, the output has none either.
   */
  const anyAudio = clips.some((clip) => clip.probe.audio !== null);
  const canPadSilence = clips.every(
    (clip) => clip.probe.audio !== null || clip.probe.durationSeconds !== null,
  );
  const hasAudio = anyAudio && canPadSilence;

  const estimatedBytes =
    canvas && seconds !== null
      ? Math.round(
          (canvas.width * canvas.height * canvas.fps * seconds * H264_BITS_PER_PIXEL) / 8 +
            (hasAudio ? (AUDIO_KBPS * 1000 * seconds) / 8 : 0),
        )
      : null;

  return {
    mode: "encode",
    mismatches,
    container: MP4,
    canvas,
    hasAudio,
    silentClips: hasAudio ? silentClips : [],
    totalSeconds: seconds,
    estimatedBytes,
  };
}

/** A reason these clips cannot be joined, or null when they can. */
export function mergeBlocker(
  clips: readonly MergeClip[],
  settings: MergeSettings = DEFAULT_MERGE_SETTINGS,
): FormatBlocker | null {
  if (clips.length < 2) {
    return {
      message: "Add at least two clips to join.",
      hint: "One clip on its own has nothing to be joined to.",
      retryable: false,
    };
  }
  const assessment = assessMerge(clips, settings);
  if (assessment.mode === "encode" && assessment.canvas === null) {
    return {
      message: "The first clip's frame size is unknown.",
      hint: "The other clips are fitted to the first one's frame, so it has to have a readable size. Put a different clip first.",
      retryable: false,
    };
  }
  return sizeBlocker(assessment.estimatedBytes, "The joined video");
}

/** The concat demuxer's list: one `file` line per clip, in order. */
export function concatList(clips: readonly MergeClip[]): string {
  // Paths are the engine's own safe names, so nothing here needs escaping.
  return ["ffconcat version 1.0", ...clips.map((clip) => `file '${clip.inputPath}'`)].join("\n") + "\n";
}

/**
 * The filter graph for a re-encode: every clip scaled into the canvas with
 * black bars where its shape differs, brought to one frame rate and one
 * pixel format, its audio to one rate and layout, then concatenated.
 */
export function concatGraph(
  clips: readonly MergeClip[],
  canvas: MergeCanvas,
  hasAudio: boolean,
): string {
  const { width, height, fps } = canvas;
  const chains: string[] = [];
  const labels: string[] = [];

  for (const [index, clip] of clips.entries()) {
    chains.push(
      `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${index}]`,
    );
    labels.push(`[v${index}]`);

    if (!hasAudio) continue;
    if (clip.probe.audio) {
      chains.push(
        `[${index}:a:0]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`,
      );
    } else {
      // Silence the length of the clip, so the next clip's sound starts on time.
      chains.push(
        `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${clip.probe.durationSeconds ?? 0}[a${index}]`,
      );
    }
    labels.push(`[a${index}]`);
  }

  chains.push(
    `${labels.join("")}concat=n=${clips.length}:v=1:a=${hasAudio ? 1 : 0}[v]${hasAudio ? "[a]" : ""}`,
  );
  return chains.join(";");
}

/** The command line for joining these clips, per the assessment. */
export function mergePlan(
  clips: readonly MergeClip[],
  settings: MergeSettings = DEFAULT_MERGE_SETTINGS,
): MergePlan {
  const assessment = assessMerge(clips, settings);
  const first = clips[0];
  const baseName = `${fileStem(first?.fileName ?? "", "video")}-merged`;

  if (assessment.mode === "copy") {
    return {
      inputArgs: ["-f", "concat", "-safe", "0", "-i", CONCAT_LIST_PATH],
      args: [
        "-map",
        "0:v:0",
        ...(assessment.hasAudio ? ["-map", "0:a:0"] : []),
        "-sn",
        "-dn",
        "-c",
        "copy",
        ...containerArgs(assessment.container),
      ],
      scratchFiles: [{ path: CONCAT_LIST_PATH, contents: concatList(clips) }],
      ...assessment.container,
      mode: "copy",
      kind: "video",
      baseName,
      expectedSeconds: assessment.totalSeconds,
      warning: playbackWarning(first?.probe.video?.codec),
    };
  }

  const canvas = assessment.canvas ?? { width: 2, height: 2, fps: FALLBACK_FPS };
  return {
    inputArgs: clips.flatMap((clip) => ["-i", clip.inputPath]),
    args: [
      "-filter_complex",
      concatGraph(clips, canvas, assessment.hasAudio),
      "-map",
      "[v]",
      ...(assessment.hasAudio ? ["-map", "[a]"] : []),
      "-sn",
      "-dn",
      ...H264_ENCODE,
      "-crf",
      "20",
      ...(assessment.hasAudio ? ["-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`] : []),
      ...MP4_FASTSTART,
    ],
    ...MP4,
    mode: "encode",
    kind: "video",
    baseName,
    expectedSeconds: assessment.totalSeconds,
  };
}
