import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { guessToolchain, parseWasm, WasmError } from "@/lib/files/wasm";

const leb = (value: number): number[] => {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
};
const text = (value: string) => [...leb(value.length), ...new TextEncoder().encode(value)];
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];

/** A small module written byte by byte: an import, two functions, a memory, a global, exports, data and names. */
function module(): Uint8Array {
  const types = section(1, [2, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 0, 0]);
  const imports = section(2, [1, ...text("env"), ...text("log"), 0x00, 1]);
  const functions = section(3, [2, 0, 1]);
  const memory = section(5, [1, 0x01, 2, 16]);
  const globals = section(6, [1, 0x7f, 0x01, 0x41, 42, 0x0b]);
  const exports = section(7, [3, ...text("add"), 0x00, 1, ...text("noop"), 0x00, 2, ...text("memory"), 0x02, 0]);
  const add = [0, 0x20, 0, 0x20, 1, 0x6a, 0x0b];
  const noop = [0, 0x0b];
  const code = section(10, [2, ...leb(add.length), ...add, ...leb(noop.length), ...noop]);
  const data = section(11, [1, 0x00, 0x41, 8, 0x0b, ...text("hello")]);
  const names = section(0, [...text("name"), 0, ...leb(text("demo").length), ...text("demo"), 1, ...leb(1 + 1 + text("adder").length), 1, 1, ...text("adder")]);
  const producers = section(0, [...text("producers"), 1, ...text("language"), 1, ...text("Rust"), ...text("1.80")]);
  return Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...imports, ...functions, ...memory, ...globals, ...exports, ...code, ...data, ...names, ...producers]);
}

describe("a module written by hand", () => {
  it("is valid WebAssembly, and reads as written", () => {
    const bytes = module();
    expect(WebAssembly.validate(bytes as BufferSource)).toBe(true);
    const parsed = parseWasm(bytes);
    expect(parsed.types).toEqual(["(i32, i32) -> i32", "() -> ()"]);
    expect(parsed.imports).toEqual([{ module: "env", name: "log", kind: "function", detail: "() -> ()" }]);
    expect(parsed.exports).toEqual([
      { name: "add", kind: "function", index: 1, detail: "(i32, i32) -> i32" },
      { name: "noop", kind: "function", index: 2, detail: "() -> ()" },
      { name: "memory", kind: "memory", index: 0, detail: "2 pages (0 MiB), at most 16 (1 MiB)" },
    ]);
    expect(parsed).toMatchObject({ functions: 2, importedFunctions: 1, globals: 1, dataSegments: 1, dataBytes: 5, moduleName: "demo" });
    expect(parsed.largest[0]).toEqual({ index: 1, name: "adder", size: 7 });
    expect(parsed.producers.get("language")).toEqual(["Rust 1.80"]);
    expect(guessToolchain(parsed)).toBe("Rust");
    expect(parsed.sections.map((entry) => entry.name)).toEqual(["type", "import", "function", "memory", "global", "export", "code", "data", 'custom "name"', 'custom "producers"']);
  });

  it("refuses what is not a module, or is cut short", () => {
    expect(() => parseWasm(new TextEncoder().encode("not wasm at all"))).toThrow(WasmError);
    expect(() => parseWasm(module().subarray(0, 40))).toThrow(/cut short/);
    expect(() => parseWasm(Uint8Array.from([0, 0x61, 0x73, 0x6d, 0x0d, 0, 1, 0]))).toThrow(/component/);
  });
});

describe("real modules, checked against the engine's own reading", () => {
  for (const [file, toolchain] of [
    ["qcms_bg.wasm", "Rust, with wasm-bindgen"],
    ["openjpeg.wasm", "Emscripten, minified (single-letter import names)"],
  ]) {
    it(`${file}: imports and exports as WebAssembly.Module lists them`, () => {
      const bytes = new Uint8Array(readFileSync(`node_modules/pdfjs-dist/wasm/${file}`));
      const parsed = parseWasm(bytes);
      const reference = new WebAssembly.Module(bytes);
      expect(parsed.imports.map(({ module, name, kind }) => ({ module, name, kind }))).toEqual(WebAssembly.Module.imports(reference));
      expect(parsed.exports.map(({ name, kind }) => ({ name, kind }))).toEqual(WebAssembly.Module.exports(reference));
      for (const name of parsed.customSections) expect(WebAssembly.Module.customSections(reference, name).length, name).toBeGreaterThan(0);
      expect(parsed.sections.reduce((sum, entry) => sum + entry.size, 0)).toBeLessThan(bytes.length);
      expect(guessToolchain(parsed)).toBe(toolchain);
      expect(parsed.functions).toBeGreaterThan(10);
    });
  }
});
