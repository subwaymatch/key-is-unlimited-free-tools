"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { Button } from "./ui/Button";
import { CORE_VERSION, FFMPEG_VERSION } from "@/lib/engine/constants";
import { formatBytes } from "@/lib/format-utils";
import type { ToolFeatures } from "@/lib/toolFeatures";
import type { ToolMeta } from "@/lib/tools";
import { useConversionQueue, type QueueOptions } from "@/lib/useConversionQueue";

import { DropZone } from "./DropZone";
import { EngineBanner } from "./EngineBanner";
import { FileCard } from "./FileCard";
import styles from "./ToolApp.module.css";

/** Files this large rely on the WORKERFS mount path rather than an in-memory copy. */
const LARGE_FILE_BYTES = 2 * 1024 ** 3;

export type QueueApi = ReturnType<typeof useConversionQueue>;

export interface ToolSettings {
  /** Heading of the disclosure row. */
  title: string;
  /** One-line state shown beside the heading while the panel is closed. */
  summary: (queue: QueueApi) => string;
  render: (queue: QueueApi) => ReactNode;
}

export interface ToolDropZone {
  accept?: string;
  inputLabel?: string;
  headline?: string;
  subhead?: string;
}

interface ToolAppProps {
  tool: ToolMeta;
  /** The paragraph under the title: the tool's promise in its own terms. */
  lead: ReactNode;
  queue: QueueOptions;
  features: ToolFeatures;
  dropZone?: ToolDropZone;
  settings?: ToolSettings;
  /** A note for the footer, for anything this tool has to say about its limits. */
  note?: ReactNode;
}

/**
 * The page every tool is built from.
 *
 * A tool is a catalogue of formats, a set of card features and, optionally, a
 * settings panel. Everything else - the engine banner, the drop zone, the
 * queue, the cards, the footer - is the same machinery, so a new tool is a
 * registry entry, a catalogue and a page that renders this.
 */
export function ToolApp({
  tool,
  lead,
  queue: queueOptions,
  features,
  dropZone,
  settings,
  note,
}: ToolAppProps) {
  const queue = useConversionQueue(queueOptions);
  const {
    jobs,
    engineState,
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
  } = queue;

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
        <h1 className={styles.title}>{tool.name}</h1>
        <p className={styles.tagline}>{lead}</p>
      </header>

      <div className={styles.stack}>
        <EngineBanner state={engineState} />

        <DropZone onFiles={handleFiles} compact={hasJobs} {...dropZone} />

        {settings && (
          <div className={styles.settings}>
            <button
              type="button"
              onClick={() => setShowSettings((previous) => !previous)}
              aria-expanded={showSettings}
              className={styles.settingsToggle}
            >
              <span className={styles.settingsTitle}>
                {settings.title}
                <span className={styles.settingsSummary}>{settings.summary(queue)}</span>
              </span>
              <ChevronDown
                aria-hidden="true"
                size={18}
                className={`${styles.chevron} ${showSettings ? styles.chevronOpen : ""}`}
              />
            </button>
            {showSettings && <div className={styles.settingsBody}>{settings.render(queue)}</div>}
          </div>
        )}

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
                  formats={queueOptions.formats}
                  features={features}
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
        {note && <p>{note}</p>}
        <p>
          Your files never leave this device. Decoding happens locally with ffmpeg compiled to
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
