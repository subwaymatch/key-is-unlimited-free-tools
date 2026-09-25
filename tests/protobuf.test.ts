import { describe, expect, it } from "vitest";

import { decodeRaw, decodeWithSchema, parseProto, ProtobufError, rawJson, rawText, unwrapInput } from "@/lib/data/protobuf";

// An Order written by the Python protobuf runtime from the .proto below, and what
// `protoc --decode_raw` prints for it (libprotoc 35.1).
const ORDER = Uint8Array.from(atob("CNb//////////wESDUFkYSBMw7Z2ZWxhY2UaEAoDQS0xEAIZexSuR+H6I0AaEAoDQi0yEAEZAAAAAAAA4D8gAioNAZYB/f//////////ATIMCgRkb29yEgRibHVlMgoKBHRpbWUSAmFtOgMA/xBADUnLBPtxHwEAAFUAACBAWAFiD2FkYUBleGFtcGxlLmNvbXX3////"), (character) => character.charCodeAt(0));

const PROTO = "syntax = \"proto3\";\npackage shop.v1;\n\n// An order, with every kind of field.\nmessage Order {\n  enum Status { STATUS_UNSPECIFIED = 0; PAID = 1; SHIPPED = 2; }\n  message Line {\n    string sku = 1;\n    uint32 quantity = 2;\n    double price = 3;\n  }\n  int64 id = 1;\n  string customer = 2;\n  repeated Line lines = 3;\n  Status status = 4;\n  repeated int32 tags = 5;\n  map<string, string> notes = 6;\n  bytes signature = 7;\n  sint32 balance = 8;\n  fixed64 stamp = 9;\n  float weight = 10;\n  bool gift = 11;\n  oneof contact { string email = 12; string phone = 13; }\n  sfixed32 offset = 14;\n}\n";

const PROTOC_RAW = "1: 18446744073709551574\n2: \"Ada L\\303\\266velace\"\n3 {\n  1: \"A-1\"\n  2: 2\n  3: 0x4023fae147ae147b\n}\n3 {\n  1: \"B-2\"\n  2: 1\n  3: 0x3fe0000000000000\n}\n4: 2\n5: \"\\001\\226\\001\\375\\377\\377\\377\\377\\377\\377\\377\\377\\001\"\n6 {\n  1: \"door\"\n  2: \"blue\"\n}\n6 {\n  1: \"time\"\n  2: \"am\"\n}\n7: \"\\000\\377\\020\"\n8: 13\n9: 0x0000011f71fb04cb\n10: 0x40200000\n11: 1\n12: \"ada@example.com\"\n14: 0xfffffff7";

describe("without a schema", () => {
  it("prints exactly what protoc --decode_raw prints", () => {
    expect(rawText(decodeRaw(ORDER))).toBe(PROTOC_RAW);
  });

  it("gives JSON with every reading of the ambiguous values", () => {
    const json = rawJson(decodeRaw(ORDER));
    expect(json["1"]).toEqual({ uint: "18446744073709551574", int: "-42" });
    expect(json["2"]).toBe("Ada L\u00f6velace");
    expect(json["3"]).toEqual([
      { "1": "A-1", "2": 2, "3": { fixed64: "4621813488089437307", double: 9.99 } },
      { "1": "B-2", "2": 1, "3": { fixed64: "4602678819172646912", double: 0.5 } },
    ]);
    expect(json["10"]).toEqual({ fixed32: 1075838976, float: 2.5 });
    expect(json["7"]).toEqual({ hex: "00ff10" });
  });

  it("refuses bytes that are not a message", () => {
    expect(() => decodeRaw(Uint8Array.from([0x0a, 0x05, 0x61]))).toThrow(ProtobufError);
    expect(() => decodeRaw(Uint8Array.from([0x07]))).toThrow(/Field number 0/);
    expect(() => decodeRaw(Uint8Array.from([0x0e, 0x01]))).toThrow(/Wire type 6/);
  });
});

describe("with a .proto file", () => {
  it("reads messages, nested types, enums, maps and oneofs", () => {
    const schema = parseProto(PROTO);
    expect(schema.syntax).toBe("proto3");
    expect(schema.topLevel).toEqual(["shop.v1.Order"]);
    expect(schema.messages.get("shop.v1.Order")!.fields.find((field) => field.name === "lines")).toMatchObject({ type: "shop.v1.Order.Line", repeated: true });
    expect(schema.enums.get("shop.v1.Order.Status")!.get(2)).toBe("SHIPPED");
  });

  it("decodes to the same values as protobuf's own JSON printer", () => {
    const decoded = decodeWithSchema(ORDER, parseProto(PROTO), "shop.v1.Order");
    expect(decoded).toMatchObject({ unknown: 0, mismatched: 0 });
    expect(decoded.value).toEqual({"id": "-42", "customer": "Ada L\u00f6velace", "lines": [{"sku": "A-1", "quantity": 2, "price": 9.99}, {"sku": "B-2", "quantity": 1, "price": 0.5}], "status": "SHIPPED", "tags": [1, 150, -3], "notes": {"time": "am", "door": "blue"}, "signature": "AP8Q", "balance": -7, "stamp": "1234567890123", "weight": 2.5, "gift": true, "email": "ada@example.com", "offset": -9});
  });

  it("keeps fields the schema does not know, by number", () => {
    const schema = parseProto('syntax = "proto3"; message Small { string name = 2; }');
    const decoded = decodeWithSchema(ORDER, schema, "Small");
    expect(decoded.value.name).toBe("Ada L\u00f6velace");
    expect(decoded.unknown).toBeGreaterThan(5);
    expect(decoded.value["[4]"]).toBe(2);
  });
});

describe("input", () => {
  it("takes base64 or hex text, and strips a gRPC frame", () => {
    const hex = Array.from(ORDER.subarray(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    expect(unwrapInput(new TextEncoder().encode(hex))).toEqual({ bytes: ORDER.subarray(0, 4), from: "hex text" });
    const framed = new Uint8Array(5 + ORDER.length);
    new DataView(framed.buffer).setUint32(1, ORDER.length);
    framed.set(ORDER, 5);
    expect(unwrapInput(framed).from).toBe("a gRPC frame");
    expect(Array.from(unwrapInput(framed).bytes)).toEqual(Array.from(ORDER));
    expect(unwrapInput(new TextEncoder().encode(btoa(String.fromCharCode(...ORDER)))).from).toBe("base64 text");
  });
});
