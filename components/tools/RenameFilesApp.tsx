"use client";

import { useMemo, useState } from "react";

import { CASE_CHANGES, DEFAULT_RENAME_SETTINGS, describeRename, PATTERN_PRESETS, patternDistinguishes, renamePlan, type CaseChange, type RenameSettings } from "@/lib/files/rename";
import { formatBytes } from "@/lib/format-utils";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { CombineOptions, PlainOutputSpec } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";
import { createZip, MAX_ZIP_BYTES } from "@/lib/zip/archive";

import { CombineApp } from "../CombineApp";
import type { PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("rename-files");

const CUSTOM = "custom";

/** Past this many the card lists the ZIP and the plan, not a row per file. */
const MAX_ROWS = 40;

function isRenameSettings(value: unknown): value is RenameSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RenameSettings>;
  return typeof candidate.pattern === "string" && typeof candidate.find === "string" && typeof candidate.replace === "string" && CASE_CHANGES.some((change) => change.id === candidate.caseChange) && typeof candidate.start === "number" && typeof candidate.padding === "number";
}

function presetFor(settings: RenameSettings): string {
  return PATTERN_PRESETS.some((preset) => preset.pattern === settings.pattern.trim()) ? settings.pattern.trim() : CUSTOM;
}

/** Files renamed by a pattern, handed back as a ZIP. */
export function RenameFilesApp() {
  const [settings, setSettings] = useState<RenameSettings>(DEFAULT_RENAME_SETTINGS);
  useStoredSettings(storageKey("settings", "rename-files"), settings, setSettings, isRenameSettings);

  const preset = presetFor(settings);
  const patternProblem = settings.pattern.trim() === "" ? "Type a pattern." : !patternDistinguishes(settings.pattern) ? 'Without {name}, {n} or {original} every file would get the same name; add one of them.' : null;

  const queue = useMemo<CombineOptions<RenameSettings>>(
    () => ({
      key: "rename-files",
      settings,
      reject: (file) => (file.size > MAX_ZIP_BYTES ? { message: "This file is too large for a ZIP without ZIP64.", hint: `Files up to ${formatBytes(MAX_ZIP_BYTES)} can be packed.` } : null),
      run: async (files, current, report, signal) => {
        const plan = renamePlan(files, current);
        const changed = plan.filter((entry) => entry.from !== entry.to);
        if (changed.length === 0) return { outputs: [], nothing: { message: "The pattern leaves every name as it is.", hint: "Change the pattern, find something to replace, or change the case." } };
        const renamed = files.map((file, index) => new File([file], plan[index].to, { type: file.type, lastModified: file.lastModified }));
        const total = files.reduce((sum, file) => sum + file.size, 0);
        report("Packing...", 0);
        const zip = await createZip(renamed, (done) => report(`Packing... ${formatBytes(done)} of ${formatBytes(total)}`, total > 0 ? done / total : null), signal);
        const list = `${plan.map((entry) => `${entry.from} -> ${entry.to}`).join("\n")}\n`;
        const outputs: PlainOutputSpec[] = [
          { label: "The renamed files, as a ZIP", fileName: "renamed-files.zip", blob: zip, kind: "file", note: `${files.length} ${files.length === 1 ? "file" : "files"}, ${changed.length} renamed` },
          { label: "What was renamed to what", fileName: "renamed-files.txt", blob: new Blob([list], { type: "text/plain;charset=utf-8" }), kind: "text", text: list },
        ];
        if (renamed.length <= MAX_ROWS) {
          for (const [index, file] of renamed.entries()) outputs.push({ label: plan[index].from === plan[index].to ? "Unchanged" : `Was ${plan[index].from}`, fileName: file.name, blob: file, kind: "file" });
        }
        return { notes: renamed.length > MAX_ROWS ? [`The files are in the ZIP; with ${renamed.length} of them the card does not list each one.`] : [], outputs };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "New names",
    defaultOpen: true,
    invalid: () => patternProblem,
    summary: () => describeRename(settings),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Pattern</legend>
          <RadioCards
            aria-label="Pattern"
            value={preset}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, pattern: value === CUSTOM ? (presetFor(previous) === CUSTOM ? previous.pattern : "{n}-{name}") : value }))}
            options={[...PATTERN_PRESETS.map((entry) => ({ value: entry.pattern, label: entry.label, blurb: entry.blurb })), { value: CUSTOM, label: "My own pattern", blurb: "Typed below, with {name}, {n}, {date}, {ext} and {original}" }]}
          />
          {preset === CUSTOM && (
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Pattern</span>
                <input type="text" value={settings.pattern} placeholder="{date}-{n}-{name}" spellCheck={false} aria-invalid={patternProblem !== null} onChange={(event) => setSettings((previous) => ({ ...previous, pattern: event.target.value }))} className={styles.input} style={{ width: "18rem" }} />
              </label>
              <p className={styles.panelNote}>{"{name}"} is the old name without its extension, {"{n}"} a counter, {"{date}"} the day the file was last changed, {"{ext}"} the extension and {"{original}"} the whole old name. The extension is kept unless the pattern places it.</p>
            </div>
          )}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Find and replace in the name</legend>
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Find</span>
              <input type="text" value={settings.find} placeholder="IMG_" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, find: event.target.value }))} className={styles.input} style={{ width: "10rem" }} />
            </label>{" "}
            <label>
              <span className={styles.fieldLabel}>Replace with</span>
              <input type="text" value={settings.replace} placeholder="holiday-" spellCheck={false} onChange={(event) => setSettings((previous) => ({ ...previous, replace: event.target.value }))} className={styles.input} style={{ width: "10rem" }} />
            </label>
            <p className={styles.panelNote}>Plain text, matched exactly, every time it appears. Leave Find empty to skip this.</p>
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Case</legend>
          <RadioCards aria-label="Case" value={settings.caseChange} onValueChange={(caseChange) => setSettings((previous) => ({ ...previous, caseChange: caseChange as CaseChange }))} options={CASE_CHANGES.map((change) => ({ value: change.id, label: change.label, blurb: change.blurb }))} columns={2} />
        </fieldset>
        {/\{n\}/.test(settings.pattern) && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Counter</legend>
            <div className={styles.panel}>
              <label>
                <span className={styles.fieldLabel}>Start at</span>
                <input type="number" inputMode="numeric" min={0} step="1" value={settings.start} onChange={(event) => setSettings((previous) => ({ ...previous, start: Math.max(0, Math.round(Number(event.target.value)) || 0) }))} className={styles.input} style={{ width: "6rem" }} />
              </label>{" "}
              <label>
                <span className={styles.fieldLabel}>Digits</span>
                <input type="number" inputMode="numeric" min={1} max={8} step="1" value={settings.padding} onChange={(event) => setSettings((previous) => ({ ...previous, padding: Math.max(1, Math.min(8, Math.round(Number(event.target.value)) || 1)) }))} className={styles.input} style={{ width: "6rem" }} />
              </label>
              <p className={styles.panelNote}>Files are numbered in the order of the list below.</p>
            </div>
          </fieldset>
        )}
      </>
    ),
  };

  return (
    <CombineApp
      tool={tool}
      lead="Drop files and get them back renamed by a pattern - numbered in order, dated, with IMG_ replaced by something you would type, in lower case - as a ZIP to unpack over the originals, with a list of what became what. A browser cannot rename files where they sit, so this is the next best thing. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      action="Rename the files"
      minFiles={1}
      noun="files"
      busyLabel="Packing"
      summary={(files) => {
        if (files.length === 0 || patternProblem) return null;
        const plan = renamePlan(files.map((entry) => entry.file), settings);
        const shown = plan.slice(0, 3).map((entry) => `${entry.from} -> ${entry.to}`).join("; ");
        return `${shown}${plan.length > 3 ? `; and ${plan.length - 3} more` : ""}.`;
      }}
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop files here", subhead: "Renamed in the order below; arrange them, then press the button" }}
      note="The counter follows the order of the list, which is the order the files were dropped in unless they are moved. Two files that would get the same name are told apart by a number in brackets. Characters no file system takes in a name are dropped. The files' bytes are not touched: the ZIP holds each one as it was, under its new name, with its date kept."
    />
  );
}
