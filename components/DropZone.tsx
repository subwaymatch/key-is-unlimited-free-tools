"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./DropZone.module.css";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  /** Rendered inside the zone; lets the page show queue state in the same space. */
  compact?: boolean;
}

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
export function DropZone({ onFiles, compact = false }: DropZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // dragenter/dragleave fire for every child element, so nesting is counted
  // rather than treating the first dragleave as "the pointer left".
  const dragDepth = useRef(0);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      onFiles(Array.from(fileList));
    },
    [onFiles],
  );

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
      className={`${styles.zone} ${compact ? styles.compact : ""} ${
        isDraggingOver ? styles.dragging : ""
      }`}
    >
      <input
        type="file"
        multiple
        aria-label="Choose video files"
        accept="video/*,audio/*,.mkv,.mov,.avi,.webm,.m4v,.ts,.mts,.m2ts,.flv,.wmv"
        className="visually-hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          // Allow re-selecting the same file after removing it from the queue.
          event.target.value = "";
        }}
      />

      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        className={styles.icon}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 16.5V9m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-.41-8.98 6 6 0 0 1 11.64-2.02A4.5 4.5 0 0 1 17.25 19.5H6.75Z"
        />
      </svg>

      <span>
        <span className={styles.headline}>
          {isDraggingOver ? "Drop to start converting" : "Drop video files here"}
        </span>
        <span className={styles.subhead}>
          Conversion starts automatically, multi-gigabyte files supported
        </span>
      </span>

      <span className={styles.button}>Choose files</span>

      <span className={styles.privacy}>
        Everything runs on your device - nothing is uploaded.
      </span>
    </label>
  );
}
