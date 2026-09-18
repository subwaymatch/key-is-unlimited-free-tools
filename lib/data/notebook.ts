/**
 * Jupyter notebooks with their outputs, counts and scratch metadata taken
 * out.
 *
 * A notebook is JSON: a list of cells, each with its source and, for a code
 * cell, its outputs and the number of the run that made them, plus metadata
 * at both levels that the front end uses for its own state. Committing one
 * to a repository commits every plot as a base64 PNG and every execution
 * count, so a one-line change is a thousand-line diff; this is what
 * `nbstripout` does, written to run in a browser.
 *
 * Pure: JSON text in, JSON text out, and the counts of what changed.
 */
import { sortKeysDeep, stripBom } from "./json";

export interface NotebookCleanOptions {
  /** Empty every code cell's outputs. */
  outputs: boolean;
  /** Set every execution count to null. */
  counts: boolean;
  /** Drop the cell metadata front ends write for themselves: timings, collapsed state, widget state. */
  cellMetadata: boolean;
}

export const DEFAULT_NOTEBOOK_OPTIONS: NotebookCleanOptions = { outputs: true, counts: true, cellMetadata: true };

/** Cell metadata keys that are state rather than meaning. Tags, slideshow settings and the like stay. */
export const SCRATCH_CELL_KEYS: readonly string[] = ["execution", "collapsed", "scrolled", "ExecuteTime", "executionInfo", "outputId", "jupyter", "pycharm", "vscode"];

/** Notebook metadata keys that are state rather than meaning. The kernel and language stay. */
export const SCRATCH_NOTEBOOK_KEYS: readonly string[] = ["widgets", "varInspector", "toc", "execution", "papermill", "colab", "accelerator", "gpuClass"];

export interface NotebookCleanResult {
  /** The notebook as JSON text, or null when nothing changed. */
  text: string | null;
  cells: number;
  codeCells: number;
  outputsRemoved: number;
  countsReset: number;
  metadataRemoved: number;
}

export class NotebookError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "NotebookError";
    this.hint = hint;
  }
}

interface Cell {
  cell_type?: unknown;
  outputs?: unknown;
  execution_count?: unknown;
  metadata?: unknown;
  [key: string]: unknown;
}

interface Notebook {
  cells?: unknown;
  nbformat?: unknown;
  worksheets?: unknown;
  metadata?: unknown;
  [key: string]: unknown;
}

/** The notebook read, or the reason it is not one. */
export function readNotebook(text: string): Notebook {
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch (error) {
    throw new NotebookError("This file is not valid JSON.", error instanceof Error ? error.message : undefined);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new NotebookError("This file is not a notebook.", "A notebook is a JSON object with a list of cells.");
  }
  const notebook = value as Notebook;
  if (notebook.nbformat === 3 || (Array.isArray(notebook.worksheets) && !Array.isArray(notebook.cells))) {
    throw new NotebookError("This notebook is in the old version 3 format.", "Open it in Jupyter and save it again, which rewrites it as version 4.");
  }
  if (!Array.isArray(notebook.cells)) {
    throw new NotebookError("This file is not a notebook.", 'It is JSON, but it has no "cells" list.');
  }
  return notebook;
}

/**
 * The notebook cleaned as asked, written the way Jupyter itself writes one:
 * one-space indentation, keys in order, a final newline.
 */
export function cleanNotebook(text: string, options: NotebookCleanOptions): NotebookCleanResult {
  const notebook = readNotebook(text);
  const cells = notebook.cells as unknown[];
  let outputsRemoved = 0;
  let countsReset = 0;
  let metadataRemoved = 0;
  let codeCells = 0;
  for (const entry of cells) {
    if (entry === null || typeof entry !== "object") continue;
    const cell = entry as Cell;
    if (cell.cell_type === "code") {
      codeCells += 1;
      if (options.outputs && Array.isArray(cell.outputs) && cell.outputs.length > 0) {
        outputsRemoved += cell.outputs.length;
        cell.outputs = [];
      }
      if (options.counts && cell.execution_count !== null && cell.execution_count !== undefined) {
        countsReset += 1;
        cell.execution_count = null;
      }
    }
    if (options.cellMetadata && cell.metadata !== null && typeof cell.metadata === "object") {
      const metadata = cell.metadata as Record<string, unknown>;
      for (const key of SCRATCH_CELL_KEYS) {
        if (key in metadata) {
          delete metadata[key];
          metadataRemoved += 1;
        }
      }
    }
  }
  if (options.cellMetadata && notebook.metadata !== null && typeof notebook.metadata === "object") {
    const metadata = notebook.metadata as Record<string, unknown>;
    for (const key of SCRATCH_NOTEBOOK_KEYS) {
      if (key in metadata) {
        delete metadata[key];
        metadataRemoved += 1;
      }
    }
  }
  const changed = outputsRemoved + countsReset + metadataRemoved > 0;
  return {
    text: changed ? writeNotebook(notebook) : null,
    cells: cells.length,
    codeCells,
    outputsRemoved,
    countsReset,
    metadataRemoved,
  };
}

/** JSON the way nbformat writes it: indented by one space, keys sorted, a newline at the end. */
export function writeNotebook(notebook: unknown): string {
  return `${JSON.stringify(sortKeysDeep(notebook), null, 1)}\n`;
}
