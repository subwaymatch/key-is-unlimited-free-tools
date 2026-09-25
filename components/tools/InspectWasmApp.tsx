"use client";

import { useMemo } from "react";

import { describeMemory, guessToolchain, parseWasm, WasmError, type WasmModule } from "@/lib/files/wasm";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp } from "../PlainToolApp";

const tool = requireTool("inspect-wasm");

const MAX_BYTES = 512 * 1024 * 1024;

function report(name: string, wasm: WasmModule, valid: boolean | null): string {
  const out: string[] = [`# ${name}`, ""];
  out.push(`- Size: ${wasm.size.toLocaleString("en")} bytes`);
  out.push(`- Built with: ${guessToolchain(wasm)}`);
  if (wasm.moduleName) out.push(`- Module name: ${wasm.moduleName}`);
  out.push(`- Valid: ${valid === null ? "not checked" : valid ? "yes, this browser's engine accepts it" : "no, this browser's engine rejects it"}`);
  out.push(`- Functions: ${wasm.functions.toLocaleString("en")} defined, ${wasm.importedFunctions} imported`);
  for (const memory of wasm.memories) out.push(`- Memory: ${describeMemory(memory)}`);
  for (const table of wasm.tables) out.push(`- Table: ${table.type}, ${table.limits.min}${table.limits.max !== null ? ` to ${table.limits.max}` : " or more"} entries`);
  out.push(`- Globals: ${wasm.globals}; data: ${wasm.dataBytes.toLocaleString("en")} bytes in ${wasm.dataSegments} ${wasm.dataSegments === 1 ? "segment" : "segments"}`);
  if (wasm.start !== null) out.push(`- Start function: ${wasm.functionNames.get(wasm.start) ?? `#${wasm.start}`}, run as soon as the module is instantiated`);
  for (const [field, values] of wasm.producers) out.push(`- ${field[0].toUpperCase()}${field.slice(1)}: ${values.join(", ")}`);
  if (wasm.features.length > 0) out.push(`- Features used: ${wasm.features.join(", ")}`);
  if (wasm.sourceMap) out.push(`- Source map: ${wasm.sourceMap}`);
  out.push("", "## Sections", "", "| Section | Bytes | Share |", "| --- | ---: | ---: |");
  for (const section of wasm.sections) out.push(`| ${section.name} | ${section.size.toLocaleString("en")} | ${((section.size / wasm.size) * 100).toFixed(1)}% |`);
  out.push("", `## Imports (${wasm.imports.length})`, "");
  const byModule = new Map<string, typeof wasm.imports>();
  for (const entry of wasm.imports) byModule.set(entry.module, [...(byModule.get(entry.module) ?? []), entry]);
  for (const [name, entries] of byModule) {
    out.push(`### ${name}`, "");
    for (const entry of entries) out.push(`- ${entry.kind} \`${entry.name}\`${entry.detail ? ` ${entry.detail}` : ""}`);
    out.push("");
  }
  out.push(`## Exports (${wasm.exports.length})`, "");
  for (const entry of wasm.exports) out.push(`- ${entry.kind} \`${entry.name}\`${entry.detail ? ` ${entry.detail}` : ""}`);
  if (wasm.largest.length > 0) {
    out.push("", "## Largest functions", "", "| Function | Bytes |", "| --- | ---: |");
    for (const entry of wasm.largest) out.push(`| ${entry.name ? `\`${entry.name}\`` : `#${entry.index}`} | ${entry.size.toLocaleString("en")} |`);
  }
  if (wasm.customSections.length > 0) out.push("", `Custom sections: ${wasm.customSections.join(", ")}.`);
  return `${out.join("\n")}\n`;
}

/** A WebAssembly module's interface and anatomy. */
export function InspectWasmApp() {
  const queue = useMemo<PlainQueueOptions<Record<string, never>>>(
    () => ({
      key: "inspect-wasm",
      settings: {},
      reject: (file) => (file.size > MAX_BYTES ? { message: "This file is too large to inspect in a browser tab.", hint: `This reads modules up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, _settings, progress) => {
        progress("Reading...", null);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let wasm: WasmModule;
        try {
          wasm = parseWasm(bytes);
        } catch (error) {
          if (error instanceof WasmError) throw new PlainError(error.message, "Drop a .wasm file as a compiler writes it.", { cause: error });
          throw error;
        }
        progress("Validating...", null);
        let valid: boolean | null = null;
        try {
          valid = typeof WebAssembly === "object" ? WebAssembly.validate(bytes) : null;
        } catch {
          valid = null;
        }
        const code = wasm.sections.find((section) => section.id === 10);
        const facts = [
          `Built with: ${guessToolchain(wasm)}`,
          `Functions: ${wasm.functions.toLocaleString("en")} defined, ${wasm.importedFunctions} imported${code ? `, ${formatBytes(code.size)} of code (${Math.round((code.size / wasm.size) * 100)}%)` : ""}`,
          `Imports: ${wasm.imports.length === 0 ? "none" : [...new Set(wasm.imports.map((entry) => entry.module))].map((name) => `${name} (${wasm.imports.filter((entry) => entry.module === name).length})`).join(", ")}`,
          `Exports: ${wasm.exports.length === 0 ? "none" : wasm.exports.slice(0, 8).map((entry) => entry.name).join(", ") + (wasm.exports.length > 8 ? `, and ${wasm.exports.length - 8} more` : "")}`,
        ];
        if (wasm.memories[0]) facts.push(`Memory: ${describeMemory(wasm.memories[0])}`);
        const notes: string[] = [];
        if (valid === false) notes.push("This browser's WebAssembly engine rejects the module: it may use a proposal this browser does not support yet, or it is damaged.");
        if (wasm.functionNames.size === 0 && wasm.functions > 0) notes.push("There is no name section, so functions are known by number; a debug build keeps their names.");
        if (wasm.customSections.some((name) => name.startsWith(".debug"))) notes.push("The wasm carries DWARF debug information, which a release build usually strips.");
        const stem = fileStem(file.name, "wasm");
        const json = {
          size: wasm.size,
          toolchain: guessToolchain(wasm),
          valid,
          sections: wasm.sections,
          imports: wasm.imports,
          exports: wasm.exports,
          functions: { defined: wasm.functions, imported: wasm.importedFunctions, largest: wasm.largest },
          memories: wasm.memories,
          tables: wasm.tables,
          globals: wasm.globals,
          data: { segments: wasm.dataSegments, bytes: wasm.dataBytes },
          producers: Object.fromEntries(wasm.producers),
          features: wasm.features,
          customSections: wasm.customSections,
        };
        return {
          facts,
          notes,
          outputs: [
            { label: "Report", fileName: `${stem}-wasm-report.md`, blob: new Blob([report(file.name, wasm, valid)], { type: "text/markdown;charset=utf-8" }), kind: "file", note: "Sections, imports, exports, memory and the largest functions" },
            { label: "As JSON", fileName: `${stem}-wasm.json`, blob: new Blob([`${JSON.stringify(json, null, 2)}\n`], { type: "application/json" }), kind: "file", note: "The same, for a script" },
          ],
        };
      },
    }),
    [],
  );

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a .wasm file and see what it is: which toolchain built it, what it imports from its host and what it exports, its memory, where its size goes section by section, and its largest functions by name. Nothing is uploaded, and nothing in it is run."
      queue={queue}
      busyLabel="Inspecting"
      dropZone={{ accept: ".wasm,application/wasm", inputLabel: "Choose .wasm files", headline: "Drop WebAssembly modules here", subhead: "Read, never run" }}
      note="The module is read as bytes and checked with WebAssembly.validate, which compiles nothing and runs nothing. The toolchain is taken from the producers section compilers write, and otherwise guessed from the shape of the imports: wasm-bindgen's __wbindgen names, Go's gojs module, Emscripten's single-letter names. Function names come from the name section, which release builds often strip. Components, the newer module-of-modules format, are recognised but not read."
    />
  );
}
