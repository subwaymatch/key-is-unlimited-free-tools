"use client";

import { useMemo } from "react";

import { BLOCKS, coverage, FontError, readFont, WEIGHTS, type FontInfo } from "@/lib/files/font";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("inspect-font");

const ACCEPT = ".ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2,application/font-woff";
const MAX_BYTES = 64 * 1024 * 1024;

const show = (code: number) => (code === 0x20 ? "space" : `${String.fromCodePoint(code)} U+${code.toString(16).toUpperCase().padStart(4, "0")}`);

function report(name: string, font: FontInfo): string {
  const { blocks, languages } = coverage(font.codePoints);
  const out = [`# ${font.names.fullName ?? font.names.family ?? name}`, ""];
  const field = (label: string, value: string | undefined | null) => value && out.push(`- ${label}: ${value.replace(/\s+/g, " ")}`);
  field("Family", font.names.typographicFamily ?? font.names.family);
  field("Style", font.names.typographicSubfamily ?? font.names.subfamily);
  field("Version", font.names.version);
  field("PostScript name", font.names.postScriptName);
  field("Format", `${font.flavor}${font.fonts > 1 ? `, first of ${font.fonts} fonts` : ""}`);
  field("Weight", font.weight !== null ? `${font.weight}${WEIGHTS[font.weight] ? ` (${WEIGHTS[font.weight]})` : ""}` : null);
  field("Glyphs", font.glyphs.toLocaleString("en"));
  field("Characters", font.codePoints.size.toLocaleString("en"));
  field("Units per em", String(font.unitsPerEm));
  field("Created", font.created?.toISOString().slice(0, 10));
  field("Modified", font.modified?.toISOString().slice(0, 10));
  field("Designer", font.names.designer);
  field("Maker", font.names.manufacturer ?? font.vendor);
  field("Embedding", font.embedding);
  field("Licence", font.names.license);
  field("Licence URL", font.names.licenseUrl);
  field("Copyright", font.names.copyright);
  if (font.axes.length > 0) field("Variable", `${font.axes.map((axis) => `${axis.tag} ${axis.min} to ${axis.max} (default ${axis.default})`).join("; ")}, ${font.instances} named instances`);
  if (font.color.length > 0) field("Colour glyphs", font.color.join(", "));
  out.push("", "## Languages", "");
  for (const language of languages) {
    const have = language.total - language.missing.length;
    if (have === 0) continue;
    out.push(`- ${language.name}: ${language.missing.length === 0 ? "yes" : `partly, ${have} of ${language.total}; missing ${language.missing.slice(0, 20).map((code) => String.fromCodePoint(code)).join(" ")}${language.missing.length > 20 ? " ..." : ""}`}`);
  }
  out.push("", "## Unicode blocks", "", "| Block | Characters |", "| --- | ---: |");
  for (const block of blocks) out.push(`| ${block.name} | ${block.covered} of ${block.total} |`);
  if (font.features.length > 0) out.push("", "## OpenType features", "", font.features.map((feature) => `\`${feature.trim()}\``).join(", "));
  if (font.scripts.length > 0) out.push("", "## Scripts with layout rules", "", font.scripts.map((script) => `\`${script.trim()}\``).join(", "));
  out.push("", "## Tables", "", "| Table | Bytes |", "| --- | ---: |", ...font.tables.map((table) => `| ${table.tag} | ${table.size.toLocaleString("en")} |`));
  return `${out.join("\n")}\n`;
}

function characterList(font: FontInfo): string {
  const lines: string[] = [];
  const points = [...font.codePoints].sort((a, b) => a - b);
  for (const [name, from, to] of BLOCKS) {
    const inside = points.filter((code) => code >= from && code <= to && code > 0x20);
    if (inside.length > 0) lines.push(`${name} (${inside.length})`, inside.map((code) => String.fromCodePoint(code)).join(" "), "");
  }
  const outside = points.filter((code) => code > 0x20 && !BLOCKS.some(([, from, to]) => code >= from && code <= to));
  if (outside.length > 0) lines.push(`Other (${outside.length})`, outside.map((code) => String.fromCodePoint(code)).join(" "), "");
  return lines.join("\n");
}

let loaded = 0;

/** A specimen drawn with the font itself, through the browser's own font loader. */
async function specimen(bytes: Uint8Array, title: string, sample: number[]): Promise<Blob | null> {
  if (typeof FontFace !== "function" || typeof document === "undefined") return null;
  const family = `key-is-specimen-${(loaded += 1)}`;
  const face = new FontFace(family, bytes.slice().buffer as ArrayBuffer);
  try {
    await face.load();
  } catch {
    return null;
  }
  document.fonts.add(face);
  try {
    const width = 1200;
    const cells = sample.slice(0, 240);
    const rows = Math.ceil(cells.length / 20);
    const height = 360 + rows * 60 + 40;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#6b7280";
    context.font = "16px system-ui, sans-serif";
    context.fillText(title, 40, 40);
    context.fillStyle = "#111827";
    let y = 110;
    for (const size of [56, 32, 20, 14]) {
      context.font = `${size}px "${family}"`;
      context.fillText(size >= 32 ? "The quick brown fox jumps" : "The quick brown fox jumps over the lazy dog. 0123456789 ?!&@", 40, y);
      y += size + 26;
    }
    y += 20;
    context.strokeStyle = "#e5e7eb";
    cells.forEach((code, index) => {
      const x = 40 + (index % 20) * 56;
      const top = y + Math.floor(index / 20) * 60;
      context.strokeRect(x, top, 52, 56);
      context.fillStyle = "#111827";
      context.font = `30px "${family}"`;
      context.textAlign = "center";
      context.fillText(String.fromCodePoint(code), x + 26, top + 36);
      context.fillStyle = "#9ca3af";
      context.font = "9px system-ui, sans-serif";
      context.fillText(code.toString(16).toUpperCase().padStart(4, "0"), x + 26, top + 52);
      context.textAlign = "start";
    });
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  } finally {
    document.fonts.delete(face);
  }
}

/** What a font file is, what it covers and what it may be used for. */
export function InspectFontApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "inspect-font",
      settings: {},
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, which is not a font." } : file.size > MAX_BYTES ? { message: "This file is too large for a font.", hint: `This reads fonts up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, _settings, progress) => {
        progress("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const stem = fileStem(file.name, "font");
        let font: FontInfo | null = null;
        let unreadable: string | null = null;
        try {
          font = readFont(bytes);
        } catch (error) {
          if (!(error instanceof FontError)) throw error;
          unreadable = error.message;
        }
        progress("Drawing a specimen...", null);
        const sample = font ? [...font.codePoints].filter((code) => code > 0x20 && code !== 0xad).sort((a, b) => a - b) : [...Array(95).keys()].map((index) => index + 0x21);
        const picture = await specimen(bytes, font ? `${font.names.fullName ?? font.names.family ?? file.name}, ${font.glyphs.toLocaleString("en")} glyphs` : file.name, sample);
        if (!font) {
          if (!picture) throw new PlainError(unreadable ?? "This font cannot be read.", "The browser could not load it either, so it may be damaged.");
          return {
            notes: [unreadable ?? ""],
            outputs: [{ label: "Specimen", fileName: `${stem}-specimen.png`, blob: picture, kind: "image", note: "Drawn by the browser, which reads WOFF2 itself" }],
          };
        }
        const { languages } = coverage(font.codePoints);
        const supported = languages.filter((language) => language.missing.length === 0).map((language) => language.name.replace(/ \(.*\)$/, ""));
        const facts = [
          `Font: ${font.names.fullName ?? font.names.family ?? file.name}${font.names.version ? `, ${font.names.version.replace(/^Version\s*/i, "version ")}` : ""}`,
          `Format: ${font.flavor}${font.axes.length > 0 ? `, variable (${font.axes.map((axis) => axis.tag).join(", ")})` : ""}${font.color.length > 0 ? `, colour (${font.color.join(", ")})` : ""}`,
          `Glyphs: ${font.glyphs.toLocaleString("en")}, for ${font.codePoints.size.toLocaleString("en")} characters`,
          `Languages: ${supported.length > 0 ? supported.join(", ") : "none of the common ones completely"}`,
        ];
        if (font.embedding) facts.push(`Embedding: ${font.embedding}`);
        const notes: string[] = [];
        if (font.names.license) notes.push(`Licence: ${font.names.license.slice(0, 280)}${font.names.license.length > 280 ? "..." : ""}`);
        const missingEuro = !font.codePoints.has(0x20ac) && font.codePoints.has(0x41);
        if (missingEuro) notes.push(`It has no euro sign (${show(0x20ac)}).`);
        const outputs: PlainOutputSpec[] = [
          { label: "Report", fileName: `${stem}-font-report.md`, blob: new Blob([report(file.name, font)], { type: "text/markdown;charset=utf-8" }), kind: "file", note: "Names, licence, languages, Unicode blocks, features and tables" },
          { label: "Every character", fileName: `${stem}-characters.txt`, blob: new Blob([characterList(font)], { type: "text/plain;charset=utf-8" }), kind: "file", note: "Grouped by Unicode block, to copy from" },
        ];
        if (picture) outputs.unshift({ label: "Specimen", fileName: `${stem}-specimen.png`, blob: picture, kind: "image", note: `Sizes from 56 to 14 px and the first ${Math.min(240, sample.length)} characters` });
        return { facts, notes, outputs };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a font file - .ttf, .otf, .woff or a collection - and see what it is: its name and version, its licence and whether it may be embedded, how many glyphs it has, which languages it can set and which characters are missing, its OpenType features and variable axes, with a specimen drawn in it. Nothing is uploaded."
      queue={queue}
      busyLabel="Reading"
      dropZone={{ accept: ACCEPT, inputLabel: "Choose fonts", headline: "Drop font files here", subhead: ".ttf, .otf, .ttc, .woff and .woff2" }}
      note="The characters a font covers come from its cmap table, the list of which character each glyph draws; a language counts as supported when every letter it needs is there. The embedding permission is the one the font's OS/2 table declares, which PDF writers and word processors obey; the licence text is the font's own and is what actually binds. WOFF2 is compressed in a way this cannot unpack yet, so for a .woff2 file only the specimen is drawn, by the browser's own font loader."
    />
  );
}
