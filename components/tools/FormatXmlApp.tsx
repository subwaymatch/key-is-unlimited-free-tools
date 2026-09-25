"use client";

import { useMemo, useState } from "react";

import { INDENT_OPTIONS } from "@/lib/data/json";
import { formatBytes } from "@/lib/format-utils";
import { fileExtension, fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { PlainQueueOptions } from "@/lib/plainQueue";
import { describeXml, formatXml, parseXml, type XmlIndent } from "@/lib/text/xml";
import { readXmlText, XML_ACCEPT, xmlProblem } from "@/lib/text/xmlFile";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("format-xml");

/** Past this an XML file cannot be held as a tree in a tab. */
const MAX_BYTES = 200 * 1024 * 1024;

interface XmlSettings {
  indent: XmlIndent;
  dropComments: boolean;
}

function isXmlSettings(value: unknown): value is XmlSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<XmlSettings>;
  return INDENT_OPTIONS.some((option) => option.id === candidate.indent) && typeof candidate.dropComments === "boolean";
}

/** XML checked and written out again, indented or minified. */
export function FormatXmlApp() {
  const [settings, setSettings] = useState<XmlSettings>({ indent: 2, dropComments: false });
  useStoredSettings(storageKey("settings", "format-xml"), settings, setSettings, isXmlSettings);

  const queue = useMemo<PlainQueueOptions<XmlSettings>>(
    () => ({
      key: "format-xml",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, which is not XML." } : file.size > MAX_BYTES ? { message: "This file is too large to format in a browser tab.", hint: `XML has to be read whole; this reads files up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const text = await readXmlText(file);
        report("Parsing...", null);
        let document;
        try {
          document = parseXml(text);
        } catch (error) {
          throw xmlProblem(error);
        }
        report("Writing...", null);
        const output = formatXml(document, current);
        const shape = describeXml(document);
        const facts = [`<${document.root.name}>, ${shape.elements.toLocaleString("en")} ${shape.elements === 1 ? "element" : "elements"}, ${shape.depth} ${shape.depth === 1 ? "level" : "levels"} deep`];
        if (output === text.replace(/^﻿/, "")) return { facts, outputs: [], nothing: { message: "This file is already written that way.", hint: "Well-formed XML, and formatted exactly as asked." } };
        const minified = current.indent === "none";
        const blob = new Blob([output], { type: "application/xml;charset=utf-8" });
        const extension = fileExtension(file.name) ?? "xml";
        return {
          facts,
          outputs: [{ label: minified ? "Minified XML" : "Formatted XML", fileName: `${fileStem(file.name, "document")}-${minified ? "minified" : "formatted"}.${extension}`, blob, kind: "file", note: `${formatBytes(blob.size)} from ${formatBytes(file.size)}${current.dropComments ? ", comments removed" : ""}` }],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Indentation & comments",
    summary: () => `${INDENT_OPTIONS.find((option) => option.id === settings.indent)?.label.toLowerCase()}${settings.dropComments ? ", comments removed" : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Indentation</legend>
          <RadioCards aria-label="Indentation" value={String(settings.indent)} onValueChange={(value) => setSettings((previous) => ({ ...previous, indent: value === "tab" || value === "none" ? value : (Number(value) as 2 | 4) }))} options={INDENT_OPTIONS.map((option) => ({ value: String(option.id), label: option.label, blurb: option.blurb }))} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Comments</legend>
          <CheckboxCards aria-label="Comments" value={settings.dropComments ? ["drop"] : []} onValueChange={(next) => setSettings((previous) => ({ ...previous, dropComments: next.includes("drop") }))} options={[{ value: "drop", label: "Remove comments", blurb: "Everything between <!-- and -->" }]} />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop an XML file - a config, a feed, a sitemap, an export, an SVG - and get it back indented so it can be read, or minified to one line, or told exactly where it breaks: the line, the column and what is wrong. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Formatting"
      dropZone={{ accept: XML_ACCEPT, inputLabel: "Choose XML files", headline: "Drop XML files here", subhead: "Formatted as they land" }}
      note="Whitespace between tags is layout and is replaced; whitespace inside text is content and is kept, so an element that mixes text and tags, like a paragraph with a bold word, stays on one line exactly as it was, and so does anything marked xml:space=&quot;preserve&quot;. Entities stay as they were written. A DTD is kept but not read, so an entity it declares is left for the next reader to expand."
    />
  );
}
