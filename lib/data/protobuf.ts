/**
 * Protocol Buffers messages read without their program: the wire format
 * taken apart field by field, as `protoc --decode_raw` does, or read
 * against a .proto file for names, types and enums.
 *
 * On the wire a message is a run of fields, each a varint key - the field
 * number and one of four wire types - and a value: a varint, eight bytes,
 * four bytes, or a length and that many bytes. The length-delimited kind
 * is a string, raw bytes, a packed list or a nested message, and nothing
 * on the wire says which; without a schema the decoder guesses the way
 * protoc does, calling it a message when it parses as one exactly and
 * text when it is printable UTF-8.
 */

export class ProtobufError extends Error {}

export type RawValue =
  | { wire: "varint"; value: bigint }
  | { wire: "fixed64"; bytes: Uint8Array }
  | { wire: "fixed32"; bytes: Uint8Array }
  | { wire: "bytes"; bytes: Uint8Array; message: RawField[] | null; text: string | null }
  | { wire: "group"; fields: RawField[] };

export interface RawField {
  number: number;
  value: RawValue;
}

class Reader {
  at = 0;

  constructor(readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.at >= this.bytes.length;
  }

  varint(): bigint {
    let result = BigInt(0);
    let shift = BigInt(0);
    for (let count = 0; count < 10; count += 1) {
      if (this.at >= this.bytes.length) throw new ProtobufError("A number runs past the end of the message.");
      const byte = this.bytes[this.at++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += BigInt(7);
    }
    throw new ProtobufError("A number is longer than ten bytes, which no varint is.");
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.at + length > this.bytes.length) throw new ProtobufError("A field says it is longer than what is left of the message.");
    const out = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return out;
  }
}

const MAX_FIELD = 2 ** 29 - 1;

function printable(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  // Control characters other than tab and line breaks mean this is not text a person wrote.
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text;
}

function readFields(reader: Reader, depth: number, endGroup: number | null): RawField[] {
  if (depth > 64) throw new ProtobufError("The message nests deeper than any real one does.");
  const fields: RawField[] = [];
  while (!reader.done) {
    const key = reader.varint();
    const number = Number(key >> BigInt(3));
    const wire = Number(key & BigInt(7));
    if (number < 1 || number > MAX_FIELD) throw new ProtobufError(`Field number ${number} is outside the range protobuf allows.`);
    if (wire === 0) fields.push({ number, value: { wire: "varint", value: reader.varint() } });
    else if (wire === 1) fields.push({ number, value: { wire: "fixed64", bytes: reader.take(8) } });
    else if (wire === 5) fields.push({ number, value: { wire: "fixed32", bytes: reader.take(4) } });
    else if (wire === 2) {
      const length = reader.varint();
      if (length > BigInt(reader.bytes.length)) throw new ProtobufError("A field says it is longer than the whole message.");
      const bytes = reader.take(Number(length));
      const text = printable(bytes);
      let message: RawField[] | null = null;
      if (bytes.length > 0 && text === null) {
        try {
          message = readFields(new Reader(bytes), depth + 1, null);
        } catch {
          message = null;
        }
      }
      fields.push({ number, value: { wire: "bytes", bytes, message, text } });
    } else if (wire === 3) {
      fields.push({ number, value: { wire: "group", fields: readFields(reader, depth + 1, number) } });
    } else if (wire === 4) {
      if (endGroup !== number) throw new ProtobufError("A group ends that was never started.");
      return fields;
    } else throw new ProtobufError(`Wire type ${wire} does not exist; this is not a protobuf message here.`);
  }
  if (endGroup !== null) throw new ProtobufError("A group is never closed.");
  return fields;
}

/** Every field of a message, nested messages guessed. Throws ProtobufError when the bytes are not a message. */
export function decodeRaw(bytes: Uint8Array): RawField[] {
  return readFields(new Reader(bytes), 0, null);
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Bytes escaped as protoc writes them: C escapes, and octal for anything not printable ASCII. */
function cEscape(bytes: Uint8Array): string {
  const named: Record<number, string> = { 0x0a: "\\n", 0x0d: "\\r", 0x09: "\\t", 0x22: '\\"', 0x27: "\\'", 0x5c: "\\\\" };
  let out = "";
  for (const byte of bytes) out += named[byte] ?? (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, "0")}`);
  return out;
}

/** The fields as `protoc --decode_raw` prints them. */
export function rawText(fields: RawField[], indent = ""): string {
  const lines: string[] = [];
  for (const { number, value } of fields) {
    if (value.wire === "varint") lines.push(`${indent}${number}: ${value.value}`);
    else if (value.wire === "fixed64") lines.push(`${indent}${number}: 0x${hexOf(value.bytes.slice().reverse())}`);
    else if (value.wire === "fixed32") lines.push(`${indent}${number}: 0x${hexOf(value.bytes.slice().reverse())}`);
    else if (value.wire === "group") lines.push(`${indent}${number} {`, rawText(value.fields, `${indent}  `), `${indent}}`);
    else if (value.message) lines.push(`${indent}${number} {`, ...(value.message.length ? [rawText(value.message, `${indent}  `)] : []), `${indent}}`);
    else lines.push(`${indent}${number}: "${cEscape(value.bytes)}"`);
  }
  return lines.filter((line) => line !== "").join("\n");
}

/** The fields as JSON, keyed by number, every reading of an ambiguous value given. */
export function rawJson(fields: RawField[]): Record<string, unknown> {
  const out: Record<string, unknown[]> = {};
  for (const { number, value } of fields) {
    let shown: unknown;
    if (value.wire === "varint") {
      // As protoc prints it, unsigned; a negative int64 is written with both readings.
      const unsigned = value.value;
      const signed = BigInt.asIntN(64, unsigned);
      shown = signed < BigInt(0) ? { uint: unsigned.toString(), int: signed.toString() } : unsigned <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(unsigned) : unsigned.toString();
    } else if (value.wire === "fixed64") shown = { fixed64: view(value.bytes).getBigUint64(0, true).toString(), double: view(value.bytes).getFloat64(0, true) };
    else if (value.wire === "fixed32") shown = { fixed32: view(value.bytes).getUint32(0, true), float: Number(view(value.bytes).getFloat32(0, true).toPrecision(9)) };
    else if (value.wire === "group") shown = rawJson(value.fields);
    else if (value.message) shown = rawJson(value.message);
    else shown = value.text ?? { hex: hexOf(value.bytes) };
    (out[String(number)] ??= []).push(shown);
  }
  const result: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(out)) result[key] = values.length === 1 ? values[0] : values;
  return result;
}

/* ---- .proto files -------------------------------------------------------- */

export interface ProtoField {
  name: string;
  number: number;
  type: string;
  repeated: boolean;
  packed: boolean | null;
  map: { key: string; value: string } | null;
}

export interface ProtoMessage {
  name: string;
  fullName: string;
  fields: ProtoField[];
}

export interface ProtoSchema {
  syntax: "proto2" | "proto3";
  package: string;
  messages: Map<string, ProtoMessage>;
  enums: Map<string, Map<number, string>>;
  /** Top-level message names, in the order the file declares them. */
  topLevel: string[];
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][\w.]*|-?\d[\w.+-]*|\S/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (!match[0].startsWith("//") && !match[0].startsWith("/*")) tokens.push(match[0]);
  }
  return tokens;
}

const SCALARS = new Set(["double", "float", "int32", "int64", "uint32", "uint64", "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64", "bool", "string", "bytes"]);

/** A .proto file's messages and enums, enough to name and type every field. */
export function parseProto(source: string): ProtoSchema {
  const tokens = tokenize(source);
  const schema: ProtoSchema = { syntax: "proto2", package: "", messages: new Map(), enums: new Map(), topLevel: [] };
  let at = 0;
  const peek = () => tokens[at];
  const next = () => {
    if (at >= tokens.length) throw new ProtobufError("The .proto file ends in the middle of a definition.");
    return tokens[at++];
  };
  const expect = (token: string) => {
    const got = next();
    if (got !== token) throw new ProtobufError(`The .proto file has "${got}" where "${token}" belongs.`);
  };
  const skipStatement = () => {
    let depth = 0;
    while (at < tokens.length) {
      const token = next();
      if (token === "{") depth += 1;
      else if (token === "}") {
        depth -= 1;
        if (depth <= 0) return;
      } else if (token === ";" && depth === 0) return;
    }
  };
  const pendingTypes: { field: ProtoField; scope: string }[] = [];

  const parseEnum = (scope: string) => {
    const name = next();
    const fullName = scope ? `${scope}.${name}` : name;
    const values = new Map<number, string>();
    expect("{");
    while (peek() !== "}") {
      const token = next();
      if (token === "option" || token === "reserved") {
        skipStatement();
        continue;
      }
      if (token === ";") continue;
      expect("=");
      const number = Number(next());
      if (peek() === "[") while (next() !== "]");
      expect(";");
      if (!values.has(number)) values.set(number, token);
    }
    expect("}");
    schema.enums.set(fullName, values);
  };

  const parseField = (message: ProtoMessage, scope: string, label: string | null) => {
    let type = next();
    let map: ProtoField["map"] = null;
    if (type === "map") {
      expect("<");
      const key = next();
      expect(",");
      const value = next();
      expect(">");
      map = { key, value };
      type = "map";
    }
    const name = next();
    expect("=");
    const number = Number(next());
    let packed: boolean | null = null;
    if (peek() === "[") {
      next();
      while (peek() !== "]") {
        const option = next();
        if (option === "packed") {
          expect("=");
          packed = next() === "true";
        }
      }
      next();
    }
    expect(";");
    const field: ProtoField = { name, number, type, repeated: label === "repeated" || map !== null, packed, map };
    message.fields.push(field);
    pendingTypes.push({ field, scope });
  };

  const parseMessage = (scope: string, top: boolean) => {
    const name = next();
    const fullName = scope ? `${scope}.${name}` : name;
    const message: ProtoMessage = { name, fullName, fields: [] };
    schema.messages.set(fullName, message);
    if (top) schema.topLevel.push(fullName);
    expect("{");
    while (peek() !== "}") {
      const token = peek();
      if (token === "message") {
        next();
        parseMessage(fullName, false);
      } else if (token === "enum") {
        next();
        parseEnum(fullName);
      } else if (token === "oneof") {
        next();
        next();
        expect("{");
        while (peek() !== "}") {
          if (peek() === "option") skipStatement();
          else parseField(message, fullName, null);
        }
        expect("}");
      } else if (token === "option" || token === "reserved" || token === "extensions" || token === "extend") {
        skipStatement();
      } else if (token === ";") {
        next();
      } else if (token === "optional" || token === "required" || token === "repeated") {
        next();
        if (peek() === "group") throw new ProtobufError("The .proto file uses a group field, which this reader does not follow; the raw decoding still shows it.");
        parseField(message, fullName, token);
      } else {
        parseField(message, fullName, null);
      }
    }
    expect("}");
  };

  while (at < tokens.length) {
    const token = next();
    if (token === "syntax" || token === "edition") {
      expect("=");
      schema.syntax = next().replace(/["']/g, "") === "proto3" ? "proto3" : "proto2";
      expect(";");
    } else if (token === "package") {
      schema.package = next();
      expect(";");
    } else if (token === "message") parseMessage(schema.package, true);
    else if (token === "enum") parseEnum(schema.package);
    else if (token === ";") continue;
    else skipStatement();
  }

  // Resolve each field's type name the way protoc does: innermost scope outwards.
  const resolve = (type: string, scope: string): string => {
    if (SCALARS.has(type)) return type;
    if (type.startsWith(".")) return type.slice(1);
    const parts = scope.split(".").filter(Boolean);
    for (let length = parts.length; length >= 0; length -= 1) {
      const candidate = [...parts.slice(0, length), type].join(".");
      if (schema.messages.has(candidate) || schema.enums.has(candidate)) return candidate;
    }
    return type;
  };
  for (const { field, scope } of pendingTypes) {
    if (field.map) field.map = { key: field.map.key, value: resolve(field.map.value, scope) };
    else field.type = resolve(field.type, scope);
  }
  if (schema.messages.size === 0) throw new ProtobufError("The .proto file defines no messages.");
  return schema;
}

/* ---- Decoding with a schema ---------------------------------------------- */

const PACKABLE = new Set(["double", "float", "int32", "int64", "uint32", "uint64", "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64", "bool"]);

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function scalar(type: string, value: RawValue, schema: ProtoSchema): unknown {
  if (value.wire === "varint") {
    const raw = value.value;
    switch (type) {
      case "bool":
        return raw !== BigInt(0);
      case "int32":
        return Number(BigInt.asIntN(32, raw));
      case "uint32":
        return Number(BigInt.asUintN(32, raw));
      case "int64":
        return BigInt.asIntN(64, raw).toString();
      case "uint64":
        return raw.toString();
      case "sint32":
        return Number((raw >> BigInt(1)) ^ -(raw & BigInt(1)));
      case "sint64":
        return ((raw >> BigInt(1)) ^ -(raw & BigInt(1))).toString();
      default: {
        const names = schema.enums.get(type);
        const number = Number(BigInt.asIntN(32, raw));
        return names ? (names.get(number) ?? number) : Number(raw);
      }
    }
  }
  if (value.wire === "fixed64") {
    const data = view(value.bytes);
    if (type === "double") return data.getFloat64(0, true);
    if (type === "sfixed64") return data.getBigInt64(0, true).toString();
    return data.getBigUint64(0, true).toString();
  }
  if (value.wire === "fixed32") {
    const data = view(value.bytes);
    if (type === "float") return Number(data.getFloat32(0, true).toPrecision(9));
    if (type === "sfixed32") return data.getInt32(0, true);
    return data.getUint32(0, true);
  }
  if (value.wire === "bytes") {
    if (type === "string") return new TextDecoder().decode(value.bytes);
    if (type === "bytes") return base64(value.bytes);
  }
  return null;
}

function unpack(type: string, bytes: Uint8Array): RawValue[] {
  const reader = new Reader(bytes);
  const values: RawValue[] = [];
  while (!reader.done) {
    if (["double", "fixed64", "sfixed64"].includes(type)) values.push({ wire: "fixed64", bytes: reader.take(8) });
    else if (["float", "fixed32", "sfixed32"].includes(type)) values.push({ wire: "fixed32", bytes: reader.take(4) });
    else values.push({ wire: "varint", value: reader.varint() });
  }
  return values;
}

export interface SchemaDecoding {
  value: Record<string, unknown>;
  /** Fields on the wire the schema does not name. */
  unknown: number;
  /** Fields whose wire type did not fit the schema's type. */
  mismatched: number;
}

/** A message decoded against a message type from a .proto file. */
export function decodeWithSchema(bytes: Uint8Array, schema: ProtoSchema, typeName: string): SchemaDecoding {
  const stats = { unknown: 0, mismatched: 0 };
  const decodeMessage = (data: Uint8Array, name: string, depth: number): Record<string, unknown> => {
    const message = schema.messages.get(name);
    if (!message) throw new ProtobufError(`The .proto file has no message called ${name}.`);
    if (depth > 64) throw new ProtobufError("The message nests deeper than any real one does.");
    const byNumber = new Map(message.fields.map((field) => [field.number, field]));
    const out: Record<string, unknown> = {};
    const fields = readFields(new Reader(data), 0, null);
    for (const { number, value } of fields) {
      const field = byNumber.get(number);
      if (!field) {
        stats.unknown += 1;
        const shown = rawJson([{ number, value }])[String(number)];
        const key = `[${number}]`;
        out[key] = out[key] === undefined ? shown : [...(Array.isArray(out[key]) ? (out[key] as unknown[]) : [out[key]]), shown];
        continue;
      }
      const values: unknown[] = [];
      if (field.map && value.wire === "bytes") {
        const entry = readFields(new Reader(value.bytes), 0, null);
        const keyField = entry.find((item) => item.number === 1);
        const valueField = entry.find((item) => item.number === 2);
        const key = keyField ? String(scalar(field.map.key, keyField.value, schema)) : "";
        const mapValue = valueField ? (schema.messages.has(field.map.value) && valueField.value.wire === "bytes" ? decodeMessage(valueField.value.bytes, field.map.value, depth + 1) : scalar(field.map.value, valueField.value, schema)) : null;
        const map = (out[field.name] ??= {}) as Record<string, unknown>;
        map[key] = mapValue;
        continue;
      }
      if (schema.messages.has(field.type)) {
        if (value.wire !== "bytes") {
          stats.mismatched += 1;
          continue;
        }
        values.push(decodeMessage(value.bytes, field.type, depth + 1));
      } else if (value.wire === "bytes" && (PACKABLE.has(field.type) || schema.enums.has(field.type))) {
        for (const item of unpack(field.type, value.bytes)) values.push(scalar(field.type, item, schema));
      } else {
        const decoded = scalar(field.type, value, schema);
        if (decoded === null) stats.mismatched += 1;
        else values.push(decoded);
      }
      if (field.repeated) out[field.name] = [...((out[field.name] as unknown[] | undefined) ?? []), ...values];
      else if (values.length > 0) out[field.name] = values[values.length - 1];
    }
    return out;
  };
  const value = decodeMessage(bytes, typeName, 0);
  return { value, ...stats };
}

/* ---- Input --------------------------------------------------------------- */

/**
 * The message bytes from a file that may hold them as base64 or hex text,
 * or behind the five-byte frame gRPC puts in front of each message.
 */
export function unwrapInput(bytes: Uint8Array): { bytes: Uint8Array; from: string | null } {
  let data = bytes;
  let from: string | null = null;
  const text = printable(bytes.subarray(0, 4096)) !== null && bytes.length < 64 * 1024 * 1024 ? new TextDecoder().decode(bytes).trim() : null;
  if (text !== null && text.length > 0) {
    const compact = text.replace(/\s+/g, "");
    if (/^([0-9a-f]{2})+$/i.test(compact)) {
      data = Uint8Array.from(compact.match(/../g)!.map((pair) => parseInt(pair, 16)));
      from = "hex text";
    } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) && compact.length % 4 !== 1) {
      const normal = compact.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
      data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      from = "base64 text";
    }
  }
  if (data.length >= 5 && data[0] <= 1 && view(data).getUint32(1, false) === data.length - 5) {
    data = data.subarray(5);
    from = from ? `${from}, in a gRPC frame` : "a gRPC frame";
  }
  return { bytes: data, from };
}
