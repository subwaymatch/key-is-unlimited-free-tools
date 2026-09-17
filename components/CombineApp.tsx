"use client";

import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { formatBytes } from "@/lib/format-utils";
import { useCombineQueue, type CombineFile, type CombineOptions } from "@/lib/plainQueue";
import type { ToolMeta } from "@/lib/tools";

import { DropZone } from "./DropZone";
import { OutputRow, PlainFootnote, type PlainSettings } from "./PlainToolApp";
import { ProgressBar } from "./ProgressBar";
import { ToolFrame } from "./ToolFrame";
import type { ToolDropZone } from "./ToolApp";
import { Button } from "./ui/Button";
import plainStyles from "./PlainToolApp.module.css";
import styles from "./CombineApp.module.css";
import toolStyles from "./ToolApp.module.css";

interface CombineAppProps<S> {
  tool: ToolMeta;
  lead: ReactNode;
  queue: CombineOptions<S>;
  settings?: PlainSettings;
  dropZone?: ToolDropZone;
  note?: ReactNode;
  /** The button: "Merge PDFs", "Create ZIP". */
  action: string;
  /** How many ready files the button needs. Defaults to 1. */
  minFiles?: number;
  /** One line about the list as it stands: "3 PDFs, 27 pages". */
  summary?: (files: CombineFile[]) => string | null;
  /** Word for the files in the list header: "PDFs", "pictures". */
  noun?: string;
  /** Word for what the run is doing: "Merging". */
  busyLabel?: string;
}

function FileRow({ entry, index, count, disabled, onMove, onRemove }: { entry: CombineFile; index: number; count: number; disabled: boolean; onMove: (direction: -1 | 1) => void; onRemove: () => void }) {
  const meta = [formatBytes(entry.file.size), ...entry.facts];
  if (entry.status === "reading") meta.push("Reading...");
  return (
    <li className={styles.file}>
      <span className={styles.index} aria-label={`File ${index + 1}`}>
        {index + 1}
      </span>
      {entry.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.previewUrl} alt="" className={styles.thumb} />
      ) : null}
      <div className={styles.identity}>
        <p className={styles.fileName} title={entry.file.name}>
          {entry.file.name}
        </p>
        <p className={styles.meta}>{meta.join(", ")}</p>
        {entry.status === "error" && entry.error && (
          <p className={styles.problem}>
            {entry.error.message}
            {entry.error.hint && <span className={styles.hint}> {entry.error.hint}</span>}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label={`Move ${entry.file.name} up`} title="Earlier">
          <ArrowUp aria-hidden="true" size={13} strokeWidth={2} />
        </Button>
        <Button onClick={() => onMove(1)} disabled={disabled || index === count - 1} aria-label={`Move ${entry.file.name} down`} title="Later">
          <ArrowDown aria-hidden="true" size={13} strokeWidth={2} />
        </Button>
        <Button onClick={onRemove} disabled={disabled} aria-label={`Remove ${entry.file.name}`} variant="ghost">
          <X aria-hidden="true" size={13} strokeWidth={2} />
          Remove
        </Button>
      </div>
    </li>
  );
}

/**
 * The page for a tool that takes several files and makes one thing of
 * them: a list to order, a button, one result.
 */
export function CombineApp<S>({ tool, lead, queue: options, settings, dropZone, note, action, minFiles = 1, summary, noun = "files", busyLabel = "Working" }: CombineAppProps<S>) {
  const queue = useCombineQueue(options);
  const { files, status, phase, ratio, outputs, notes, error, addFiles, removeFile, moveFile, clear, run, cancel } = queue;
  const [showSettings, setShowSettings] = useState(settings?.defaultOpen ?? false);
  const invalid = settings?.invalid?.() ?? null;

  const handleFiles = useCallback(
    (added: File[]) => {
      addFiles(added);
      setShowSettings(false);
    },
    [addFiles],
  );

  const busy = status === "working";
  const ready = files.filter((entry) => entry.status === "ready");
  const reading = files.filter((entry) => entry.status === "reading").length;
  const canRun = !busy && invalid === null && ready.length >= minFiles && reading === 0;
  const line = summary ? summary(ready) : null;

  return (
    <ToolFrame tool={tool} lead={lead} footer={<PlainFootnote note={note} />}>
      <DropZone onFiles={handleFiles} compact={files.length > 0} disabled={invalid !== null} {...dropZone} />

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

      {files.length > 0 && (
        <section aria-label={`${noun} to combine`}>
          <div className={toolStyles.queueHeader}>
            <h2 className={toolStyles.queueCount}>
              {files.length} {files.length === 1 ? noun.replace(/s$/, "") : noun}
              {reading > 0 && (
                <span className={toolStyles.queueRemaining} aria-live="polite">
                  {reading} being read
                </span>
              )}
            </h2>
            <Button onClick={clear} disabled={busy} variant="ghost">
              Clear all
            </Button>
          </div>

          <ol className={styles.files}>
            {files.map((entry, index) => (
              <FileRow key={entry.id} entry={entry} index={index} count={files.length} disabled={busy} onMove={(direction) => moveFile(entry.id, direction)} onRemove={() => removeFile(entry.id)} />
            ))}
          </ol>

          {line && <p className={styles.summary}>{line}</p>}
          {ready.length < minFiles && ready.length > 0 && reading === 0 && (
            <p className={styles.summary}>Add at least {minFiles - ready.length} more to go on.</p>
          )}

          <div className={styles.actionRow}>
            {busy ? (
              <>
                <div className={styles.progress}>
                  <p className={styles.phase} aria-live="polite">
                    {phase}
                  </p>
                  <ProgressBar ratio={ratio} label={busyLabel} />
                </div>
                <Button onClick={cancel} variant="ghost">
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={() => void run()} disabled={!canRun} variant="primary" size="md">
                {action}
              </Button>
            )}
          </div>

          {status === "error" && error && (
            <div role="alert" className={styles.alert}>
              <p className={styles.alertMessage}>{error.message}</p>
              {error.hint && <p className={styles.alertHint}>{error.hint}</p>}
            </div>
          )}

          {notes.map((entry) => (
            <p key={entry} className={styles.note}>
              {entry}
            </p>
          ))}

          {outputs.length > 0 && (
            <ul className={`${plainStyles.outputs} ${styles.outputs}`}>
              {outputs.map((output) => (
                <OutputRow key={output.id} output={output} />
              ))}
            </ul>
          )}
        </section>
      )}
    </ToolFrame>
  );
}
