"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatTimecode } from "@/lib/engine/trim";

import styles from "./Waveform.module.css";

interface WaveformProps {
  /** One normalised peak per bucket, left to right across the whole file. */
  peaks: number[];
  durationSeconds: number;
  /** Current selection, in seconds. A null end means "to the end of the file". */
  startSeconds: number;
  endSeconds: number | null;
  /** Called while dragging and again on release, with the new range. */
  onSelect: (startSeconds: number, endSeconds: number | null) => void;
  disabled?: boolean;
}

/** Shortest selection a drag may produce, so a stray click cannot make one. */
const MIN_DRAG_SECONDS = 0.05;

/**
 * The audio envelope, with the clip range drawn over it.
 *
 * Drawn on a canvas rather than as elements: a file reduces to hundreds of
 * buckets, and that many DOM nodes re-laid-out on every drag frame is the one
 * thing guaranteed to make this feel slow.
 *
 * Dragging is an enhancement, not the interface. The panel's Start and End
 * fields remain the precise and keyboard-reachable way to set the same range,
 * which is why this carries a describing label rather than trying to be a
 * focusable control of its own.
 */
export function Waveform({
  peaks,
  durationSeconds,
  startSeconds,
  endSeconds,
  onSelect,
  disabled = false,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const end = endSeconds ?? durationSeconds;

  // Keep the backing store in step with the element's real size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || peaks.length === 0) return;

    const ratio = window.devicePixelRatio || 1;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    /*
     * Colours come from the same custom properties as everything else, read at
     * draw time, so the canvas follows the theme instead of hard-coding one.
     */
    const style = getComputedStyle(canvas);
    const selected = style.getPropertyValue("--foreground").trim() || "#0a0a0a";
    const muted = style.getPropertyValue("--border-strong").trim() || "#d4d4d4";

    const barWidth = Math.max(1, width / peaks.length);
    const gap = barWidth > 3 ? 1 : 0;
    const middle = height / 2;

    for (let i = 0; i < peaks.length; i += 1) {
      const x = (i / peaks.length) * width;
      const seconds = (i / peaks.length) * durationSeconds;
      const inRange = seconds >= startSeconds && seconds <= end;
      // A floor, so silence still reads as a bar rather than a gap in the line.
      const barHeight = Math.max(1, peaks[i] * (height - 2));

      context.fillStyle = inRange ? selected : muted;
      context.fillRect(x, middle - barHeight / 2, Math.max(1, barWidth - gap), barHeight);
    }

    // Marker rules, drawn last so they sit above the bars.
    context.fillStyle = selected;
    for (const seconds of [startSeconds, end]) {
      const x = Math.min(width - 2, (seconds / durationSeconds) * width);
      context.fillRect(x, 0, 2, height);
    }
  }, [peaks, width, durationSeconds, startSeconds, end]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw when the OS theme flips, since the colours are read at draw time.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => draw();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [draw]);

  const secondsAt = (event: React.PointerEvent<HTMLCanvasElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return fraction * durationSeconds;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || durationSeconds <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragFrom(secondsAt(event));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragFrom === null) return;
    const to = secondsAt(event);
    onSelect(Math.min(dragFrom, to), Math.max(dragFrom, to));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragFrom === null) return;
    const to = secondsAt(event);
    const from = dragFrom;
    setDragFrom(null);
    /*
     * A click is not a selection. Without this a mis-aimed tap would collapse
     * the range to a single instant and silently produce an empty clip.
     */
    if (Math.abs(to - from) < MIN_DRAG_SECONDS) return;
    onSelect(Math.min(from, to), Math.max(from, to));
  };

  const label =
    endSeconds === null && startSeconds === 0
      ? `Audio waveform, whole file selected, ${formatTimecode(durationSeconds)} long`
      : `Audio waveform, ${formatTimecode(startSeconds)} to ${formatTimecode(end)} selected`;

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={`${styles.canvas} ${disabled ? styles.disabled : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDragFrom(null)}
    />
  );
}
