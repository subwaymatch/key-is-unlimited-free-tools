import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CORE_JS_SHA256,
  CORE_WASM_BYTES,
  CORE_WASM_SHA256,
} from "@/lib/engine/constants";

/**
 * The loader keeps a module-level cache of the download, so each test gets a
 * fresh copy of the module rather than the previous test's promise.
 */
async function loadFresh() {
  vi.resetModules();
  return import("@/lib/engine/coreLoader");
}

/** A response whose body arrives in `chunks`, with whatever headers the test wants. */
function streamedResponse(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

function bytesOf(length: number, fill = 7) {
  return new Uint8Array(length).fill(fill);
}

async function sha256Of(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("sha256Hex", () => {
  it("matches the platform digest, in lowercase hex", async () => {
    const { sha256Hex } = await loadFresh();
    const bytes = new TextEncoder().encode("ffmpeg");
    expect(await sha256Hex(bytes)).toBe(await sha256Of(bytes));
  });
});

describe("loadCoreUrls", () => {
  const createObjectURL = vi.fn(() => `blob:${Math.random()}`);

  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Serves a wasm and a core JS whose bytes hash to whatever `pins` says the
   * module should expect. The pins are patched into the constants module so the
   * fixtures can stay tiny instead of being a real 31 MB core.
   */
  async function serve(options: {
    wasm: Uint8Array;
    js: Uint8Array;
    wasmChunks?: number;
    headers?: Record<string, string>;
    pinnedWasmSha256?: string;
    pinnedWasmBytes?: number;
  }) {
    const wasmSha = options.pinnedWasmSha256 ?? (await sha256Of(options.wasm));
    const jsSha = await sha256Of(options.js);
    vi.doMock("@/lib/engine/constants", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/engine/constants")>()),
      CORE_WASM_SHA256: wasmSha,
      CORE_JS_SHA256: jsSha,
      CORE_WASM_BYTES: options.pinnedWasmBytes ?? options.wasm.length,
    }));

    const chunkCount = options.wasmChunks ?? 4;
    const size = Math.ceil(options.wasm.length / chunkCount);
    const chunks = Array.from({ length: chunkCount }, (_, i) =>
      options.wasm.slice(i * size, (i + 1) * size),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith(".wasm")
          ? streamedResponse(chunks, options.headers)
          : streamedResponse([options.js]),
      ),
    );
    return loadFresh();
  }

  it("measures progress against the pinned size, not the Content-Length of a compressed body", async () => {
    const wasm = bytesOf(1000);
    const { loadCoreUrls } = await serve({
      wasm,
      js: bytesOf(10, 1),
      wasmChunks: 4,
      // What a CDN sends for a brotli-compressed body: a third of the real size.
      headers: { "content-length": "333", "content-encoding": "br" },
    });

    const ratios: number[] = [];
    await loadCoreUrls((progress) => {
      ratios.push(progress.ratio ?? -1);
      expect(progress.totalBytes).toBe(1000);
    });

    // Four chunks of 250 and a final "done": the bar climbs, it does not slam
    // to 100% a third of the way in.
    expect(ratios).toEqual([0.25, 0.5, 0.75, 1, 1]);
  });

  it("refuses a core whose bytes do not match the pinned checksum", async () => {
    const { loadCoreUrls } = await serve({
      wasm: bytesOf(64),
      js: bytesOf(10, 1),
      pinnedWasmSha256: "0".repeat(64),
    });

    await expect(loadCoreUrls()).rejects.toMatchObject({
      name: "ExtractionError",
      message: expect.stringMatching(/checksum/i),
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("hands back blob URLs for both files once they verify, and caches them", async () => {
    const { loadCoreUrls } = await serve({ wasm: bytesOf(64), js: bytesOf(10, 1) });

    const first = await loadCoreUrls();
    expect(first.wasmURL).toMatch(/^blob:/);
    expect(first.coreURL).toMatch(/^blob:/);
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    const progress: number[] = [];
    const second = await loadCoreUrls((p) => progress.push(p.ratio ?? -1));
    expect(second).toBe(first);
    // A later caller is told the download is complete rather than left at 0%.
    expect(progress).toEqual([1]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("lets a failed download be retried rather than caching the failure", async () => {
    const { loadCoreUrls } = await serve({ wasm: bytesOf(64), js: bytesOf(10, 1) });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));

    await expect(loadCoreUrls()).rejects.toMatchObject({ name: "ExtractionError" });
    await expect(loadCoreUrls()).resolves.toMatchObject({ wasmURL: expect.stringMatching(/^blob:/) });
  });
});

describe("the pins in constants.ts", () => {
  it("look like a real size and two SHA-256 digests", () => {
    expect(CORE_WASM_BYTES).toBeGreaterThan(20 * 1024 ** 2);
    expect(CORE_WASM_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(CORE_JS_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
