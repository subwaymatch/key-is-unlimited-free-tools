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
  /**
   * Display rotation from the stream's display matrix, in degrees, or null
   * when the stream carries none.
   *
   * A phone holds its sensor in landscape and records 1280x720 with a 90
   * degree matrix; every player shows 720x1280. The coded size is what ffmpeg
   * prints, so the rotation has to travel with it or the card reports a
   * portrait clip as landscape.
   */
  rotationDegrees: number | null;
}

/** A subtitle track, as far as the probe can tell. */
export interface SubtitleStreamInfo {
  /** ffmpeg codec name: "subrip", "ass", "mov_text", "hdmv_pgs_subtitle". */
  codec: string;
  /** ISO 639 language tag from the stream, e.g. "eng", or null when unset. */
  language: string | null;
  /** The stream's title tag, when it has one: "English (SDH)". */
  title: string | null;
}

/** A chapter marker the container carries. */
export interface ChapterInfo {
  startSeconds: number;
  endSeconds: number;
  title: string | null;
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
  /** Every subtitle track ffmpeg found, in file order. */
  subtitleStreams: SubtitleStreamInfo[];
  /** The container's chapter list, in order. */
  chapters: ChapterInfo[];
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

/** What a finished output is, which decides how the card previews it. "text" is never previewed. */
export type OutputKind = "audio" | "video" | "image" | "text";

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
  /**
   * Where the engine mounted the source, for the rare plan that has to name
   * it inside a filter rather than through `-i`: burning one of the file's
   * own subtitle tracks reads the same file a second time.
   */
  inputPath?: string;
  /**
   * Whether the visitor asked for the source's tags to be dropped.
   *
   * The engine appends the stripping arguments itself, after a plan's own,
   * so a plan that writes metadata of its own - chapter markers - has to see
   * the switch and do the stripping itself, or the engine's arguments would
   * undo its work. Set together with `stripsMetadata` on the plan.
   */
  stripMetadata?: boolean;
  /**
   * Lower-case extension of the source file, without the dot, when it has one.
   *
   * ffmpeg's format name cannot tell a MOV from an MP4 - both probe as
   * "mov,mp4,m4a,3gp,3g2,mj2" - so the only way to keep a MOV a MOV is the
   * name the file arrived under.
   */
  sourceExtension?: string | null;
}

/**
 * A file a run needs in the core's filesystem: a subtitle file to burn, a
 * font for it, the concat demuxer's list. Written before the command and
 * removed after it, whichever way it ended.
 */
export interface ScratchFile {
  /** Absolute path inside the core; a directory in it is created as needed. */
  path: string;
  contents: string | Uint8Array;
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
  /** Files the run needs alongside the input. See ScratchFile. */
  scratchFiles?: ScratchFile[];
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
  /**
   * Something true about the result that is worth saying once it exists, but
   * is not a reason to refuse the job: "browsers cannot play this codec".
   */
  warning?: string;
  /**
   * Probe the finished file and report the range it really covers.
   *
   * A stream copy can only start on a keyframe, so a "fast cut" from 0:03
   * routinely begins seconds earlier. The plan cannot know by how much; the
   * output can, and one probe of a file already in memory is cheap.
   */
  verifyDuration?: boolean;
  /** True when the plan already drops metadata, so the engine does not repeat it. */
  stripsMetadata?: boolean;
  /**
   * Leave the range out of the filename; the plan has named the output itself.
   *
   * A clipped output carries its range in its name so several clips of one
   * file can sit in one folder. A single frame is not a clip: it is taken at
   * the start marker, and "frame-at-2s" says that where "2s-6s" would not.
   */
  omitRangeSuffix?: boolean;
  /**
   * How long the output is compared with the range it was made from.
   *
   * A plan that re-times its output - a speed change - produces a file that
   * is not the length of its input, and the engine measures progress against
   * the output timeline. Without this a 2x speed-up would stop at 50% and a
   * 0.5x slow-down would sit at 100% for half the run. Defaults to 1.
   */
  durationFactor?: number;
  /**
   * Builds the final pass's arguments from what the analysis passes printed,
   * in place of `args`.
   *
   * Loudness normalisation measures the file in one pass and corrects it in
   * the next with the numbers it found, so the final command line cannot be
   * written until the first pass has run. `keep` picks the log lines worth
   * holding on to - a chatty run prints thousands - and `args` turns them into
   * the output options.
   */
  refine?: {
    keep(line: string): boolean;
    args(lines: readonly string[]): string[];
  };
  /**
   * Put the range's length before `-i`, so it bounds what is read rather than
   * what is written.
   *
   * `-t` as an output option stops the encoder once the *output* reaches the
   * length of the range, which cuts a slow-down off halfway through. As an
   * input option it limits the input to the range and the output is however
   * long the plan makes it.
   */
  limitInput?: boolean;
}

/**
 * How a blocked format should read on the card.
 *
 * "error" is something that went wrong; "info" is a job that has nothing to
 * do, such as a file already smaller than the size it was asked to fit. The
 * second is not a failure and must not be dressed as one - there is nothing
 * to retry, only a different choice to make.
 */
export type FailureSeverity = "error" | "info";

export interface FormatBlocker {
  message: string;
  hint: string;
  /** Defaults to "error". */
  severity?: FailureSeverity;
  /**
   * Whether running the same job again could produce a different result.
   * Defaults to false for a blocker: a guard that said no will say no again.
   */
  retryable?: boolean;
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
   * True for a format whose whole purpose is dropping the source's metadata.
   *
   * The tools offer a "remove metadata" switch; the metadata remover does not,
   * because a switch that cannot be turned off is worse than no switch.
   */
  alwaysStripsMetadata?: boolean;
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
  /**
   * Whether this format is worth offering for this file at all.
   *
   * Distinct from `blocker`, which explains a refusal after someone asked.
   * This decides whether the chip appears: the compressor puts every preset
   * in its catalogue so a file can be re-compressed smaller from its own
   * card, and the sizes larger than the file itself have no business there.
   * Defaults to true.
   */
  offer?(probe: ProbeResult, context: PlanContext): boolean;
}

/**
 * Which stream a tool needs the file to have.
 *
 * The audio extractor cannot do anything with a silent video, and a video
 * converter has nothing to convert in an MP3; "media" is for tools that work
 * on whatever is there, such as stripping metadata.
 */
export type MediaExpectation = "audio" | "video" | "media" | "subtitles";

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
  /**
   * The range the file really covers, when that differs from the range asked
   * for. Only a keyframe-aligned stream copy produces one, and only when the
   * nearest keyframe was genuinely earlier than the marker.
   */
  actualTrim?: TrimRange | null;
  /** Carried over from the plan: something true about the file, once it exists. */
  warning?: string;
}

export interface ExtractOptions {
  /** Portion of the source to extract. Null or omitted means the whole file. */
  trim?: TrimRange | null;
  /**
   * Drop titles, dates, location, chapters and the muxer's own encoder tag
   * from the output. Plans that already strip are left alone.
   */
  stripMetadata?: boolean;
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

/**
 * One ffmpeg invocation over several inputs, producing one file.
 *
 * The merger's shape. Unlike a FormatPlan the inputs are part of the plan,
 * because how they are given - a concat list for a stream copy, one `-i` per
 * file for a filter graph - is the decision the plan exists to make.
 */
export interface MergePlan {
  /** Everything up to and including the inputs: `-f concat -safe 0 -i list` or `-i a -i b`. */
  inputArgs: string[];
  /** Output options: everything between the inputs and the output path. */
  args: string[];
  /** Files the run needs alongside the inputs, such as the concat demuxer's list. */
  scratchFiles?: ScratchFile[];
  extension: string;
  mimeType: string;
  mode: ExtractMode;
  kind: OutputKind;
  /** Name for the download, without the extension. */
  baseName: string;
  /** Length of the joined output in seconds, for progress; null when unknown. */
  expectedSeconds: number | null;
  warning?: string;
  stripsMetadata?: boolean;
}

export interface MergeOptions {
  stripMetadata?: boolean;
  onProgress?: (progress: ExtractProgress) => void;
}

/** One of several files mounted together, probed on its own. */
export interface MountedInput {
  file: File;
  /** Where the file is inside the core's filesystem, for the plan's `-i`. */
  inputPath: string;
  /** Null when the file could not be read; `error` then says why. */
  probe: ProbeResult | null;
  error: ExtractionError | null;
}

/** Several files open at once: mounted together, ready to be joined. */
export interface MultiSession {
  readonly inputs: readonly MountedInput[];
  /** A frame from one of the inputs, for its row. Null for audio, or on failure. */
  poster(index: number): Promise<PosterFrame | null>;
  merge(plan: MergePlan, options?: MergeOptions): Promise<ExtractOutput>;
  /** Unmounts every input and releases engine-side resources. */
  close(): Promise<void>;
}

export interface AudioExtractor {
  readonly id: string;
  readonly capabilities: EngineCapabilities | null;
  load(onProgress?: (progress: EngineLoadProgress) => void): Promise<EngineCapabilities>;
  openSession(file: File, options?: OpenSessionOptions): Promise<ExtractSession>;
  /**
   * Opens several files together, for the tools that take more than one.
   *
   * Every file is mounted in one go, so the plan can name them all on one
   * command line. A file that fails to probe does not fail the session: it is
   * reported on its own input, and the caller decides what to do about it.
   */
  openFiles(files: File[], options?: OpenSessionOptions): Promise<MultiSession>;
  /** Hard-stops in-flight work; the engine reloads lazily on next use. */
  terminate(): void;
}

export interface ExtractionErrorOptions extends ErrorOptions {
  severity?: FailureSeverity;
  /** Whether running the same job again could end differently. Defaults to true. */
  retryable?: boolean;
  /**
   * True when the ffmpeg instance cannot be trusted afterwards.
   *
   * A wasm trap leaves the core's heap in an undefined state: every later
   * command in that worker fails, including a probe of a completely different
   * file. The engine has to be thrown away and rebuilt, so the failure is
   * flagged here rather than inferred from the message by every caller.
   */
  fatal?: boolean;
}

/** Thrown for conditions the UI explains rather than dumps a stack trace for. */
export class ExtractionError extends Error {
  readonly hint?: string;
  readonly severity: FailureSeverity;
  readonly retryable: boolean;
  readonly fatal: boolean;

  constructor(message: string, hint?: string, options?: ExtractionErrorOptions) {
    super(message, options);
    this.name = "ExtractionError";
    this.hint = hint;
    this.severity = options?.severity ?? "error";
    this.retryable = options?.retryable ?? true;
    this.fatal = options?.fatal ?? false;
  }
}
