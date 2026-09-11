// @vitest-environment jsdom

/**
 * The merger's store, driven through a fake engine.
 *
 * Reading, joining, cancelling and the list edits between them are all
 * state transitions that need no ffmpeg; the fake settles each engine call
 * by hand so every path is exercised deterministically.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EngineCapabilities,
  EngineLoadProgress,
  ExtractOutput,
  MergeOptions,
  MergePlan,
  MountedInput,
  PosterFrame,
  ProbeResult,
} from "@/lib/engine/types";
import { ExtractionError } from "@/lib/engine/types";

interface PendingMerge {
  plan: MergePlan;
  options?: MergeOptions;
  settled: boolean;
  resolve: (value: ExtractOutput) => void;
  reject: (reason: unknown) => void;
}

const fake = vi.hoisted(() => {
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
    durationSeconds: 10,
    bitrateKbps: 2700,
    audioStreams: [],
    audio: {
      codec: "aac",
      profile: "LC",
      sampleRate: 48_000,
      channels: 2,
      channelLayout: "stereo",
      language: null,
      title: null,
      bitrateKbps: 192,
    },
    videoStreams: [VIDEO],
    video: VIDEO,
    hasVideo: true,
    subtitleStreams: [],
    chapters: [],
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    log: [],
  };

  class FakeMultiSession {
    closed = false;
    merges: PendingMerge[] = [];
    readonly inputs: MountedInput[];

    constructor(readonly files: File[]) {
      this.inputs = files.map((file, index) => ({
        file,
        inputPath: `/input/source-${index + 1}.mp4`,
        // A file named "broken" is the one the probe cannot read.
        probe: file.name.startsWith("broken") ? null : PROBE,
        error: file.name.startsWith("broken")
          ? new ExtractionError("This file could not be read as a media file.", "bad", { retryable: false })
          : null,
      }));
    }

    poster(): Promise<PosterFrame | null> {
      return Promise.resolve(null);
    }

    merge(plan: MergePlan, options?: MergeOptions): Promise<ExtractOutput> {
      return new Promise<ExtractOutput>((resolve, reject) => {
        const call: PendingMerge = {
          plan,
          options,
          settled: false,
          resolve: (value) => {
            call.settled = true;
            resolve(value);
          },
          reject: (reason) => {
            call.settled = true;
            reject(reason);
          },
        };
        this.merges.push(call);
      });
    }

    async close(): Promise<void> {
      this.closed = true;
    }

    abort(): void {
      for (const call of this.merges) {
        if (!call.settled) call.reject(new Error("called FFmpeg.terminate()"));
      }
    }
  }

  class FakeEngine {
    loaded = false;
    poisoned = false;
    terminated = false;
    sessions: FakeMultiSession[] = [];
    capabilities: EngineCapabilities | null = null;

    setLogListener(): void {}

    async load(onProgress?: (progress: EngineLoadProgress) => void): Promise<EngineCapabilities> {
      this.loaded = true;
      this.capabilities = state.capabilities;
      onProgress?.({ stage: "ready", ratio: 1, receivedBytes: 0, totalBytes: 0 });
      return state.capabilities;
    }

    async openFiles(files: File[]): Promise<FakeMultiSession> {
      const session = new FakeMultiSession(files);
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
    capabilities: {
      encoders: new Set(["libx264", "aac"]),
      supportsWorkerFs: true,
    } as EngineCapabilities,
  };

  return { state, FakeEngine, FakeMultiSession, PROBE };
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

import { resetEngineState } from "@/lib/engineState";
import { resetMergeStore, useMergeQueue } from "@/lib/useMergeQueue";

const file = (name = "clip.mp4") => new File([new Uint8Array(16)], name, { type: "video/mp4" });

const sessions = () => fake.state.engines.flatMap((engine) => engine.sessions);

async function session(index: number): Promise<InstanceType<typeof fake.FakeMultiSession>> {
  let found: InstanceType<typeof fake.FakeMultiSession> | undefined;
  await waitFor(() => {
    found = sessions()[index];
    expect(found).toBeDefined();
  });
  return found!;
}

async function pendingMerge(target: InstanceType<typeof fake.FakeMultiSession>): Promise<PendingMerge> {
  let call: PendingMerge | undefined;
  await waitFor(() => {
    call = target.merges.find((entry) => !entry.settled);
    expect(call).toBeDefined();
  });
  return call!;
}

function output(plan: MergePlan): ExtractOutput {
  return {
    blob: new Blob([new Uint8Array(8)], { type: plan.mimeType }),
    fileName: `${plan.baseName}.${plan.extension}`,
    extension: plan.extension,
    mimeType: plan.mimeType,
    bytes: 8,
    elapsedMs: 5,
    mode: plan.mode,
    kind: "video",
    trim: null,
  };
}

const setup = () => renderHook(() => useMergeQueue());
type Hook = ReturnType<typeof setup>;

const statuses = (hook: Hook) => hook.result.current.clips.map((clip) => clip.status);

/** Adds files and waits for every one of them to be read. */
async function addAndRead(hook: Hook, files: File[]) {
  await act(async () => {
    hook.result.current.addFiles(files);
  });
  await waitFor(() =>
    expect(hook.result.current.clips.every((clip) => clip.status === "ready" || clip.status === "error")).toBe(
      true,
    ),
  );
}

beforeEach(() => {
  resetMergeStore();
  resetEngineState();
  window.localStorage.clear();
  fake.state.engines = [];
  fake.state.current = null;
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

describe("reading clips", () => {
  it("reads new clips in one session and closes it", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("b.mp4")]);

    expect(statuses(hook)).toEqual(["ready", "ready"]);
    expect(hook.result.current.clips[0].probe?.durationSeconds).toBe(10);
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.engineState.stage).toBe("ready");
    const first = await session(0);
    expect(first.files.map((entry) => entry.name)).toEqual(["a.mp4", "b.mp4"]);
    await waitFor(() => expect(first.closed).toBe(true));
  });

  it("refuses a file that is not media without opening the engine", async () => {
    const hook = setup();
    await act(async () => {
      hook.result.current.addFiles([new File([new Uint8Array(4)], "notes.txt", { type: "text/plain" })]);
    });
    expect(statuses(hook)).toEqual(["error"]);
    expect(hook.result.current.clips[0].error?.message).toMatch(/not a video or audio file/);
    expect(fake.state.engines).toHaveLength(0);
  });

  it("marks a clip the probe cannot read and keeps the others", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("broken.mp4")]);
    expect(statuses(hook)).toEqual(["ready", "error"]);
    expect(hook.result.current.clips[1].error?.message).toMatch(/could not be read/);
  });
});

describe("joining", () => {
  it("opens the ready clips in order, runs the plan and keeps the output", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("b.mp4"), file("broken.mp4")]);

    await act(async () => {
      void hook.result.current.merge();
    });
    const second = await session(1);
    // Only the readable clips go into the join.
    expect(second.files.map((entry) => entry.name)).toEqual(["a.mp4", "b.mp4"]);
    await waitFor(() => expect(hook.result.current.status).toBe("merging"));

    const call = await pendingMerge(second);
    expect(call.plan.mode).toBe("copy");
    expect(call.plan.inputArgs).toContain("concat");
    expect(call.options?.stripMetadata).toBe(true);
    await act(async () => {
      call.resolve(output(call.plan));
    });

    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    expect(hook.result.current.output?.result.fileName).toBe("a-merged.mp4");
    expect(hook.result.current.output?.url).toBe("blob:1");
    expect(hook.result.current.error).toBeNull();
    await waitFor(() => expect(second.closed).toBe(true));
  });

  it("does nothing with fewer than two readable clips", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("broken.mp4")]);
    await act(async () => {
      await hook.result.current.merge();
    });
    expect(sessions()).toHaveLength(1);
    expect(hook.result.current.output).toBeNull();
  });

  it("clears the output when the list changes, and honours the order", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("b.mp4")]);
    await act(async () => {
      void hook.result.current.merge();
    });
    const call = await pendingMerge(await session(1));
    await act(async () => {
      call.resolve(output(call.plan));
    });
    await waitFor(() => expect(hook.result.current.output).not.toBeNull());

    const [a, b] = hook.result.current.clips;
    await act(async () => {
      hook.result.current.moveClip(b.id, -1);
    });
    expect(hook.result.current.clips.map((clip) => clip.file.name)).toEqual(["b.mp4", "a.mp4"]);
    expect(hook.result.current.output).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");

    await act(async () => {
      hook.result.current.removeClip(a.id);
    });
    expect(hook.result.current.clips.map((clip) => clip.file.name)).toEqual(["b.mp4"]);
  });

  it("reports a join that fails, on the page rather than as a crash", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("b.mp4")]);
    await act(async () => {
      void hook.result.current.merge();
    });
    const call = await pendingMerge(await session(1));
    await act(async () => {
      call.reject(new ExtractionError("Joining the clips failed.", "muxer said no"));
    });
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    expect(hook.result.current.error?.message).toBe("Joining the clips failed.");
    expect(hook.result.current.output).toBeNull();
  });

  it("cancels a join by killing the worker, quietly, and starts a fresh engine next time", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("b.mp4")]);
    await act(async () => {
      void hook.result.current.merge();
    });
    await pendingMerge(await session(1));

    await act(async () => {
      hook.result.current.cancel();
    });
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    // A cancel is something the visitor did: no error, no output, a new engine.
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.output).toBeNull();
    expect(fake.state.engines[0].terminated).toBe(true);
    expect(hook.result.current.engineState.stage).toBe("idle");
    expect(hook.result.current.engineState.restarts).toBe(0);

    // The clips are still there and can be joined again on the new engine.
    expect(statuses(hook)).toEqual(["ready", "ready"]);
    await act(async () => {
      void hook.result.current.merge();
    });
    await pendingMerge(await session(2));
    expect(fake.state.engines).toHaveLength(2);
  });

  it("reads clips that arrive during a join once it is done", async () => {
    const hook = setup();
    await addAndRead(hook, [file("a.mp4"), file("b.mp4")]);
    await act(async () => {
      void hook.result.current.merge();
    });
    const call = await pendingMerge(await session(1));

    await act(async () => {
      hook.result.current.addFiles([file("c.mp4")]);
    });
    expect(statuses(hook)).toEqual(["ready", "ready", "new"]);
    expect(sessions()).toHaveLength(2);

    await act(async () => {
      call.resolve(output(call.plan));
    });
    await waitFor(() => expect(statuses(hook)).toEqual(["ready", "ready", "ready"]));
    expect(sessions()).toHaveLength(3);
    // A file added after the join was asked for is not part of it.
    expect(hook.result.current.output).toBeNull();
  });
});
