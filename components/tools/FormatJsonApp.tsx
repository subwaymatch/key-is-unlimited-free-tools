"use client";

import { useMemo, useState } from "react";

import { describeJson, formatJson, INDENT_OPTIONS, jsonDepth, looksLikeJsonLines, parseJson, sortKeysDeep, stripBom, type JsonIndent } from "@/lib/data/json";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import { describeProblem } from "./JsonToCsvApp";
import styles from "../Settings.module.css";

const tool = requireTool("format-json");

const ACCEPT = ".json,.geojson,.jsonc,.txt,application/json,text/plain";

/** Past this the whole file has to be parsed into memory at once, which a tab cannot do. */
const MAX_BYTES = 512 * 1024 * 1024;

interface FormatSettings {
  indent: JsonIndent;
  sortKeys: boolean;
}

function isFormatSettings(value: unknown): value is FormatSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FormatSettings>;
  return INDENT_OPTIONS.some((option) => option.id === candidate.indent) && typeof candidate.sortKeys === "boolean";
}

/** JSON checked and written out again, indented or minified. */
export function FormatJsonApp() {
  const [settings, setSettings] = useState<FormatSettings>({ indent: 2, sortKeys: false });
  useStoredSettings(storageKey("settings", "format-json"), settings, setSettings, isFormatSettings);

  const queue = useMemo<PlainQueueOptions<FormatSettings>>(
    () => ({
      key: "format-json",
      settings,
      reject: (file) =>
        file.size === 0
          ? { message: "This file is empty.", hint: "It is 0 bytes, which is not JSON." }
          : file.size > MAX_BYTES
            ? { message: "This file is too large to parse in a browser tab.", hint: `JSON has to be read whole; this reads files up to ${formatBytes(MAX_BYTES)}.` }
            : null,
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await file.text();
        report("Parsing...", null);
        const parsed = parseJson(text);
        if ("problem" in parsed) {
          const hint = describeProblem(parsed.problem);
          throw new PlainError("This file is not valid JSON.", looksLikeJsonLines(text) ? `${hint} It looks like JSON Lines - one value per line - which is not one JSON document; JSON to CSV reads those.` : hint);
        }
        report("Writing...", null);
        const value = current.sortKeys ? sortKeysDeep(parsed.value) : parsed.value;
        const output = formatJson(value, current.indent);
        const facts = [`${describeJson(parsed.value)}, ${jsonDepth(parsed.value)} ${jsonDepth(parsed.value) === 1 ? "level" : "levels"} deep`];
        if (output === stripBom(text)) {
          return { facts, outputs: [], nothing: { message: "This file is already written that way.", hint: "Valid JSON, and formatted exactly as asked." } };
        }
        const minified = current.indent === "none";
        const blob = new Blob([output], { type: "application/json;charset=utf-8" });
        return {
          facts,
          outputs: [{ label: minified ? "Minified JSON" : "Formatted JSON", fileName: `${fileStem(file.name, "data")}-${minified ? "minified" : "formatted"}.json`, blob, kind: "file", note: `${formatBytes(blob.size)} from ${formatBytes(file.size)}${current.sortKeys ? ", keys sorted" : ""}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Indentation & keys",
    summary: () => `${INDENT_OPTIONS.find((option) => option.id === settings.indent)?.label.toLowerCase()}${settings.sortKeys ? ", keys sorted" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Indentation</legend>
          <RadioCards aria-label="Indentation" value={String(settings.indent)} onValueChange={(value) => setSettings((previous) => ({ ...previous, indent: value === "tab" || value === "none" ? value : (Number(value) as JsonIndent) }))} options={INDENT_OPTIONS.map((option) => ({ value: String(option.id), label: option.label, blurb: option.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Keys</legend>
          <RadioCards
            aria-label="Keys"
            value={settings.sortKeys ? "sorted" : "kept"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, sortKeys: value === "sorted" }))}
            options={[
              { value: "kept", label: "In their order", blurb: "As the file has them" },
              { value: "sorted", label: "Sorted", blurb: "Alphabetical at every level, so two files diff cleanly" },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a JSON file and get it back indented for reading, or minified to the smallest file, with the keys sorted if you like; a file that does not parse says where it broke, by line and column. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Formatting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose JSON files", headline: "Drop JSON files here", subhead: "Checked and rewritten as they land" }}
      note="The file is parsed by the browser's own JSON reader and written back by it, so what comes out is exactly the same data: numbers, strings and order, apart from the order of keys when sorting is on. Comments and trailing commas are not JSON and are reported as errors. A file has to be read whole to be parsed, so very large ones need that much room in the browser."
    />
  );
}
