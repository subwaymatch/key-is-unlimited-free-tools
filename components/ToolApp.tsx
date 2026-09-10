"use client";

import { ChevronDown, DownloadCloud } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { Button } from "./ui/Button";
import { CORE_VERSION, FFMPEG_VERSION } from "@/lib/engine/constants";
import { formatBytes } from "@/lib/format-utils";
import type { ToolFeatures } from "@/lib/toolFeatures";
import type { ToolMeta } from "@/lib/tools";
import { useConversionQueue, type QueueOptions } from "@/lib/useConversionQueue";

import { DropZone } from "./DropZone";
import { EngineBanner } from "./EngineBanner";
import { FileCard } from "./FileCard";
import settingsStyles from "./Settings.module.css";
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
  /**
   * Open the panel on arrival.
   *
   * For the tool whose whole point is a number the visitor has to choose. The
   * compressor's target size lived behind a collapsed row below the fold,
   * which meant most people started a job at whatever the default happened to
   * be without ever seeing that there was a choice.
   */
  defaultOpen?: boolean;
  /**
   * Why the current settings cannot start a job, or null when they can.
   *
   * Shown in the panel and it disables the drop zone, so a half-typed custom
   * size cannot quietly run at the previous one.
   */
  invalid?: (queue: QueueApi) => string | null;
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
  /*
   * The queue's own state lives in a module-level store keyed by tool, so a
   * visit to another tool and a press of Back finds the files, the markers and
   * the finished outputs where they were left.
   */
  const options = useMemo<QueueOptions>(
    () => ({ ...queueOptions, key: queueOptions.key ?? tool.slug }),
    [queueOptions, tool.slug],
  );
  const queue = useConversionQueue(options);
  const {
    jobs,
    engineState,
    stripMetadata,
    setStripMetadata,
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

  const [showSettings, setShowSettings] = useState(settings?.defaultOpen ?? false);

  const invalid = settings?.invalid?.(queue) ?? null;

  /*
   * The metadata remover strips unconditionally - it is the whole tool - so
   * offering a checkbox that changes nothing would only be confusing.
   */
  const stripsMetadataAnyway = options.formats.every(
    (format) => format.alwaysStripsMetadata === true,
  );
  const metadataSummary = stripsMetadataAnyway
    ? "metadata removed"
    : stripMetadata
      ? "metadata removed"
      : "metadata kept";

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

  /**
   * Saves every finished output, one click instead of one per file.
   *
   * A plain sequence of synthetic anchor clicks rather than a zip: no library,
   * no second copy of every file in memory, and the browser's own downloads
   * list is where they were going anyway. Chrome asks once for permission to
   * save multiple files and remembers the answer; the small gap between clicks
   * is what keeps it from treating the burst as a popup.
   */
  const downloadAll = useCallback(() => {
    completedOutputs.forEach((output, index) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = output.url!;
        link.download = output.result?.fileName ?? "download";
        document.body.append(link);
        link.click();
        link.remove();
      }, index * 250);
    });
  }, [completedOutputs]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{tool.name}</h1>
        <p className={styles.tagline}>{lead}</p>
      </header>

      <div className={styles.stack}>
        <EngineBanner state={engineState} />

        <DropZone
          onFiles={handleFiles}
          compact={hasJobs}
          disabled={invalid !== null}
          {...dropZone}
        />

        {/*
         * Every tool has a panel, because every tool has at least the metadata
         * toggle to put in it - and a tool that stripped tags with no way to
         * say otherwise would be as surprising as one that kept them silently.
         * The exception is the metadata remover, which strips unconditionally
         * and would otherwise get a disclosure that opens onto nothing.
         */}
        {(settings || !stripsMetadataAnyway) && (
          <div className={styles.settings}>
            <button
              type="button"
              onClick={() => setShowSettings((previous) => !previous)}
              aria-expanded={showSettings}
              className={styles.settingsToggle}
            >
              <span className={styles.settingsTitle}>
                {settings?.title ?? "Output options"}
                <span className={styles.settingsSummary}>
                  {settings ? settings.summary(queue) : metadataSummary}
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
                {settings?.render(queue)}
                {!stripsMetadataAnyway && (
                  <fieldset className={settingsStyles.fieldset}>
                    <legend className={settingsStyles.legend}>Metadata</legend>
                    <p className={settingsStyles.intro}>
                      On by default. A clip from a phone carries the time it was taken, the model
                      of the phone and the GPS fix of where you were standing, and none of that
                      has any business riding along into a file you are about to send to someone.
                    </p>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={stripMetadata}
                        onChange={(event) => setStripMetadata(event.target.checked)}
                      />
                      <span>
                        <span className={styles.checkboxLabel}>
                          Remove titles, dates, location and chapters from the output
                        </span>
                        <span className={styles.checkboxBlurb}>
                          Turn this off to carry the source tags across, which is what you want
                          when the title and artist of a music file are the point.
                        </span>
                      </span>
                    </label>
                  </fieldset>
                )}
              </div>
            )}
            {invalid && (
              <p role="alert" className={styles.settingsError}>
                {invalid}
              </p>
            )}
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
                  formats={options.formats}
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
              <div className={styles.totalRow}>
                <p className={styles.total}>
                  {completedOutputs.length} files ready -{" "}
                  {formatBytes(
                    completedOutputs.reduce(
                      (total, output) => total + (output.result?.bytes ?? 0),
                      0,
                    ),
                  )}{" "}
                  total
                </p>
                <Button onClick={downloadAll}>
                  <DownloadCloud aria-hidden="true" size={14} strokeWidth={2} />
                  Download all
                </Button>
              </div>
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
