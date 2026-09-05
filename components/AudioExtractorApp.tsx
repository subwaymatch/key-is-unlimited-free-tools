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
import styles from "./AudioExtractorApp.module.css";

/** Files this large rely on the WORKERFS mount path rather than an in-memory copy. */
const LARGE_FILE_BYTES = 2 * 1024 ** 3;

/**
 * One band of the page: a numbered label in the left column, content in the
 * right. The label column is what separates the bands — no card, no fill, just
 * the shared axis and a hairline above.
 */
function Band({
  index,
  title,
  children,
  ...rest
}: {
  index: string;
  title: string;
  children: React.ReactNode;
} & React.ComponentPropsWithoutRef<"section">) {
  return (
    <section className={styles.band} {...rest}>
      <h2 className={styles.bandLabel}>
        <span className={styles.bandIndex}>{index}</span>
        {title}
      </h2>
      <div className={styles.bandBody}>{children}</div>
    </section>
  );
}

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
      <header className={styles.masthead}>
        <p className={styles.wordmark}>
          key.is
          <span className={styles.wordmarkNote}>Unlimited free tools</span>
        </p>
        <h1 className={styles.title}>
          Extract audio
          <br />
          from video
        </h1>
        <p className={styles.tagline}>
          Drop one or more videos and the audio comes out the other side — whole, clipped to a
          range, or trimmed of its silence.
        </p>

        <dl className={styles.spec}>
          <div className={styles.specItem}>
            <dt className={styles.specTerm}>Formats</dt>
            <dd className={styles.specValue}>MP3 · M4A · WAV · FLAC · Opus</dd>
          </div>
          <div className={styles.specItem}>
            <dt className={styles.specTerm}>Uploads</dt>
            <dd className={styles.specValue}>None — ffmpeg runs in your browser</dd>
          </div>
          <div className={styles.specItem}>
            <dt className={styles.specTerm}>Size limit</dt>
            <dd className={styles.specValue}>None to speak of</dd>
          </div>
        </dl>
      </header>

      <EngineBanner state={engineState} />

      <Band index="01" title="Source">
        <DropZone onFiles={handleFiles} compact={hasJobs} />
      </Band>

      <Band index="02" title="Output">
        <div className={styles.settings}>
          <button
            type="button"
            onClick={() => setShowSettings((previous) => !previous)}
            aria-expanded={showSettings}
            className={styles.settingsToggle}
          >
            <span className={styles.settingsTitle}>Formats &amp; trim</span>
            <span className={styles.settingsSummary}>
              {selectedFormats.length > 0
                ? selectedFormats.length === 1
                  ? "1 format"
                  : `${selectedFormats.length} formats`
                : "no format"}
              {trimSettings.mode === "silence" && " · trim silence"}
              {trimSettings.mode === "range" && " · clip a range"}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`${styles.chevron} ${showSettings ? styles.chevronOpen : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {showSettings && (
            <div className={styles.settingsBody}>
              <div className={styles.settingsSection}>
                <FormatPicker
                  selected={selectedFormats}
                  onChange={setSelectedFormats}
                  capabilities={engineState.capabilities}
                />
              </div>
              <div className={styles.settingsSection}>
                <TrimPicker settings={trimSettings} onChange={setTrimSettings} />
              </div>
            </div>
          )}
        </div>
      </Band>

      {hasJobs && (
        <Band index="03" title="Queue" aria-label="Conversion queue">
          <div className={styles.queueHeader}>
            <p className={styles.queueCount}>
              {jobs.length} {jobs.length === 1 ? "file" : "files"}
              {activeCount > 0 && (
                <span className={styles.queueRemaining} aria-live="polite">
                  {activeCount} remaining
                </span>
              )}
            </p>
            {finishedCount > 0 && (
              <button type="button" onClick={clearFinished} className={styles.clearButton}>
                Clear finished
              </button>
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
              {completedOutputs.length} files ready ·{" "}
              {formatBytes(
                completedOutputs.reduce((total, output) => total + (output.result?.bytes ?? 0), 0),
              )}{" "}
              total
            </p>
          )}
        </Band>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerRow}>
          <p className={styles.footerTerm}>Privacy</p>
          <p className={styles.footerValue}>
            Your videos never leave this device. Decoding happens locally with ffmpeg compiled to
            WebAssembly (@ffmpeg/ffmpeg {FFMPEG_VERSION}, core {CORE_VERSION}).
          </p>
        </div>
        <div className={styles.footerRow}>
          <p className={styles.footerTerm}>Large files</p>
          <p className={styles.footerValue}>
            Mounted and read on demand rather than loaded into memory, which is what allows videos
            well past the usual ~2 GB WebAssembly ceiling
            {largestFile > LARGE_FILE_BYTES && ` (largest so far: ${formatBytes(largestFile)})`}.
          </p>
        </div>
      </footer>
    </main>
  );
}
