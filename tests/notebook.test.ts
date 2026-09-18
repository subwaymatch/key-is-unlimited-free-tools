import { describe, expect, it } from "vitest";

import { cleanNotebook, DEFAULT_NOTEBOOK_OPTIONS, readNotebook, writeNotebook } from "@/lib/data/notebook";

const NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3" }, language_info: { name: "python" }, widgets: { state: {} } },
  cells: [
    { cell_type: "markdown", id: "a", metadata: {}, source: ["# Title"] },
    {
      cell_type: "code",
      id: "b",
      execution_count: 7,
      metadata: { collapsed: true, tags: ["keep"], execution: { iopub: "..." } },
      outputs: [{ output_type: "stream", text: ["hi\n"] }, { output_type: "display_data", data: { "image/png": "AAAA" } }],
      source: ["print('hi')"],
    },
    { cell_type: "code", id: "c", execution_count: null, metadata: {}, outputs: [], source: [] },
  ],
};

describe("cleaning a notebook", () => {
  it("empties outputs, resets counts and drops scratch metadata, keeping what matters", () => {
    const result = cleanNotebook(JSON.stringify(NOTEBOOK), DEFAULT_NOTEBOOK_OPTIONS);
    expect(result).toMatchObject({ cells: 3, codeCells: 2, outputsRemoved: 2, countsReset: 1, metadataRemoved: 3 });
    const cleaned = JSON.parse(result.text!);
    expect(cleaned.cells[1].outputs).toEqual([]);
    expect(cleaned.cells[1].execution_count).toBeNull();
    expect(cleaned.cells[1].metadata).toEqual({ tags: ["keep"] });
    expect(cleaned.metadata).toEqual({ kernelspec: { name: "python3" }, language_info: { name: "python" } });
    expect(result.text!.endsWith("\n")).toBe(true);
    // Written like nbformat: one-space indent, keys in order.
    expect(result.text!.startsWith('{\n "cells": [')).toBe(true);
  });

  it("does only what was asked", () => {
    const result = cleanNotebook(JSON.stringify(NOTEBOOK), { outputs: true, counts: false, cellMetadata: false });
    expect(result).toMatchObject({ outputsRemoved: 2, countsReset: 0, metadataRemoved: 0 });
    const cleaned = JSON.parse(result.text!);
    expect(cleaned.cells[1].execution_count).toBe(7);
    expect(cleaned.cells[1].metadata.collapsed).toBe(true);
  });

  it("reports a notebook that is already clean", () => {
    const clean = cleanNotebook(JSON.stringify(NOTEBOOK), DEFAULT_NOTEBOOK_OPTIONS).text!;
    expect(cleanNotebook(clean, DEFAULT_NOTEBOOK_OPTIONS).text).toBeNull();
  });

  it("refuses what is not a version 4 notebook, with the reason", () => {
    expect(() => readNotebook("not json")).toThrow(/not valid JSON/);
    expect(() => readNotebook("[1]")).toThrow(/not a notebook/);
    expect(() => readNotebook('{"a":1}')).toThrow(/not a notebook/);
    try {
      readNotebook('{"a":1}');
    } catch (error) {
      expect((error as { hint?: string }).hint).toMatch(/no "cells" list/);
    }
    expect(() => readNotebook('{"nbformat":3,"worksheets":[]}')).toThrow(/version 3/);
    expect(writeNotebook({ b: 1, a: 2 })).toBe('{\n "a": 2,\n "b": 1\n}\n');
  });
});
