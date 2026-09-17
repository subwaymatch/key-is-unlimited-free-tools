"use client";

import { ChevronDown, DownloadCloud } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { Button } from "./ui/Button";
import { archiveName, downloadAllAsZip } from "@/lib/download";
import { formatBytes } from "@/lib/format-utils";
import type { ToolFeatures } from "@/lib/toolFeatures";
import type { ToolMeta } from "@/lib/tools";
import { useConversionQueue, type QueueOptions } from "@/lib/useConversionQueue";

import { DropZone } from "./DropZone";
import { EngineBanner } from "./EngineBanner";
import { FileCard } from "./FileCard";
import { EngineFootnote, ToolFrame } from "./ToolFrame";
import settingsStyles from "./Settings.module.css";
import styles from "./ToolApp.module.css";

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
  /**
   * What the "remove metadata" switch means on this tool, in place of the
   * usual paragraph, for the one tool where it means something else.
   */
  metadataIntro?: string;
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
  metadataIntro,
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
   * Saves every finished output, one click and one file.
   *
   * A ZIP written by the same streaming writer the Create ZIP tool uses. The
   * alternative - a burst of synthetic anchor clicks - makes Chrome ask
   * whether this site may save several files at once, and leaves however
   * many loose in the downloads folder when it says yes. Packing a handful
   * of finished videos takes a moment, so the button says what it is doing;
   * an archive too large for classic ZIP falls back to the old burst.
   */
  const [packing, setPacking] = useState(false);
  const downloadAll = useCallback(() => {
    setPacking(true);
    void downloadAllAsZip(
      completedOutputs.map((output) => ({
        fileName: output.result?.fileName ?? "download",
        blob: output.result!.blob,
        url: output.url,
      })),
      archiveName(tool.slug),
    ).finally(() => setPacking(false));
  }, [completedOutputs, tool.slug]);

  return (
    <ToolFrame
      tool={tool}
      lead={lead}
      footer={<EngineFootnote note={note} largestFile={largestFile} />}
    >
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
                    {metadataIntro ??
                      "On by default. A clip from a phone carries the time it was taken, the model of the phone and the GPS fix of where you were standing, and none of that has any business riding along into a file you are about to send to someone."}
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
              <Button onClick={downloadAll} disabled={packing}>
                <DownloadCloud aria-hidden="true" size={14} strokeWidth={2} />
                {packing ? "Packing..." : "Download all as a ZIP"}
              </Button>
            </div>
          )}
        </section>
      )}
    </ToolFrame>
  );
}
