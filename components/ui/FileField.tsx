"use client";

import { Button } from "./Button";
import styles from "../Settings.module.css";

interface FileFieldProps {
  id: string;
  accept: string;
  /** What is chosen right now, for the label; null for nothing. */
  chosen: string | null;
  onChoose: (file: File) => void;
  onClear: () => void;
  error?: string | null;
  /** A line under the chooser about what the file will be used for. */
  note?: string;
}

/**
 * A file chooser inside a settings panel, for the tools that take a second
 * file alongside the ones in the queue.
 *
 * The same row the burn-in tool drew for its subtitle file, lifted out so
 * every panel that takes a file looks like that one.
 */
export function FileField({ id, accept, chosen, onChoose, onClear, error, note }: FileFieldProps) {
  return (
    <div className={styles.panel}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {chosen ?? "No file chosen"}
      </label>
      <div className={styles.fileRow}>
        <input
          id={id}
          type="file"
          accept={accept}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChoose(file);
            event.target.value = "";
          }}
          className={styles.fileInput}
        />
        {chosen && (
          <Button onClick={onClear} variant="ghost">
            Clear
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.warning}>
          {error}
        </p>
      )}
      {note && <p className={styles.panelNote}>{note}</p>}
    </div>
  );
}
