"use client";

import { ChevronDown, Download, DownloadCloud, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { downloadText } from "@/lib/download";
import { formatBytes } from "@/lib/format-utils";
import { fileExtension, fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import {
  decodeSubtitleBytes,
  FRAME_RATE_PRESETS,
  formatVttTime,
  isRetimed,
  NO_RETIMING,
  parseOffset,
  parseSubtitles,
  retimeCues,
  serialize,
  stretchFactor,
  stripMarkup,
  SUBTITLE_TARGETS,
  SubtitleError,
  targetFor,
  type Cue,
  type ParsedSubtitles,
  type Retiming,
  type SubtitleTarget,
} from "@/lib/subtitles";
import { requireTool } from "@/lib/tools";

import { DropZone } from "../DropZone";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { CheckboxCards } from "../ui/CheckboxCards";
import { Select } from "../ui/Select";
import settingsStyles from "../Settings.module.css";
import toolStyles from "../ToolApp.module.css";
import styles from "./ConvertSubtitlesApp.module.css";

const tool = requireTool("convert-subtitles");

const ACCEPT = ".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/plain";

const NO_STRETCH = "none";
const CUSTOM_STRETCH = "custom";

const STRETCH_OPTIONS = [
  { value: NO_STRETCH, label: "No stretch" },
  ...FRAME_RATE_PRESETS.map((preset, index) => ({ value: String(index), label: preset.label })),
  { value: CUSTOM_STRETCH, label: "Custom factor" },
];

interface SubtitleSettings {
  targets: SubtitleTarget[];
  offsetText: string;
  stretch: string;
  customFactorText: string;
}

const DEFAULT_SETTINGS: SubtitleSettings = {
  targets: ["srt", "vtt"],
  offsetText: "",
  stretch: NO_STRETCH,
  customFactorText: "1",
};

const TARGET_IDS = new Set<string>(SUBTITLE_TARGETS.map((target) => target.id));

function isSubtitleSettings(value: unknown): value is SubtitleSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SubtitleSettings>;
  return (
    Array.isArray(candidate.targets) &&
    candidate.targets.every((target) => TARGET_IDS.has(target)) &&
    typeof candidate.offsetText === "string" &&
    typeof candidate.stretch === "string" &&
    typeof candidate.customFactorText === "string"
  );
}

/** The retiming the panel currently describes, or a problem with it. */
function readRetiming(settings: SubtitleSettings): { retiming: Retiming | null; problem: string | null } {
  const offset = parseOffset(settings.offsetText);
  if (offset === null) {
    return { retiming: null, problem: `"${settings.offsetText.trim()}" is not a time - try 1.5, -2 or 0:03.25.` };
  }
  let factor = 1;
  if (settings.stretch === CUSTOM_STRETCH) {
    const typed = Number(settings.customFactorText);
    if (!Number.isFinite(typed) || typed <= 0 || typed > 10) {
      return { retiming: null, problem: "The stretch factor has to be a number above 0 and up to 10." };
    }
    factor = typed;
  } else if (settings.stretch !== NO_STRETCH) {
    const preset = FRAME_RATE_PRESETS[Number(settings.stretch)];
    if (preset) factor = stretchFactor(preset.from, preset.to);
  }
  return { retiming: { offsetSeconds: offset, factor }, problem: null };
}

type EntryStatus = "reading" | "ready" | "error";

interface Entry {
  id: string;
  file: File;
  status: EntryStatus;
  parsed?: ParsedSubtitles;
  encoding?: string;
  error?: { message: string; hint?: string };
}

let entryCounter = 0;

interface Output {
  target: SubtitleTarget;
  label: string;
  fileName: string;
  text: string;
  bytes: number;
  mimeType: string;
}

/** What one file becomes, given the panel: every chosen target, retimed. */
function buildOutputs(entry: Entry, retiming: Retiming, targets: SubtitleTarget[]): {
  outputs: Output[];
  cues: Cue[];
  dropped: number;
} {
  if (!entry.parsed) return { outputs: [], cues: [], dropped: 0 };
  const { cues, dropped } = retimeCues(entry.parsed.cues, retiming);
  const stem = fileStem(entry.file.name, "subtitles");
  const sourceExtension = fileExtension(entry.file.name);
  const outputs = targets.map((id) => {
    const target = targetFor(id);
    const text = serialize(cues, id);
    // The same format back again needs a different name, or the download
    // lands beside the source under the very name it started from.
    const sameFormat = target.extension === sourceExtension || (id === "ass" && sourceExtension === "ssa");
    const suffix = sameFormat ? (isRetimed(retiming) ? "-retimed" : "-clean") : "";
    return {
      target: id,
      label: target.label,
      fileName: `${stem}${suffix}.${target.extension}`,
      text,
      bytes: new TextEncoder().encode(text).length,
      mimeType: target.mimeType,
    };
  });
  return { outputs, cues, dropped };
}

function SubtitleCard({
  entry,
  retiming,
  targets,
  onRemove,
}: {
  entry: Entry;
  retiming: Retiming;
  targets: SubtitleTarget[];
  onRemove: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const { outputs, cues, dropped } = useMemo(
    () => buildOutputs(entry, retiming, targets),
    [entry, retiming, targets],
  );

  const parsed = entry.parsed;
  const meta = [formatBytes(entry.file.size)];
  if (parsed) {
    meta.push(parsed.format.toUpperCase());
    meta.push(`${parsed.cues.length} ${parsed.cues.length === 1 ? "cue" : "cues"}`);
    const last = parsed.cues[parsed.cues.length - 1];
    if (last) meta.push(`${formatVttTime(parsed.cues[0].start)} to ${formatVttTime(last.end)}`);
    if (entry.encoding && entry.encoding !== "UTF-8") meta.push(`read as ${entry.encoding}`);
  }

  const notes = [...(parsed?.warnings ?? [])];
  if (isRetimed(retiming) && parsed) {
    const parts: string[] = [];
    if (retiming.factor !== 1) parts.push(`stretched by ${retiming.factor.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`);
    if (retiming.offsetSeconds !== 0) {
      parts.push(`shifted ${retiming.offsetSeconds > 0 ? "later" : "earlier"} by ${Math.abs(retiming.offsetSeconds)} s`);
    }
    notes.push(
      `Timing ${parts.join(" and ")}.${
        dropped > 0 ? ` ${dropped} ${dropped === 1 ? "cue" : "cues"} that ended before the start ${dropped === 1 ? "was" : "were"} dropped.` : ""
      }`,
    );
  }

  return (
    <li className={styles.card}>
      <div className={styles.header}>
        <div className={styles.identity}>
          <p className={styles.fileName} title={entry.file.name}>
            {entry.file.name}
          </p>
          <p className={styles.meta}>{entry.status === "reading" ? "Reading..." : meta.join(", ")}</p>
        </div>
        <div className={styles.actions}>
          <span
            className={`${styles.status} ${
              entry.status === "error" ? styles.statusError : entry.status === "ready" ? styles.statusDone : styles.statusIdle
            }`}
          >
            {entry.status === "error" ? "Failed" : entry.status === "ready" ? "Ready" : "Reading"}
          </span>
          <Button onClick={onRemove} aria-label={`Remove ${entry.file.name}`} variant="ghost">
            <X aria-hidden="true" size={13} strokeWidth={2} />
            Remove
          </Button>
        </div>
      </div>

      {entry.status === "error" && entry.error && (
        <div role="alert" className={styles.alert}>
          <p className={styles.alertMessage}>{entry.error.message}</p>
          {entry.error.hint && <p className={styles.alertHint}>{entry.error.hint}</p>}
        </div>
      )}

      {notes.map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}

      {outputs.length > 0 && (
        <ul className={styles.outputs}>
          {outputs.map((output) => (
            <li key={output.target} className={styles.row}>
              <div className={styles.rowLabel}>
                <span className={styles.formatName}>{output.label}</span>
                <span className={styles.tag}>.{output.fileName.split(".").pop()}</span>
              </div>
              <div className={styles.rowState}>
                <span className={styles.rowMeta}>{formatBytes(output.bytes)}</span>
                <Button
                  onClick={() => downloadText(output.fileName, output.text, output.mimeType)}
                  variant="primary"
                  aria-label={`Download ${output.fileName}`}
                >
                  <Download aria-hidden="true" size={14} strokeWidth={2} />
                  Download
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cues.length > 0 && (
        <div className={styles.disclosure}>
          <button
            type="button"
            onClick={() => setShowPreview((previous) => !previous)}
            aria-expanded={showPreview}
            className={styles.disclosureButton}
          >
            {showPreview ? "Hide" : "Show"} the first cues
          </button>
          {showPreview && (
            <ol className={styles.preview}>
              {cues.slice(0, 5).map((cue, index) => (
                <li key={index} className={styles.previewCue}>
                  <span className={styles.previewTime}>
                    {formatVttTime(cue.start)} - {formatVttTime(cue.end)}
                  </span>
                  <span className={styles.previewText}>{stripMarkup(cue.text).replace(/\n/g, " / ")}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The subtitle converter: plain text in, plain text out, no WebAssembly.
 *
 * Everything happens the moment a file lands, and again the moment a setting
 * changes: the outputs are a function of the parsed cues and the panel, so
 * there is nothing to queue and nothing to wait for.
 */
export function ConvertSubtitlesApp() {
  const [settings, setSettings] = useState<SubtitleSettings>(DEFAULT_SETTINGS);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showSettings, setShowSettings] = useState(true);

  useStoredSettings(storageKey("settings", "convert-subtitles"), settings, setSettings, isSubtitleSettings);

  const { retiming, problem } = readRetiming(settings);
  const targets = settings.targets;

  const addFiles = useCallback((files: File[]) => {
    const added: Entry[] = files.map((file) => ({
      id: `subtitle-${(entryCounter += 1)}`,
      file,
      status: "reading",
    }));
    setEntries((previous) => [...previous, ...added]);
    setShowSettings(false);

    for (const entry of added) {
      void entry.file
        .arrayBuffer()
        .then((bytes) => {
          const { text, encoding } = decodeSubtitleBytes(bytes);
          const parsed = parseSubtitles(text, entry.file.name);
          setEntries((previous) =>
            previous.map((item) =>
              item.id === entry.id ? { ...item, status: "ready", parsed, encoding } : item,
            ),
          );
        })
        .catch((error: unknown) => {
          const failure =
            error instanceof SubtitleError
              ? { message: error.message, hint: error.hint }
              : { message: "This file could not be read.", hint: error instanceof Error ? error.message : undefined };
          setEntries((previous) =>
            previous.map((item) => (item.id === entry.id ? { ...item, status: "error", error: failure } : item)),
          );
        });
    }
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  const readyEntries = entries.filter((entry) => entry.status === "ready");

  const downloadAll = useCallback(() => {
    if (!retiming) return;
    let index = 0;
    for (const entry of readyEntries) {
      for (const output of buildOutputs(entry, retiming, targets).outputs) {
        window.setTimeout(() => downloadText(output.fileName, output.text, output.mimeType), index * 250);
        index += 1;
      }
    }
  }, [readyEntries, retiming, targets]);

  const invalid =
    problem ?? (targets.length === 0 ? "Choose at least one output format below." : null);

  const summary = (() => {
    const formats = targets.length === 0 ? "no format" : targets.map((id) => targetFor(id).label).join(", ");
    if (!retiming) return `${formats}, timing not set`;
    const timing = isRetimed(retiming)
      ? `${retiming.offsetSeconds !== 0 ? `${retiming.offsetSeconds > 0 ? "+" : ""}${retiming.offsetSeconds} s` : ""}${
          retiming.offsetSeconds !== 0 && retiming.factor !== 1 ? ", " : ""
        }${retiming.factor !== 1 ? `x${Number(retiming.factor.toFixed(4))}` : ""}`
      : "timing kept";
    return `${formats}; ${timing}`;
  })();

  return (
    <ToolFrame
      tool={tool}
      lead="Drop an SRT, WebVTT, ASS or SSA file and get it back in any of the others, or as a plain transcript. Shift every cue by a fixed amount when the subtitles are early or late, or stretch them when they drift because they were made for a different frame rate. Plain text in, plain text out: nothing is uploaded, and nothing is downloaded either."
      footer={
        <>
          <p>
            Italics, bold and underline survive the conversion; fonts, colours and positions do
            not, because SRT has no way to say them and a WebVTT file that depends on them would
            not look the same anywhere else. Files that are not UTF-8 are read as Windows-1252,
            which is what most older subtitle files are, and always written back as UTF-8.
          </p>
          <p>Your files never leave this device. The conversion is a few lines of JavaScript, run in your browser.</p>
        </>
      }
    >
      <DropZone
        onFiles={addFiles}
        compact={entries.length > 0}
        disabled={invalid !== null}
        accept={ACCEPT}
        inputLabel="Choose subtitle files"
        headline="Drop subtitle files here"
        subhead="SRT, WebVTT, ASS or SSA. Converted the moment they land"
      />

      <div className={toolStyles.settings}>
        <button
          type="button"
          onClick={() => setShowSettings((previous) => !previous)}
          aria-expanded={showSettings}
          className={toolStyles.settingsToggle}
        >
          <span className={toolStyles.settingsTitle}>
            Output formats & timing
            <span className={toolStyles.settingsSummary}>{summary}</span>
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
              <legend className={settingsStyles.legend}>Output formats</legend>
              <p className={settingsStyles.intro}>
                Every file gets each of these. Changing the choice changes the outputs of files already
                here, since nothing has to be re-run.
              </p>
              <CheckboxCards
                aria-label="Output formats"
                value={targets}
                onValueChange={(next) => setSettings((previous) => ({ ...previous, targets: next }))}
                options={SUBTITLE_TARGETS.map((target) => ({
                  value: target.id,
                  label: target.label,
                  blurb: target.blurb,
                }))}
              />
            </fieldset>

            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Timing</legend>
              <p className={settingsStyles.intro}>
                Subtitles that are late throughout need a shift: a positive number moves every cue later,
                a negative one earlier. Subtitles that start in sync and drift were made for a video at a
                different frame rate and need a stretch.
              </p>
              <div className={styles.timingRow}>
                <label>
                  <span className={settingsStyles.fieldLabel}>Shift by</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={settings.offsetText}
                    placeholder="0"
                    aria-invalid={parseOffset(settings.offsetText) === null}
                    onChange={(event) =>
                      setSettings((previous) => ({ ...previous, offsetText: event.target.value }))
                    }
                    className={settingsStyles.input}
                  />
                </label>
                <label className={styles.stretchField}>
                  <span className={settingsStyles.fieldLabel}>Stretch</span>
                  <Select
                    aria-label="Stretch"
                    value={settings.stretch}
                    options={STRETCH_OPTIONS}
                    onValueChange={(stretch) => setSettings((previous) => ({ ...previous, stretch }))}
                  />
                </label>
                {settings.stretch === CUSTOM_STRETCH && (
                  <label>
                    <span className={settingsStyles.fieldLabel}>Factor</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      min="0.1"
                      max="10"
                      value={settings.customFactorText}
                      onChange={(event) =>
                        setSettings((previous) => ({ ...previous, customFactorText: event.target.value }))
                      }
                      className={settingsStyles.input}
                    />
                  </label>
                )}
              </div>
              <p className={settingsStyles.panelNote}>
                Seconds, or a clock: 1.5, -2, 0:03.25. Every time is multiplied by the stretch first
                and shifted second.
              </p>
            </fieldset>
          </div>
        )}
        {invalid && (
          <p role="alert" className={toolStyles.settingsError}>
            {invalid}
          </p>
        )}
      </div>

      {entries.length > 0 && (
        <section aria-label="Subtitle files">
          <div className={toolStyles.queueHeader}>
            <h2 className={toolStyles.queueCount}>
              {entries.length} {entries.length === 1 ? "file" : "files"}
            </h2>
            {entries.length > 0 && (
              <Button onClick={() => setEntries([])} variant="ghost">
                Clear all
              </Button>
            )}
          </div>
          <ul className={styles.cards}>
            {entries.map((entry) => (
              <SubtitleCard
                key={entry.id}
                entry={entry}
                retiming={retiming ?? NO_RETIMING}
                targets={targets}
                onRemove={() => removeEntry(entry.id)}
              />
            ))}
          </ul>
          {readyEntries.length * targets.length > 1 && (
            <div className={toolStyles.totalRow}>
              <p className={toolStyles.total}>
                {readyEntries.length * targets.length} files ready
              </p>
              <Button onClick={downloadAll}>
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
