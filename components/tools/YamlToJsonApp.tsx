"use client";

import { useMemo, useState } from "react";

import { describeJson, formatJson, INDENT_OPTIONS, parseJson, type JsonIndent } from "@/lib/data/json";
import { parseYaml, toYaml, YamlError } from "@/lib/data/yaml";
import { formatBytes } from "@/lib/format-utils";
import { fileExtension, fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { detectEncoding, looksBinary } from "@/lib/text/encoding";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("yaml-to-json");

const ACCEPT = ".yaml,.yml,.json,.geojson,.jsonc,application/yaml,application/x-yaml,text/yaml,application/json";

/** Past this a document cannot be held as a tree in a tab. */
const MAX_BYTES = 128 * 1024 * 1024;

type Direction = "auto" | "json" | "yaml";

interface YamlSettings {
  direction: Direction;
  indent: JsonIndent;
}

const DIRECTIONS: { value: Direction; label: string; blurb: string }[] = [
  { value: "auto", label: "Whichever it is not", blurb: "YAML becomes JSON, JSON becomes YAML" },
  { value: "json", label: "Always JSON", blurb: "YAML or JSON in, JSON out" },
  { value: "yaml", label: "Always YAML", blurb: "Also tidies a YAML file into one consistent style" },
];

function isYamlSettings(value: unknown): value is YamlSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<YamlSettings>;
  return DIRECTIONS.some((direction) => direction.value === candidate.direction) && INDENT_OPTIONS.some((option) => option.id === candidate.indent);
}

function looksJson(name: string, text: string): boolean {
  const extension = (fileExtension(name) ?? "").toLowerCase();
  if (extension === "json" || extension === "geojson" || extension === "jsonc") return true;
  if (extension === "yaml" || extension === "yml") return false;
  return /^\s*[[{]/.test(text) && "value" in parseJson(text);
}

/** YAML turned into JSON and JSON into YAML. */
export function YamlToJsonApp() {
  const [settings, setSettings] = useState<YamlSettings>({ direction: "auto", indent: 2 });
  useStoredSettings(storageKey("settings", "yaml-to-json"), settings, setSettings, isYamlSettings);

  const queue = useMemo<PlainQueueOptions<YamlSettings>>(
    () => ({
      key: "yaml-to-json",
      settings,
      reject: (file) => (file.size > MAX_BYTES ? { message: "This file is too large to convert in a browser tab.", hint: `It has to be read whole; this reads files up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sample = bytes.subarray(0, 64 * 1024);
        if (looksBinary(sample)) throw new PlainError("This is not a text file.", "YAML and JSON are plain text, and this file has bytes no text has.");
        const text = new TextDecoder(detectEncoding(sample).encoding).decode(bytes);
        const fromJson = looksJson(file.name, text);
        const toJson = current.direction === "json" || (current.direction === "auto" && !fromJson);
        report("Parsing...", null);
        let documents: unknown[];
        if (fromJson) {
          const parsed = parseJson(text);
          if ("problem" in parsed) {
            const { problem } = parsed;
            throw new PlainError(`This is not valid JSON${problem.line !== null ? ` (line ${problem.line}, column ${problem.column})` : ""}.`, problem.near ? `${problem.message}, near: ${problem.near}` : problem.message);
          }
          documents = [parsed.value];
        } else {
          try {
            documents = parseYaml(text);
          } catch (error) {
            if (error instanceof YamlError) {
              const shown = text.split(/\r?\n/)[error.line - 1]?.trim();
              throw new PlainError(`This is not valid YAML. ${error.message}`, shown ? `The line reads: ${shown.slice(0, 80)}` : "Check the indentation there: YAML nests by spaces, never tabs.", { cause: error });
            }
            throw error;
          }
        }
        const stem = fileStem(file.name, "document");
        const multiple = documents.length > 1;
        const facts = [`Read as: ${fromJson ? "JSON" : multiple ? `YAML, ${documents.length} documents` : "YAML"}`];
        if (toJson) {
          report("Writing...", null);
          const value = documents.length === 0 ? null : multiple ? documents : documents[0];
          facts.push(`Contents: ${describeJson(value)}`);
          const blob = new Blob([formatJson(value, current.indent)], { type: "application/json;charset=utf-8" });
          const notes: string[] = [];
          if (multiple) notes.push(`The file holds ${documents.length} YAML documents, separated by ---, so the JSON is an array of them, in order.`);
          if (documents.length === 0) notes.push("The file has no YAML document in it, only comments or nothing, so the JSON is null.");
          if (!fromJson && /(^|\s)#/.test(text)) notes.push("Comments are not part of YAML's data, and JSON has no comments, so they are not carried over.");
          return { facts, notes, outputs: [{ label: "JSON", fileName: `${stem}.json`, blob, kind: "file", note: `${formatBytes(blob.size)}, ${INDENT_OPTIONS.find((option) => option.id === current.indent)?.label.toLowerCase()}` }] };
        }
        report("Writing...", null);
        const yaml = documents.length === 0 ? "" : documents.map((document) => toYaml(document)).join("---\n");
        const blob = new Blob([yaml], { type: "application/yaml;charset=utf-8" });
        const notes: string[] = [];
        if (!fromJson && /(^|\s)#/.test(text)) notes.push("Comments are not part of YAML's data, so rewriting the file drops them.");
        if (!fromJson && /(^|\s)[&*][A-Za-z0-9_-]+/.test(text)) notes.push("Anchors and aliases are written out in full wherever they were used.");
        return { facts, notes, outputs: [{ label: "YAML", fileName: `${stem}${fromJson ? "" : "-tidied"}.yaml`, blob, kind: "file", note: formatBytes(blob.size) }] };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Direction & indentation",
    summary: () => `${DIRECTIONS.find((direction) => direction.value === settings.direction)?.label.toLowerCase()}, JSON with ${INDENT_OPTIONS.find((option) => option.id === settings.indent)?.label.toLowerCase()}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Convert to</legend>
          <RadioCards aria-label="Convert to" value={settings.direction} onValueChange={(value) => setSettings((previous) => ({ ...previous, direction: value as Direction }))} options={DIRECTIONS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>JSON indentation</legend>
          <RadioCards aria-label="JSON indentation" value={String(settings.indent)} onValueChange={(value) => setSettings((previous) => ({ ...previous, indent: value === "tab" || value === "none" ? value : (Number(value) as 2 | 4) }))} options={INDENT_OPTIONS.map((option) => ({ value: String(option.id), label: option.label, blurb: option.blurb }))} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a YAML file - a Kubernetes manifest, a CI workflow, a Compose or config file - and get the same data as JSON, or drop JSON and get YAML. Broken YAML gets the line and what is wrong. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose YAML or JSON files", headline: "Drop YAML or JSON files here", subhead: "Converted as they land" }}
      note="YAML is read by the YAML 1.2 core schema, as current tools read it: yes, no, on and off stay strings rather than turning into true and false, while an unquoted version such as 1.10 is the number 1.1, as every YAML reader takes it. Anchors, aliases and << merge keys are expanded; block scalars, quoted strings and flow collections all read. Written YAML quotes any string that an older YAML 1.1 reader would take for something else. Custom tags beyond the standard ones are read as their plain value."
    />
  );
}
