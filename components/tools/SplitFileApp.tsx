"use client";

import { useMemo, useState } from "react";

import { joinCommands, PART_SIZE_OPTIONS, partCount, partName } from "@/lib/files/parts";
import { formatBytes } from "@/lib/format-utils";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("split-file");

/** More pieces than this is not a split anyone wants, and not a page that renders. */
const MAX_PARTS = 500;

const CUSTOM = "custom";

interface SplitSettings {
  /** Bytes per piece. */
  partBytes: number;
  /** The custom size as typed, in megabytes. */
  customMb: string;
}

function isSplitSettings(value: unknown): value is SplitSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SplitSettings>;
  return typeof candidate.partBytes === "number" && candidate.partBytes > 0 && typeof candidate.customMb === "string";
}

function choiceFor(settings: SplitSettings): string {
  return PART_SIZE_OPTIONS.some((option) => option.bytes === settings.partBytes) ? String(settings.partBytes) : CUSTOM;
}

/** A file in numbered pieces of a size. */
export function SplitFileApp() {
  const [settings, setSettings] = useState<SplitSettings>({ partBytes: PART_SIZE_OPTIONS[1].bytes, customMb: "50" });
  useStoredSettings(storageKey("settings", "split-file"), settings, setSettings, isSplitSettings);

  const choice = choiceFor(settings);
  const customInvalid = choice === CUSTOM && !(Number(settings.customMb) > 0);

  const queue = useMemo<PlainQueueOptions<SplitSettings>>(
    () => ({
      key: "split-file",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes; there is nothing to split." } : null),
      run: async (file, current) => {
        const count = partCount(file.size, current.partBytes);
        if (count === 1) {
          return { facts: [formatBytes(file.size)], outputs: [], nothing: { message: `This file is already under ${formatBytes(current.partBytes)}.`, hint: "One piece would be the whole file." } };
        }
        if (count > MAX_PARTS) {
          throw new PlainError(`That would be ${count.toLocaleString("en")} pieces.`, `This makes up to ${MAX_PARTS}; choose a larger piece size.`);
        }
        const commands = joinCommands(file.name, count);
        return {
          facts: [`${count} pieces of ${formatBytes(current.partBytes)}`],
          notes: [
            `To join them without this site: on macOS or Linux, ${commands.unix}; on Windows, ${commands.windows}. Or drop the pieces on the join tool here.`,
          ],
          outputs: Array.from({ length: count }, (_, index) => {
            const start = index * current.partBytes;
            const end = Math.min(file.size, start + current.partBytes);
            return { label: `Piece ${index + 1} of ${count}`, fileName: partName(file.name, index + 1, count), blob: file.slice(start, end), kind: "file" as const, note: index === count - 1 ? "the last piece, and whatever was left" : undefined };
          }),
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Piece size",
    defaultOpen: true,
    invalid: () => (customInvalid ? "Type a number of megabytes above zero." : null),
    summary: () => formatBytes(settings.partBytes),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Each piece at most</legend>
        <RadioCards
          aria-label="Each piece at most"
          value={choice}
          onValueChange={(value) => setSettings((previous) => (value === CUSTOM ? { ...previous, partBytes: Math.max(1, Math.round(Number(previous.customMb) * 1000 * 1000)) || 1 } : { ...previous, partBytes: Number(value) }))}
          options={[...PART_SIZE_OPTIONS.map((option) => ({ value: String(option.bytes), label: option.label, blurb: option.blurb })), { value: CUSTOM, label: "Custom", blurb: "Any number of megabytes" }]}
        />
        {choice === CUSTOM && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Megabytes</span>
              <input type="number" inputMode="decimal" min={1} step="1" value={settings.customMb} aria-invalid={customInvalid} onChange={(event) => setSettings((previous) => ({ ...previous, customMb: event.target.value, partBytes: Math.max(1, Math.round(Number(event.target.value) * 1000 * 1000)) || previous.partBytes }))} className={styles.input} />
            </label>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a file too large for an email, a chat, an upload form or an old disk, and get it back in numbered pieces of the size you choose, to send one at a time and join again at the other end - here, or with one command. Nothing is uploaded, and nothing is copied: each piece is a slice of the file."
      queue={queue}
      settings={toolSettings}
      busyLabel="Slicing"
      dropZone={{ accept: "*/*", inputLabel: "Choose files", headline: "Drop any file here", subhead: `Cut into pieces of ${formatBytes(settings.partBytes)} as they land - change it above` }}
      note="The pieces are the file's bytes in order and nothing else - no header, no compression - named the way split names them, .001, .002 and so on, so they join with cat on macOS or Linux, copy /b on Windows, or the join tool here. A piece is the file's own bytes and cannot be opened on its own. Download all as a ZIP packs every piece into one archive, which is rarely what a split is for; the pieces are meant to go separately."
    />
  );
}
