// @vitest-environment jsdom

/**
 * The queue hook holds every cancel, retry and re-queue transition, and none
 * of it needs ffmpeg to be exercised: the hook talks to the AudioExtractor
 * interface, so a fake engine whose calls the test settles by hand is enough
 * to drive it through each path deterministically.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtractionError } from "@/lib/engine/types";
import type {
  EngineCapabilities,
  EngineLoadProgress,
  ExtractOptions,
  ExtractOutput,
  ExtractProgress,
  OutputFormat,
  PosterFrame,
  ProbeResult,
  SilenceScanOptions,
  SilenceScanResult,
} from "@/lib/engine/types";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface PendingCall {
  kind: "extract" | "silence";
  formatId?: string;
  options?: ExtractOptions | Partial<SilenceScanOptions>;
  /** Whether the test has taken this call to settle it. */
  taken: boolean;
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * The fake engine has to exist before the hook module is imported, because
 * `vi.mock` is hoisted above the imports; `vi.hoisted` lifts it alongside.
 */
const fake = vi.hoisted(() => {
  function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const VIDEO = {
    codec: "h264",
    profile: "High",
    pixelFormat: "yuv420p",
    width: 1280,
    height: 720,
    fps: 30,
    bitrateKbps: 2500,
    rotationDegrees: null,
  };

  const PROBE: ProbeResult = {
    durationSeconds: 120,
    bitrateKbps: 2700,
    audioStreams: [],
    audio: {
      codec: "aac",
      profile: "LC",
      sampleRate: 48_000,
      channels: 2,
      channelLayout: "stereo",
      bitrateKbps: 192,
    },
    videoStreams: [VIDEO],
    video: VIDEO,
    hasVideo: true,
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    log: [],
  };

  class FakeSession {
    probe = PROBE;
    closed = false;
    /** Set by a test to make the thumbnail step fail. */
    posterFails = false;
    /** How many times a frame has been asked for, to prove it is cached. */
    posterCalls = 0;
    /** Every call the hook has made, in order; settled ones stay for the record. */
    calls: PendingCall[] = [];

    constructor(readonly file: File) {}

    #record<T>(
      kind: PendingCall["kind"],
      formatId: string | undefined,
      options: PendingCall["options"],
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const call: PendingCall = {
          kind,
          formatId,
          options,
          taken: false,
          settled: false,
          resolve: (value) => {
            call.settled = true;
            resolve(value as T);
          },
          reject: (reason) => {
            call.settled = true;
            reject(reason);
          },
        };
        this.calls.push(call);
      });
    }

    extract(format: OutputFormat, options?: ExtractOptions): Promise<ExtractOutput> {
      return this.#record("extract", format.id, options);
    }

    /**
     * Rejects when `posterFails` is set, to prove a bad frame is survivable.
     *
     * Returns nothing unless a test asks for a frame: a poster is one more
     * object URL, and most of these tests count the ones the outputs make.
     */
    poster(): Promise<PosterFrame | null> {
      this.posterCalls += 1;
      if (this.posterFails) return Promise.reject(new Error("no frame"));
      if (!state.posterFrames) return Promise.resolve(null);
      return Promise.resolve({
        blob: new Blob([new Uint8Array(4)], { type: "image/jpeg" }),
        atSeconds: 1,
      });
    }

    detectSilence(
      options?: Partial<SilenceScanOptions>,
      onProgress?: (progress: ExtractProgress) => void,
    ): Promise<SilenceScanResult> {
      onProgress?.({ processedSeconds: 0, ratio: 0 });
      return this.#record("silence", undefined, options);
    }

    async close(): Promise<void> {
      this.closed = true;
    }

    /** What FFmpeg.terminate() does to commands still in flight. */
    abort(): void {
      for (const call of this.calls) {
        if (!call.settled) call.reject(new Error("called FFmpeg.terminate()"));
      }
    }
  }

  class FakeEngine {
    readonly id = "fake";
    loaded = false;
    terminated = false;
    /** When set, `load` waits on it - for tests that act during the core download. */
    loadGate: Deferred<void> | null = null;
    sessions: FakeSession[] = [];
    capabilities: EngineCapabilities | null = null;

    setLogListener(): void {}

    async load(onProgress?: (progress: EngineLoadProgress) => void): Promise<EngineCapabilities> {
      onProgress?.({ stage: "downloading-core", ratio: 0.5, receivedBytes: 1, totalBytes: 2 });
      if (this.loadGate) await this.loadGate.promise;
      // Like the real engine, a terminate() that arrived before there was a
      // worker to kill does not stop the load; the job is settled afterwards.
      this.loaded = true;
      this.capabilities = state.capabilities;
      onProgress?.({ stage: "ready", ratio: 1, receivedBytes: 0, totalBytes: 0 });
      return state.capabilities;
    }

    async openSession(file: File): Promise<FakeSession> {
      if (state.openFails) throw state.openFails;
      const session = new FakeSession(file);
      this.sessions.push(session);
      return session;
    }

    terminate(): void {
      this.terminated = true;
      this.loaded = false;
      for (const session of this.sessions) session.abort();
    }
  }

  const state = {
    engines: [] as FakeEngine[],
    current: null as FakeEngine | null,
    /** Set by a test to make every openSession throw, as a bad file does. */
    openFails: null as unknown,
    /** Set by a test that cares about the thumbnail rather than the outputs. */
    posterFrames: false,
    capabilities: {
      // No pcm_s16le, so WAV is the format this core cannot produce.
      encoders: new Set(["aac", "libmp3lame", "opus", "flac"]),
      supportsWorkerFs: true,
    } as EngineCapabilities,
  };

  return { defer, state, FakeEngine, FakeSession, PROBE };
});

vi.mock("@/lib/engine/ffmpegEngine", () => ({
  getEngine: () => {
    if (!fake.state.current) {
      fake.state.current = new fake.FakeEngine();
      fake.state.engines.push(fake.state.current);
    }
    return fake.state.current;
  },
  resetEngine: () => {
    fake.state.current?.terminate();
    fake.state.current = null;
  },
}));

import { resetQueueStores, useConversionQueue } from "@/lib/useConversionQueue";

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useConversionQueue>, unknown>>;

const file = (name = "holiday.mp4") => new File([new Uint8Array(16)], name, { type: "video/mp4" });

function output(call: PendingCall): ExtractOutput {
  const extension = call.formatId === "original" ? "m4a" : (call.formatId ?? "bin");
  const trim = (call.options as ExtractOptions | undefined)?.trim ?? null;
  return {
    blob: new Blob([new Uint8Array(8)], { type: `audio/${extension}` }),
    fileName: `holiday.${extension}`,
    extension,
    mimeType: `audio/${extension}`,
    bytes: 8,
    elapsedMs: 5,
    mode: call.formatId === "original" ? "copy" : "encode",
    kind: "audio",
    trim,
  };
}

/** The engine's most recent session, once the hook has opened one. */
async function session(index = 0): Promise<InstanceType<typeof fake.FakeSession>> {
  let found: InstanceType<typeof fake.FakeSession> | undefined;
  await waitFor(() => {
    found = fake.state.engines.flatMap((engine) => engine.sessions)[index];
    expect(found).toBeDefined();
  });
  return found!;
}

/** How many times a frame has been asked for, across every session opened. */
const posterCalls = () =>
  fake.state.engines
    .flatMap((engine) => engine.sessions)
    .reduce((total, entry) => total + entry.posterCalls, 0);

/** The next call the hook makes on a session, once it has made one. */
async function nextCall(target: InstanceType<typeof fake.FakeSession>): Promise<PendingCall> {
  let call: PendingCall | undefined;
  await waitFor(() => {
    call = target.calls.find((entry) => !entry.taken);
    expect(call).toBeDefined();
  });
  call!.taken = true;
  return call!;
}

/** Settles a pending extract as if ffmpeg had produced the file. */
async function finish(call: PendingCall) {
  await act(async () => {
    call.resolve(output(call));
  });
}

async function fail(call: PendingCall, message: string) {
  await act(async () => {
    call.reject(new Error(message));
  });
}

function setup(): Hook {
  return renderHook(() => useConversionQueue());
}

const job = (hook: Hook, index = 0) => hook.result.current.jobs[index];
const outputs = (hook: Hook, index = 0) =>
  job(hook, index).outputs.map((entry) => `${entry.formatId}:${entry.status}`);
const formats = (hook: Hook, index = 0) => job(hook, index).outputs.map((entry) => entry.formatId);

/** Runs a single-format file to completion, leaving the engine loaded. */
async function warmUp(hook: Hook) {
  await act(async () => {
    hook.result.current.setSelectedFormats(["original"]);
  });
  await act(async () => {
    hook.result.current.addFiles([file("first.mp4")]);
  });
  await finish(await nextCall(await session(0)));
  await waitFor(() => expect(job(hook, 0).status).toBe("done"));
}

beforeEach(() => {
  // The queue keeps its jobs in a module-level store so a visit to another
  // tool does not throw the work away, and its format selection in local
  // storage so a tool remembers how it was left. A test has to start from
  // neither, or it inherits the previous test's files and its format picks.
  resetQueueStores();
  window.localStorage.clear();
  fake.state.engines = [];
  fake.state.current = null;
  fake.state.openFails = null;
  fake.state.posterFrames = false;
  let counter = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:${(counter += 1)}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a file through the queue", () => {
  it("converts each requested format in turn on one session, then closes it", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });

    const first = await session();
    await waitFor(() => expect(job(hook).status).toBe("converting"));
    expect(job(hook).probe?.durationSeconds).toBe(120);
    expect(hook.result.current.engineState.stage).toBe("ready");

    const original = await nextCall(first);
    expect(original.formatId).toBe("original");
    expect(outputs(hook)).toEqual(["original:running", "mp3:pending"]);
    await finish(original);

    const mp3 = await nextCall(first);
    expect(mp3.formatId).toBe("mp3");
    expect(outputs(hook)).toEqual(["original:done", "mp3:running"]);
    await finish(mp3);

    await waitFor(() => expect(job(hook).status).toBe("done"));
    expect(outputs(hook)).toEqual(["original:done", "mp3:done"]);
    expect(job(hook).outputs.map((entry) => entry.url)).toEqual(["blob:1", "blob:2"]);
    expect(job(hook).phase).toBe("Done");
    expect(hook.result.current.activeCount).toBe(0);
    await waitFor(() => expect(first.closed).toBe(true));
    expect(fake.state.engines).toHaveLength(1);
  });

  /*
   * A thumbnail is decoration. The engine already resolves to null on its own
   * failures, and the queue catches the rest, so no way of failing to get a
   * frame may take the conversion down with it.
   */
  it("still converts the file when the thumbnail cannot be taken", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });

    const first = await session();
    first.posterFails = true;

    const original = await nextCall(first);
    await finish(original);
    const mp3 = await nextCall(first);
    await finish(mp3);

    await waitFor(() => expect(job(hook).status).toBe("done"));
    expect(job(hook).posterUrl).toBeUndefined();
  });

  it("carries on with the other formats when one fails, and reports the failure on its row", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });
    const first = await session();

    await fail(await nextCall(first), "Unknown encoder 'nope'");
    await waitFor(() => expect(outputs(hook)).toEqual(["original:error", "mp3:running"]));
    expect(job(hook).outputs[0].error?.message).toBe("Unknown encoder 'nope'");

    await finish(await nextCall(first));
    await waitFor(() => expect(job(hook).status).toBe("done"));
    expect(job(hook).error).toBeUndefined();
  });

  it("fails the file when nothing came out of it, naming the first error", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.setSelectedFormats(["mp3"]);
    });
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });

    await fail(await nextCall(await session()), "boom");
    await waitFor(() => expect(job(hook).status).toBe("error"));
    expect(job(hook).error?.message).toBe("boom");
    expect(job(hook).phase).toBe("Failed");
  });

  it("leaves out formats the loaded core cannot encode", async () => {
    const hook = setup();
    await warmUp(hook);

    await act(async () => {
      hook.result.current.setSelectedFormats(["wav", "mp3"]);
    });
    await act(async () => {
      hook.result.current.addFiles([file("second.mp4")]);
    });
    expect(formats(hook, 1)).toEqual(["mp3"]);
    await finish(await nextCall(await session(1)));
    await waitFor(() => expect(job(hook, 1).status).toBe("done"));

    // Nothing usable selected: the defaults stand in, minus anything unavailable.
    await act(async () => {
      hook.result.current.setSelectedFormats(["wav"]);
    });
    await act(async () => {
      hook.result.current.addFiles([file("third.mp4")]);
    });
    expect(formats(hook, 2)).toEqual(["original", "mp3"]);
    const third = await session(2);
    await finish(await nextCall(third));
    await finish(await nextCall(third));
    await waitFor(() => expect(job(hook, 2).status).toBe("done"));
  });
});

describe("cancelling", () => {
  it("keeps finished outputs and re-runs the rest on a fresh engine when one format is stopped mid-run", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.setSelectedFormats(["original", "mp3", "m4a"]);
    });
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });

    const first = await session(0);
    await finish(await nextCall(first));
    const mp3 = await nextCall(first);
    expect(outputs(hook)).toEqual(["original:done", "mp3:running", "m4a:pending"]);

    await act(async () => {
      hook.result.current.cancelOutput(job(hook).id, job(hook).outputs[1].id);
    });
    // The worker was killed, which is what rejected the MP3 command; the same
    // session cannot serve the rest.
    expect(fake.state.engines[0].terminated).toBe(true);
    expect(mp3.settled).toBe(true);

    const second = await session(1);
    expect(fake.state.engines).toHaveLength(2);
    const m4a = await nextCall(second);
    expect(m4a.formatId).toBe("m4a");
    expect(outputs(hook)).toEqual(["original:done", "mp3:cancelled", "m4a:running"]);

    await finish(m4a);
    await waitFor(() => expect(job(hook).status).toBe("done"));
    // The stream copy that finished before the cancel is untouched.
    expect(job(hook).outputs[0].url).toBe("blob:1");
    expect(job(hook).outputs[2].url).toBe("blob:2");
  });

  it("acknowledges a cancel during the engine load at once, and honours it when the load completes", async () => {
    const hook = setup();
    const gate = fake.defer<void>();
    // Prime the engine before the hook asks for it, so the gate is in place.
    const engine = new fake.FakeEngine();
    engine.loadGate = gate;
    fake.state.current = engine;
    fake.state.engines.push(engine);

    await act(async () => {
      hook.result.current.addFiles([file()]);
    });
    expect(job(hook).status).toBe("preparing");
    expect(job(hook).phase).toBe("Loading the ffmpeg engine...");

    await act(async () => {
      hook.result.current.cancelJob(job(hook).id);
    });
    // There was no worker to kill, so the download is left to finish - but the
    // card says what is going on rather than looking ignored.
    expect(job(hook).status).toBe("preparing");
    expect(job(hook).phase).toBe("Cancelling...");

    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(job(hook).status).toBe("cancelled"));
    expect(engine.sessions).toHaveLength(0);
    expect(hook.result.current.engineState.stage).toBe("idle");
  });

  it("settles a queued file's outputs along with it", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file("a.mp4"), file("b.mp4")]);
    });
    const first = await session(0);
    await nextCall(first);
    expect(job(hook, 1).status).toBe("queued");

    await act(async () => {
      hook.result.current.cancelJob(job(hook, 1).id);
    });
    expect(job(hook, 1).status).toBe("cancelled");
    expect(outputs(hook, 1)).toEqual(["original:cancelled", "mp3:cancelled"]);
    // The running file is unaffected.
    expect(job(hook, 0).status).toBe("converting");
    expect(fake.state.engines[0].terminated).toBe(false);
  });

  it("never opens a queued file whose every format was cancelled", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file("a.mp4"), file("b.mp4")]);
    });
    const first = await session(0);
    const a = await nextCall(first);

    await act(async () => {
      for (const entry of job(hook, 1).outputs) {
        hook.result.current.cancelOutput(job(hook, 1).id, entry.id);
      }
    });
    expect(job(hook, 1).status).toBe("queued");

    await finish(a);
    await finish(await nextCall(first));
    await waitFor(() => expect(job(hook, 0).status).toBe("done"));
    await waitFor(() => expect(job(hook, 1).status).toBe("cancelled"));
    // No mount, no probe: the engine was never asked to open the second file.
    expect(fake.state.engines[0].sessions).toHaveLength(1);
    expect(job(hook, 1).probe).toBeUndefined();
  });
});

describe("adding to a file", () => {
  it("appends a format to a running job without disturbing it", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.setSelectedFormats(["original"]);
    });
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });
    const first = await session();
    const original = await nextCall(first);

    await act(async () => {
      hook.result.current.addFormatToJob(job(hook).id, "flac");
    });
    // Still converting: the run loop picks the new output up on its next pass.
    expect(job(hook).status).toBe("converting");
    expect(outputs(hook)).toEqual(["original:running", "flac:pending"]);

    await finish(original);
    const flac = await nextCall(first);
    expect(flac.formatId).toBe("flac");
    await finish(flac);
    await waitFor(() => expect(job(hook).status).toBe("done"));
    expect(fake.state.engines[0].sessions).toHaveLength(1);
  });

  it("queues another format for a finished file and runs only that one", async () => {
    const hook = setup();
    await warmUp(hook);

    await act(async () => {
      hook.result.current.addFormatToJob(job(hook).id, "flac");
    });
    const second = await session(1);
    const call = await nextCall(second);
    expect(call.formatId).toBe("flac");
    expect(outputs(hook)).toEqual(["original:done", "flac:running"]);
    await finish(call);
    await waitFor(() => expect(job(hook).status).toBe("done"));

    // Asking again for the same format over the same range is a no-op.
    await act(async () => {
      hook.result.current.addFormatToJob(job(hook).id, "flac");
    });
    expect(outputs(hook)).toEqual(["original:done", "flac:done"]);
    expect(job(hook).status).toBe("done");

    // A clip of it is a different output, and carries its range.
    await act(async () => {
      hook.result.current.addFormatToJob(job(hook).id, "flac", { startSeconds: 10, endSeconds: 20 });
    });
    const clip = await nextCall(await session(2));
    expect((clip.options as ExtractOptions).trim).toEqual({ startSeconds: 10, endSeconds: 20 });
    await finish(clip);
    await waitFor(() => expect(outputs(hook)).toEqual(["original:done", "flac:done", "flac:done"]));
  });

  it("puts a failed output back through on retry, leaving the finished ones alone", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });
    const first = await session(0);
    await finish(await nextCall(first));
    await fail(await nextCall(first), "boom");
    await waitFor(() => expect(job(hook).status).toBe("done"));
    expect(outputs(hook)).toEqual(["original:done", "mp3:error"]);

    await act(async () => {
      hook.result.current.retryOutput(job(hook).id, job(hook).outputs[1].id);
    });
    const retry = await nextCall(await session(1));
    expect(retry.formatId).toBe("mp3");
    await finish(retry);
    await waitFor(() => expect(outputs(hook)).toEqual(["original:done", "mp3:done"]));
    expect(job(hook).outputs[0].url).toBe("blob:1");
  });
});

describe("automatic trimming", () => {
  it("listens for silence first and hands the range to every pending output", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.setTrimSettings({
        mode: "silence",
        silence: { thresholdDb: -40, minDurationSeconds: 0.3 },
      });
    });
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });

    const first = await session();
    const scan = await nextCall(first);
    expect(scan.kind).toBe("silence");
    expect(scan.options).toEqual({ thresholdDb: -40, minDurationSeconds: 0.3 });
    expect(job(hook).phase).toBe("Listening for silence...");

    const suggested = { startSeconds: 3.1, endSeconds: 110.4 };
    await act(async () => {
      scan.resolve({
        intervals: [
          { start: 0, end: 3.2 },
          { start: 110.3, end: null },
        ],
        suggested,
        entirelySilent: false,
        durationSeconds: 120,
        options: { thresholdDb: -40, minDurationSeconds: 0.3 },
      } satisfies SilenceScanResult);
    });

    const original = await nextCall(first);
    expect((original.options as ExtractOptions).trim).toEqual(suggested);
    expect(job(hook).trim).toEqual(suggested);
    expect(job(hook).autoTrim).toBe(false);
    expect(job(hook).silence?.intervals).toHaveLength(2);
    expect(job(hook).outputs.every((entry) => entry.trim === suggested)).toBe(true);

    await finish(original);
    await finish(await nextCall(first));
    await waitFor(() => expect(job(hook).status).toBe("done"));
  });
});

describe("terminal states", () => {
  it("settles every waiting output when the file itself fails to open", async () => {
    // A file that cannot be probed used to leave its formats sitting at
    // "Waiting" with a live Cancel button, under a red error, for a run that
    // was never going to come.
    fake.state.openFails = new ExtractionError(
      "This file could not be read as a media file.",
      "ffmpeg could not parse the container.",
      { retryable: false },
    );

    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file("corrupt.mp4")]);
    });

    await waitFor(() => expect(job(hook).status).toBe("error"));
    expect(outputs(hook)).toEqual(["original:error", "mp3:error"]);
    expect(job(hook).error?.retryable).toBe(false);
    expect(job(hook).outputs[0].error?.retryable).toBe(false);
  });

  it("settles the waiting outputs of a file cancelled mid-run", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });
    await nextCall(await session(0));
    expect(outputs(hook)).toEqual(["original:running", "mp3:pending"]);

    await act(async () => {
      hook.result.current.cancelJob(job(hook).id);
    });

    await waitFor(() => expect(job(hook).status).toBe("cancelled"));
    // Nothing may still claim to be waiting for a turn it will not get.
    expect(job(hook).outputs.every((entry) => entry.status === "cancelled")).toBe(true);
  });
});

describe("an engine that crashes", () => {
  it("fails only the format that crashed and re-runs the rest on a new engine", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([file()]);
    });

    const first = await session(0);
    const original = await nextCall(first);
    await act(async () => {
      // What a wasm trap looks like coming back out of ffmpeg.wasm.
      original.reject(new ExtractionError("The ffmpeg engine stopped unexpectedly.", undefined, {
        fatal: true,
      }));
    });

    // The crashed format keeps its error; the engine is thrown away.
    await waitFor(() => expect(job(hook).outputs[0].status).toBe("error"));
    expect(fake.state.engines[0].terminated).toBe(true);
    expect(hook.result.current.engineState.restarts).toBe(1);

    // ...and the format behind it runs on the replacement, with no reload.
    const second = await session(1);
    expect(second).not.toBe(first);
    const mp3 = await nextCall(second);
    expect(mp3.formatId).toBe("mp3");
    await finish(mp3);

    await waitFor(() => expect(job(hook).status).toBe("done"));
    expect(outputs(hook)).toEqual(["original:error", "mp3:done"]);
  });
});

describe("files that are not media", () => {
  it("refuses a text file without waking the engine", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([
        new File([new Uint8Array(8)], "notes.txt", { type: "text/plain" }),
      ]);
    });

    expect(job(hook).status).toBe("error");
    expect(job(hook).error?.message).toMatch(/not a video or audio file/);
    expect(job(hook).error?.retryable).toBe(false);
    // No outputs to strand, and no 31 MB download to reach the same answer.
    expect(job(hook).outputs).toEqual([]);
    expect(fake.state.engines).toHaveLength(0);
  });

  it("still opens a media file whose extension is unfamiliar to the browser", async () => {
    const hook = setup();
    await act(async () => {
      // Browsers routinely report no MIME type at all for Matroska.
      hook.result.current.addFiles([new File([new Uint8Array(8)], "clip.mkv", { type: "" })]);
    });

    expect(job(hook).status).not.toBe("error");
    await expect(session(0)).resolves.toBeDefined();
  });
});

describe("work that outlives the page", () => {
  it("finds the same files after the tool is unmounted and mounted again", async () => {
    // Trimming a file, glancing at another tool and pressing Back used to
    // find an empty page: the state and the object URLs went with the
    // component.
    const first = setup();
    await warmUp(first);
    const url = job(first).outputs[0].url;
    expect(url).toBeDefined();

    first.unmount();
    const second = setup();

    expect(second.result.current.jobs).toHaveLength(1);
    expect(job(second).status).toBe("done");
    expect(job(second).outputs[0].url).toBe(url);
    // The finished download must still work, so its URL is not revoked.
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
  });
});

describe("housekeeping", () => {
  it("revokes a file's object URLs when it is removed", async () => {
    const hook = setup();
    await warmUp(hook);
    expect(job(hook).outputs[0].url).toBe("blob:1");

    await act(async () => {
      hook.result.current.removeJob(job(hook).id);
    });
    expect(hook.result.current.jobs).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
  });

  it("takes the thumbnail once per file, not once per run", async () => {
    fake.state.posterFrames = true;
    const hook = setup();
    await warmUp(hook);
    expect(job(hook).posterUrl).toBeDefined();
    expect(posterCalls()).toBe(1);

    // Every "also convert to" hands the job back to the pump, which opens a
    // second session for the file; re-seeking and re-encoding a frame the card
    // is already showing is pure waste.
    await act(async () => {
      hook.result.current.addFormatToJob(job(hook).id, "mp3");
    });
    await finish(await nextCall(await session(1)));
    await waitFor(() => expect(job(hook).status).toBe("done"));
    expect(outputs(hook)).toEqual(["original:done", "mp3:done"]);
    expect(posterCalls()).toBe(1);
  });
});
