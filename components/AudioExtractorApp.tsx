"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "./ui/Button";
import { useCallback, useState } from "react";

import { CORE_VERSION, FFMPEG_VERSION } from "@/lib/engine/constants";
import { formatBytes } from "@/lib/format-utils";
import { useConversionQueue } from "@/lib/useConversionQueue";

import { DropZone } from "./DropZone";
import { EngineBanner } from "./EngineBanner";
import { FileCard } from "./FileCard";
import { FormatPicker } from "./FormatPicker";
import { TrimPicker } from "./TrimPicker";
import styles from "./AudioExtractorApp.module.css";

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
    cancelOutput,
    retryOutput,
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
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Extract audio from video</h1>
        <p className={styles.tagline}>
          Drop one or more videos and the audio comes out the other side - MP3, M4A, WAV, FLAC or
          Opus, whole or clipped to a range. Everything runs in your browser through WebAssembly,
          so nothing is uploaded and there is no file size limit to speak of.
        </p>
      </header>

      <div className={styles.stack}>
        <EngineBanner state={engineState} />

        <DropZone onFiles={handleFiles} compact={hasJobs} />

        <div className={styles.settings}>
          <button
            type="button"
            onClick={() => setShowSettings((previous) => !previous)}
            aria-expanded={showSettings}
            className={styles.settingsToggle}
          >
            <span className={styles.settingsTitle}>
              Output formats &amp; trim
              <span className={styles.settingsSummary}>
                {selectedFormats.length > 0
                  ? selectedFormats.length === 1
                    ? "1 format"
                    : `${selectedFormats.length} formats`
                  : "no format"}
                {trimSettings.mode === "silence" && " - trim silence"}
                {trimSettings.mode === "range" && " - clip a range"}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              size={18}
              className={`${styles.chevron} ${showSettings ? styles.chevronOpen : ""}`}
            />
          </button>
          {showSettings && (
            <div className={styles.settingsBody}>
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
            <div className={styles.queueHeader}>
              <h2 className={styles.queueCount}>
                {jobs.length} {jobs.length === 1 ? "file" : "files"}
                {activeCount > 0 && (
                  <span className={styles.queueRemaining} aria-live="polite">
                    {activeCount} remaining
                  </span>
                )}
              </h2>
              {finishedCount > 0 && (
                <Button onClick={clearFinished} variant="ghost">
                  Clear finished
                </Button>
              )}
            </div>

            <ul className={styles.jobs}>
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
                  onCancelOutput={cancelOutput}
                  onRetryOutput={retryOutput}
                />
              ))}
            </ul>

            {completedOutputs.length > 1 && (
              <p className={styles.total}>
                {completedOutputs.length} files ready -{" "}
                {formatBytes(
                  completedOutputs.reduce((total, output) => total + (output.result?.bytes ?? 0), 0),
                )}{" "}
                total
              </p>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
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
