"use client";

import { ChevronDown, Copy, Download, DownloadCloud, RotateCcw, X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { formatBytes } from "@/lib/format-utils";
import { usePlainQueue, type PlainJob, type PlainOutput, type PlainQueueOptions } from "@/lib/plainQueue";
import type { ToolMeta } from "@/lib/tools";

import { DropZone } from "./DropZone";
import { ProgressBar } from "./ProgressBar";
import { ToolFrame } from "./ToolFrame";
import type { ToolDropZone } from "./ToolApp";
import { Button } from "./ui/Button";
import styles from "./PlainToolApp.module.css";
import toolStyles from "./ToolApp.module.css";

export interface PlainSettings {
  title: string;
  summary: () => string;
  render: () => ReactNode;
  /** Why the settings cannot start a job, or null when they can. Disables the drop zone. */
  invalid?: () => string | null;
  defaultOpen?: boolean;
}

interface PlainToolAppProps<S> {
  tool: ToolMeta;
  lead: ReactNode;
  queue: PlainQueueOptions<S>;
  settings?: PlainSettings;
  dropZone?: ToolDropZone;
  /** A note for the fine print, for anything this tool has to say about its limits. */
  note?: ReactNode;
  /** Word for what a running file is doing: "Converting". */
  busyLabel?: string;
}

/** The fine print every no-engine tool ends with. */
export function PlainFootnote({ note }: { note?: ReactNode }) {
  return (
    <>
      {note && <p>{note}</p>}
      <p>
        Your files never leave this device. This tool is plain JavaScript run by your browser: there is
        no server behind it and nothing is uploaded.
      </p>
    </>
  );
}

/** Saves several files, one click: a burst of anchor clicks the browser treats as one permission. */
export function downloadAll(outputs: readonly PlainOutput[]): void {
  outputs.forEach((output, index) => {
    window.setTimeout(() => {
      const link = document.createElement("a");
      link.href = output.url;
      link.download = output.fileName;
      document.body.append(link);
      link.click();
      link.remove();
    }, index * 250);
  });
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

/** One finished output: a picture, a document, a file or a line of text. */
export function OutputRow({ output }: { output: PlainOutput }) {
  const extension = output.fileName.split(".").pop() ?? "";
  return (
    <li className={styles.row}>
      <div className={styles.rowLabel}>
        <span className={styles.formatName}>{output.label}</span>
        {output.kind !== "text" && <span className={styles.tag}>.{extension}</span>}
      </div>
      <div className={styles.rowState}>
        {output.kind !== "text" && <span className={styles.rowMeta}>{formatBytes(output.bytes)}</span>}
        {output.kind === "text" && output.text && (
          <Button onClick={() => copyText(output.text!)} aria-label={`Copy ${output.label}`}>
            <Copy aria-hidden="true" size={14} strokeWidth={2} />
            Copy
          </Button>
        )}
        <a href={output.url} download={output.fileName} className={styles.download} aria-label={`Download ${output.fileName}`}>
          <Download aria-hidden="true" size={14} strokeWidth={2} />
          Download
        </a>
      </div>
      {output.kind === "text" && output.text && (
        <div className={styles.textOutput}>
          <code className={styles.textValue}>{output.text}</code>
        </div>
      )}
      {output.note && <p className={output.note.startsWith("Matches") ? styles.match : output.note.startsWith("Does not match") ? styles.mismatch : styles.rowNote}>{output.note}</p>}
      {output.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={output.url} alt="" className={styles.preview} />
      )}
    </li>
  );
}

function JobCard({ job, busyLabel, onRemove, onRetry }: { job: PlainJob; busyLabel: string; onRemove: () => void; onRetry: () => void }) {
  const status =
    job.status === "done" ? "Done" : job.status === "error" ? "Failed" : job.status === "nothing" ? "Nothing to do" : job.status === "working" ? busyLabel : "Waiting";
  const tone = job.status === "done" ? styles.statusDone : job.status === "error" ? styles.statusError : styles.statusIdle;
  const facts = job.facts.map((fact) => {
    const colon = fact.indexOf(": ");
    return colon > 0 ? { label: fact.slice(0, colon), value: fact.slice(colon + 2) } : { label: "", value: fact };
  });
  const plainFacts = facts.filter((fact) => fact.label === "").map((fact) => fact.value);
  const labelledFacts = facts.filter((fact) => fact.label !== "");

  return (
    <li className={styles.card}>
      <div className={styles.header}>
        <div className={styles.identity}>
          {job.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.previewUrl} alt="" className={styles.thumb} />
          )}
          <div className={styles.names}>
            <p className={styles.fileName} title={job.file.name}>
              {job.file.name}
            </p>
            <p className={styles.meta}>{[formatBytes(job.file.size), ...plainFacts].join(", ")}</p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.status} ${tone}`}>{status}</span>
          {job.status === "error" && job.error?.retryable && (
            <Button onClick={onRetry}>
              <RotateCcw aria-hidden="true" size={13} strokeWidth={2} />
              Retry
            </Button>
          )}
          <Button onClick={onRemove} aria-label={`Remove ${job.file.name}`} variant="ghost">
            <X aria-hidden="true" size={13} strokeWidth={2} />
            Remove
          </Button>
        </div>
      </div>

      {job.status === "working" && (
        <div className={styles.progress}>
          <p className={styles.phase} aria-live="polite">
            {job.phase}
          </p>
          <ProgressBar ratio={job.ratio} label={`${busyLabel} ${job.file.name}`} />
        </div>
      )}

      {(job.status === "error" || job.status === "nothing") && job.error && (
        <div role={job.status === "error" ? "alert" : "status"} className={`${styles.alert} ${job.status === "nothing" ? styles.alertInfo : ""}`}>
          <p className={styles.alertMessage}>{job.error.message}</p>
          {job.error.hint && <p className={styles.alertHint}>{job.error.hint}</p>}
        </div>
      )}

      {labelledFacts.length > 0 && (
        <dl className={styles.facts}>
          {labelledFacts.map((fact, index) => (
            <div key={index} style={{ display: "contents" }}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {job.notes.map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}

      {job.outputs.length > 0 && (
        <ul className={styles.outputs}>
          {job.outputs.map((output) => (
            <OutputRow key={output.id} output={output} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The page every no-engine tool is built from: a drop zone, a settings
 * panel, and a card per file with what came out of it.
 *
 * Everything a tool supplies is a function of one file and the settings;
 * the queue runs them one at a time and this shows the result.
 */
export function PlainToolApp<S>({ tool, lead, queue: options, settings, dropZone, note, busyLabel = "Working" }: PlainToolAppProps<S>) {
  const { jobs, addFiles, removeJob, retryJob, clearFinished, activeCount } = usePlainQueue(options);
  const [showSettings, setShowSettings] = useState(settings?.defaultOpen ?? false);
  const invalid = settings?.invalid?.() ?? null;

  const handleFiles = useCallback(
    (files: File[]) => {
      addFiles(files);
      setShowSettings(false);
    },
    [addFiles],
  );

  const finished = jobs.filter((job) => job.status !== "queued" && job.status !== "working").length;
  const completed = jobs.flatMap((job) => job.outputs.filter((output) => output.kind !== "text"));

  return (
    <ToolFrame tool={tool} lead={lead} footer={<PlainFootnote note={note} />}>
      <DropZone onFiles={handleFiles} compact={jobs.length > 0} disabled={invalid !== null} {...dropZone} />

      {settings && (
        <div className={toolStyles.settings}>
          <button type="button" onClick={() => setShowSettings((previous) => !previous)} aria-expanded={showSettings} className={toolStyles.settingsToggle}>
            <span className={toolStyles.settingsTitle}>
              {settings.title}
              <span className={toolStyles.settingsSummary}>{settings.summary()}</span>
            </span>
            <ChevronDown aria-hidden="true" size={18} className={`${toolStyles.chevron} ${showSettings ? toolStyles.chevronOpen : ""}`} />
          </button>
          {showSettings && <div className={toolStyles.settingsBody}>{settings.render()}</div>}
          {invalid && (
            <p role="alert" className={toolStyles.settingsError}>
              {invalid}
            </p>
          )}
        </div>
      )}

      {jobs.length > 0 && (
        <section aria-label="Files">
          <div className={toolStyles.queueHeader}>
            <h2 className={toolStyles.queueCount}>
              {jobs.length} {jobs.length === 1 ? "file" : "files"}
              {activeCount > 0 && (
                <span className={toolStyles.queueRemaining} aria-live="polite">
                  {activeCount} remaining
                </span>
              )}
            </h2>
            {finished > 0 && (
              <Button onClick={clearFinished} variant="ghost">
                Clear finished
              </Button>
            )}
          </div>
          <ul className={styles.cards}>
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} busyLabel={busyLabel} onRemove={() => removeJob(job.id)} onRetry={() => retryJob(job.id)} />
            ))}
          </ul>
          {completed.length > 1 && (
            <div className={toolStyles.totalRow}>
              <p className={toolStyles.total}>
                {completed.length} files ready - {formatBytes(completed.reduce((total, output) => total + output.bytes, 0))} total
              </p>
              <Button onClick={() => downloadAll(completed)}>
                <DownloadCloud aria-hidden="true" size={14} strokeWidth={2} />
                Download all
              </Button>
            </div>
          )}
        </section>
      )}
    </ToolFrame>
  );
}
