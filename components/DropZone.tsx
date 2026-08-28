"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 */
export function DropZone({ onFiles, compact = false }: DropZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
    <div
      className={`relative rounded-2xl border-2 border-dashed text-center transition-colors ${
        isDraggingOver
          ? "border-accent bg-accent-soft"
          : "border-border-strong bg-surface hover:border-accent"
      } ${compact ? "px-6 py-8" : "px-6 py-16"}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.mkv,.mov,.avi,.webm,.m4v,.ts,.mts,.m2ts,.flv,.wmv"
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          // Allow re-selecting the same file after removing it from the queue.
          event.target.value = "";
        }}
      />

      <div className="flex flex-col items-center gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={1.5}
          stroke="currentColor"
          className={`${compact ? "size-8" : "size-12"} text-subtle`}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16.5V9m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-.41-8.98 6 6 0 0 1 11.64-2.02A4.5 4.5 0 0 1 17.25 19.5H6.75Z"
          />
        </svg>

        <div>
          <p className={`font-medium ${compact ? "text-base" : "text-lg"}`}>
            {isDraggingOver ? "Drop to start converting" : "Drop video files here"}
          </p>
          <p className="mt-1 text-sm text-muted">
            Conversion starts automatically · multi-gigabyte files supported
          </p>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Choose files
        </button>

        <p className="text-xs text-subtle">
          Everything runs on your device — nothing is uploaded.
        </p>
      </div>
    </div>
  );
}
