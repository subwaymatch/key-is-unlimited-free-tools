/**
 * The video tools' catalogues.
 *
 * Every entry here is an OutputFormat: a label, a plan the engine runs, and a
 * guard that says no before a long run rather than after it. The tools are
 * mostly argument strings against the machinery the audio extractor already
 * has (section 3.1 of agent-outputs/browser-tool-catalogue-and-build-order.md),
 * and this file is where those strings live.
 *
 * Two decisions recur:
 *
 *  - Copy where possible. A stream copy is the difference between seconds and
 *    an hour on a large file, and it is lossless. Each format works out from
 *    the probe whether the source already fits, and only encodes what does not.
 *  - Guard the output size. Input is mounted and never copied, but output is
 *    built in the core's heap (section 6 of the plan). Copies are sized from
 *    the file, encodes from a bits-per-pixel estimate, and anything past
 *    MAX_SAFE_OUTPUT_BYTES is refused with a way out.
 *
 * Everything here is pure, so the argument strings are unit-tested without a
 * browser.
 */
import { copyTargetForCodec, MAX_SAFE_OUTPUT_BYTES } from "./formats";
import { trimDuration } from "./trim";
import type {
  FormatBlocker,
  FormatPlan,
  OutputFormat,
  PlanContext,
  ProbeResult,
  VideoStreamInfo,
} from "./types";

/** The first video stream and, when there is one, the first audio stream. */
export const SELECT_VIDEO = ["-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"];

/** Moves the moov atom to the front so players can start immediately. */
const MP4_FASTSTART = ["-movflags", "+faststart"];

/**
 * H.264 for everything that has to play anywhere.
 *
 * `veryfast` because the encoder runs single-threaded in WebAssembly, where
 * `medium` is roughly two and a half times slower for a few percent smaller
 * output. 4:2:0 8-bit is the one pixel format every decoder takes.
 */
const H264_ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];

export interface Container {
  extension: string;
  mimeType: string;
}

export const MP4: Container = { extension: "mp4", mimeType: "video/mp4" };
export const WEBM: Container = { extension: "webm", mimeType: "video/webm" };
export const MKV: Container = { extension: "mkv", mimeType: "video/x-matroska" };
export const MOV: Container = { extension: "mov", mimeType: "video/quicktime" };

const MP4_VIDEO = new Set(["h264", "hevc", "mpeg4", "av1"]);
/** Codecs an MP4 can hold that ordinary players also decode. */
const MP4_AUDIO = new Set(["aac", "mp3", "ac3", "eac3", "alac"]);
const WEBM_VIDEO = new Set(["vp8", "vp9", "av1"]);
const WEBM_AUDIO = new Set(["opus", "vorbis"]);
const MOV_VIDEO = new Set(["prores", "dnxhd", "mjpeg", "qtrle", "cfhd"]);

/**
 * The container that can hold these two codecs without re-encoding either.
 *
 * Matroska takes nearly anything, so it is the fallback; the others are chosen
 * when they fit, because more players open them.
 */
export function containerFor(video: string | null, audio: string | null): Container {
  const v = video?.toLowerCase() ?? null;
  const a = audio?.toLowerCase() ?? null;
  if (v === null) return copyTargetForCodec(a);
  if (MP4_VIDEO.has(v) && (a === null || MP4_AUDIO.has(a))) return MP4;
  if (WEBM_VIDEO.has(v) && (a === null || WEBM_AUDIO.has(a))) return WEBM;
  if (MOV_VIDEO.has(v)) return MOV;
  return MKV;
}

/** Muxer options a container wants on every output. */
export function containerArgs(container: Container): string[] {
  return container === MP4 || container === MOV ? MP4_FASTSTART : [];
}

/**
 * Whether an H.264 stream can go into an MP4 as it is and still play anywhere.
 *
 * 10-bit and 4:4:4 H.264 are legal and browsers refuse them, so the pixel
 * format decides; a probe that could not read it is given the benefit of the
 * doubt.
 */
export function isBrowserSafeH264(video: VideoStreamInfo): boolean {
  if (video.codec.toLowerCase() !== "h264") return false;
  const pixelFormat = video.pixelFormat?.toLowerCase() ?? null;
  return pixelFormat === null || pixelFormat === "yuv420p" || pixelFormat === "yuvj420p";
}

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/**
 * Roughly how large a stream copy of this range will be: the file, scaled to
 * the part of it being kept.
 */
export function estimateCopyBytes(probe: ProbeResult, context: PlanContext): number {
  const total = probe.durationSeconds;
  const clip = trimDuration(context.trim, total);
  if (!total || !clip) return context.fileBytes;
  return Math.round((context.fileBytes * clip) / total);
}

/**
 * Bits per pixel per frame that `libx264 -preset veryfast -crf 23` tends to
 * land on for ordinary footage. Deliberately on the high side: the estimate
 * exists to refuse an encode that would overflow the heap after an hour of
 * work, and a false refusal costs a trim while a false pass costs the hour.
 */
const H264_CRF_BITS_PER_PIXEL = 0.07;

/** Roughly how large a constant-quality H.264 encode of this range will be. */
export function estimateEncodedBytes(
  probe: ProbeResult,
  context: PlanContext,
  audioKbps: number,
): number | null {
  const video = probe.video;
  const seconds = trimDuration(context.trim, probe.durationSeconds);
  if (!video || !video.width || !video.height || !seconds) return null;
  const fps = video.fps ?? 30;
  const videoBits = video.width * video.height * fps * seconds * H264_CRF_BITS_PER_PIXEL;
  return Math.round(videoBits / 8 + (audioKbps * 1000 * seconds) / 8);
}

/** The output-ceiling guard shared by every format that writes a video file. */
export function sizeBlocker(estimatedBytes: number | null, what: string): FormatBlocker | null {
  if (estimatedBytes === null || estimatedBytes <= MAX_SAFE_OUTPUT_BYTES) return null;
  return {
    message: `${what} would be about ${gb(estimatedBytes)} GB.`,
    hint: "ffmpeg.wasm builds its output in memory, which caps out near 1.5 GB. Trim the file to a shorter range, or compress it to a target size instead.",
  };
}

/** A guard for the tools that only make sense over a range. */
export function requireTrim(context: PlanContext): FormatBlocker | null {
  if (context.trim) return null;
  return {
    message: "Set a start or end marker first.",
    hint: "Without a range the cut would be the whole file. Drag across the preview or type a time.",
  };
}

/* ---- Convert ------------------------------------------------------------ */

/** Whether the first audio track already fits the format, or is absent. */
function audioFits(probe: ProbeResult, codecs: Set<string>): boolean {
  const codec = probe.audio?.codec.toLowerCase();
  return codec === undefined || codecs.has(codec);
}

/**
 * The converter: "make this video work".
 *
 * MP4 is the target that matters. It copies an H.264 track and an AAC track
 * when the source already has them, which turns a MOV, MKV or TS remux into a
 * few seconds, and encodes only what does not fit. The others are for people
 * who know they want them.
 */
export const CONVERT_FORMATS: readonly OutputFormat[] = [
  {
    id: "mp4",
    label: "MP4 (H.264 + AAC)",
    blurb: "Plays anywhere: browsers, phones, TVs and editors. Copied without re-encoding when the source already fits",
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe) {
      const copyVideo = probe.video !== null && isBrowserSafeH264(probe.video);
      const copyAudio = audioFits(probe, new Set(["aac"]));
      return {
        args: [
          ...SELECT_VIDEO,
          ...(copyVideo ? ["-c:v", "copy"] : [...H264_ENCODE, "-crf", "23"]),
          ...(probe.audio ? (copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"]) : []),
          ...MP4_FASTSTART,
        ],
        ...MP4,
        mode: copyVideo && copyAudio ? "copy" : "encode",
        kind: "video",
      };
    },
    blocker(probe, context) {
      const copyVideo = probe.video !== null && isBrowserSafeH264(probe.video);
      const estimated = copyVideo
        ? estimateCopyBytes(probe, context)
        : estimateEncodedBytes(probe, context, 160);
      return sizeBlocker(estimated, "The MP4");
    },
  },
  {
    id: "webm",
    label: "WebM (VP9 + Opus)",
    blurb: "The open web format. Copied when the source is already VP8 or VP9; otherwise slow to encode",
    lossless: false,
    requiredEncoder: "libvpx-vp9",
    plan(probe) {
      const codec = probe.video?.codec.toLowerCase();
      const copyVideo = codec !== undefined && WEBM_VIDEO.has(codec);
      const copyAudio = audioFits(probe, WEBM_AUDIO);
      return {
        args: [
          ...SELECT_VIDEO,
          ...(copyVideo
            ? ["-c:v", "copy"]
            : [
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                "33",
                "-deadline",
                "good",
                "-cpu-used",
                "5",
                "-pix_fmt",
                "yuv420p",
              ]),
          // ffmpeg's own Opus encoder: libopus traps in this core, see formats.ts.
          ...(probe.audio
            ? copyAudio
              ? ["-c:a", "copy"]
              : ["-c:a", "opus", "-strict", "-2", "-b:a", "128k"]
            : []),
        ],
        ...WEBM,
        mode: copyVideo && copyAudio ? "copy" : "encode",
        kind: "video",
      };
    },
    blocker(probe, context) {
      const codec = probe.video?.codec.toLowerCase();
      const copyVideo = codec !== undefined && WEBM_VIDEO.has(codec);
      const estimated = copyVideo
        ? estimateCopyBytes(probe, context)
        : estimateEncodedBytes(probe, context, 128);
      return sizeBlocker(estimated, "The WebM");
    },
  },
  {
    id: "mkv",
    label: "MKV (no re-encoding)",
    blurb: "Repackages every stream as it is. Fastest and lossless, but fewer players open MKV",
    lossless: true,
    requiredEncoder: null,
    plan() {
      return {
        args: ["-map", "0:v:0", "-map", "0:a?", "-sn", "-dn", "-c", "copy"],
        ...MKV,
        mode: "copy",
        kind: "video",
      };
    },
    blocker(probe, context) {
      return sizeBlocker(estimateCopyBytes(probe, context), "The MKV");
    },
  },
];

export const DEFAULT_CONVERT_FORMAT_IDS = ["mp4"];

/* ---- Compress to a target size ------------------------------------------ */

/** Sizes people are actually asked for, with where the number comes from. */
export const COMPRESS_PRESETS: readonly { megabytes: number; blurb: string }[] = [
  { megabytes: 8, blurb: "The tightest chat and forum limits" },
  { megabytes: 10, blurb: "Discord without Nitro" },
  { megabytes: 25, blurb: "Email attachments: Gmail, Outlook" },
  { megabytes: 50, blurb: "Most messaging apps and forms" },
  { megabytes: 100, blurb: "WhatsApp and Telegram media" },
  { megabytes: 250, blurb: "Roomy, for long recordings" },
];

/** Video heights on offer; "auto" picks one the bitrate can actually fill. */
export type CompressResolution = "auto" | "source" | 1080 | 720 | 480 | 360;

export interface CompressSettings {
  targetBytes: number;
  resolution: CompressResolution;
  /** Two passes hit the size; one pass is twice as quick and close to it. */
  twoPass: boolean;
}

export const DEFAULT_COMPRESS_SETTINGS: CompressSettings = {
  targetBytes: 25_000_000,
  resolution: "auto",
  twoPass: true,
};

/**
 * Margin left under the target for container overhead and the encoder's own
 * overshoot. Two passes land within a couple of percent of the bitrate they
 * were given; a single pass is looser.
 */
const TWO_PASS_MARGIN = 0.95;
const ONE_PASS_MARGIN = 0.9;

/**
 * Seconds of video a single pass may spend before its rate control catches
 * up: the size of the VBV buffer it is given, which starts full. The budget
 * treats the clip as this much longer, so the bound holds on a short clip
 * as well as a long one.
 */
const ONE_PASS_BUFFER_SECONDS = 1;

/** Below this the picture is a smear of blocks, whatever the resolution. */
const MIN_VIDEO_KBPS = 50;

export interface CompressBudget {
  videoKbps: number;
  audioKbps: number;
  totalKbps: number;
}

/**
 * Splits a byte budget over a length into a video and an audio bitrate.
 *
 * Audio takes a fixed slice that shrinks as the budget does: 128 kbps is
 * transparent for AAC, but at a 300 kbps total it would be nearly half the
 * file, so speech-grade rates take over. Null when the video would fall under
 * the minimum, which is the case a smaller target or a shorter range fixes.
 */
export function compressBudget(
  targetBytes: number,
  seconds: number,
  hasAudio: boolean,
  twoPass = true,
): CompressBudget | null {
  if (!(seconds > 0) || !(targetBytes > 0)) return null;
  const margin = twoPass ? TWO_PASS_MARGIN : ONE_PASS_MARGIN;
  const effectiveSeconds = twoPass ? seconds : seconds + ONE_PASS_BUFFER_SECONDS;
  const totalKbps = (targetBytes * 8 * margin) / effectiveSeconds / 1000;
  const audioKbps = !hasAudio
    ? 0
    : totalKbps >= 1500
      ? 128
      : totalKbps >= 600
        ? 96
        : totalKbps >= 300
          ? 64
          : 48;
  const videoKbps = Math.floor(totalKbps - audioKbps);
  if (videoKbps < MIN_VIDEO_KBPS) return null;
  return { videoKbps, audioKbps, totalKbps: Math.floor(totalKbps) };
}

/** The 16:9 heights the automatic choice picks from, largest first. */
const AUTO_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240];

/**
 * Fewest bits per pixel per frame at which H.264 still looks like video
 * rather than a mosaic. Spending fewer pixels at more bits each is always the
 * better trade below it.
 */
const MIN_BITS_PER_PIXEL = 0.04;

/**
 * The tallest frame a bitrate can afford, so a small target gets a smaller,
 * clean picture instead of a full-size, blocky one.
 */
export function autoHeight(videoKbps: number, fps: number | null): number {
  const pixelBudget = (videoKbps * 1000) / (MIN_BITS_PER_PIXEL * (fps ?? 30));
  for (const height of AUTO_HEIGHTS) {
    if ((height * height * 16) / 9 <= pixelBudget) return height;
  }
  return AUTO_HEIGHTS[AUTO_HEIGHTS.length - 1];
}

/**
 * A scale filter that fits the frame inside a box without ever enlarging it.
 *
 * The box is 16:9 at the given height and is turned on its side for portrait
 * video, so "720p" means 1280x720 for a landscape phone clip and 720x1280 for
 * a portrait one, rather than squashing the latter to 405 pixels wide. Both
 * dimensions stay even, which 4:2:0 encoders require.
 */
export function fitFilter(height: number): string {
  const long = Math.round((height * 16) / 9);
  const short = height;
  return (
    `scale=w='if(gt(iw,ih),min(iw,${long}),min(iw,${short}))'` +
    `:h='if(gt(iw,ih),min(ih,${short}),min(ih,${long}))'` +
    ":force_original_aspect_ratio=decrease:force_divisible_by=2"
  );
}

/**
 * Whether a frame already fits inside the box `fitFilter` would draw, in
 * which case the filter is left off: a no-op scale still costs a pass through
 * the scaler on every frame, and the plan should read as what it does.
 */
export function fitsHeight(video: VideoStreamInfo | null, height: number): boolean {
  if (!video || !video.width || !video.height) return false;
  const long = Math.round((height * 16) / 9);
  return (
    Math.max(video.width, video.height) <= long && Math.min(video.width, video.height) <= height
  );
}

function resolutionLabel(resolution: CompressResolution): string {
  if (resolution === "auto") return "auto";
  if (resolution === "source") return "source";
  return `${resolution}p`;
}

/**
 * The compressor for one set of settings.
 *
 * The settings are baked into the format rather than read at run time, so a
 * file queued at 25 MB stays a 25 MB job however the panel changes afterwards,
 * and "25 MB" and "8 MB" of one file are two outputs on its card.
 */
export function compressFormat(settings: CompressSettings): OutputFormat {
  const megabytes = Math.round(settings.targetBytes / 1_000_000);
  const id = `compress-${megabytes}mb-${resolutionLabel(settings.resolution)}-${
    settings.twoPass ? "2pass" : "1pass"
  }`;

  const budgetFor = (probe: ProbeResult, context: PlanContext) =>
    compressBudget(
      settings.targetBytes,
      trimDuration(context.trim, probe.durationSeconds) ?? 0,
      probe.audio !== null,
      settings.twoPass,
    );

  return {
    id,
    label: `${megabytes} MB`,
    blurb: `Under ${megabytes} MB, ${
      settings.twoPass ? "two-pass" : "single-pass"
    } H.264 at ${resolutionLabel(settings.resolution)} resolution`,
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe, context = { trim: null, fileBytes: 0 }) {
      const budget = budgetFor(probe, context) ?? {
        videoKbps: MIN_VIDEO_KBPS,
        audioKbps: 48,
        totalKbps: MIN_VIDEO_KBPS + 48,
      };

      const wanted =
        settings.resolution === "auto"
          ? autoHeight(budget.videoKbps, probe.video?.fps ?? null)
          : settings.resolution === "source"
            ? null
            : settings.resolution;
      const height = wanted !== null && fitsHeight(probe.video, wanted) ? null : wanted;

      /*
       * Two passes know the whole clip and can spend above the average where
       * it is needed, so the cap is loose. A single pass only sees the past,
       * and on a short or busy clip its average drifts over the target, so
       * the cap sits on the bitrate itself with one second of buffer: the
       * most it can then write is the buffer plus the rate times the length,
       * which is what compressBudget allowed for.
       */
      const maxrate = settings.twoPass ? Math.round(budget.videoKbps * 1.5) : budget.videoKbps;
      const bufsize = settings.twoPass ? maxrate * 2 : maxrate * ONE_PASS_BUFFER_SECONDS;
      const common = [
        ...SELECT_VIDEO,
        ...H264_ENCODE,
        "-b:v",
        `${budget.videoKbps}k`,
        "-maxrate",
        `${maxrate}k`,
        "-bufsize",
        `${bufsize}k`,
        ...(height === null ? [] : ["-vf", fitFilter(height)]),
      ];

      const audio = probe.audio;
      const audioArgs = !audio
        ? []
        : audio.codec.toLowerCase() === "aac" &&
            audio.bitrateKbps !== null &&
            audio.bitrateKbps <= budget.audioKbps
          ? ["-c:a", "copy"]
          : [
              "-c:a",
              "aac",
              "-b:a",
              `${budget.audioKbps}k`,
              ...((audio.channels ?? 2) > 2 ? ["-ac", "2"] : []),
            ];

      return {
        analysisPasses: settings.twoPass ? [[...common, "-pass", "1", "-an"]] : undefined,
        args: [
          ...common,
          ...(settings.twoPass ? ["-pass", "2"] : []),
          ...audioArgs,
          ...MP4_FASTSTART,
        ],
        ...MP4,
        mode: "encode",
        kind: "video",
        fileSuffix: `-${megabytes}mb`,
      };
    },
    blocker(probe, context) {
      const seconds = trimDuration(context.trim, probe.durationSeconds);
      if (!seconds) {
        return {
          message: "This file's length is unknown, so it cannot be sized.",
          hint: "The container does not report a duration. Converting it to MP4 first gives it one.",
        };
      }

      if (settings.targetBytes > MAX_SAFE_OUTPUT_BYTES) {
        return {
          message: `${megabytes} MB is more than ffmpeg.wasm can hold in memory.`,
          hint: "Outputs are built in memory and cap out near 1.5 GB. Choose a smaller target.",
        };
      }

      const already = estimateCopyBytes(probe, context);
      if (already <= settings.targetBytes) {
        return {
          message: `This ${context.trim ? "range" : "file"} is already under ${megabytes} MB.`,
          hint: `It is about ${(already / 1_000_000).toFixed(already < 10_000_000 ? 1 : 0)} MB. Choose a smaller target to shrink it further.`,
        };
      }

      if (budgetFor(probe, context) === null) {
        return {
          message: `${megabytes} MB is too small for ${context.trim ? "a range" : "a video"} this long.`,
          hint: `At that size the picture would get under ${MIN_VIDEO_KBPS} kbps. Choose a larger target, or trim it to a shorter range.`,
        };
      }

      return null;
    },
  };
}

/* ---- Remove audio ------------------------------------------------------- */

export const MUTE_FORMAT: OutputFormat = {
  id: "mute",
  label: "Without audio",
  blurb: "The video stream copied as it is, with every audio track dropped",
  lossless: true,
  requiredEncoder: null,
  plan(probe) {
    const container = containerFor(probe.video?.codec ?? null, null);
    return {
      args: ["-map", "0:v:0", "-an", "-sn", "-dn", "-c:v", "copy", ...containerArgs(container)],
      ...container,
      mode: "copy",
      kind: "video",
      fileSuffix: "-muted",
    };
  },
  blocker(probe, context) {
    return sizeBlocker(estimateCopyBytes(probe, context), "The video");
  },
};

/* ---- Video to GIF ------------------------------------------------------- */

export interface GifSettings {
  fps: number;
  /** Pixels wide, or null to keep the source width. Never enlarged. */
  width: number | null;
}

export const GIF_FPS_OPTIONS: readonly number[] = [10, 12, 15, 20];
export const GIF_WIDTH_OPTIONS: readonly (number | null)[] = [320, 480, 640, null];

export const DEFAULT_GIF_SETTINGS: GifSettings = { fps: 15, width: 480 };

/**
 * Bytes per pixel per frame a GIF of ordinary footage tends to cost once
 * dithered and LZW-packed. Screen recordings do far better; this is sized for
 * the camera clip that does not.
 */
const GIF_BYTES_PER_PIXEL = 0.4;

/** Roughly how large the GIF will be, or null when the frame size is unknown. */
export function estimateGifBytes(
  probe: ProbeResult,
  context: PlanContext,
  settings: GifSettings,
): number | null {
  const video = probe.video;
  const seconds = trimDuration(context.trim, probe.durationSeconds);
  if (!video || !video.width || !video.height || !seconds) return null;
  const width = settings.width === null ? video.width : Math.min(settings.width, video.width);
  const height = Math.round((video.height * width) / video.width);
  return Math.round(width * height * settings.fps * seconds * GIF_BYTES_PER_PIXEL);
}

/**
 * The GIF converter for one set of settings.
 *
 * One pass, not two: the palette is generated and applied in the same graph
 * through a split, so the video is decoded once. `stats_mode=diff` weights the
 * palette towards what changes between frames, and `diff_mode=rectangle`
 * re-encodes only the part of each frame that moved, which is what keeps a
 * talking head from costing the same as a car chase.
 */
export function gifFormat(settings: GifSettings): OutputFormat {
  const id = `gif-${settings.fps}fps-${settings.width ?? "source"}`;
  const scale =
    settings.width === null ? "" : `,scale=min(iw\\,${settings.width}):-2:flags=lanczos`;
  const graph =
    `[0:v:0]fps=${settings.fps}${scale},split[a][b];` +
    "[a]palettegen=stats_mode=diff[p];" +
    "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]";

  return {
    id,
    label: "GIF",
    blurb: `${settings.fps} fps, ${
      settings.width === null ? "source size" : `${settings.width} px wide`
    }, looping`,
    lossless: false,
    requiredEncoder: "gif",
    plan() {
      return {
        args: ["-filter_complex", graph, "-map", "[out]", "-loop", "0", "-f", "gif"],
        extension: "gif",
        mimeType: "image/gif",
        mode: "encode",
        kind: "image",
      };
    },
    blocker(probe, context) {
      return sizeBlocker(estimateGifBytes(probe, context, settings), "The GIF");
    },
  };
}

/* ---- Trim --------------------------------------------------------------- */

/**
 * Two ways to cut, because they trade the two things people care about.
 *
 * A stream copy is instant and lossless but can only start on a keyframe, so
 * the cut lands up to a few seconds before the marker. Re-encoding lands on
 * the frame, and costs a full encode of the clip.
 */
export const TRIM_FORMATS: readonly OutputFormat[] = [
  {
    id: "trim-copy",
    label: "Fast cut",
    blurb: "Copies the streams without re-encoding. Instant and lossless, but the cut snaps to the nearest keyframe before the marker",
    lossless: true,
    requiredEncoder: null,
    plan(probe) {
      const container = containerFor(probe.video?.codec ?? null, probe.audio?.codec ?? null);
      return {
        args: [
          ...SELECT_VIDEO,
          "-c",
          "copy",
          // A copied stream starts on the keyframe before the seek, which lands
          // it at a negative timestamp; shift everything so the clip starts at zero.
          "-avoid_negative_ts",
          "make_zero",
          ...containerArgs(container),
        ],
        ...container,
        mode: "copy",
        kind: "video",
      };
    },
    blocker(probe, context) {
      return requireTrim(context) ?? sizeBlocker(estimateCopyBytes(probe, context), "The clip");
    },
  },
  {
    id: "trim-precise",
    label: "Precise cut",
    blurb: "Re-encodes so the cut lands exactly on the markers. Slower, and the result is always an MP4",
    lossless: false,
    requiredEncoder: "libx264",
    plan(probe) {
      return {
        args: [
          ...SELECT_VIDEO,
          ...H264_ENCODE,
          "-crf",
          "18",
          // Encoded rather than copied: a copied track would keep the packets
          // between the keyframe and the marker and drift out of sync.
          ...(probe.audio ? ["-c:a", "aac", "-b:a", "192k"] : []),
          ...MP4_FASTSTART,
        ],
        ...MP4,
        mode: "encode",
        kind: "video",
      };
    },
    blocker(probe, context) {
      return (
        requireTrim(context) ??
        sizeBlocker(estimateEncodedBytes(probe, context, 192), "The clip")
      );
    },
  },
];

/* ---- Remove metadata ---------------------------------------------------- */

export const STRIP_FORMAT: OutputFormat = {
  id: "strip",
  label: "Without metadata",
  blurb: "Streams copied as they are; titles, tags, dates, location, chapters and data tracks dropped",
  lossless: true,
  requiredEncoder: null,
  plan(probe) {
    const container = containerFor(probe.video?.codec ?? null, probe.audio?.codec ?? null);
    return {
      args: [
        // Cover art is a video stream too, and it is dropped along with the
        // subtitle and data tracks, which is where camera GPS logs live.
        ...(probe.hasVideo ? ["-map", "0:v:0"] : []),
        "-map",
        "0:a?",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_metadata:s",
        "-1",
        "-map_chapters",
        "-1",
        "-c",
        "copy",
        // Stops the muxer stamping its own name into the file it just cleaned.
        "-fflags",
        "+bitexact",
        ...containerArgs(container),
      ],
      ...container,
      mode: "copy",
      kind: probe.hasVideo ? "video" : "audio",
      fileSuffix: "-clean",
    };
  },
  blocker(probe, context) {
    return sizeBlocker(estimateCopyBytes(probe, context), "The file");
  },
};

/** Convenience for tests and the card: what a format would write for a file. */
export function planFor(format: OutputFormat, probe: ProbeResult, fileBytes = 0): FormatPlan {
  return format.plan(probe, { trim: null, fileBytes });
}
