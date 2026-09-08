/**
 * Engine-agnostic contract for audio extraction.
 *
 * The app talks to this interface only, so the ffmpeg.wasm implementation can
 * be swapped (or joined) by another engine - e.g. a WebCodecs-based one - with
 * no changes above `lib/`.
 *
 * The session shape (open once per file, extract many formats, close) exists
 * because mounting and probing a multi-gigabyte file is the expensive part;
 * producing a second output format from an already-open file should not repeat it.
 */

export interface AudioStreamInfo {
  /** ffmpeg codec name, e.g. "aac", "opus", "pcm_s16le". */
  codec: string;
  /** Human-readable profile, e.g. "LC", when ffmpeg reports one. */
  profile: string | null;
  sampleRate: number | null;
  channels: number | null;
  /** Raw channel layout as printed by ffmpeg, e.g. "stereo", "5.1(side)". */
  channelLayout: string | null;
  bitrateKbps: number | null;
}

export interface VideoStreamInfo {
  /** ffmpeg codec name, e.g. "h264", "hevc", "vp9". */
  codec: string;
  /** Human-readable profile, e.g. "High", "Main 10", when ffmpeg reports one. */
  profile: string | null;
  /** Pixel format, e.g. "yuv420p". What decides whether a browser can play it. */
  pixelFormat: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
}

export interface ProbeResult {
  /** Media duration in seconds, or null when ffmpeg reports "N/A". */
  durationSeconds: number | null;
  /** Overall bitrate from the Duration line, in kb/s, or null when absent. */
  bitrateKbps: number | null;
  /** Every audio stream ffmpeg found, in file order. */
  audioStreams: AudioStreamInfo[];
  /** First audio stream (the one extracted), or null when the file has none. */
  audio: AudioStreamInfo | null;
  /** Every real video stream, in file order. Embedded cover art is not one. */
  videoStreams: VideoStreamInfo[];
  /** First video stream (the one the video tools work on), or null. */
  video: VideoStreamInfo | null;
  hasVideo: boolean;
  /** Container/format name(s) ffmpeg detected, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  formatName: string | null;
  /** ffmpeg's stderr for this probe, kept for the per-file log panel. */
  log: string[];
}

export interface EngineCapabilities {
  /** Encoder names the loaded core actually provides (from `ffmpeg -encoders`). */
  encoders: ReadonlySet<string>;
  /** False when the core was built without WORKERFS, which caps input at ~2 GB. */
  supportsWorkerFs: boolean;
}

export type EngineLoadStage = "idle" | "downloading-core" | "starting" | "ready";

export interface EngineLoadProgress {
  stage: EngineLoadStage;
  /** 0..1 for the core download; null while indeterminate. */
  ratio: number | null;
  receivedBytes: number;
  totalBytes: number;
}

export interface ExtractProgress {
  /** 0..1, computed from processed media time over the probed duration. */
  ratio: number | null;
  /** Seconds of media processed so far. */
  processedSeconds: number;
}

export type ExtractMode = "copy" | "encode";

/** What a finished output is, which decides how the card previews it. */
export type OutputKind = "audio" | "video" | "image";

/**
 * A slice of the source timeline, in seconds measured from the start of the
 * file. `endSeconds` is null for "run to the end", which lets a start-only trim
 * skip the `-t` argument entirely rather than restating the file's own length.
 */
export interface TrimRange {
  startSeconds: number;
  endSeconds: number | null;
}

/**
 * What a format knows about the job beyond the probe when it builds its plan.
 *
 * A target-size compressor needs the length of the clip, not of the file, to
 * turn megabytes into a bitrate; and a guard against re-compressing something
 * already small needs the size of the file.
 */
export interface PlanContext {
  trim: TrimRange | null;
  fileBytes: number;
}

/**
 * One concrete ffmpeg invocation, or a short sequence of them.
 *
 * The engine builds the command line around this:
 *
 *   ffmpeg [seek] [inputArgs] -i <input> <pass args> [length] <output>
 *
 * with the seek and the length coming from the trim, so a plan never has to
 * know where the file is mounted or how a clip is expressed.
 */
export interface FormatPlan {
  /** Output options: everything between the input and the output path. */
  args: string[];
  /** Options that belong before `-i`, such as a forced input format. */
  inputArgs?: string[];
  /**
   * Passes to run before the final one, each written to the null muxer.
   *
   * Two-pass encoding puts its analysis pass here. The engine adds the pass
   * log location itself and removes the log afterwards, so a plan only has to
   * say `-pass 1` and `-pass 2`.
   */
  analysisPasses?: string[][];
  extension: string;
  mimeType: string;
  mode: ExtractMode;
  /** Defaults to "audio", which is what every format was until the video tools. */
  kind?: OutputKind;
  /**
   * Added to the source name, before any clip range: "-compressed", "-muted".
   * A tool whose output keeps the source extension needs one, or the download
   * would land in the folder under the very name it started from.
   */
  fileSuffix?: string;
}

export interface FormatBlocker {
  message: string;
  hint: string;
}

/**
 * Something a tool can produce from an open file.
 *
 * The audio formats, the video containers, "the same file without its audio"
 * and "a GIF of this range at 15 fps" are all one of these: a label for the
 * card, a plan the engine can run, and an optional guard that says no before
 * a long run rather than after it.
 */
export interface OutputFormat {
  /**
   * Identity within one tool's catalogue. Where settings change the plan, they
   * belong in the id too, so "25 MB" and "8 MB" are two outputs of one file.
   */
  id: string;
  label: string;
  blurb: string;
  /** Whether the result preserves the source bit-for-bit or losslessly. */
  lossless: boolean;
  /**
   * Encoder that must exist in the loaded core for this format to work.
   * Null means the format is (or can be) a pure stream copy.
   */
  requiredEncoder: string | null;
  plan(probe: ProbeResult, context?: PlanContext): FormatPlan;
  /**
   * A reason this format cannot run on this file, or null when it can.
   *
   * Checked before anything expensive happens, so a WAV that would overflow
   * the heap or a target size too small for the length is reported at once.
   */
  blocker?(probe: ProbeResult, context: PlanContext): FormatBlocker | null;
}

/**
 * Which stream a tool needs the file to have.
 *
 * The audio extractor cannot do anything with a silent video, and a video
 * converter has nothing to convert in an MP3; "media" is for tools that work
 * on whatever is there, such as stripping metadata.
 */
export type MediaExpectation = "audio" | "video" | "media";

export interface OpenSessionOptions {
  /** Defaults to "audio". */
  expects?: MediaExpectation;
}

export interface SilenceScanOptions {
  /** Amplitude at or below which audio counts as silence, in dBFS. */
  thresholdDb: number;
  /** How long the quiet must last before it counts as silence, in seconds. */
  minDurationSeconds: number;
}

/** One stretch of silence. `end` is null when the file ended still silent. */
export interface SilenceInterval {
  start: number;
  end: number | null;
}

export interface SilenceScanResult {
  /** Every silence ffmpeg reported, in file order. */
  intervals: SilenceInterval[];
  /** Leading and trailing silence removed, or null when there is none to cut. */
  suggested: TrimRange | null;
  /** True when silence covers the whole file, which is why `suggested` is null. */
  entirelySilent: boolean;
  /**
   * Length of audio the scan worked against, in seconds: the container's
   * duration when the probe found one, otherwise how far the decode itself
   * got. Files written without a duration (a browser MediaRecorder WebM, say)
   * only have the latter, and `suggested` was computed from it.
   */
  durationSeconds: number | null;
  options: SilenceScanOptions;
}

export interface ExtractOutput {
  blob: Blob;
  fileName: string;
  extension: string;
  mimeType: string;
  bytes: number;
  elapsedMs: number;
  mode: ExtractMode;
  kind: OutputKind;
  /** The portion of the source this output covers; null when it is all of it. */
  trim: TrimRange | null;
}

export interface ExtractOptions {
  /** Portion of the source to extract. Null or omitted means the whole file. */
  trim?: TrimRange | null;
  onProgress?: (progress: ExtractProgress) => void;
}

/** A still frame lifted out of a video, for the file card. */
export interface PosterFrame {
  /** JPEG image. The caller owns the object URL it makes from this. */
  blob: Blob;
  /** Where in the source the frame was taken, in seconds. */
  atSeconds: number;
}

/**
 * The shape of a file's audio, for drawing.
 *
 * Peaks are normalised against the loudest bucket rather than full scale, so a
 * quiet recording still fills the height instead of drawing a flat line.
 */
export interface WaveformData {
  /** One peak per bucket, 0..1, left to right across the whole file. */
  peaks: number[];
  /**
   * Seconds the peaks span. Taken from the decode when the container did not
   * say, which is the case for anything a browser recorded.
   */
  durationSeconds: number | null;
}

/** One open file: mounted, probed, ready to produce outputs. */
export interface ExtractSession {
  readonly probe: ProbeResult;
  extract(format: OutputFormat, options?: ExtractOptions): Promise<ExtractOutput>;
  /**
   * Decodes the audio once to find where it is silent.
   *
   * This is a full pass over the audio stream, so it costs roughly what one
   * re-encode costs - which is why it is a separate call the caller opts into
   * rather than something every extraction does.
   */
  /**
   * A single frame, for the card's thumbnail. Resolves to null when the file
   * has no video to take one from.
   */
  poster(): Promise<PosterFrame | null>;

  /**
   * The audio envelope, for the clip panel to draw.
   *
   * Costs a full decode, like a silence scan, so it is asked for when someone
   * opens the panel rather than for every file.
   */
  waveform(onProgress?: (progress: ExtractProgress) => void): Promise<WaveformData>;

  detectSilence(
    options?: Partial<SilenceScanOptions>,
    onProgress?: (progress: ExtractProgress) => void,
  ): Promise<SilenceScanResult>;
  /** Unmounts the input and releases engine-side resources. */
  close(): Promise<void>;
}

export interface AudioExtractor {
  readonly id: string;
  readonly capabilities: EngineCapabilities | null;
  load(onProgress?: (progress: EngineLoadProgress) => void): Promise<EngineCapabilities>;
  openSession(file: File, options?: OpenSessionOptions): Promise<ExtractSession>;
  /** Hard-stops in-flight work; the engine reloads lazily on next use. */
  terminate(): void;
}

/** Thrown for conditions the UI explains rather than dumps a stack trace for. */
export class ExtractionError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractionError";
    this.hint = hint;
  }
}
