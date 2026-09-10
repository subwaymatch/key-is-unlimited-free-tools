"use client";

/**
 * Remembering a tool's settings between visits.
 *
 * Deliberately small: `localStorage`, one key per setting, and a validator the
 * caller supplies. Anything that fails to parse or fails validation is
 * discarded rather than repaired, because a stored value from an older build
 * is not worth a migration and a wrong one is worse than a default.
 *
 * Reads never happen during render. A static export prerenders the page at
 * build time, so a first render that took the stored value would disagree with
 * the HTML the browser already has and React would throw the whole tree away.
 * `useStoredSettings` applies stored values in an effect instead, which costs
 * one extra render and no correctness.
 */
import { useEffect, useRef } from "react";

const PREFIX = "key.is";

export function storageKey(...parts: string[]): string {
  return [PREFIX, ...parts].join(":");
}

/** Reads and validates a stored value, or null when there is not a usable one. */
export function readStored<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    // Private mode, a quota-exhausted profile, or something that is not JSON.
    return null;
  }
}

export function writeStored(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked outright; remembering is a convenience.
  }
}

/**
 * Applies a stored value once on mount, then writes every later change back.
 *
 * `apply` is called at most once per mount and only when something valid was
 * stored, so a component's own defaults stand until then.
 */
export function useStoredSettings<T>(
  key: string,
  value: T,
  apply: (stored: T) => void,
  isValid: (value: unknown) => value is T,
): void {
  const applied = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const stored = readStored(key, isValid);
    if (stored !== null) applyRef.current(stored);
    // `isValid` is a module-level predicate in every caller; `key` is a constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    // Nothing is written before the stored value has had its chance, or the
    // defaults this render started with would overwrite it.
    if (!applied.current) return;
    writeStored(key, value);
  }, [key, value]);
}
