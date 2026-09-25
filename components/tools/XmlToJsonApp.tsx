"use client";

import { useMemo, useState } from "react";

import { parseJson } from "@/lib/data/json";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { describeXml, jsonToXml, parseXml, xmlToJson } from "@/lib/text/xml";
import { readXmlText, XML_ACCEPT, xmlProblem } from "@/lib/text/xmlFile";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import styles from "../Settings.module.css";

const tool = requireTool("xml-to-json");

const MAX_BYTES = 200 * 1024 * 1024;

interface ConvertSettings {
  typed: boolean;
}

function isConvertSettings(value: unknown): value is ConvertSettings {
  return typeof value === "object" && value !== null && typeof (value as Partial<ConvertSettings>).typed === "boolean";
}

/** XML as JSON, and JSON as XML, by one convention both ways. */
export function XmlToJsonApp() {
  const [settings, setSettings] = useState<ConvertSettings>({ typed: true });
  useStoredSettings(storageKey("settings", "xml-to-json"), settings, setSettings, isConvertSettings);

  const queue = useMemo<PlainQueueOptions<ConvertSettings>>(
    () => ({
      key: "xml-to-json",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, so there is nothing to convert." } : file.size > MAX_BYTES ? { message: "This file is too large to convert in a browser tab.", hint: `It has to be read whole; this reads files up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await readXmlText(file);
        const stem = fileStem(file.name, "data");
        const start = text.replace(/^﻿/, "").trimStart();
        if (start.startsWith("{") || start.startsWith("[")) {
          const parsed = parseJson(text);
          if ("problem" in parsed) throw new PlainError("This file starts like JSON but is not valid JSON.", parsed.problem.line ? `Line ${parsed.problem.line}, column ${parsed.problem.column}: ${parsed.problem.message}` : parsed.problem.message);
          report("Writing XML...", null);
          const xml = jsonToXml(parsed.value, "root", 2);
          return {
            facts: ["JSON, so converting to XML"],
            outputs: [{ label: "XML", fileName: `${stem}.xml`, blob: new Blob([xml], { type: "application/xml;charset=utf-8" }), kind: "file", note: formatBytes(new Blob([xml]).size) }],
          };
        }
        let document;
        try {
          document = parseXml(text);
        } catch (error) {
          throw xmlProblem(error);
        }
        report("Writing JSON...", null);
        const json = `${JSON.stringify(xmlToJson(document, current), null, 2)}\n`;
        const shape = describeXml(document);
        return {
          facts: ["XML, so converting to JSON", `Root: <${document.root.name}>, ${shape.elements.toLocaleString("en")} elements`],
          outputs: [{ label: "JSON", fileName: `${stem}.json`, blob: new Blob([json], { type: "application/json;charset=utf-8" }), kind: "file", note: `${formatBytes(new Blob([json]).size)}${current.typed ? ", numbers and true/false typed" : ", every value a string"}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Values",
    summary: () => (settings.typed ? "numbers and true/false as JSON values" : "every value a string"),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>XML to JSON</legend>
        <CheckboxCards aria-label="XML to JSON" value={settings.typed ? ["typed"] : []} onValueChange={(next) => setSettings({ typed: next.includes("typed") })} options={[{ value: "typed", label: "Numbers and true/false as JSON values", blurb: "12 rather than \"12\"; 007 and 1.50 stay text, since a number would lose them" }]} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an XML file and get it as JSON, or drop a JSON file and get it as XML: attributes as keys starting with @, text beside them as #text, and an element that repeats as an array, the convention most converters share. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: `${XML_ACCEPT},.json,application/json`, inputLabel: "Choose XML or JSON files", headline: "Drop XML or JSON files here", subhead: "Which way it goes is read off the file" }}
      note="An element holding only text becomes that text; one with attributes or children becomes an object; a child that appears more than once becomes an array, so a list with one item comes out as a single value, which is the price of this convention. Namespace prefixes stay part of the names. Going the other way, a key that is not a valid element name is made into one, and JSON that has come from this page goes back to the XML it came from."
    />
  );
}
