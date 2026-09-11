// @vitest-environment jsdom

/**
 * Remembering settings between visits.
 *
 * The interesting cases are the ones that must not throw: a value written by
 * an older build, a browser that refuses storage outright, and the first
 * render, which has to match the prerendered HTML rather than the stored value.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { readStored, storageKey, useStoredSettings, writeStored } from "@/lib/persist";

const isNumber = (value: unknown): value is number => typeof value === "number";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("storageKey", () => {
  it("namespaces every key under the site", () => {
    expect(storageKey("settings", "compress-video")).toBe("key.is:settings:compress-video");
  });
});

describe("readStored", () => {
  it("returns a stored value that passes its validator", () => {
    writeStored("k", 42);
    expect(readStored("k", isNumber)).toBe(42);
  });

  it("discards a value of the wrong shape rather than repairing it", () => {
    writeStored("k", { megabytes: 25 });
    expect(readStored("k", isNumber)).toBeNull();
  });

  it("survives text that is not JSON", () => {
    window.localStorage.setItem("k", "{not json");
    expect(readStored("k", isNumber)).toBeNull();
  });

  it("survives storage that throws, as a locked-down browser's does", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    expect(readStored("k", isNumber)).toBeNull();
  });

  it("does not fail a write when the quota is exhausted", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeStored("k", 1)).not.toThrow();
  });
});

describe("useStoredSettings", () => {
  function harness(key: string, initial: number) {
    return renderHook(() => {
      const [value, setValue] = useState(initial);
      useStoredSettings(key, value, setValue, isNumber);
      return { value, setValue };
    });
  }

  it("applies a stored value after mount, not during the first render", () => {
    writeStored("k", 7);
    const hook = harness("k", 1);
    // The first render has to agree with the prerendered HTML, so the stored
    // value lands in an effect and costs one extra render instead of a
    // hydration mismatch.
    expect(hook.result.current.value).toBe(7);
  });

  it("leaves the default alone when nothing usable is stored", () => {
    window.localStorage.setItem("k", '"not a number"');
    expect(harness("k", 1).result.current.value).toBe(1);
  });

  it("writes every later change back", () => {
    const hook = harness("k", 1);
    act(() => {
      hook.result.current.setValue(9);
    });
    expect(readStored("k", isNumber)).toBe(9);
  });
});
