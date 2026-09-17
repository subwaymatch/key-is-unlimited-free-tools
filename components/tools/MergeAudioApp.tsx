"use client";

import { ArrowDown, ArrowUp, ChevronDown, Download, Merge, X } from "lucide-react";
import { useMemo, useState } from "react";

import { assessMerge, mergeBlocker, type MergeMode } from "@/lib/engine/merge";
import { describeAudio, formatBytes, formatDuration, formatPercent } from "@/lib/format-utils";
import { AUDIO_ACCEPT } from "@/lib/mediaTypes";
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

const tool = requireTool("merge-audio");

const MODE_OPTIONS: { value: MergeMode; label: string; blurb: string }[] = [
  { value: "auto", label: "Copy when the files match", blurb: "Joined without re-encoding when every file has the same codec, rate and channels: seconds, and nothing lost. Re-encoded only when they differ" },
  { value: "encode", label: "Always re-encode", blurb: "Decoded and joined into one clean file in the first file's format, whatever went in" },
];

function FileRow({ clip, index, count, disabled, onMove, onRemove }: { clip: MergeClipState; index: number; count: number; disabled: boolean; onMove: (direction: -1 | 1) => void; onRemove: () => void }) {
  const meta = [formatBytes(clip.file.size)];
  if (clip.probe) {
    meta.push(formatDuration(clip.probe.durationSeconds));
    meta.push(clip.probe.audio ? describeAudio(clip.probe.audio) : "no audio");
  } else if (clip.status === "reading") meta.push("Reading...");
  else if (clip.status === "new") meta.push("Waiting to be read");
  return (
    <li className={`${styles.clip} ${clip.status === "error" ? styles.clipError : ""}`}>
      <span className={styles.index} aria-label={`File ${index + 1}`}>
        {index + 1}
      </span>
      <div className={styles.identity}>
        <p className={styles.fileName} title={clip.file.name}>
          <span className={styles.fileStem}>{clip.file.name}</span>
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
        <Button onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label={`Move ${clip.file.name} up`} title="Earlier">
          <ArrowUp aria-hidden="true" size={13} strokeWidth={2} />
        </Button>
        <Button onClick={() => onMove(1)} disabled={disabled || index === count - 1} aria-label={`Move ${clip.file.name} down`} title="Later">
          <ArrowDown aria-hidden="true" size={13} strokeWidth={2} />
        </Button>
        <Button onClick={onRemove} disabled={disabled} aria-label={`Remove ${clip.file.name}`} variant="ghost">
          <X aria-hidden="true" size={13} strokeWidth={2} />
          Remove
        </Button>
      </div>
    </li>
  );
}

/** The merger for sound alone: the video merger's machinery with its own store and wording. */
export function MergeAudioApp() {
  const queue = useMergeQueue({ key: "merge-audio", expects: "audio" });
  const { clips, status, phase, ratio, output, error, settings, setSettings, stripMetadata, setStripMetadata, engineState, addFiles, moveClip, removeClip, clearClips, merge, cancel } = queue;
  const [showSettings, setShowSettings] = useState(false);

  const busy = status !== "idle";
  const ready = readyClips(clips);
  const largestFile = clips.reduce((max, clip) => Math.max(max, clip.file.size), 0);

  const assessment = useMemo(() => {
    if (ready.length < 2) return null;
    const planned = describeClips(clips);
    return { blocker: mergeBlocker(planned, settings), ...assessMerge(planned, settings) };
  }, [clips, ready.length, settings]);

  const unreadCount = clips.filter((clip) => clip.status === "new" || clip.status === "reading").length;
  const canMerge = !busy && ready.length >= 2 && unreadCount === 0 && !assessment?.blocker;

  const summary = (() => {
    if (!assessment) return ready.length === 1 && unreadCount === 0 ? "Add at least one more file to join to this one." : null;
    const length = assessment.totalSeconds === null ? "" : `, ${formatDuration(assessment.totalSeconds)} in all`;
    const container = assessment.container.extension.toUpperCase();
    if (assessment.mode === "copy") return `${ready.length} files${length}. They match, so they will be joined without re-encoding, into ${/^[AEIOUM]/.test(container) ? "an" : "a"} ${container}.`;
    const because = assessment.mismatches.length > 0 ? ` because ${assessment.mismatches.slice(0, 3).join("; ")}${assessment.mismatches.length > 3 ? `; and ${assessment.mismatches.length - 3} more` : ""}` : "";
    return `${ready.length} files${length}. They will be decoded and joined into one ${container}${because}.`;
  })();

  return (
    <ToolFrame
      tool={tool}
      lead="Drop two or more audio files, put them in order, and join them into one. Files that share a codec, sample rate and channel layout are joined without re-encoding, in seconds and losslessly; a mix of formats is decoded and joined into the first file's format. Nothing is uploaded."
      footer={
        <EngineFootnote
          note="A copy needs every file to match: the same codec, sample rate and channels. Files from one recorder or one album usually do; a mix of MP3s and M4As does not, and is decoded and joined into the first file's format instead. Chapter markers are not written; the chapter tool adds them to the joined file from a typed list."
          largestFile={largestFile}
        />
      }
    >
      <EngineBanner state={engineState} />
      <DropZone onFiles={addFiles} compact={clips.length > 0} accept={AUDIO_ACCEPT} inputLabel="Choose audio files to join" headline="Drop audio files here" subhead="Joined in the order below; add them all, then arrange them" />

      <div className={toolStyles.settings}>
        <button type="button" onClick={() => setShowSettings((previous) => !previous)} aria-expanded={showSettings} className={toolStyles.settingsToggle}>
          <span className={toolStyles.settingsTitle}>
            Join method
            <span className={toolStyles.settingsSummary}>
              {settings.mode === "auto" ? "copy when they match" : "always re-encode"}, {stripMetadata ? "metadata removed" : "metadata kept"}
            </span>
          </span>
          <ChevronDown aria-hidden="true" size={18} className={`${toolStyles.chevron} ${showSettings ? toolStyles.chevronOpen : ""}`} />
        </button>
        {showSettings && (
          <div className={toolStyles.settingsBody}>
            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Join method</legend>
              <RadioCards aria-label="Join method" value={settings.mode} onValueChange={(mode) => setSettings({ mode })} options={MODE_OPTIONS} columns={2} disabled={busy} />
            </fieldset>
            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Metadata</legend>
              <p className={settingsStyles.intro}>On by default. The joined file otherwise carries the tags of the first file: its title, artist and album.</p>
              <label className={toolStyles.checkboxRow}>
                <input type="checkbox" checked={stripMetadata} onChange={(event) => setStripMetadata(event.target.checked)} />
                <span>
                  <span className={toolStyles.checkboxLabel}>Remove titles, tags and chapters from the output</span>
                </span>
              </label>
            </fieldset>
          </div>
        )}
      </div>

      {clips.length > 0 && (
        <section aria-label="Files to join">
          <div className={toolStyles.queueHeader}>
            <h2 className={toolStyles.queueCount}>
              {clips.length} {clips.length === 1 ? "file" : "files"}
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
              <FileRow key={clip.id} clip={clip} index={index} count={clips.length} disabled={busy} onMove={(direction) => moveClip(clip.id, direction)} onRemove={() => removeClip(clip.id)} />
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
                    <span className={styles.phase} aria-live="polite">
                      {phase}
                    </span>
                    <span className={styles.elapsed}>{formatPercent(ratio)}</span>
                  </div>
                  <ProgressBar ratio={ratio} label="Joining" />
                </div>
                <Button onClick={cancel} variant="ghost">
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={() => void merge()} disabled={!canMerge} variant="primary" size="md">
                <Merge aria-hidden="true" size={14} strokeWidth={2} />
                Join the files
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
                  <span className={styles.outputName}>{output.result.fileName}</span>
                  <span className={`${styles.tag} ${styles.tagExt}`}>.{output.result.extension}</span>
                  {output.result.mode === "copy" && <span className={`${styles.tag} ${styles.tagCopy}`}>Stream copy</span>}
                </div>
                <div className={styles.outputState}>
                  <span className={styles.outputMeta}>{formatBytes(output.result.bytes)}</span>
                  <a href={output.url} download={output.result.fileName} className={styles.download}>
                    <Download aria-hidden="true" size={14} strokeWidth={2} />
                    Download
                  </a>
                </div>
              </div>
              <audio controls src={output.url} preload="metadata" style={{ marginTop: "0.75rem", width: "100%" }} />
            </div>
          )}
        </section>
      )}
    </ToolFrame>
  );
}
