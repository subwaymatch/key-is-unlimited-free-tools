/**
 * A WebAssembly module taken apart: its sections and what each weighs,
 * what it imports and from where, what it exports and with what
 * signature, its memory and tables, its largest functions by name when the
 * name section is there, and which toolchain built it.
 *
 * The binary format is a magic number, a version and a run of sections,
 * each an id and a LEB128 length; this walks them and reads the ones that
 * describe the module's interface, and only counts the rest.
 */

export class WasmError extends Error {}

const SECTION_NAMES = ["custom", "type", "import", "function", "table", "memory", "global", "export", "start", "element", "code", "data", "data count", "tag"];

const VALUE_TYPES: Record<number, string> = { 0x7f: "i32", 0x7e: "i64", 0x7d: "f32", 0x7c: "f64", 0x7b: "v128", 0x70: "funcref", 0x6f: "externref", 0x6e: "anyref", 0x6d: "eqref", 0x6c: "i31ref", 0x6b: "structref", 0x6a: "arrayref", 0x69: "exnref", 0x71: "nullref", 0x72: "nullexternref", 0x73: "nullfuncref", 0x74: "nullexnref" };

const KINDS = ["function", "table", "memory", "global", "tag"] as const;
export type ExternKind = (typeof KINDS)[number];

class Reader {
  constructor(
    readonly bytes: Uint8Array,
    public at = 0,
    readonly end = bytes.length,
  ) {}

  byte(): number {
    if (this.at >= this.end) throw new WasmError("A section ends in the middle of a value.");
    return this.bytes[this.at++];
  }

  u32(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.byte();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (shift > 35) throw new WasmError("A number is longer than a 32-bit LEB128 can be.");
    }
  }

  /** A signed LEB128 of any width, skipped. */
  skipLeb(): void {
    while (this.byte() & 0x80);
  }

  name(): string {
    const length = this.u32();
    if (this.at + length > this.end) throw new WasmError("A name runs past the end of its section.");
    const text = new TextDecoder().decode(this.bytes.subarray(this.at, this.at + length));
    this.at += length;
    return text;
  }

  skip(count: number): void {
    this.at += count;
    if (this.at > this.end) throw new WasmError("A value runs past the end of its section.");
  }
}

function valueType(reader: Reader): string {
  const code = reader.byte();
  if (code === 0x63 || code === 0x64) {
    // (ref null? heaptype): the heap type is a signed LEB, a type index or an abstract type.
    const next = reader.bytes[reader.at];
    reader.skipLeb();
    return `(ref ${code === 0x63 ? "null " : ""}${VALUE_TYPES[next] ?? next})`;
  }
  return VALUE_TYPES[code] ?? `0x${code.toString(16)}`;
}

interface Limits {
  min: number;
  max: number | null;
  shared: boolean;
  is64: boolean;
}

function limits(reader: Reader): Limits {
  const flags = reader.byte();
  const min = reader.u32();
  const max = flags & 1 ? reader.u32() : null;
  return { min, max, shared: (flags & 2) !== 0, is64: (flags & 4) !== 0 };
}

/** Skips a constant expression, up to and including its end opcode. */
function skipConstExpr(reader: Reader): void {
  for (;;) {
    const opcode = reader.byte();
    if (opcode === 0x0b) return;
    if (opcode === 0x41 || opcode === 0x42 || opcode === 0x23 || opcode === 0xd2) reader.skipLeb();
    else if (opcode === 0x43) reader.skip(4);
    else if (opcode === 0x44) reader.skip(8);
    else if (opcode === 0xd0) reader.skipLeb();
    else if (opcode === 0xfd) {
      reader.u32();
      reader.skip(16);
    } else if (opcode === 0xfb) {
      // GC constant instructions: an opcode and up to two immediates.
      const sub = reader.u32();
      if (sub <= 8 || sub === 0x1c || sub === 0x1a || sub === 0x1b) {
        if (sub !== 0x1a && sub !== 0x1b && sub !== 0x1c) reader.skipLeb();
        if (sub === 6 || sub === 7 || sub === 8) reader.skipLeb();
      }
    } else if (opcode >= 0x6a && opcode <= 0x7c) {
      // Extended constant expressions: add, sub and mul, no immediates.
    } else throw new WasmError(`An initializer uses opcode 0x${opcode.toString(16)}, which is not a constant instruction.`);
  }
}

export interface WasmImport {
  module: string;
  name: string;
  kind: ExternKind;
  detail: string;
}

export interface WasmExport {
  name: string;
  kind: ExternKind;
  index: number;
  detail: string;
}

export interface WasmSection {
  id: number;
  name: string;
  /** Payload bytes, without the id and length. */
  size: number;
}

export interface WasmFunctionSize {
  index: number;
  name: string | null;
  size: number;
}

export interface WasmModule {
  version: number;
  size: number;
  sections: WasmSection[];
  types: string[];
  /** Type count when some are GC struct or array types this does not spell out. */
  typeCount: number;
  imports: WasmImport[];
  exports: WasmExport[];
  functions: number;
  importedFunctions: number;
  memories: Limits[];
  tables: { type: string; limits: Limits }[];
  globals: number;
  dataSegments: number;
  dataBytes: number;
  elementSegments: number;
  start: number | null;
  codeBytes: number;
  largest: WasmFunctionSize[];
  moduleName: string | null;
  functionNames: Map<number, string>;
  producers: Map<string, string[]>;
  features: string[];
  customSections: string[];
  sourceMap: string | null;
}

/** Everything the module says about itself. Throws WasmError when it is not a WebAssembly module. */
export function parseWasm(bytes: Uint8Array): WasmModule {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new WasmError("This is not a WebAssembly module: it does not start with \\0asm.");
  }
  const version = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  if (version !== 1) throw new WasmError(version === 0x1000d ? "This is a WebAssembly component (the component model), not a core module; only core modules are read." : `This module is version ${version}; only version 1 is read.`);
  const wasm: WasmModule = { version, size: bytes.length, sections: [], types: [], typeCount: 0, imports: [], exports: [], functions: 0, importedFunctions: 0, memories: [], tables: [], globals: 0, dataSegments: 0, dataBytes: 0, elementSegments: 0, start: null, codeBytes: 0, largest: [], moduleName: null, functionNames: new Map(), producers: new Map(), features: [], customSections: [], sourceMap: null };
  const functionTypes: number[] = [];
  const bodies: { index: number; size: number }[] = [];
  let at = 8;
  while (at < bytes.length) {
    const head = new Reader(bytes, at);
    const id = head.byte();
    const size = head.u32();
    const start = head.at;
    const end = start + size;
    if (end > bytes.length) throw new WasmError(`The ${SECTION_NAMES[id] ?? `unknown (${id})`} section runs past the end of the file; it is cut short.`);
    const reader = new Reader(bytes, start, end);
    const section: WasmSection = { id, name: SECTION_NAMES[id] ?? `unknown (${id})`, size };
    switch (id) {
      case 0: {
        const name = reader.name();
        section.name = `custom "${name}"`;
        wasm.customSections.push(name);
        try {
          readCustom(name, reader, wasm);
        } catch {
          // A custom section that does not parse changes nothing about the module.
        }
        break;
      }
      case 1: {
        const count = reader.u32();
        wasm.typeCount = count;
        for (let index = 0; index < count; index += 1) {
          if (reader.bytes[reader.at] !== 0x60) break;
          reader.byte();
          const params = Array.from({ length: reader.u32() }, () => valueType(reader));
          const results = Array.from({ length: reader.u32() }, () => valueType(reader));
          wasm.types.push(`(${params.join(", ")}) -> ${results.length === 0 ? "()" : results.length === 1 ? results[0] : `(${results.join(", ")})`}`);
        }
        break;
      }
      case 2: {
        const count = reader.u32();
        for (let index = 0; index < count; index += 1) {
          const moduleName = reader.name();
          const name = reader.name();
          const kind = KINDS[reader.byte()] ?? "function";
          let detail = "";
          if (kind === "function") {
            const type = reader.u32();
            functionTypes.push(type);
            wasm.importedFunctions += 1;
            detail = wasm.types[type] ?? `type ${type}`;
          } else if (kind === "table") {
            const type = valueType(reader);
            const bounds = limits(reader);
            wasm.tables.push({ type, limits: bounds });
            detail = `${type}, ${bounds.min}${bounds.max !== null ? ` to ${bounds.max}` : "+"}`;
          } else if (kind === "memory") {
            const bounds = limits(reader);
            wasm.memories.push(bounds);
            detail = describeMemory(bounds);
          } else if (kind === "global") {
            const type = valueType(reader);
            detail = `${reader.byte() ? "mutable " : ""}${type}`;
          } else {
            reader.byte();
            detail = `type ${reader.u32()}`;
          }
          wasm.imports.push({ module: moduleName, name, kind, detail });
        }
        break;
      }
      case 3: {
        const count = reader.u32();
        wasm.functions = count;
        for (let index = 0; index < count; index += 1) functionTypes.push(reader.u32());
        break;
      }
      case 4: {
        const count = reader.u32();
        for (let index = 0; index < count; index += 1) {
          if (reader.bytes[reader.at] === 0x40) {
            reader.byte();
            reader.byte();
            const type = valueType(reader);
            wasm.tables.push({ type, limits: limits(reader) });
            skipConstExpr(reader);
          } else {
            const type = valueType(reader);
            wasm.tables.push({ type, limits: limits(reader) });
          }
        }
        break;
      }
      case 5: {
        const count = reader.u32();
        for (let index = 0; index < count; index += 1) wasm.memories.push(limits(reader));
        break;
      }
      case 6:
        wasm.globals = reader.u32();
        break;
      case 7: {
        const count = reader.u32();
        for (let index = 0; index < count; index += 1) {
          const name = reader.name();
          const kind = KINDS[reader.byte()] ?? "function";
          const target = reader.u32();
          wasm.exports.push({ name, kind, index: target, detail: "" });
        }
        break;
      }
      case 8:
        wasm.start = reader.u32();
        break;
      case 9:
        wasm.elementSegments = reader.u32();
        break;
      case 10: {
        const count = reader.u32();
        wasm.codeBytes = size;
        for (let index = 0; index < count; index += 1) {
          const bodySize = reader.u32();
          bodies.push({ index: wasm.importedFunctions + index, size: bodySize });
          reader.skip(bodySize);
        }
        break;
      }
      case 11: {
        const count = reader.u32();
        wasm.dataSegments = count;
        for (let index = 0; index < count; index += 1) {
          const flags = reader.u32();
          if (flags === 2) reader.u32();
          if (flags === 0 || flags === 2) skipConstExpr(reader);
          const length = reader.u32();
          wasm.dataBytes += length;
          reader.skip(length);
        }
        break;
      }
      default:
        break;
    }
    wasm.sections.push(section);
    at = end;
  }
  for (const entry of wasm.exports) {
    if (entry.kind === "function") entry.detail = wasm.types[functionTypes[entry.index]] ?? "";
    else if (entry.kind === "memory") entry.detail = wasm.memories[entry.index] ? describeMemory(wasm.memories[entry.index]) : "";
    else if (entry.kind === "table") entry.detail = wasm.tables[entry.index]?.type ?? "";
  }
  wasm.largest = bodies
    .sort((a, b) => b.size - a.size)
    .slice(0, 15)
    .map((body) => ({ index: body.index, name: wasm.functionNames.get(body.index) ?? wasm.exports.find((entry) => entry.kind === "function" && entry.index === body.index)?.name ?? null, size: body.size }));
  return wasm;
}

function readCustom(name: string, reader: Reader, wasm: WasmModule): void {
  if (name === "name") {
    while (reader.at < reader.end) {
      const kind = reader.byte();
      const size = reader.u32();
      const end = reader.at + size;
      if (kind === 0) wasm.moduleName = reader.name();
      else if (kind === 1) {
        const count = reader.u32();
        for (let index = 0; index < count; index += 1) {
          const target = reader.u32();
          wasm.functionNames.set(target, reader.name());
        }
      }
      reader.at = end;
    }
  } else if (name === "producers") {
    const fields = reader.u32();
    for (let index = 0; index < fields; index += 1) {
      const field = reader.name();
      const count = reader.u32();
      const values: string[] = [];
      for (let value = 0; value < count; value += 1) {
        const tool = reader.name();
        const version = reader.name();
        values.push(version ? `${tool} ${version}` : tool);
      }
      wasm.producers.set(field, values);
    }
  } else if (name === "target_features") {
    const count = reader.u32();
    for (let index = 0; index < count; index += 1) {
      const prefix = String.fromCharCode(reader.byte());
      const feature = reader.name();
      if (prefix !== "-") wasm.features.push(feature);
    }
  } else if (name === "sourceMappingURL") {
    wasm.sourceMap = reader.name();
  }
}

export function describeMemory(bounds: Limits): string {
  const page = 65536;
  const size = (pages: number) => (pages * page >= 1024 ** 3 ? `${Math.round(((pages * page) / 1024 ** 3) * 10) / 10} GiB` : `${Math.round((pages * page) / 1024 ** 2)} MiB`);
  return `${bounds.min} ${bounds.min === 1 ? "page" : "pages"} (${size(bounds.min)})${bounds.max !== null ? `, at most ${bounds.max} (${size(bounds.max)})` : ", no maximum"}${bounds.shared ? ", shared between threads" : ""}${bounds.is64 ? ", 64-bit" : ""}`;
}

/** Which toolchain built the module, from its producers section and the shape of its imports. */
export function guessToolchain(wasm: WasmModule): string {
  const producers = [...(wasm.producers.get("language") ?? []), ...(wasm.producers.get("processed-by") ?? []), ...(wasm.producers.get("sdk") ?? [])].join(" ");
  const imports = wasm.imports.map((entry) => `${entry.module}.${entry.name}`).join(" ");
  const exports = wasm.exports.map((entry) => entry.name).join(" ");
  if (/wasm-bindgen/.test(producers) || /__wbindgen|__wbg_/.test(imports)) return "Rust, with wasm-bindgen";
  if (/rustc|Rust/.test(producers)) return "Rust";
  if (/TinyGo/i.test(producers)) return "TinyGo";
  if (/\bgo\b|gojs\./.test(imports) || /runtime\.wasmExit|syscall\/js/.test(imports)) return "Go";
  if (/AssemblyScript/i.test(producers) || /env\.abort/.test(imports) && /__new|__pin/.test(exports)) return "AssemblyScript";
  if (/Emscripten|emscripten/.test(producers) || /emscripten_|__wasm_call_ctors|_emscripten_/.test(`${imports} ${exports}`)) return "C or C++, with Emscripten";
  if (wasm.imports.length > 0 && wasm.imports.every((entry) => /^[a-z]$/.test(entry.module) && entry.name.length <= 2)) return "Emscripten, minified (single-letter import names)";
  if (/dotnet|mono/i.test(`${producers} ${imports}`)) return ".NET";
  if (/Zig/i.test(producers)) return "Zig";
  if (/wasi_snapshot_preview1|wasi_unstable/.test(imports)) return `${/clang/.test(producers) ? "C or C++" : "A WASI program"}, for WASI`;
  if (/clang/.test(producers)) return "C or C++, with clang";
  return "not recorded";
}
