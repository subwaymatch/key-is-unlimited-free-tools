"use client";

import { CloudUpload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { VIDEO_ACCEPT } from "@/lib/mediaTypes";

import styles from "./DropZone.module.css";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  /** Rendered inside the zone; lets the page show queue state in the same space. */
  compact?: boolean;
  /** The file input's accept list. */
  accept?: string;
  /** Accessible name of the file input. */
  inputLabel?: string;
  headline?: string;
  /** Shown under the headline; what happens once a file lands. */
  subhead?: string;
  /** Refuses files while the tool's settings cannot start a job. */
  disabled?: boolean;
}

/** How long a pointer has to rest on the zone before the core is prefetched. */
const WARM_UP_DWELL_MS = 400;

/**
 * Drag-and-drop target that also accepts drops anywhere on the page.
 *
 * Dropping onto a small rectangle is a needless aim test when the whole window
 * is available, but the visible zone stays as the affordance and the
 * click-to-browse fallback.
 *
 * The zone is a `<label>` wrapping the file input, so the entire box opens the
 * picker rather than only the button inside it - that is the browser's own
 * behaviour, with no click forwarding to keep in sync. It also means the input
 * stays a real focusable control: tabbing to it rings the whole box through
 * `focus-within`, and Space opens the picker. Everything else inside is
 * therefore markup a label may legally contain, which is why the text is in
 * spans rather than paragraphs, and why the button is a span - a real button
 * would swallow the click instead of activating the input.
 */
export function DropZone({
  onFiles,
  compact = false,
  accept = VIDEO_ACCEPT,
  inputLabel = "Choose video files",
  headline = "Drop video files here",
  subhead = "Conversion starts automatically, multi-gigabyte files supported",
  disabled = false,
}: DropZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // dragenter/dragleave fire for every child element, so nesting is counted
  // rather than treating the first dragleave as "the pointer left".
  const dragDepth = useRef(0);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (disabledRef.current || !fileList || fileList.length === 0) return;
      onFiles(Array.from(fileList));
    },
    [onFiles],
  );

  /**
   * Starts the ~31 MB core download before it is needed.
   *
   * Reaching for the drop zone is as good a signal as there is that a file is
   * about to arrive, and the download is the longest part of a first
   * conversion by some margin. Idempotent, cached after the first call, and
   * its failures are the next real job's problem rather than a pointer's.
   *
   * The dwell matters: this zone is most of the page on a tool page, so a
   * pointer merely crossing it is not a decision, and spending 31 MB of
   * somebody's data plan on one would be rude. Focus needs no dwell - reaching
   * the file input with the keyboard is already deliberate.
   */
  const start = useCallback(() => {
    if (disabledRef.current) return;
    void import("@/lib/engine/coreLoader")
      .then((module) => module.loadCoreUrls())
      .catch(() => {});
  }, []);

  const warmUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelWarmUp = useCallback(() => {
    if (warmUpTimer.current !== null) clearTimeout(warmUpTimer.current);
    warmUpTimer.current = null;
  }, []);
  const warmUpAfterDwell = useCallback(() => {
    cancelWarmUp();
    warmUpTimer.current = setTimeout(start, WARM_UP_DWELL_MS);
  }, [cancelWarmUp, start]);

  useEffect(() => cancelWarmUp, [cancelWarmUp]);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current += 1;
      setIsDraggingOver(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      // Without this the browser navigates to the dropped file.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDraggingOver(false);
    };

    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current = 0;
      setIsDraggingOver(false);
      handleFiles(event.dataTransfer.files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  return (
    <label
      onPointerEnter={warmUpAfterDwell}
      onPointerLeave={cancelWarmUp}
      onFocus={start}
      className={`${styles.zone} ${compact ? styles.compact : ""} ${
        isDraggingOver ? styles.dragging : ""
      } ${disabled ? styles.disabled : ""}`}
    >
      <input
        type="file"
        multiple
        aria-label={inputLabel}
        accept={accept}
        disabled={disabled}
        className="visually-hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          // Allow re-selecting the same file after removing it from the queue.
          event.target.value = "";
        }}
      />

      <CloudUpload aria-hidden="true" className={styles.icon} size={32} strokeWidth={1.25} />

      <span>
        <span className={styles.headline}>
          {isDraggingOver ? "Drop to add the files" : headline}
        </span>
        <span className={styles.subhead}>{subhead}</span>
      </span>

      <span className={styles.button}>Choose files</span>

      <span className={styles.privacy}>
        Everything runs on your device - nothing is uploaded.
      </span>
    </label>
  );
}
