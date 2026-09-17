"use client";

/**
 * The queue for the tools with no engine: images through the canvas, PDFs
 * through pdf-lib, archives through fflate, checksums through plain
 * arithmetic.
 *
 * The same shape as the conversion queue, smaller: files are worked one at
 * a time by a function the tool supplies, each capturing the settings as
 * they stood when it was added, and the store lives at module level keyed
 * by tool so a visit to another page and a press of Back finds the work
 * where it was left. Two stores: one job per file, and one job over many
 * files for the tools that combine.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface PlainFailure {
  message: string;
  hint?: string;
  /** Whether running again could end differently. */
  retryable: boolean;
}

/** Thrown by a runner for conditions the card explains rather than dumps. */
export class PlainError extends Error {
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(message: string, hint?: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "PlainError";
    this.hint = hint;
    this.retryable = options?.retryable ?? false;
  }
}

export type OutputKind = "image" | "pdf" | "file" | "text";

export interface PlainOutputSpec {
  label: string;
  fileName: string;
  blob: Blob;
  kind: OutputKind;
  /** A line under the row: "1600x1200, quality 82". */
  note?: string;
  /** For a text output, what to show and copy: a hash. */
  text?: string;
}

export interface PlainOutput extends PlainOutputSpec {
  id: string;
  /** Object URL for download and preview; revoked with the job. */
  url: string;
  bytes: number;
}

export interface PlainResult {
  outputs: PlainOutputSpec[];
  /** Facts about the source worth showing: "3000x2000", the tags found. */
  facts?: string[];
  /** Something true about the result: "metadata removed". */
  notes?: string[];
  /**
   * The job had nothing to do: a file with no metadata, a PDF with one page
   * asked to split. Reported as a note rather than a failure.
   */
  nothing?: { message: string; hint?: string };
}

export type PlainReport = (phase: string, ratio: number | null) => void;

export type PlainRunner<S> = (file: File, settings: S, report: PlainReport, signal: AbortSignal) => Promise<PlainResult>;

export type PlainStatus = "queued" | "working" | "done" | "nothing" | "error";

export interface PlainJob {
  id: string;
  file: File;
  status: PlainStatus;
  phase: string;
  ratio: number | null;
  facts: string[];
  notes: string[];
  outputs: PlainOutput[];
  error?: PlainFailure;
  /** Object URL of the source, for a thumbnail, when the tool asked for one. */
  previewUrl?: string;
  /** The settings this job runs with, captured when it was added. */
  settings: unknown;
}

export interface FileRejection {
  message: string;
  hint: string;
}

export interface PlainQueueOptions<S> {
  /** Which store this tool's work lives in. */
  key: string;
  run: PlainRunner<S>;
  /** The settings a file added next is worked with. */
  settings: S;
  /** Why a file will not be taken, or null when it is worth trying. */
  reject?: (file: File) => FileRejection | null;
  /** Keep an object URL of the source for a thumbnail: images. */
  preview?: boolean;
}

interface PlainStore {
  jobs: PlainJob[];
  options: PlainQueueOptions<unknown>;
  pumping: boolean;
  active: { jobId: string; controller: AbortController } | null;
  listeners: Set<() => void>;
}

const stores = new Map<string, PlainStore>();

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}-${Date.now().toString(36)}`;

function getStore(options: PlainQueueOptions<unknown>): PlainStore {
  let store = stores.get(options.key);
  if (!store) {
    store = { jobs: [], options, pumping: false, active: null, listeners: new Set() };
    stores.set(options.key, store);
  }
  return store;
}

function notify(store: PlainStore): void {
  for (const listener of store.listeners) listener();
}

function releaseJob(job: PlainJob): void {
  for (const output of job.outputs) URL.revokeObjectURL(output.url);
  if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
}

/** What a thrown value means on a card. */
export function toPlainFailure(error: unknown): PlainFailure {
  if (error instanceof PlainError) return { message: error.message, hint: error.hint, retryable: error.retryable };
  if (error instanceof Error) {
    return { message: "This file could not be processed.", hint: error.message, retryable: true };
  }
  return { message: "This file could not be processed.", retryable: true };
}

/** Outputs with their URLs and sizes filled in. */
export function materializeOutputs(specs: readonly PlainOutputSpec[]): PlainOutput[] {
  return specs.map((spec) => ({ ...spec, id: nextId("output"), url: URL.createObjectURL(spec.blob), bytes: spec.blob.size }));
}

/** @internal - lets tests start from a clean page. */
export function resetPlainStores(): void {
  for (const store of stores.values()) {
    store.active?.controller.abort();
    for (const job of store.jobs) releaseJob(job);
  }
  stores.clear();
  for (const store of combineStores.values()) {
    store.active?.abort();
    for (const output of store.state.outputs) URL.revokeObjectURL(output.url);
  }
  combineStores.clear();
}

async function pump(store: PlainStore): Promise<void> {
  if (store.pumping) return;
  store.pumping = true;
  try {
    for (;;) {
      const job = store.jobs.find((entry) => entry.status === "queued");
      if (!job) break;
      const controller = new AbortController();
      store.active = { jobId: job.id, controller };
      const patch = (changes: Partial<PlainJob>) => {
        store.jobs = store.jobs.map((entry) => (entry.id === job.id ? { ...entry, ...changes } : entry));
        notify(store);
      };
      patch({ status: "working", phase: "Working...", ratio: null });
      try {
        const result = await store.options.run(
          job.file,
          job.settings,
          (phase, ratio) => {
            if (!controller.signal.aborted) patch({ phase, ratio });
          },
          controller.signal,
        );
        if (controller.signal.aborted) continue;
        if (result.nothing) {
          patch({
            status: "nothing",
            phase: "Nothing to do",
            ratio: null,
            facts: result.facts ?? [],
            notes: result.notes ?? [],
            error: { message: result.nothing.message, hint: result.nothing.hint, retryable: false },
          });
        } else {
          patch({ status: "done", phase: "Done", ratio: 1, facts: result.facts ?? [], notes: result.notes ?? [], outputs: materializeOutputs(result.outputs) });
        }
      } catch (error) {
        if (controller.signal.aborted) continue;
        patch({ status: "error", phase: "Failed", ratio: null, error: toPlainFailure(error) });
      } finally {
        store.active = null;
      }
    }
  } finally {
    store.pumping = false;
  }
}

export function usePlainQueue<S>(options: PlainQueueOptions<S>) {
  const store = getStore(options as PlainQueueOptions<unknown>);
  // The settings as they stand on this render, for the next file added.
  store.options = options as PlainQueueOptions<unknown>;

  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [store],
  );
  const getJobs = useCallback(() => store.jobs, [store]);
  const jobs = useSyncExternalStore(subscribe, getJobs, getJobs);

  const addFiles = useCallback(
    (files: File[]) => {
      const { reject, preview, settings } = store.options;
      const added: PlainJob[] = files.map((file) => {
        const rejection = reject?.(file) ?? null;
        const base: PlainJob = {
          id: nextId("job"),
          file,
          status: rejection ? "error" : "queued",
          phase: rejection ? "Failed" : "Waiting",
          ratio: null,
          facts: [],
          notes: [],
          outputs: [],
          settings,
        };
        if (rejection) base.error = { ...rejection, retryable: false };
        else if (preview) base.previewUrl = URL.createObjectURL(file);
        return base;
      });
      store.jobs = [...store.jobs, ...added];
      notify(store);
      void pump(store);
    },
    [store],
  );

  const removeJob = useCallback(
    (id: string) => {
      const job = store.jobs.find((entry) => entry.id === id);
      if (!job) return;
      if (store.active?.jobId === id) store.active.controller.abort();
      releaseJob(job);
      store.jobs = store.jobs.filter((entry) => entry.id !== id);
      notify(store);
    },
    [store],
  );

  const retryJob = useCallback(
    (id: string) => {
      store.jobs = store.jobs.map((job) => {
        if (job.id !== id || job.status === "working" || job.status === "queued") return job;
        for (const output of job.outputs) URL.revokeObjectURL(output.url);
        return { ...job, status: "queued", phase: "Waiting", ratio: null, outputs: [], error: undefined, notes: [] };
      });
      notify(store);
      void pump(store);
    },
    [store],
  );

  const clearFinished = useCallback(() => {
    const keep: PlainJob[] = [];
    for (const job of store.jobs) {
      if (job.status === "queued" || job.status === "working") keep.push(job);
      else releaseJob(job);
    }
    store.jobs = keep;
    notify(store);
  }, [store]);

  const activeCount = jobs.filter((job) => job.status === "queued" || job.status === "working").length;

  return { jobs, addFiles, removeJob, retryJob, clearFinished, activeCount };
}

/* ---- Many files, one job ------------------------------------------------ */

export type CombineFileStatus = "reading" | "ready" | "error";

export interface CombineFile {
  id: string;
  file: File;
  status: CombineFileStatus;
  facts: string[];
  previewUrl?: string;
  error?: PlainFailure;
}

export type CombineStatus = "idle" | "working" | "done" | "error";

export interface CombineInspection {
  facts: string[];
  /** An object URL the store owns and revokes. */
  previewUrl?: string;
}

export interface CombineOptions<S> {
  key: string;
  run: (files: File[], settings: S, report: PlainReport, signal: AbortSignal) => Promise<PlainResult>;
  settings: S;
  /** Something to say about each file as it arrives: pages, size, a thumbnail. */
  inspect?: (file: File) => Promise<CombineInspection>;
  reject?: (file: File) => FileRejection | null;
}

/** What the page sees. Replaced whole on every change, so the snapshot's identity says when. */
export interface CombineState {
  files: CombineFile[];
  status: CombineStatus;
  phase: string;
  ratio: number | null;
  outputs: PlainOutput[];
  notes: string[];
  error: PlainFailure | null;
}

interface CombineStore {
  state: CombineState;
  options: CombineOptions<unknown>;
  active: AbortController | null;
  listeners: Set<() => void>;
}

const combineStores = new Map<string, CombineStore>();

const IDLE: CombineState = { files: [], status: "idle", phase: "", ratio: null, outputs: [], notes: [], error: null };

function getCombineStore(options: CombineOptions<unknown>): CombineStore {
  let store = combineStores.get(options.key);
  if (!store) {
    store = { state: IDLE, options, active: null, listeners: new Set() };
    combineStores.set(options.key, store);
  }
  return store;
}

function patchCombine(store: CombineStore, changes: Partial<CombineState>): void {
  store.state = { ...store.state, ...changes };
  for (const listener of store.listeners) listener();
}

/** The outputs released and forgotten: the list they described has changed. */
function withoutOutputs(store: CombineStore): Partial<CombineState> {
  for (const output of store.state.outputs) URL.revokeObjectURL(output.url);
  return { outputs: [], status: "idle", error: null, notes: [], phase: "", ratio: null };
}

export function useCombineQueue<S>(options: CombineOptions<S>) {
  const store = getCombineStore(options as CombineOptions<unknown>);
  store.options = options as CombineOptions<unknown>;

  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [store],
  );
  const snapshot = useCallback(() => store.state, [store]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  const addFiles = useCallback(
    (files: File[]) => {
      const { reject, inspect } = store.options;
      const added: CombineFile[] = files.map((file) => {
        const rejection = reject?.(file) ?? null;
        return {
          id: nextId("file"),
          file,
          status: rejection ? "error" : inspect ? "reading" : "ready",
          facts: [],
          error: rejection ? { ...rejection, retryable: false } : undefined,
        };
      });
      patchCombine(store, { ...withoutOutputs(store), files: [...store.state.files, ...added] });
      if (!inspect) return;
      for (const entry of added) {
        if (entry.status !== "reading") continue;
        void inspect(entry.file)
          .then((inspection) => {
            if (!store.state.files.some((candidate) => candidate.id === entry.id)) {
              if (inspection.previewUrl) URL.revokeObjectURL(inspection.previewUrl);
              return;
            }
            patchCombine(store, {
              files: store.state.files.map((candidate) =>
                candidate.id === entry.id ? { ...candidate, status: "ready", facts: inspection.facts, previewUrl: inspection.previewUrl } : candidate,
              ),
            });
          })
          .catch((error: unknown) => {
            patchCombine(store, {
              files: store.state.files.map((candidate) =>
                candidate.id === entry.id ? { ...candidate, status: "error", error: toPlainFailure(error) } : candidate,
              ),
            });
          });
      }
    },
    [store],
  );

  const removeFile = useCallback(
    (id: string) => {
      const entry = store.state.files.find((candidate) => candidate.id === id);
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      patchCombine(store, { ...withoutOutputs(store), files: store.state.files.filter((candidate) => candidate.id !== id) });
    },
    [store],
  );

  const moveFile = useCallback(
    (id: string, direction: -1 | 1) => {
      const files = [...store.state.files];
      const index = files.findIndex((candidate) => candidate.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= files.length) return;
      [files[index], files[target]] = [files[target], files[index]];
      patchCombine(store, { ...withoutOutputs(store), files });
    },
    [store],
  );

  const clear = useCallback(() => {
    store.active?.abort();
    store.active = null;
    for (const entry of store.state.files) if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    patchCombine(store, { ...withoutOutputs(store), files: [] });
  }, [store]);

  const run = useCallback(async () => {
    if (store.state.status === "working") return;
    const ready = store.state.files.filter((entry) => entry.status === "ready");
    const controller = new AbortController();
    store.active = controller;
    patchCombine(store, { ...withoutOutputs(store), status: "working", phase: "Working..." });
    try {
      const result = await store.options.run(
        ready.map((entry) => entry.file),
        store.options.settings,
        (phase, ratio) => {
          if (!controller.signal.aborted) patchCombine(store, { phase, ratio });
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.nothing) {
        patchCombine(store, { status: "error", phase: "Nothing to do", ratio: null, error: { message: result.nothing.message, hint: result.nothing.hint, retryable: false } });
      } else {
        patchCombine(store, { status: "done", phase: "Done", ratio: 1, outputs: materializeOutputs(result.outputs), notes: result.notes ?? [] });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      patchCombine(store, { status: "error", phase: "Failed", ratio: null, error: toPlainFailure(error) });
    } finally {
      if (store.active === controller) store.active = null;
    }
  }, [store]);

  const cancel = useCallback(() => {
    store.active?.abort();
    store.active = null;
    patchCombine(store, { status: "idle", phase: "", ratio: null });
  }, [store]);

  return { ...state, addFiles, removeFile, moveFile, clear, run, cancel };
}
