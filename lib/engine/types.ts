/**
 * Engine-agnostic contract for audio extraction.
 *
 * The app talks to this interface only, so the ffmpeg.wasm implementation can
 * be swapped (or joined) by another engine — e.g. a WebCodecs-based one — with
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

export interface ProbeResult {
  /** Media duration in seconds, or null when ffmpeg reports "N/A". */
  durationSeconds: number | null;
  /** Every audio stream ffmpeg found, in file order. */
  audioStreams: AudioStreamInfo[];
  /** First audio stream (the one extracted), or null when the file has none. */
  audio: AudioStreamInfo | null;
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

/**
 * A slice of the source timeline, in seconds measured from the start of the
 * file. `endSeconds` is null for "run to the end", which lets a start-only trim
 * skip the `-t` argument entirely rather than restating the file's own length.
 */
export interface TrimRange {
  startSeconds: number;
  endSeconds: number | null;
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
  /** The portion of the source this output covers; null when it is all of it. */
  trim: TrimRange | null;
}

export interface ExtractOptions {
  /** Portion of the source to extract. Null or omitted means the whole file. */
  trim?: TrimRange | null;
  onProgress?: (progress: ExtractProgress) => void;
}

/** One open file: mounted, probed, ready to produce outputs. */
export interface ExtractSession {
  readonly probe: ProbeResult;
  extract(formatId: string, options?: ExtractOptions): Promise<ExtractOutput>;
  /**
   * Decodes the audio once to find where it is silent.
   *
   * This is a full pass over the audio stream, so it costs roughly what one
   * re-encode costs — which is why it is a separate call the caller opts into
   * rather than something every extraction does.
   */
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
  openSession(file: File): Promise<ExtractSession>;
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
