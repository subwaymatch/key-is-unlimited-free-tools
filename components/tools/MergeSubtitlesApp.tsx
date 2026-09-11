"use client";

import { ChevronDown, Download, DownloadCloud, X } from "lucide-react";
import { useCallback, useState } from "react";

import { downloadText } from "@/lib/download";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import {
  decodeSubtitleBytes,
  mergeCues,
  parseSubtitles,
  serialize,
  SUBTITLE_TARGETS,
  SubtitleError,
  targetFor,
  type MergeLayout,
  type ParsedSubtitles,
  type SubtitleTarget,
} from "@/lib/subtitles";
import { requireTool } from "@/lib/tools";

import { DropZone } from "../DropZone";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import settingsStyles from "../Settings.module.css";
import toolStyles from "../ToolApp.module.css";
import styles from "./ConvertSubtitlesApp.module.css";

const tool = requireTool("merge-subtitles");

const ACCEPT = ".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/plain";

type MergeTarget = Exclude<SubtitleTarget, "txt">;

interface MergeSettings {
  layout: MergeLayout;
  targets: MergeTarget[];
}

const DEFAULT_SETTINGS: MergeSettings = { layout: "stacked", targets: ["srt"] };

const TARGET_OPTIONS = SUBTITLE_TARGETS.filter((target) => target.id !== "txt").map((target) => ({
  value: target.id as MergeTarget,
  label: target.label,
  blurb: target.blurb,
}));

const LAYOUT_OPTIONS = [
  {
    value: "stacked",
    label: "Second language at the top",
    blurb: "Every cue from both files, the second language positioned at the top of the picture. Each keeps its own timing",
  },
  {
    value: "combined",
    label: "Both in one cue",
    blurb: "Each first-language cue with the matching second-language text underneath. For players that show one cue at a time",
  },
];

function isMergeSettings(value: unknown): value is MergeSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MergeSettings>;
  return (
    (candidate.layout === "stacked" || candidate.layout === "combined") &&
    Array.isArray(candidate.targets) &&
    candidate.targets.every((target) => TARGET_OPTIONS.some((option) => option.value === target))
  );
}

interface Loaded {
  name: string;
  parsed: ParsedSubtitles;
}

interface Entry {
  id: string;
  file: File;
  status: "reading" | "ready" | "error";
  parsed?: ParsedSubtitles;
  error?: { message: string; hint?: string };
}

let entryCounter = 0;

async function readSubtitles(file: File): Promise<ParsedSubtitles> {
  const { text } = decodeSubtitleBytes(await file.arrayBuffer());
  return parseSubtitles(text, file.name);
}

function describeError(error: unknown): { message: string; hint?: string } {
  return error instanceof SubtitleError
    ? { message: error.message, hint: error.hint }
    : { message: "This file could not be read.", hint: error instanceof Error ? error.message : undefined };
}

/**
 * Two languages into one file.
 *
 * The second language is chosen once, in the panel; every first-language
 * file dropped is merged with it. Outputs are derived from the two sets of
 * cues and the panel, so a change to the layout changes every file at once.
 */
export function MergeSubtitlesApp() {
  const [settings, setSettings] = useState<MergeSettings>(DEFAULT_SETTINGS);
  const [secondary, setSecondary] = useState<Loaded | null>(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showSettings, setShowSettings] = useState(true);

  useStoredSettings(storageKey("settings", "merge-subtitles"), settings, setSettings, isMergeSettings);

  const chooseSecondary = useCallback((file: File | undefined) => {
    if (!file) return;
    setSecondaryError(null);
    void readSubtitles(file)
      .then((parsed) => setSecondary({ name: file.name, parsed }))
      .catch((error: unknown) => {
        setSecondary(null);
        const { message, hint } = describeError(error);
        setSecondaryError(hint ? `${message} ${hint}` : message);
      });
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const added: Entry[] = files.map((file) => ({ id: `merge-${(entryCounter += 1)}`, file, status: "reading" }));
    setEntries((previous) => [...previous, ...added]);
    setShowSettings(false);
    for (const entry of added) {
      void readSubtitles(entry.file)
        .then((parsed) =>
          setEntries((previous) => previous.map((item) => (item.id === entry.id ? { ...item, status: "ready", parsed } : item))),
        )
        .catch((error: unknown) =>
          setEntries((previous) =>
            previous.map((item) => (item.id === entry.id ? { ...item, status: "error", error: describeError(error) } : item)),
          ),
        );
    }
  }, []);

  const outputsFor = useCallback(
    (entry: Entry) => {
      if (!entry.parsed || !secondary) return { outputs: [], unmatched: 0 };
      const { cues, unmatched } = mergeCues(entry.parsed.cues, secondary.parsed.cues, settings.layout);
      const stem = fileStem(entry.file.name, "subtitles");
      const outputs = settings.targets.map((id) => {
        const target = targetFor(id);
        const text = serialize(cues, id);
        return {
          target: id,
          label: target.label,
          fileName: `${stem}-bilingual.${target.extension}`,
          text,
          bytes: new TextEncoder().encode(text).length,
          mimeType: target.mimeType,
          cueCount: cues.length,
        };
      });
      return { outputs, unmatched };
    },
    [secondary, settings],
  );

  const readyEntries = entries.filter((entry) => entry.status === "ready");
  const invalid = !secondary
    ? "Choose the second language's subtitle file below before adding the first."
    : settings.targets.length === 0
      ? "Choose at least one output format below."
      : null;

  const downloadAll = useCallback(() => {
    let index = 0;
    for (const entry of readyEntries) {
      for (const output of outputsFor(entry).outputs) {
        window.setTimeout(() => downloadText(output.fileName, output.text, output.mimeType), index * 250);
        index += 1;
      }
    }
  }, [outputsFor, readyEntries]);

  return (
    <ToolFrame
      tool={tool}
      lead="Choose the subtitle file for the second language, drop the file for the first, and get one file with both: the second language at the top of the picture and the first at the bottom, or the two folded into one cue for players that show a single line. For learning a language, or for a room that speaks two. Nothing is uploaded, and nothing is downloaded either."
      footer={
        <>
          <p>
            The two files are kept as they are: each cue keeps its own timing in the stacked
            layout, and only the cues that overlap by at least half are folded together in the
            combined one, so lines that merely touch stay apart. A second-language cue with no
            first-language cue to sit under is kept on its own.
          </p>
          <p>Your files never leave this device. The merge is a few lines of JavaScript, run in your browser.</p>
        </>
      }
    >
      <DropZone
        onFiles={addFiles}
        compact={entries.length > 0}
        disabled={invalid !== null}
        accept={ACCEPT}
        inputLabel="Choose the first language's subtitle files"
        headline="Drop the first language's subtitle file here"
        subhead={secondary ? `It will be merged with ${secondary.name}` : "Choose the second language's file in the panel first"}
      />

      <div className={toolStyles.settings}>
        <button
          type="button"
          onClick={() => setShowSettings((previous) => !previous)}
          aria-expanded={showSettings}
          className={toolStyles.settingsToggle}
        >
          <span className={toolStyles.settingsTitle}>
            Second language & layout
            <span className={toolStyles.settingsSummary}>
              {secondary ? secondary.name : "no second file"}, {settings.layout === "stacked" ? "stacked" : "combined"}
            </span>
          </span>
          <ChevronDown aria-hidden="true" size={18} className={`${toolStyles.chevron} ${showSettings ? toolStyles.chevronOpen : ""}`} />
        </button>
        {showSettings && (
          <div className={toolStyles.settingsBody}>
            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Second language</legend>
              <p className={settingsStyles.intro}>
                The subtitle file to merge into each first-language file you drop. SRT, WebVTT, ASS or SSA.
              </p>
              <div className={settingsStyles.panel}>
                <label className={settingsStyles.fieldLabel} htmlFor="merge-secondary-file">
                  {secondary ? `${secondary.name} (${secondary.parsed.format.toUpperCase()}, ${secondary.parsed.cues.length} cues)` : "No file chosen"}
                </label>
                <div className={settingsStyles.fileRow}>
                  <input
                    id="merge-secondary-file"
                    type="file"
                    accept={ACCEPT}
                    onChange={(event) => {
                      chooseSecondary(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    className={settingsStyles.fileInput}
                  />
                  {secondary && (
                    <Button onClick={() => setSecondary(null)} variant="ghost">
                      Clear
                    </Button>
                  )}
                </div>
                {secondaryError && (
                  <p role="alert" className={settingsStyles.warning}>
                    {secondaryError}
                  </p>
                )}
              </div>
            </fieldset>

            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Layout</legend>
              <RadioCards
                aria-label="Layout"
                value={settings.layout}
                onValueChange={(value) => setSettings((previous) => ({ ...previous, layout: value as MergeLayout }))}
                options={LAYOUT_OPTIONS}
                columns={2}
              />
            </fieldset>

            <fieldset className={settingsStyles.fieldset}>
              <legend className={settingsStyles.legend}>Output formats</legend>
              <CheckboxCards
                aria-label="Output formats"
                value={settings.targets}
                onValueChange={(next) => setSettings((previous) => ({ ...previous, targets: next }))}
                options={TARGET_OPTIONS}
              />
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
            <Button onClick={() => setEntries([])} variant="ghost">
              Clear all
            </Button>
          </div>
          <ul className={styles.cards}>
            {entries.map((entry) => {
              const { outputs, unmatched } = outputsFor(entry);
              const meta = [formatBytes(entry.file.size)];
              if (entry.parsed) {
                meta.push(`${entry.parsed.format.toUpperCase()}, ${entry.parsed.cues.length} cues`);
                if (secondary) meta.push(`with ${secondary.name}`);
              }
              return (
                <li key={entry.id} className={styles.card}>
                  <div className={styles.header}>
                    <div className={styles.identity}>
                      <p className={styles.fileName} title={entry.file.name}>{entry.file.name}</p>
                      <p className={styles.meta}>{entry.status === "reading" ? "Reading..." : meta.join(", ")}</p>
                    </div>
                    <div className={styles.actions}>
                      <span className={`${styles.status} ${entry.status === "error" ? styles.statusError : entry.status === "ready" ? styles.statusDone : styles.statusIdle}`}>
                        {entry.status === "error" ? "Failed" : entry.status === "ready" ? "Ready" : "Reading"}
                      </span>
                      <Button onClick={() => setEntries((previous) => previous.filter((item) => item.id !== entry.id))} aria-label={`Remove ${entry.file.name}`} variant="ghost">
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
                  {unmatched > 0 && (
                    <p className={styles.note}>
                      {unmatched} second-language {unmatched === 1 ? "cue overlaps" : "cues overlap"} no first-language cue and {unmatched === 1 ? "is" : "are"} kept on {unmatched === 1 ? "its" : "their"} own.
                    </p>
                  )}
                  {outputs.length > 0 && (
                    <ul className={styles.outputs}>
                      {outputs.map((output) => (
                        <li key={output.target} className={styles.row}>
                          <div className={styles.rowLabel}>
                            <span className={styles.formatName}>{output.label}</span>
                            <span className={styles.tag}>.{output.fileName.split(".").pop()}</span>
                            <span className={styles.tag}>{output.cueCount} cues</span>
                          </div>
                          <div className={styles.rowState}>
                            <span className={styles.rowMeta}>{formatBytes(output.bytes)}</span>
                            <Button onClick={() => downloadText(output.fileName, output.text, output.mimeType)} variant="primary" aria-label={`Download ${output.fileName}`}>
                              <Download aria-hidden="true" size={14} strokeWidth={2} />
                              Download
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {readyEntries.length * settings.targets.length > 1 && (
            <div className={toolStyles.totalRow}>
              <p className={toolStyles.total}>{readyEntries.length * settings.targets.length} files ready</p>
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
