"use client";

import { useMemo, useState } from "react";

import { decodeRaw, decodeWithSchema, parseProto, ProtobufError, rawJson, rawText, unwrapInput, type ProtoSchema } from "@/lib/data/protobuf";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { FileField } from "../ui/FileField";
import styles from "../Settings.module.css";

const tool = requireTool("decode-protobuf");

const MAX_BYTES = 64 * 1024 * 1024;

interface ProtoSettings {
  schema: ProtoSchema | null;
  schemaName: string | null;
  /** The message type to read as, or "" to pick the one that fits. */
  type: string;
}

function countFields(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countFields(item), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((sum: number, item) => sum + 1 + countFields(item), 0);
  return 0;
}

/** A protobuf message read without its program, or against its .proto file. */
export function DecodeProtobufApp() {
  const [settings, setSettings] = useState<ProtoSettings>({ schema: null, schemaName: null, type: "" });
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const queue = useMemo<PlainQueueOptions<ProtoSettings>>(
    () => ({
      key: "decode-protobuf",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "An empty message is valid protobuf, but there is nothing in it to show." } : file.size > MAX_BYTES ? { message: "This file is too large to decode in a browser tab.", hint: `This reads messages up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        const { bytes, from } = unwrapInput(new Uint8Array(await file.arrayBuffer()));
        let fields;
        try {
          fields = decodeRaw(bytes);
        } catch (error) {
          if (error instanceof ProtobufError) throw new PlainError("This is not a protobuf message.", `${error.message} If it is several messages in a row, or compressed, it has to be split or unpacked first.`, { cause: error });
          throw error;
        }
        const stem = fileStem(file.name, "message");
        const facts = [`Size: ${formatBytes(bytes.length)}${from ? `, read from ${from}` : ""}`, `Top-level fields: ${fields.length === 0 ? "none" : [...new Set(fields.map((field) => field.number))].join(", ")}`];
        const outputs = [
          { label: "As protoc --decode_raw prints it", fileName: `${stem}-raw.txt`, blob: new Blob([`${rawText(fields)}\n`], { type: "text/plain;charset=utf-8" }), kind: "file" as const, note: "Field numbers, nested messages indented" },
        ];
        const notes: string[] = [];
        if (current.schema) {
          const schema = current.schema;
          const candidates = current.type ? [current.type] : [...schema.topLevel, ...[...schema.messages.keys()].filter((name) => !schema.topLevel.includes(name))];
          let best: { type: string; decoded: ReturnType<typeof decodeWithSchema> } | null = null;
          for (const type of candidates) {
            try {
              const decoded = decodeWithSchema(bytes, schema, type);
              const score = decoded.unknown * 2 + decoded.mismatched * 5 - countFields(decoded.value) * 0.01;
              const bestScore = best ? best.decoded.unknown * 2 + best.decoded.mismatched * 5 - countFields(best.decoded.value) * 0.01 : Infinity;
              if (score < bestScore) best = { type, decoded };
            } catch {
              // This type does not fit the bytes; try the next.
            }
          }
          if (!best) throw new PlainError(`The message does not read as ${current.type || "any message in the .proto file"}.`, "The raw decoding still works; choose another .proto file or message type.");
          const { decoded, type } = best;
          facts.push(`Read as: ${type}${current.type ? "" : ", the message type that fits best"}`);
          if (decoded.unknown > 0) notes.push(`${decoded.unknown} ${decoded.unknown === 1 ? "field is" : "fields are"} not in the .proto file and ${decoded.unknown === 1 ? "is" : "are"} shown by number in brackets, such as "[7]": the file may be older than the message.`);
          if (decoded.mismatched > 0) notes.push(`${decoded.mismatched} ${decoded.mismatched === 1 ? "field has" : "fields have"} a wire type that does not fit the type the .proto file gives, so this may be the wrong message type.`);
          outputs.push({ label: "JSON, with names", fileName: `${stem}.json`, blob: new Blob([`${JSON.stringify(decoded.value, null, 2)}\n`], { type: "application/json" }), kind: "file" as const, note: "Field names, enum names, 64-bit numbers as strings, bytes as base64" });
        } else {
          outputs.push({ label: "JSON, by field number", fileName: `${stem}.json`, blob: new Blob([`${JSON.stringify(rawJson(fields), null, 2)}\n`], { type: "application/json" }), kind: "file" as const, note: "Every reading of a value that could be several things" });
          notes.push("Without a .proto file, field names and types are unknown: a length-prefixed value is shown as a nested message when it reads as one exactly, as text when it is printable, and as hex otherwise. Add the .proto file above for names.");
        }
        return { facts, notes, outputs };
      },
    }),
    [settings],
  );

  const messageNames = settings.schema ? [...settings.schema.messages.keys()] : [];

  const toolSettings: PlainSettings = {
    title: ".proto file",
    summary: () => (settings.schema ? `${settings.schemaName}${settings.type ? `, as ${settings.type}` : ""}` : "none: fields by number"),
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Schema, if you have it</legend>
          <p className={styles.intro}>With the message&apos;s .proto file, fields get their names, enums their values and numbers their right types. Without it, the message is still taken apart field by field.</p>
          <FileField
            id="proto-file"
            accept=".proto,text/plain"
            chosen={settings.schemaName}
            error={schemaError}
            onChoose={async (file) => {
              try {
                const schema = parseProto(await file.text());
                setSchemaError(null);
                setSettings({ schema, schemaName: file.name, type: "" });
              } catch (error) {
                setSchemaError(error instanceof Error ? error.message : String(error));
              }
            }}
            onClear={() => {
              setSchemaError(null);
              setSettings({ schema: null, schemaName: null, type: "" });
            }}
            note="Imports are not followed: types from another file are shown by number."
          />
        </fieldset>
        {settings.schema && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Message type</legend>
            <select className={styles.input} style={{ width: "auto", maxWidth: "100%" }} value={settings.type} onChange={(event) => setSettings((previous) => ({ ...previous, type: event.target.value }))} aria-label="Message type">
              <option value="">Whichever fits best</option>
              {messageNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </fieldset>
        )}
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a binary protobuf message - a captured request, a saved cache entry, a .bin or .pb file, even as base64 or hex text - and see what is inside, field by field, the way protoc --decode_raw shows it, or with names when you add its .proto file. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Decoding"
      dropZone={{ accept: "*/*", inputLabel: "Choose messages", headline: "Drop protobuf messages here", subhead: "Binary, base64 or hex; a gRPC frame is taken off" }}
      note="The raw output matches protoc --decode_raw, except that a printable string which also happens to parse as a message is shown as the string. With a .proto file the JSON follows protobuf's own JSON mapping: 64-bit integers as strings, so no digit is lost, bytes as base64, enums by name and maps as objects. proto2 and proto3 are both read, with nested messages, enums, oneofs, maps and packed fields; groups, a proto2 feature long deprecated, appear only in the raw output."
    />
  );
}
