"use client";

import { ArrowDown, ArrowUp, ChevronDown, Download, Merge, X } from "lucide-react";
import { useMemo, useState } from "react";

import { assessMerge, mergeBlocker, type MergeMode } from "@/lib/engine/merge";
import { describeAudio, describeVideo, formatBytes, formatDuration, formatPercent } from "@/lib/format-utils";
import { fileExtension } from "@/lib/mediaTypes";
import { requireTool } from "@/lib/tools";
import { describeClips, readyClips, useMergeQueue, type MergeClipState } from "@/lib/useMergeQueue";

import { DropZone } from "../DropZone";
import { EngineBanner } from "../EngineBanner";
import { ProgressBar } from "../ProgressBar";
import { EngineFootnote, ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { RadioCards } from "../ui/RadioCards";
import settingsStyles from "../Settings.module.css";
import toolStyles from "../ToolApp.module.css";
import styles from "./MergeVideosApp.module.css";

const tool = requireTool("merge-videos");

const MODE_OPTIONS: { value: MergeMode; label: string; blurb: string }[] = [
  {
    value: "auto",
    label: "Copy when the clips match",
    blurb: "Joined without re-encoding when every clip has the same streams: seconds, and lossless. Re-encoded only when they differ",
  },
  {
    value: "encode",
    label: "Always re-encode",
    blurb: "One clean H.264 MP4 whatever went in, fitted to the first clip's frame. Slower, and the choice when a copy plays oddly",
  },
];

function ClipRow({
  clip,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  clip: MergeClipState;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const extension = fileExtension(clip.file.name);
  const stem = extension
    ? clip.file.name.slice(0, clip.file.name.length - extension.length - 1)
    : clip.file.name;

  const meta = [formatBytes(clip.file.size)];
  if (clip.probe) {
    meta.push(formatDuration(clip.probe.durationSeconds));
    if (clip.probe.video) meta.push(describeVideo(clip.probe.video));
    meta.push(clip.probe.audio ? describeAudio(clip.probe.audio) : "no audio");
  } else if (clip.status === "reading") {
    meta.push("Reading...");
  } else if (clip.status === "new") {
    meta.push("Waiting to be read");
  }

  return (
    <li className={`${styles.clip} ${clip.status === "error" ? styles.clipError : ""}`}>
      <span className={styles.index} aria-label={`Clip ${index + 1}`}>
        {index + 1}
      </span>
      {clip.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={clip.posterUrl} alt="" className={styles.poster} />
      ) : (
        <span className={styles.posterEmpty} aria-hidden="true" />
      )}
      <div className={styles.identity}>
        <p className={styles.fileName} title={clip.file.name}>
          <span className={styles.fileStem}>{stem}</span>
          {extension && <span className={styles.fileExt}>.{extension}</span>}
        </p>
        <p className={styles.meta}>{meta.join(", ")}</p>
        {clip.status === "error" && clip.error && (
          <p className={styles.clipProblem}>
            {clip.error.message}
            {clip.error.hint && <span className={styles.clipHint}> {clip.error.hint}</span>}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          onClick={() => onMove(-1)}
          disabled={disabled || index === 0}
          aria-label={`Move ${clip.file.name} up`}
          title="Earlier"
        >
          <ArrowUp aria-hidden="true" size={13} strokeWidth={2} />
        </Button>
        <Button
          onClick={() => onMove(1)}
          disabled={disabled || index === count - 1}
          aria-label={`Move ${clip.file.name} down`}
          title="Later"
        >
          <ArrowDown aria-hidden="true" size={13} strokeWidth={2} />
        </Button>
        <Button
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${clip.file.name}`}
          variant="ghost"
        >
          <X aria-hidden="true" size={13} strokeWidth={2} />
          Remove
        </Button>
      </div>
    </li>
  );
}

/**
 * The merger: several files in, one file out.
 *
 * Clips are read as they arrive so the list shows what each one is and the
 * summary can say, before anything is committed to, whether the join will be
 * a copy or a re-encode and why. The join itself waits for the button.
 */
export function MergeVideosApp() {
  const queue = useMergeQueue();
  const {
    clips,
    status,
    phase,
    ratio,
    processedSeconds,
    output,
    error,
    logs,
    settings,
    setSettings,
    stripMetadata,
    setStripMetadata,
    engineState,
    addFiles,
    moveClip,
    removeClip,
    clearClips,
    merge,
    cancel,
  } = queue;

  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const busy = status !== "idle";
  const ready = readyClips(clips);
  const largestFile = clips.reduce((max, clip) => Math.max(max, clip.file.size), 0);

  /*
   * What the planner would do with the list as it stands: the same code that
   * runs the join, so the summary cannot promise a copy and deliver an encode.
   */
  const assessment = useMemo(() => {
    if (ready.length < 2) return null;
    const planned = describeClips(clips);
    return { blocker: mergeBlocker(planned, settings), ...assessMerge(planned, settings) };
  }, [clips, ready.length, settings]);

  const unreadCount = clips.filter((clip) => clip.status === "new" || clip.status === "reading").length;
  const canMerge = !busy && ready.length >= 2 && unreadCount === 0 && !assessment?.blocker;

  const summary = (() => {
    if (!assessment) {
      return ready.length === 1 && unreadCount === 0
        ? "Add at least one more clip to join to this one."
        : null;
    }
    const length = assessment.totalSeconds === null ? "" : `, ${formatDuration(assessment.totalSeconds)} in all`;
    if (assessment.mode === "copy") {
      const container = assessment.container.extension.toUpperCase();
      const article = /^[AEIOUM]/.test(container) ? "an" : "a";
      return `${ready.length} clips${length}. They match, so they will be joined without re-encoding, into ${article} ${container}.`;
    }
    const canvas = assessment.canvas;
    const frame = canvas ? ` fitted to clip 1's ${canvas.width}x${canvas.height} frame at ${canvas.fps} fps` : "";
    const because =
      assessment.mismatches.length > 0
        ? ` because ${assessment.mismatches.slice(0, 3).join("; ")}${
            assessment.mismatches.length > 3 ? `; and ${assessment.mismatches.length - 3} more` : ""
          }`
        : "";
    const silence =
      assessment.silentClips.length > 0
        ? ` ${assessment.silentClips.length === 1 ? `Clip ${assessment.silentClips[0]} has` : `Clips ${assessment.silentClips.join(", ")} have`} no audio and will be silent for ${assessment.silentClips.length === 1 ? "its" : "their"} part.`
        : "";
    return `${ready.length} clips${length}. They will be re-encoded to H.264${frame}${because}.${silence}`;
  })();

  return (
    <ToolFrame
      tool={tool}
      lead="Drop two or more videos, put them in order, and join them into one file. Clips with the same codec, frame size and frame rate are joined without re-encoding, in seconds and losslessly; anything else is re-encoded to fit the first clip. Nothing is uploaded."
      footer={
        <EngineFootnote
          note="A copy needs every clip to match exactly: same codec and profile, same frame size and pixel format, same frame rate, same audio. Clips from one phone or one camera usually do; a mix of sources usually does not, and is re-encoded to H.264 at the first clip's size instead. The output is built in memory and caps out near 1.5 GB, so a join of several long copies may need re-encoding or a shorter list."
          largestFile={largestFile}
        />
      }
    >
      <EngineBanner state={engineState} />

      <DropZone
        onFiles={addFiles}
        compact={clips.length > 0}
        inputLabel="Choose video files to join"
        headline="Drop video files here"
        subhead="Clips are joined in the order below; add them all, then arrange them"
      />

      <div className={toolStyles.settings}>
        <button
          type="button"
          onClick={() => setShowSettings((previous) => !previous)}
          aria-expanded={showSettings}
          className={toolStyles.settingsToggle}
        >
          <span className={toolStyles.settingsTitle}>
            Join method
            <span className={toolStyles.settingsSummary}>
              {settings.mode === "auto" ? "copy when they match" : "always re-encode"},{" "}
              {stripMetadata ? "metadata removed" : "metadata kept"}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            size={18}
            className={`${toolStyles.chevron} ${showSettings ? toolStyles.chevronOpen : ""}`}
          />
        </button>
        {showSettings && (
          <div className={toolStyles.settingsBody}>
            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Join method</legend>
              <RadioCards
                aria-label="Join method"
                value={settings.mode}
                onValueChange={(mode) => setSettings({ mode })}
                options={MODE_OPTIONS}
                columns={2}
                disabled={busy}
              />
            </fieldset>
            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Metadata</legend>
              <p className={settingsStyles.intro}>
                On by default. The joined file otherwise carries the tags of the first clip: the date, the
                phone, and the GPS fix of where it was taken.
              </p>
              <label className={toolStyles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={stripMetadata}
                  onChange={(event) => setStripMetadata(event.target.checked)}
                />
                <span>
                  <span className={toolStyles.checkboxLabel}>
                    Remove titles, dates, location and chapters from the output
                  </span>
                </span>
              </label>
            </fieldset>
          </div>
        )}
      </div>

      {clips.length > 0 && (
        <section aria-label="Clips to join">
          <div className={toolStyles.queueHeader}>
            <h2 className={toolStyles.queueCount}>
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
              {unreadCount > 0 && (
                <span className={toolStyles.queueRemaining} aria-live="polite">
                  {unreadCount} being read
                </span>
              )}
            </h2>
            <Button onClick={clearClips} disabled={busy} variant="ghost">
              Clear all
            </Button>
          </div>

          <ol className={styles.clips}>
            {clips.map((clip, index) => (
              <ClipRow
                key={clip.id}
                clip={clip}
                index={index}
                count={clips.length}
                disabled={status === "merging"}
                onMove={(direction) => moveClip(clip.id, direction)}
                onRemove={() => removeClip(clip.id)}
              />
            ))}
          </ol>

          {summary && <p className={styles.summary}>{summary}</p>}

          {assessment?.blocker && (
            <div role="alert" className={styles.alert}>
              <p className={styles.alertMessage}>{assessment.blocker.message}</p>
              <p className={styles.alertHint}>{assessment.blocker.hint}</p>
            </div>
          )}

          <div className={styles.mergeRow}>
            {status === "merging" ? (
              <>
                <div className={styles.progress}>
                  <div className={styles.phaseRow}>
                    <p className={styles.phase} aria-live="polite">
                      {phase}
                    </p>
                    <p className={styles.elapsed}>
                      {ratio === null
                        ? "Working..."
                        : `${formatDuration(processedSeconds)}${
                            assessment?.totalSeconds != null
                              ? ` / ${formatDuration(assessment.totalSeconds)}`
                              : ""
                          }, ${formatPercent(ratio)}`}
                    </p>
                  </div>
                  <ProgressBar ratio={ratio} label="Join progress" />
                </div>
                <Button onClick={cancel}>Cancel</Button>
              </>
            ) : (
              <Button onClick={() => void merge()} disabled={!canMerge} variant="primary" size="md">
                <Merge aria-hidden="true" size={14} strokeWidth={2} />
                {ready.length >= 2 ? `Join ${ready.length} clips` : "Join clips"}
              </Button>
            )}
          </div>

          {error && (
            <div role="alert" className={styles.alert}>
              <p className={styles.alertMessage}>{error.message}</p>
              {error.hint && <p className={styles.alertHint}>{error.hint}</p>}
            </div>
          )}

          {output && (
            <div className={styles.output}>
              <div className={styles.outputHead}>
                <div className={styles.outputLabel}>
                  <span className={styles.outputName}>Joined video</span>
                  <span className={`${styles.tag} ${styles.tagExt}`}>.{output.result.extension}</span>
                  {output.result.mode === "copy" && (
                    <span
                      title="Copied without re-encoding - bit-for-bit identical streams"
                      className={`${styles.tag} ${styles.tagCopy}`}
                    >
                      Stream copy
                    </span>
                  )}
                </div>
                <div className={styles.outputState}>
                  <span className={styles.outputMeta}>{formatBytes(output.result.bytes)}</span>
                  <a href={output.url} download={output.result.fileName} className={styles.download}>
                    <Download aria-hidden="true" size={14} strokeWidth={2} />
                    Download
                  </a>
                </div>
              </div>
              {output.result.warning && <p className={styles.outputNote}>{output.result.warning}</p>}
              <video controls preload="metadata" src={output.url} className={styles.videoPreview}>
                Your browser cannot play this video.
              </video>
            </div>
          )}

          {logs.length > 0 && (
            <div className={styles.disclosure}>
              <button
                type="button"
                onClick={() => setShowLogs((previous) => !previous)}
                aria-expanded={showLogs}
                className={styles.disclosureButton}
              >
                {showLogs ? "Hide" : "Show"} ffmpeg log ({logs.length} lines)
              </button>
              {showLogs && <pre className={styles.log}>{logs.join("\n")}</pre>}
            </div>
          )}
        </section>
      )}
    </ToolFrame>
  );
}
