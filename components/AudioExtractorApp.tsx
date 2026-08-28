"use client";

import { useCallback, useState } from "react";

import { CORE_VERSION, FFMPEG_VERSION } from "@/lib/engine/constants";
import { formatBytes } from "@/lib/format-utils";
import { useConversionQueue } from "@/lib/useConversionQueue";

import { DropZone } from "./DropZone";
import { EngineBanner } from "./EngineBanner";
import { FileCard } from "./FileCard";
import { FormatPicker } from "./FormatPicker";
import { TrimPicker } from "./TrimPicker";

/** Files this large rely on the WORKERFS mount path rather than an in-memory copy. */
const LARGE_FILE_BYTES = 2 * 1024 ** 3;

export function AudioExtractorApp() {
  const {
    jobs,
    engineState,
    selectedFormats,
    setSelectedFormats,
    trimSettings,
    setTrimSettings,
    addFiles,
    addFormatToJob,
    detectSilence,
    cancelJob,
    removeJob,
    retryJob,
    clearFinished,
    activeCount,
  } = useConversionQueue();

  const [showSettings, setShowSettings] = useState(false);

  const handleFiles = useCallback(
    (files: File[]) => {
      addFiles(files);
      setShowSettings(false);
    },
    [addFiles],
  );

  const hasJobs = jobs.length > 0;
  const finishedCount = jobs.filter(
    (job) => job.status === "done" || job.status === "error" || job.status === "cancelled",
  ).length;
  const largestFile = jobs.reduce((max, job) => Math.max(max, job.file.size), 0);

  const completedOutputs = jobs.flatMap((job) =>
    job.outputs.filter((output) => output.status === "done" && output.url),
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Extract audio from video
        </h1>
        <p className="mt-2 text-muted">
          Drop one or more videos and the audio comes out the other side — MP3, M4A, WAV, FLAC or
          Opus, whole or clipped to a range. Everything runs in your browser through WebAssembly,
          so nothing is uploaded and there is no file size limit to speak of.
        </p>
      </header>

      <div className="space-y-4">
        <EngineBanner state={engineState} />

        <DropZone onFiles={handleFiles} compact={hasJobs} />

        <div className="rounded-xl border border-border-subtle bg-surface">
          <button
            type="button"
            onClick={() => setShowSettings((previous) => !previous)}
            aria-expanded={showSettings}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="text-sm font-medium">
              Output formats &amp; trim
              <span className="ml-2 font-normal text-muted">
                {selectedFormats.length > 0
                  ? selectedFormats.length === 1
                    ? "1 format"
                    : `${selectedFormats.length} formats`
                  : "no format"}
                {trimSettings.mode === "silence" && " · trim silence"}
                {trimSettings.mode === "range" && " · clip a range"}
              </span>
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`size-4 text-muted transition-transform ${showSettings ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {showSettings && (
            <div className="space-y-5 border-t border-border-subtle px-4 py-4">
              <FormatPicker
                selected={selectedFormats}
                onChange={setSelectedFormats}
                capabilities={engineState.capabilities}
              />
              <TrimPicker settings={trimSettings} onChange={setTrimSettings} />
            </div>
          )}
        </div>

        {hasJobs && (
          <section aria-label="Conversion queue">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">
                {jobs.length} {jobs.length === 1 ? "file" : "files"}
                {activeCount > 0 && (
                  <span className="ml-2 font-normal text-muted" aria-live="polite">
                    {activeCount} remaining
                  </span>
                )}
              </h2>
              {finishedCount > 0 && (
                <button
                  type="button"
                  onClick={clearFinished}
                  className="text-xs text-subtle underline-offset-2 hover:text-muted hover:underline"
                >
                  Clear finished
                </button>
              )}
            </div>

            <ul className="space-y-3">
              {jobs.map((job) => (
                <FileCard
                  key={job.id}
                  job={job}
                  capabilities={engineState.capabilities}
                  onCancel={cancelJob}
                  onRemove={removeJob}
                  onRetry={retryJob}
                  onAddFormat={addFormatToJob}
                  onDetectSilence={detectSilence}
                />
              ))}
            </ul>

            {completedOutputs.length > 1 && (
              <p className="mt-3 text-xs text-subtle">
                {completedOutputs.length} files ready ·{" "}
                {formatBytes(
                  completedOutputs.reduce((total, output) => total + (output.result?.bytes ?? 0), 0),
                )}{" "}
                total
              </p>
            )}
          </section>
        )}
      </div>

      <footer className="mt-12 space-y-2 border-t border-border-subtle pt-6 text-xs text-subtle">
        <p>
          Your videos never leave this device. Decoding happens locally with ffmpeg compiled to
          WebAssembly (@ffmpeg/ffmpeg {FFMPEG_VERSION}, core {CORE_VERSION}).
        </p>
        <p>
          Large files are mounted and read on demand rather than loaded into memory, which is what
          allows videos well past the usual ~2 GB WebAssembly ceiling
          {largestFile > LARGE_FILE_BYTES && ` (largest so far: ${formatBytes(largestFile)})`}.
        </p>
      </footer>
    </main>
  );
}
