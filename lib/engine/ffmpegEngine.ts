/**
 * ffmpeg.wasm implementation of the AudioExtractor contract.
 *
 * The one load-bearing decision in this file is how the input file reaches
 * ffmpeg. The obvious API — `ffmpeg.writeFile(name, await fetchFile(file))` —
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
 * export condition, so it must never be imported at module scope — a static
 * export build prerenders these modules in Node. Types are imported with
 * `import type` (erased at compile time) and the real module is pulled in
 * dynamically, in the browser, on first use.
 */
import type { FFmpeg, LogEvent, ProgressEvent as FFmpegProgressEvent } from "@ffmpeg/ffmpeg";

import { getClassWorkerUrl } from "./constants";
import { loadCoreUrls } from "./coreLoader";
import {
  findFormatBlocker,
  getFormat,
  SELECT_AUDIO,
  type OutputFormatId,
} from "./formats";
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
  type ProbeResult,
  type SilenceScanOptions,
  type SilenceScanResult,
} from "./types";

/** Where the input file is mounted inside the core's filesystem. */
const MOUNT_POINT = "/input";

/** Retained log lines per command, so a chatty run cannot grow without bound. */
const MAX_LOG_LINES = 400;

/** `ffmpeg -encoders` prints several hundred rows; none of them may be dropped. */
const MAX_ENCODER_LOG_LINES = 2_000;

/**
 * Silence events retained per scan.
 *
 * A conversation with a pause every few seconds produces thousands of them, and
 * the ones that matter are at both ends — so this cap is generous and the
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

  async openSession(file: File): Promise<ExtractSession> {
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
      const probe = await this.#probe(ffmpeg, inputPath);
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
      // Already exists from a previous file — the expected path after job one.
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

  async #probe(ffmpeg: FFmpeg, inputPath: string): Promise<ProbeResult> {
    const log = this.#capture();
    // No output file is given, so ffmpeg prints the stream table and exits
    // non-zero. The exit code carries no information here; the log does.
    await ffmpeg.exec(["-hide_banner", "-i", inputPath]);
    log.release();

    const probe = parseProbeOutput(log.lines);

    if (!probe.audio) {
      const reason = summarizeFailure(log.lines);
      const unreadable =
        /Invalid data|No such file|could not find codec|moov atom not found|Unknown format/i.test(
          reason ?? "",
        );
      throw new ExtractionError(
        unreadable ? "This file could not be read as a media file." : "No audio track found.",
        unreadable
          ? (reason ?? "ffmpeg could not parse the container.")
          : "The video has no audio stream to extract.",
      );
    }

    return probe;
  }

  /** @internal — driven by FFmpegSession. */
  async runExtract(
    ffmpeg: FFmpeg,
    inputPath: string,
    file: File,
    formatId: OutputFormatId,
    probe: ProbeResult,
    options?: ExtractOptions,
  ): Promise<ExtractOutput> {
    const format = getFormat(formatId);
    const onProgress = options?.onProgress;

    // Clamp the range to the file before anything expensive happens, so an
    // impossible clip is reported in milliseconds rather than after a long run.
    const { trim, problem } = resolveTrim(options?.trim, probe.durationSeconds);
    if (problem) throw new ExtractionError(problem.message, problem.hint);

    const blocker = findFormatBlocker(formatId, probe, trim);
    if (blocker) throw new ExtractionError(blocker.message, blocker.hint);

    if (format.requiredEncoder && !this.#capabilities?.encoders.has(format.requiredEncoder)) {
      throw new ExtractionError(
        `${format.label} is not supported by this ffmpeg build.`,
        `The core does not provide the "${format.requiredEncoder}" encoder.`,
      );
    }

    const plan = format.plan(probe);
    const outputPath = `/out.${plan.extension}`;
    // With input seeking the output timeline restarts at zero, so progress is
    // measured against the length of the clip, not the length of the file.
    const duration = trimDuration(trim, probe.durationSeconds);
    const { input: trimInput, output: trimOutput } = trimArgs(trim);

    // ffmpeg's own `progress` ratio is unreliable when it cannot infer the
    // duration, so the ratio is computed from processed media time instead.
    this.#progressSink = ({ time }) => {
      const processedSeconds = Math.max(0, time / 1_000_000);
      onProgress?.({
        processedSeconds,
        ratio: duration ? Math.min(1, processedSeconds / duration) : null,
      });
    };

    const log = this.#capture();
    const startedAt = performance.now();

    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec([
        "-hide_banner",
        ...trimInput,
        "-i",
        inputPath,
        ...plan.args,
        ...trimOutput,
        outputPath,
      ]);
    } finally {
      log.release();
      this.#progressSink = null;
    }

    if (exitCode !== 0) {
      throw new ExtractionError(
        `${format.label} conversion failed.`,
        summarizeFailure(log.lines) ?? `ffmpeg exited with code ${exitCode}.`,
      );
    }

    const data = await ffmpeg.readFile(outputPath);
    // Free the core's copy immediately; the bytes now live in a JS Blob.
    await ffmpeg.deleteFile(outputPath).catch(() => {});

    if (typeof data === "string") {
      throw new ExtractionError("ffmpeg returned text where audio was expected.");
    }

    const blob = new Blob([data as BlobPart], { type: plan.mimeType });
    onProgress?.({ processedSeconds: duration ?? 0, ratio: 1 });

    // A trimmed output carries its range in the filename, so several clips from
    // one video do not all land in Downloads under the same name.
    const suffix = trimFileSuffix(trim, probe.durationSeconds);

    return {
      blob,
      fileName: `${baseName(file.name)}${suffix}.${plan.extension}`,
      extension: plan.extension,
      mimeType: plan.mimeType,
      bytes: blob.size,
      elapsedMs: performance.now() - startedAt,
      mode: plan.mode,
      trim,
    };
  }

  /**
   * @internal — driven by FFmpegSession.
   *
   * Runs the audio through `silencedetect` with the null muxer: a full decode
   * of the audio stream that writes nothing. Video is never touched, so this
   * costs far less than the name suggests, but it is still a whole pass — which
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
    const duration = probe.durationSeconds;

    this.#progressSink = ({ time }) => {
      const processedSeconds = Math.max(0, time / 1_000_000);
      onProgress?.({
        processedSeconds,
        ratio: duration ? Math.min(1, processedSeconds / duration) : null,
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

    const intervals = parseSilenceLog(eventLog.lines);
    onProgress?.({ processedSeconds: duration ?? 0, ratio: 1 });

    return {
      intervals,
      suggested: suggestTrimFromSilence(intervals, duration),
      entirelySilent: isEntirelySilent(intervals, duration),
      options: settings,
    };
  }

  /** @internal — driven by FFmpegSession. */
  async closeSession(ffmpeg: FFmpeg): Promise<void> {
    await this.#safeUnmount(ffmpeg);
    this.#progressSink = null;
    this.#busy = false;
  }

  /**
   * Stops any in-flight command.
   *
   * ffmpeg runs synchronously inside its worker, so a conversion in progress
   * cannot be interrupted cooperatively — killing the worker is the only way.
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

  extract(formatId: string, options?: ExtractOptions): Promise<ExtractOutput> {
    if (this.#closed) {
      return Promise.reject(new ExtractionError("This file is no longer open."));
    }
    return this.engine.runExtract(
      this.ffmpeg,
      this.inputPath,
      this.file,
      formatId as OutputFormatId,
      this.probe,
      options,
    );
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
