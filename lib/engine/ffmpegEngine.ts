/**
 * ffmpeg.wasm implementation of the AudioExtractor contract.
 *
 * The one load-bearing decision in this file is how the input file reaches
 * ffmpeg. The obvious API - `ffmpeg.writeFile(name, await fetchFile(file))` -
 * copies the entire video into the core's in-memory filesystem, which lives in
 * a WebAssembly heap that tops out around 2 GB. That is the entire reason
 * ffmpeg.wasm is famous for a "2 GB limit".
 *
 * Instead the File is mounted through WORKERFS, a read-only Emscripten
 * filesystem backed by `Blob.slice`. ffmpeg reads the file from disk on demand
 * and the video never enters the heap at all; inputs of 13+ GB have been
 * demonstrated this way. The heap still bounds the *output*, which for
 * extracted audio is a non-issue except for very long WAVs (see
 * MAX_SAFE_OUTPUT_BYTES in formats.ts).
 *
 * Note the imports: `@ffmpeg/ffmpeg` resolves to a throwing stub under Node's
 * export condition, so it must never be imported at module scope - a static
 * export build prerenders these modules in Node. Types are imported with
 * `import type` (erased at compile time) and the real module is pulled in
 * dynamically, in the browser, on first use.
 */
import type { FFmpeg, LogEvent, ProgressEvent as FFmpegProgressEvent } from "@ffmpeg/ffmpeg";

import { getClassWorkerUrl } from "./constants";
import { loadCoreUrls } from "./coreLoader";
import { SELECT_AUDIO } from "./formats";
import { parseEncoders, parseProbeOutput, summarizeFailure } from "./probe";
import {
  DEFAULT_SILENCE_OPTIONS,
  isEntirelySilent,
  isSilenceEventLine,
  parseSilenceLog,
  resolveTrim,
  silenceDetectArgs,
  suggestTrimFromSilence,
  trimArgs,
  trimDuration,
  trimFileSuffix,
} from "./trim";
import {
  ExtractionError,
  type AudioExtractor,
  type EngineCapabilities,
  type EngineLoadProgress,
  type ExtractOptions,
  type ExtractOutput,
  type ExtractProgress,
  type ExtractSession,
  type MediaExpectation,
  type OpenSessionOptions,
  type OutputFormat,
  type PosterFrame,
  type ProbeResult,
  type SilenceScanOptions,
  type SilenceScanResult,
  type WaveformData,
} from "./types";

/** Where the input file is mounted inside the core's filesystem. */
const MOUNT_POINT = "/input";

/**
 * Where a two-pass encode keeps its first-pass statistics.
 *
 * ffmpeg writes `<prefix>-0.log` and, for x264, `<prefix>-0.log.mbtree` into
 * MEMFS. They are removed after the final pass, whichever way it ended, since
 * they share the heap with the next job's output.
 */
const PASS_LOG_PREFIX = "twopass";
const PASS_LOG_FILES = [`${PASS_LOG_PREFIX}-0.log`, `${PASS_LOG_PREFIX}-0.log.mbtree`];

/**
 * Thumbnail width in pixels. Twice the widest the card draws it, so the frame
 * still looks sharp on a high-density screen.
 */
const POSTER_WIDTH = 320;

/**
 * Sample rate the waveform decode targets, in Hz.
 *
 * Low on purpose: the envelope is all that gets drawn, and at 1 kHz even a
 * three-hour file lands around 20 MB of PCM instead of gigabytes. Decoding
 * dominates the time either way, so a higher rate would buy nothing.
 */
const WAVEFORM_RATE = 1000;

/** Buckets the envelope is reduced to. Comfortably more than the pixels drawn. */
const WAVEFORM_BUCKETS = 600;

/** Retained log lines per command, so a chatty run cannot grow without bound. */
const MAX_LOG_LINES = 400;

/** `ffmpeg -encoders` prints several hundred rows; none of them may be dropped. */
const MAX_ENCODER_LOG_LINES = 2_000;

/**
 * Silence events retained per scan.
 *
 * A conversation with a pause every few seconds produces thousands of them, and
 * the ones that matter are at both ends - so this cap is generous and the
 * capture keeps only silencedetect's own lines rather than the whole log.
 */
const MAX_SILENCE_EVENT_LINES = 20_000;

type FFmpegModule = typeof import("@ffmpeg/ffmpeg");

let modulePromise: Promise<FFmpegModule> | null = null;

/** Loads @ffmpeg/ffmpeg lazily, in the browser only. */
function loadFFmpegModule(): Promise<FFmpegModule> {
  modulePromise ??= import("@ffmpeg/ffmpeg");
  return modulePromise;
}

/**
 * Names the mounted file predictably.
 *
 * WORKERFS lets the mounted entry be named independently of the real filename,
 * so the path handed to ffmpeg never contains spaces, quotes or colons that
 * could be misread as a protocol prefix. The extension is preserved because
 * ffmpeg uses it as a hint when probing the container.
 */
export function safeMountName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  const extension =
    lastDot > 0 && lastDot < fileName.length - 1
      ? fileName
          .slice(lastDot + 1)
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(0, 8)
          .toLowerCase()
      : "";
  return extension ? `source.${extension}` : "source";
}

/** Strips the extension so outputs can be named after the source file. */
/**
 * Reduces raw mono 16-bit PCM to one normalised peak per bucket.
 *
 * Peak rather than average, so a short loud moment still shows up as one. The
 * result is scaled against the loudest bucket rather than full scale: a quiet
 * recording should fill the panel, not draw a flat line along the bottom.
 */
export function reducePeaks(pcm: Uint8Array, buckets = WAVEFORM_BUCKETS): number[] {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  if (samples.length === 0) return [];

  const width = Math.max(1, Math.floor(samples.length / buckets));
  const count = Math.min(buckets, Math.ceil(samples.length / width));
  const peaks = new Array<number>(count).fill(0);

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = bucket * width;
    const end = Math.min(start + width, samples.length);
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }
    peaks[bucket] = peak;
  }

  const loudest = peaks.reduce((max, value) => (value > max ? value : max), 0);
  if (loudest === 0) return peaks.map(() => 0);
  return peaks.map((value) => value / loudest);
}

export function baseName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  const stem = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  return stem.trim() || "audio";
}

type LogSink = (event: LogEvent) => void;
type ProgressSink = (event: FFmpegProgressEvent) => void;

export class FFmpegEngine implements AudioExtractor {
  readonly id = "ffmpeg.wasm";

  #ffmpeg: FFmpeg | null = null;
  #loadPromise: Promise<EngineCapabilities> | null = null;
  #capabilities: EngineCapabilities | null = null;
  #workerFsType: string | null = null;

  /** Active listeners; ffmpeg's `on()` only appends, so events are routed here. */
  #logSink: LogSink | null = null;
  #progressSink: ProgressSink | null = null;

  /** Bottom of the log chain: the UI's per-file log panel, when subscribed. */
  #logListener: LogSink | null = null;

  /** Set while a session holds the engine, so misuse fails loudly. */
  #busy = false;

  get capabilities(): EngineCapabilities | null {
    return this.#capabilities;
  }

  get loaded(): boolean {
    return this.#ffmpeg !== null && this.#capabilities !== null;
  }

  /** Subscribes to raw ffmpeg output, for the per-file log panel. */
  setLogListener(listener: ((event: LogEvent) => void) | null): void {
    this.#logListener = listener;
  }

  load(onProgress?: (progress: EngineLoadProgress) => void): Promise<EngineCapabilities> {
    if (this.#loadPromise) {
      if (this.#capabilities) {
        onProgress?.({ stage: "ready", ratio: 1, receivedBytes: 0, totalBytes: 0 });
      }
      return this.#loadPromise;
    }

    this.#loadPromise = this.#doLoad(onProgress);
    this.#loadPromise.catch(() => {
      // Allow a retry after a failed load (offline, CDN blocked, ...).
      this.#loadPromise = null;
      this.#ffmpeg = null;
    });
    return this.#loadPromise;
  }

  async #doLoad(
    onProgress?: (progress: EngineLoadProgress) => void,
  ): Promise<EngineCapabilities> {
    const [{ FFmpeg: FFmpegClass, FFFSType }, { coreURL, wasmURL }] = await Promise.all([
      loadFFmpegModule(),
      loadCoreUrls((progress) => {
        onProgress?.({
          stage: "downloading-core",
          ratio: progress.ratio,
          receivedBytes: progress.receivedBytes,
          totalBytes: progress.totalBytes,
        });
      }),
    ]);

    onProgress?.({ stage: "starting", ratio: null, receivedBytes: 0, totalBytes: 0 });

    const ffmpeg = new FFmpegClass();
    // Every capture chains onto this base sink, so subscribers see all output.
    this.#logSink = (event) => this.#logListener?.(event);
    ffmpeg.on("log", (event) => this.#logSink?.(event));
    ffmpeg.on("progress", (event) => this.#progressSink?.(event));

    try {
      await ffmpeg.load({
        coreURL,
        wasmURL,
        // Absolute same-origin worker URL; see constants.ts for why it must be absolute.
        classWorkerURL: getClassWorkerUrl(),
      });
    } catch (cause) {
      // ffmpeg.wasm rejects with a bare string, and a failed Worker constructor
      // throws a DOMException; keep whatever detail is there for bug reports.
      const detail =
        typeof cause === "string"
          ? cause
          : cause instanceof Error
            ? `${cause.name}: ${cause.message}`
            : String(cause);
      throw new ExtractionError("The ffmpeg engine failed to start.", detail, { cause });
    }

    this.#ffmpeg = ffmpeg;
    this.#workerFsType = FFFSType.WORKERFS;
    this.#capabilities = await this.#detectCapabilities(ffmpeg);

    onProgress?.({ stage: "ready", ratio: 1, receivedBytes: 0, totalBytes: 0 });
    return this.#capabilities;
  }

  /**
   * Asks the core what it can actually do, rather than assuming.
   *
   * Which encoders a given ffmpeg.wasm build ships is not documented anywhere
   * authoritative, so the UI greys out formats this core cannot produce rather
   * than failing halfway through a long conversion.
   */
  async #detectCapabilities(ffmpeg: FFmpeg): Promise<EngineCapabilities> {
    const log = this.#capture(MAX_ENCODER_LOG_LINES);
    await ffmpeg.exec(["-hide_banner", "-encoders"]);
    log.release();
    const encoders = parseEncoders(log.lines);

    // WORKERFS is what lifts the input-size ceiling. If this core lacks it,
    // large files are hopeless and the UI should say so before the user waits.
    let supportsWorkerFs = false;
    try {
      await this.#ensureMountPoint(ffmpeg);
      supportsWorkerFs = await ffmpeg.mount(
        this.#mountType(),
        { blobs: [{ name: "probe.bin", data: new Blob([new Uint8Array([0])]) }] },
        MOUNT_POINT,
      );
      if (supportsWorkerFs) await this.#safeUnmount(ffmpeg);
    } catch {
      supportsWorkerFs = false;
    }

    return { encoders, supportsWorkerFs };
  }

  /**
   * `mount()` takes the FFFSType enum, whose values are plain strings. The enum
   * object only exists after the dynamic import, so the value is cached instead.
   */
  #mountType(): Parameters<FFmpeg["mount"]>[0] {
    if (!this.#workerFsType) throw new ExtractionError("The ffmpeg engine is not loaded.");
    return this.#workerFsType as Parameters<FFmpeg["mount"]>[0];
  }

  /**
   * Collects ffmpeg's log lines for the duration of one command.
   *
   * Log messages are posted from the worker before that command's own response,
   * so everything captured between calling and awaiting belongs to it.
   */
  #capture(
    maxLines = MAX_LOG_LINES,
    keep?: (message: string) => boolean,
  ): { lines: string[]; release: () => void } {
    const lines: string[] = [];
    const previous = this.#logSink;
    this.#logSink = (event) => {
      if (lines.length < maxLines && (!keep || keep(event.message))) {
        lines.push(event.message);
      }
      previous?.(event);
    };
    return {
      lines,
      release: () => {
        this.#logSink = previous;
      },
    };
  }

  async openSession(file: File, options?: OpenSessionOptions): Promise<ExtractSession> {
    const capabilities = await this.load();
    if (this.#busy) {
      throw new ExtractionError("The engine is already processing another file.");
    }
    const ffmpeg = this.#ffmpeg;
    if (!ffmpeg) throw new ExtractionError("The ffmpeg engine is not loaded.");

    if (!capabilities.supportsWorkerFs && file.size > 2 * 1024 ** 3) {
      throw new ExtractionError(
        "This ffmpeg build cannot read files larger than 2 GB.",
        "The core was built without WORKERFS, so the file would have to be copied into memory.",
      );
    }

    this.#busy = true;
    const mountName = safeMountName(file.name);

    try {
      await this.#ensureMountPoint(ffmpeg);
      // The File is mounted, never copied: this is what lifts the 2 GB limit.
      const mounted = await ffmpeg.mount(
        this.#mountType(),
        { blobs: [{ name: mountName, data: file }] },
        MOUNT_POINT,
      );
      if (!mounted) {
        throw new ExtractionError(
          "Could not mount the video for reading.",
          "WORKERFS is unavailable in this ffmpeg build.",
        );
      }
    } catch (error) {
      this.#busy = false;
      throw error;
    }

    const inputPath = `${MOUNT_POINT}/${mountName}`;

    try {
      const probe = await this.#probe(ffmpeg, inputPath, options?.expects ?? "audio");
      return new FFmpegSession(this, ffmpeg, file, inputPath, probe);
    } catch (error) {
      await this.#safeUnmount(ffmpeg);
      this.#busy = false;
      throw error;
    }
  }

  async #ensureMountPoint(ffmpeg: FFmpeg): Promise<void> {
    try {
      await ffmpeg.createDir(MOUNT_POINT);
    } catch {
      // Already exists from a previous file - the expected path after job one.
    }
    // A run terminated mid-flight may have left something mounted here.
    await this.#safeUnmount(ffmpeg);
  }

  async #safeUnmount(ffmpeg: FFmpeg): Promise<void> {
    try {
      await ffmpeg.unmount(MOUNT_POINT);
    } catch {
      // Nothing was mounted; nothing to undo.
    }
  }

  /**
   * Unmounts the input and confirms it is really gone.
   *
   * WORKERFS never copies the video - a mounted entry is a node holding a
   * reference to the `File`, read through `Blob.slice` on demand - so releasing
   * it is exactly this unmount. But that also means a silently failed unmount
   * would pin the user's file inside the worker for the life of the page, and
   * `unmount` has to stay best-effort because it is called speculatively before
   * every mount. Hence the check here, where a mount is known to exist.
   */
  async #releaseInput(ffmpeg: FFmpeg): Promise<void> {
    await this.#safeUnmount(ffmpeg);

    try {
      const entries = (await ffmpeg.listDir(MOUNT_POINT)).filter(
        (node) => node.name !== "." && node.name !== "..",
      );
      if (entries.length === 0) return;

      await this.#safeUnmount(ffmpeg);
      const stillThere = (await ffmpeg.listDir(MOUNT_POINT)).filter(
        (node) => node.name !== "." && node.name !== "..",
      );
      if (stillThere.length > 0) {
        console.warn(
          `[ffmpeg] ${MOUNT_POINT} still holds ${stillThere
            .map((node) => node.name)
            .join(", ")} after unmount; the input file stays referenced until the worker restarts.`,
        );
      }
    } catch {
      // The worker is gone, or the directory with it. Either way the mount
      // cannot be holding anything.
    }
  }

  async #probe(
    ffmpeg: FFmpeg,
    inputPath: string,
    expects: MediaExpectation,
  ): Promise<ProbeResult> {
    const log = this.#capture();
    // No output file is given, so ffmpeg prints the stream table and exits
    // non-zero. The exit code carries no information here; the log does.
    await ffmpeg.exec(["-hide_banner", "-i", inputPath]);
    log.release();

    const probe = parseProbeOutput(log.lines);

    const satisfied =
      expects === "audio"
        ? probe.audio !== null
        : expects === "video"
          ? probe.hasVideo
          : probe.audio !== null || probe.hasVideo;

    if (!satisfied) {
      const reason = summarizeFailure(log.lines);
      const unreadable =
        probe.formatName === null ||
        /Invalid data|No such file|could not find codec|moov atom not found|Unknown format/i.test(
          reason ?? "",
        );
      if (unreadable) {
        throw new ExtractionError(
          "This file could not be read as a media file.",
          reason ?? "ffmpeg could not parse the container.",
        );
      }
      if (expects === "video") {
        throw new ExtractionError(
          "No video track found.",
          "This file has no video stream to work on. It may be audio only.",
        );
      }
      throw new ExtractionError(
        "No audio track found.",
        "The video has no audio stream to extract.",
      );
    }

    return probe;
  }

  /** @internal - driven by FFmpegSession. */
  async runExtract(
    ffmpeg: FFmpeg,
    inputPath: string,
    file: File,
    format: OutputFormat,
    probe: ProbeResult,
    options?: ExtractOptions,
  ): Promise<ExtractOutput> {
    const onProgress = options?.onProgress;

    // Clamp the range to the file before anything expensive happens, so an
    // impossible clip is reported in milliseconds rather than after a long run.
    const { trim, problem } = resolveTrim(options?.trim, probe.durationSeconds);
    if (problem) throw new ExtractionError(problem.message, problem.hint);

    const context = { trim, fileBytes: file.size };
    const blocker = format.blocker?.(probe, context) ?? null;
    if (blocker) throw new ExtractionError(blocker.message, blocker.hint);

    const plan = format.plan(probe, context);

    // A format that turns out to be a stream copy for this file needs no
    // encoder, whatever it would need for another file.
    if (
      plan.mode === "encode" &&
      format.requiredEncoder &&
      !this.#capabilities?.encoders.has(format.requiredEncoder)
    ) {
      throw new ExtractionError(
        `${format.label} is not supported by this ffmpeg build.`,
        `The core does not provide the "${format.requiredEncoder}" encoder.`,
      );
    }

    const outputPath = `/out.${plan.extension}`;
    // With input seeking the output timeline restarts at zero, so progress is
    // measured against the length of the clip, not the length of the file.
    const duration = trimDuration(trim, probe.durationSeconds);
    const { input: trimInput, output: trimOutput } = trimArgs(trim);

    const analysisPasses = plan.analysisPasses ?? [];
    const totalPasses = analysisPasses.length + 1;
    // Every pass reads the whole clip, so each gets an equal share of the bar.
    const passLog = analysisPasses.length > 0 ? ["-passlogfile", PASS_LOG_PREFIX] : [];

    const command = (passArgs: string[], output: string[]) => [
      "-hide_banner",
      ...trimInput,
      ...(plan.inputArgs ?? []),
      "-i",
      inputPath,
      ...passArgs,
      ...passLog,
      ...trimOutput,
      ...output,
    ];

    const startedAt = performance.now();

    try {
      for (const [index, passArgs] of [...analysisPasses, plan.args].entries()) {
        const isFinal = index === analysisPasses.length;

        // ffmpeg's own `progress` ratio is unreliable when it cannot infer the
        // duration, so the ratio is computed from processed media time instead.
        this.#progressSink = ({ time }) => {
          const processedSeconds = Math.max(0, time / 1_000_000);
          const passRatio = duration ? Math.min(1, processedSeconds / duration) : null;
          onProgress?.({
            processedSeconds,
            ratio: passRatio === null ? null : (index + passRatio) / totalPasses,
          });
        };

        const log = this.#capture();
        let exitCode: number;
        try {
          // The null muxer discards every packet and is AVFMT_NOFILE, so "-"
          // is never actually opened.
          exitCode = await ffmpeg.exec(
            command(passArgs, isFinal ? [outputPath] : ["-f", "null", "-"]),
          );
        } finally {
          log.release();
          this.#progressSink = null;
        }

        if (exitCode !== 0) {
          throw new ExtractionError(
            isFinal
              ? `${format.label} conversion failed.`
              : `${format.label} conversion failed during its analysis pass.`,
            summarizeFailure(log.lines) ?? `ffmpeg exited with code ${exitCode}.`,
          );
        }
      }
    } finally {
      if (analysisPasses.length > 0) {
        for (const name of PASS_LOG_FILES) {
          await ffmpeg.deleteFile(name).catch(() => {});
        }
      }
    }

    const data = await ffmpeg.readFile(outputPath);
    // Free the core's copy immediately; the bytes now live in a JS Blob.
    await ffmpeg.deleteFile(outputPath).catch(() => {});

    if (typeof data === "string") {
      throw new ExtractionError("ffmpeg returned text where media was expected.");
    }

    const blob = new Blob([data as BlobPart], { type: plan.mimeType });
    onProgress?.({ processedSeconds: duration ?? 0, ratio: 1 });

    // A trimmed output carries its range in the filename, so several clips from
    // one video do not all land in Downloads under the same name.
    const suffix = trimFileSuffix(trim, probe.durationSeconds);

    return {
      blob,
      fileName: `${baseName(file.name)}${plan.fileSuffix ?? ""}${suffix}.${plan.extension}`,
      extension: plan.extension,
      mimeType: plan.mimeType,
      bytes: blob.size,
      elapsedMs: performance.now() - startedAt,
      mode: plan.mode,
      kind: plan.kind ?? "audio",
      trim,
    };
  }

  /**
   * @internal - driven by FFmpegSession.
   *
   * Runs the audio through `silencedetect` with the null muxer: a full decode
   * of the audio stream that writes nothing. Video is never touched, so this
   * costs far less than the name suggests, but it is still a whole pass - which
   * is why it happens only when someone asks for automatic trimming.
   */
  async runSilenceScan(
    ffmpeg: FFmpeg,
    inputPath: string,
    probe: ProbeResult,
    options?: Partial<SilenceScanOptions>,
    onProgress?: (progress: ExtractProgress) => void,
  ): Promise<SilenceScanResult> {
    const settings: SilenceScanOptions = { ...DEFAULT_SILENCE_OPTIONS, ...options };
    const probedDuration = probe.durationSeconds;

    // Progress is the decoder's own clock, so its high-water mark is the length
    // of the audio when the container did not say. Files from a browser's
    // MediaRecorder never do, and without some length there is no way to tell
    // a trailing silence from a pause, so the scan would find nothing to trim.
    let decodedSeconds = 0;

    this.#progressSink = ({ time }) => {
      const processedSeconds = Math.max(0, time / 1_000_000);
      decodedSeconds = Math.max(decodedSeconds, processedSeconds);
      onProgress?.({
        processedSeconds,
        ratio: probedDuration ? Math.min(1, processedSeconds / probedDuration) : null,
      });
    };

    // Two nested captures: a bounded tail for a failure message, and a filtered
    // one that keeps every silence event however chatty the run gets. They must
    // be released innermost-first or the chain is left pointing at a dead sink.
    const failureLog = this.#capture();
    const eventLog = this.#capture(MAX_SILENCE_EVENT_LINES, isSilenceEventLine);

    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec([
        "-hide_banner",
        "-i",
        inputPath,
        ...SELECT_AUDIO,
        ...silenceDetectArgs(settings),
        // The null muxer discards every packet and is AVFMT_NOFILE, so "-" is
        // never actually opened.
        "-f",
        "null",
        "-",
      ]);
    } finally {
      eventLog.release();
      failureLog.release();
      this.#progressSink = null;
    }

    if (exitCode !== 0) {
      throw new ExtractionError(
        "Silence detection failed.",
        summarizeFailure(failureLog.lines) ?? `ffmpeg exited with code ${exitCode}.`,
      );
    }

    const duration = probedDuration ?? (decodedSeconds > 0 ? decodedSeconds : null);
    const intervals = parseSilenceLog(eventLog.lines);
    onProgress?.({ processedSeconds: duration ?? 0, ratio: 1 });

    return {
      intervals,
      suggested: suggestTrimFromSilence(intervals, duration),
      entirelySilent: isEntirelySilent(intervals, duration),
      durationSeconds: duration,
      options: settings,
    };
  }

  /**
   * One frame from the video, as JPEG, for the file card.
   *
   * `-ss` goes before `-i` on purpose. Input seeking jumps the demuxer
   * straight to the nearest keyframe instead of decoding everything up to the
   * timestamp, which is the difference between a moment and minutes on a
   * multi-gigabyte film.
   *
   * A tenth of the way in avoids the black frames and studio logos that open
   * most videos, without landing so late that a short clip seeks past its own
   * end. Failure is not an error worth surfacing: a missing thumbnail is a
   * cosmetic loss, so this resolves to null rather than throwing and taking a
   * conversion down with it.
   */
  async runPoster(
    ffmpeg: FFmpeg,
    inputPath: string,
    probe: ProbeResult,
  ): Promise<PosterFrame | null> {
    if (!probe.hasVideo) return null;

    const duration = probe.durationSeconds;
    const atSeconds = duration && duration > 0 ? Math.min(duration * 0.1, duration - 0.1) : 0;
    const outputPath = "poster.jpg";
    const failureLog = this.#capture();

    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec([
        "-hide_banner",
        ...(atSeconds > 0 ? ["-ss", atSeconds.toFixed(3)] : []),
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-an",
        "-sn",
        "-dn",
        "-frames:v",
        "1",
        // Fit the card without carrying a 4K frame around in memory. -2 keeps
        // the height even, which the JPEG encoder needs for chroma subsampling.
        "-vf",
        `scale=${POSTER_WIDTH}:-2:flags=fast_bilinear`,
        "-q:v",
        "4",
        "-f",
        "mjpeg",
        outputPath,
      ]);
    } catch {
      failureLog.release();
      return null;
    } finally {
      failureLog.release();
    }

    if (exitCode !== 0) return null;

    try {
      const data = await ffmpeg.readFile(outputPath);
      if (typeof data === "string" || data.length === 0) return null;
      return { blob: new Blob([data as BlobPart], { type: "image/jpeg" }), atSeconds };
    } catch {
      return null;
    } finally {
      // The frame lives in MEMFS, which is the same heap the next conversion
      // needs, so it does not get to stay there.
      try {
        await ffmpeg.deleteFile(outputPath);
      } catch {
        // Never written, or already gone.
      }
    }
  }

  /**
   * Decodes the audio down to an envelope for the clip panel to draw.
   *
   * One full decode, the same cost as a silence scan, so it is only run when
   * someone opens the panel. The result is reduced to a fixed number of
   * buckets here rather than in the component, because the intermediate PCM
   * lives in the core's heap and the sooner it is gone the better.
   */
  async runWaveform(
    ffmpeg: FFmpeg,
    inputPath: string,
    probe: ProbeResult,
    onProgress?: (progress: ExtractProgress) => void,
  ): Promise<WaveformData> {
    const probedDuration = probe.durationSeconds;
    let decodedSeconds = 0;

    this.#progressSink = ({ time }) => {
      const processedSeconds = Math.max(0, time / 1_000_000);
      decodedSeconds = Math.max(decodedSeconds, processedSeconds);
      onProgress?.({
        processedSeconds,
        ratio: probedDuration ? Math.min(1, processedSeconds / probedDuration) : null,
      });
    };

    const outputPath = "waveform.pcm";
    const failureLog = this.#capture();

    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec([
        "-hide_banner",
        "-i",
        inputPath,
        ...SELECT_AUDIO,
        "-ac",
        "1",
        "-ar",
        String(WAVEFORM_RATE),
        "-f",
        "s16le",
        outputPath,
      ]);
    } finally {
      failureLog.release();
      this.#progressSink = null;
    }

    if (exitCode !== 0) {
      throw new ExtractionError(
        "Could not read the audio to draw it.",
        summarizeFailure(failureLog.lines) ?? `ffmpeg exited with code ${exitCode}.`,
      );
    }

    try {
      const raw = await ffmpeg.readFile(outputPath);
      if (typeof raw === "string") {
        throw new ExtractionError("ffmpeg returned text where audio was expected.");
      }
      const peaks = reducePeaks(raw);
      const seconds = raw.length / 2 / WAVEFORM_RATE;
      onProgress?.({ processedSeconds: seconds, ratio: 1 });
      return {
        peaks,
        durationSeconds: probedDuration ?? (seconds > 0 ? seconds : null),
      };
    } finally {
      try {
        await ffmpeg.deleteFile(outputPath);
      } catch {
        // Never written, or already gone.
      }
    }
  }

  /** @internal - driven by FFmpegSession. */
  async closeSession(ffmpeg: FFmpeg): Promise<void> {
    await this.#releaseInput(ffmpeg);
    this.#progressSink = null;
    this.#busy = false;
  }

  /**
   * Stops any in-flight command.
   *
   * ffmpeg runs synchronously inside its worker, so a conversion in progress
   * cannot be interrupted cooperatively - killing the worker is the only way.
   * The next `load()` starts a fresh one; the core bytes are already cached, so
   * the restart costs a WebAssembly instantiation, not a 31 MB download.
   */
  terminate(): void {
    this.#ffmpeg?.terminate();
    this.#ffmpeg = null;
    this.#loadPromise = null;
    this.#capabilities = null;
    this.#workerFsType = null;
    this.#logSink = null;
    this.#progressSink = null;
    this.#busy = false;
  }
}

class FFmpegSession implements ExtractSession {
  #closed = false;

  constructor(
    private readonly engine: FFmpegEngine,
    private readonly ffmpeg: FFmpeg,
    private readonly file: File,
    private readonly inputPath: string,
    readonly probe: ProbeResult,
  ) {}

  extract(format: OutputFormat, options?: ExtractOptions): Promise<ExtractOutput> {
    if (this.#closed) {
      return Promise.reject(new ExtractionError("This file is no longer open."));
    }
    return this.engine.runExtract(
      this.ffmpeg,
      this.inputPath,
      this.file,
      format,
      this.probe,
      options,
    );
  }

  poster(): Promise<PosterFrame | null> {
    if (this.#closed) return Promise.resolve(null);
    return this.engine.runPoster(this.ffmpeg, this.inputPath, this.probe);
  }

  waveform(onProgress?: (progress: ExtractProgress) => void): Promise<WaveformData> {
    if (this.#closed) {
      return Promise.reject(new ExtractionError("This file is no longer open."));
    }
    return this.engine.runWaveform(this.ffmpeg, this.inputPath, this.probe, onProgress);
  }

  detectSilence(
    options?: Partial<SilenceScanOptions>,
    onProgress?: (progress: ExtractProgress) => void,
  ): Promise<SilenceScanResult> {
    if (this.#closed) {
      return Promise.reject(new ExtractionError("This file is no longer open."));
    }
    return this.engine.runSilenceScan(
      this.ffmpeg,
      this.inputPath,
      this.probe,
      options,
      onProgress,
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.engine.closeSession(this.ffmpeg);
  }
}

let sharedEngine: FFmpegEngine | null = null;

/** The app runs one engine (one worker, one core) for the whole page. */
export function getEngine(): FFmpegEngine {
  sharedEngine ??= new FFmpegEngine();
  return sharedEngine;
}

/** Drops the shared engine after a hard cancel, so the next job starts clean. */
export function resetEngine(): void {
  sharedEngine?.terminate();
  sharedEngine = null;
}
