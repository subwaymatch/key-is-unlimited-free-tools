"use client";

import { useState } from "react";

import { CORE_LABEL } from "@/lib/engine/coreLoader";
import { formatBytes } from "@/lib/format-utils";
import type { EngineState } from "@/lib/useConversionQueue";

import { ProgressBar } from "./ProgressBar";
import styles from "./EngineBanner.module.css";

interface EngineBannerProps {
  state: EngineState;
}

/**
 * Surfaces the one-time ffmpeg core download.
 *
 * It is ~31 MB, so the first conversion would otherwise begin with a long,
 * unexplained pause. Once the engine is ready this collapses to nothing.
 */
export function EngineBanner({ state }: EngineBannerProps) {
  /*
   * A crashed engine is rebuilt automatically, and the file that crashed it
   * carries its own error on its own row. Without a word here, though, the
   * restart shows up as a second core load out of nowhere. So it gets one
   * line - shown only while there is nothing more urgent to say, and
   * dismissible, because it is history rather than a state of the page.
   */
  const [acknowledged, setAcknowledged] = useState(0);
  const restarted =
    state.restarts > acknowledged && (state.stage === "idle" || state.stage === "ready");

  if (restarted) {
    return (
      <p className={styles.restart}>
        <span>
          The ffmpeg engine crashed on an earlier job and has been restarted. Your other files and
          formats are unaffected.
        </span>
        <button
          type="button"
          onClick={() => setAcknowledged(state.restarts)}
          className={styles.dismiss}
        >
          Dismiss
        </button>
      </p>
    );
  }

  if (state.stage === "idle" || state.stage === "ready") return null;

  if (state.stage === "error") {
    return (
      <div role="alert" className={styles.error}>
        <p className={styles.errorMessage}>
          {state.error?.message ?? "The ffmpeg engine failed to load."}
        </p>
        {state.error?.hint && <p className={styles.errorHint}>{state.error.hint}</p>}
      </div>
    );
  }

  const isDownloading = state.stage === "downloading-core";

  return (
    <div className={styles.banner}>
      <div className={styles.header}>
        <p className={styles.title}>
          {isDownloading ? "Downloading the ffmpeg engine..." : "Starting the ffmpeg engine..."}
        </p>
        {isDownloading && state.totalBytes > 0 && (
          <p className={styles.bytes}>
            {formatBytes(state.receivedBytes)} / {formatBytes(state.totalBytes)}
          </p>
        )}
      </div>

      <div className={styles.bar}>
        <ProgressBar
          ratio={isDownloading ? state.ratio : null}
          label="ffmpeg engine loading progress"
        />
      </div>

      <p className={styles.note}>{CORE_LABEL} is fetched once and then cached by your browser.</p>
    </div>
  );
}
