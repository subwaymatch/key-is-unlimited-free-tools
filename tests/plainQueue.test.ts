// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlainError, resetPlainStores, useCombineQueue, usePlainQueue, type PlainResult } from "@/lib/plainQueue";

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

interface Deferred {
  resolve: (value: PlainResult) => void;
  reject: (reason: unknown) => void;
  file: File;
  settings: unknown;
  signal: AbortSignal;
}

beforeEach(() => {
  let urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:${(urls += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  resetPlainStores();
});

describe("the plain queue", () => {
  it("works files one at a time with the settings they were added under", async () => {
    const calls: Deferred[] = [];
    const run = vi.fn(
      (input: File, settings: unknown, _report: unknown, signal: AbortSignal) =>
        new Promise<PlainResult>((resolve, reject) => calls.push({ resolve, reject, file: input, settings, signal })),
    );
    const hook = renderHook(({ quality }: { quality: number }) => usePlainQueue({ key: "t", run, settings: { quality }, preview: true }), {
      initialProps: { quality: 80 },
    });
    act(() => hook.result.current.addFiles([file("a.png"), file("b.png")]));
    hook.rerender({ quality: 50 });
    act(() => hook.result.current.addFiles([file("c.png")]));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(hook.result.current.jobs.map((job) => job.status)).toEqual(["working", "queued", "queued"]);
    expect(hook.result.current.jobs[0].previewUrl).toBe("blob:1");
    expect(calls[0].settings).toEqual({ quality: 80 });

    await act(async () => {
      calls[0].resolve({ outputs: [{ label: "PNG", fileName: "a.png", blob: new Blob([new Uint8Array(3)]), kind: "image", note: "1x1" }], facts: ["1x1"], notes: ["done"] });
    });
    await waitFor(() => expect(hook.result.current.jobs[0].status).toBe("done"));
    expect(hook.result.current.jobs[0].outputs[0]).toMatchObject({ label: "PNG", bytes: 3, url: "blob:4" });
    expect(hook.result.current.jobs[0].facts).toEqual(["1x1"]);

    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].reject(new PlainError("No good.", "Because.", { retryable: true })));
    await waitFor(() => expect(hook.result.current.jobs[1].status).toBe("error"));
    expect(hook.result.current.jobs[1].error).toEqual({ message: "No good.", hint: "Because.", retryable: true });

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].settings).toEqual({ quality: 50 });
    await act(async () => calls[2].resolve({ outputs: [], nothing: { message: "Nothing here." } }));
    await waitFor(() => expect(hook.result.current.jobs[2].status).toBe("nothing"));
    expect(hook.result.current.activeCount).toBe(0);

    // Retry re-runs the failed one with the settings it had.
    act(() => hook.result.current.retryJob(hook.result.current.jobs[1].id));
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[3].settings).toEqual({ quality: 80 });
    await act(async () => calls[3].resolve({ outputs: [] }));
    await waitFor(() => expect(hook.result.current.jobs[1].status).toBe("done"));

    act(() => hook.result.current.clearFinished());
    expect(hook.result.current.jobs).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("refuses what the tool rejects, and aborts a job that is removed while working", async () => {
    const calls: Deferred[] = [];
    const run = vi.fn(
      (input: File, settings: unknown, _report: unknown, signal: AbortSignal) =>
        new Promise<PlainResult>((resolve, reject) => calls.push({ resolve, reject, file: input, settings, signal })),
    );
    const hook = renderHook(() =>
      usePlainQueue({ key: "u", run, settings: {}, reject: (candidate) => (candidate.name.endsWith(".txt") ? { message: "Not a picture.", hint: "Nope." } : null) }),
    );
    act(() => hook.result.current.addFiles([file("notes.txt"), file("a.png")]));
    expect(hook.result.current.jobs[0].status).toBe("error");
    expect(hook.result.current.jobs[0].error?.message).toBe("Not a picture.");
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => hook.result.current.removeJob(hook.result.current.jobs[1].id));
    expect(calls[0].signal.aborted).toBe(true);
    expect(hook.result.current.jobs).toHaveLength(1);
  });
});

describe("the combine queue", () => {
  it("reads files as they arrive, keeps their order, and runs them as one job", async () => {
    const run = vi.fn(async (files: File[]) => ({ outputs: [{ label: "PDF", fileName: "merged.pdf", blob: new Blob([new Uint8Array(files.length)]), kind: "pdf" as const }] }));
    const inspect = vi.fn(async (candidate: File) => ({ facts: [`${candidate.size} bytes`] }));
    const hook = renderHook(() => useCombineQueue({ key: "c", run, settings: {}, inspect }));
    act(() => hook.result.current.addFiles([file("a.pdf", 1), file("b.pdf", 2)]));
    await waitFor(() => expect(hook.result.current.files.every((entry) => entry.status === "ready")).toBe(true));
    expect(hook.result.current.files.map((entry) => entry.facts[0])).toEqual(["1 bytes", "2 bytes"]);

    act(() => hook.result.current.moveFile(hook.result.current.files[1].id, -1));
    expect(hook.result.current.files.map((entry) => entry.file.name)).toEqual(["b.pdf", "a.pdf"]);
    act(() => hook.result.current.moveFile(hook.result.current.files[0].id, -1));
    expect(hook.result.current.files.map((entry) => entry.file.name)).toEqual(["b.pdf", "a.pdf"]);

    await act(async () => hook.result.current.run());
    expect(run).toHaveBeenCalledWith([hook.result.current.files[0].file, hook.result.current.files[1].file], {}, expect.any(Function), expect.any(AbortSignal));
    expect(hook.result.current.status).toBe("done");
    expect(hook.result.current.outputs[0]).toMatchObject({ fileName: "merged.pdf", bytes: 2 });

    // A change to the list drops the output that no longer describes it.
    act(() => hook.result.current.removeFile(hook.result.current.files[0].id));
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.outputs).toHaveLength(0);

    act(() => hook.result.current.clear());
    expect(hook.result.current.files).toHaveLength(0);
  });

  it("reports a failed run on the whole job", async () => {
    const run = vi.fn(async () => {
      throw new PlainError("Broke.", "Why.");
    });
    const hook = renderHook(() => useCombineQueue({ key: "d", run, settings: {} }));
    act(() => hook.result.current.addFiles([file("a.pdf")]));
    await act(async () => hook.result.current.run());
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error).toEqual({ message: "Broke.", hint: "Why.", retryable: false });
  });
});
