import { describe, expect, it } from "vitest";

import { extensionMatches, hexDump, identify, identifyText } from "@/lib/files/identify";

const bytes = (...values: (number | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === "number") out.push(value);
    else for (const ch of value) out.push(ch.charCodeAt(0));
  }
  return new Uint8Array(out);
};

const text = (value: string) => new TextEncoder().encode(value);

describe("identifying files by their bytes", () => {
  it("reads the signatures", () => {
    expect(identify(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)).kind.name).toBe("PNG image");
    expect(identify(bytes(0xff, 0xd8, 0xff, 0xe0)).kind.extensions).toContain("jpg");
    expect(identify(bytes("GIF89a")).kind.mime).toBe("image/gif");
    expect(identify(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")).kind.name).toBe("WebP image");
    expect(identify(bytes("RIFF", 0, 0, 0, 0, "WAVEfmt ")).kind.name).toBe("WAV audio");
    expect(identify(bytes(0, 0, 0, 0x18, "ftypisom")).kind.name).toBe("MP4 video");
    expect(identify(bytes(0, 0, 0, 0x18, "ftypqt  ")).kind.name).toBe("QuickTime video");
    expect(identify(bytes(0, 0, 0, 0x18, "ftypavif")).kind.name).toBe("AVIF image");
    expect(identify(bytes(0, 0, 0, 0x18, "ftypheic")).kind.extensions).toContain("heic");
    expect(identify(bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, "webm")).kind.name).toBe("WebM video");
    expect(identify(bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, "matroska")).kind.name).toBe("Matroska video");
    expect(identify(bytes("OggS", 0, 0, 0, 0, "OpusHead")).kind.name).toBe("Opus audio");
    expect(identify(bytes("ID3", 3, 0)).kind.name).toBe("MP3 audio");
    expect(identify(bytes("%PDF-1.7")).kind.name).toBe("PDF document");
    expect(identify(bytes(0x1f, 0x8b, 8)).kind.extensions).toContain("gz");
    expect(identify(bytes("MZ", 0x90)).kind.category).toBe("program");
    expect(identify(bytes(0x7f, "ELF")).kind.name).toContain("ELF");
    expect(identify(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34)).kind.name).toBe("Java class");
    expect(identify(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2)).kind.name).toContain("universal");
    expect(identify(bytes("SQLite format 3", 0)).kind.name).toBe("SQLite database");
    expect(identify(bytes("wOF2")).kind.category).toBe("font");
    expect(identify(bytes("KEYISENC", 1)).kind.name).toContain("key.is");
  });

  it("looks further in for a TAR, an ISO and a transport stream", () => {
    const tar = new Uint8Array(600);
    tar.set(bytes("ustar"), 257);
    expect(identify(tar).kind.name).toBe("TAR archive");
    const ts = new Uint8Array(188 * 4);
    for (const at of [0, 188, 376, 564]) ts[at] = 0x47;
    expect(identify(ts).kind.name).toBe("MPEG transport stream");
  });

  it("tells the Office formats and other ZIPs apart by their entry names", () => {
    const zip = bytes(0x50, 0x4b, 3, 4, 0, 0, "[Content_Types].xml");
    expect(identify(zip, text("word/document.xml")).kind.extensions).toEqual(["docx"]);
    expect(identify(zip, text("xl/workbook.xml")).kind.extensions).toEqual(["xlsx"]);
    expect(identify(zip, text("ppt/slides/slide1.xml")).kind.extensions).toEqual(["pptx"]);
    expect(identify(bytes(0x50, 0x4b, 3, 4, 0, 0, "mimetypeapplication/epub+zip")).kind.extensions).toEqual(["epub"]);
    expect(identify(zip, text("META-INF/MANIFEST.MF")).kind.extensions).toEqual(["jar"]);
    expect(identify(zip, text("classes.dex")).kind.extensions).toEqual(["apk"]);
    expect(identify(zip, text("nothing special")).kind.name).toBe("ZIP archive");
  });

  it("reads text by its first lines", () => {
    expect(identifyText('{"a": 1}').name).toBe("JSON data");
    expect(identifyText('{"cells": [], "nbformat": 4}').name).toBe("Jupyter notebook");
    expect(identifyText("a,b,c\n1,2,3\n4,5,6\n").extensions).toEqual(["csv"]);
    expect(identifyText('name,note\n"Smith, John","said ""hi"""\nplain,"two\nlines"\nlast,\n').extensions).toEqual(["csv"]);
    expect(identifyText("a\tb\n1\t2\n3\t4\n").name).toBe("Tab-separated table");
    expect(identifyText("a;b\n1;2\n3;4\n").name).toBe("CSV table (semicolons)");
    // Two lines with a comma each are prose, not a table.
    expect(identifyText("just some words, on two lines\nand another, here\n").name).toBe("Plain text");
    expect(identifyText("1\n00:00:01,000 --> 00:00:02,000\nHi\n").extensions).toEqual(["srt"]);
    expect(identifyText("WEBVTT\n\n").extensions).toEqual(["vtt"]);
    expect(identifyText('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>').name).toBe("SVG image");
    expect(identifyText('<?xml version="1.0"?><gpx></gpx>').name).toBe("GPX track");
    expect(identifyText("<!DOCTYPE html><html></html>").name).toBe("HTML page");
    expect(identifyText("#!/usr/bin/env python3\nprint(1)").name).toBe("Python script");
    expect(identifyText("#!/bin/sh\necho").name).toBe("Shell script");
    expect(identifyText("BEGIN:VCARD\nFN:Ada\nEND:VCARD").extensions).toEqual(["vcf"]);
    expect(identifyText("-----BEGIN CERTIFICATE-----\nAAAA\n").name).toContain("PEM");
    expect(identifyText("# Title\n\nSome words.").name).toBe("Markdown text");
    expect(identifyText("just some words\non two lines").name).toBe("Plain text");
    const identified = identify(text("hello\nworld\n"));
    expect(identified).toMatchObject({ how: "text", encoding: "ASCII, which is also UTF-8" });
    expect(identified.kind.name).toBe("Plain text");
  });

  it("shrugs at unknown binary and names an empty file", () => {
    expect(identify(new Uint8Array([0, 1, 2, 3, 255, 254, 0, 0])).kind.name).toContain("unknown");
    expect(identify(new Uint8Array(0)).kind.name).toBe("Empty file");
  });

  it("checks the extension against the kind", () => {
    const png = identify(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)).kind;
    expect(extensionMatches("photo.png", png)).toBe(true);
    expect(extensionMatches("photo.PNG", png)).toBe(true);
    expect(extensionMatches("photo.jpg", png)).toBe(false);
    expect(extensionMatches("photo", png)).toBe(false);
    const jpeg = identify(bytes(0xff, 0xd8, 0xff)).kind;
    expect(extensionMatches("photo.jpeg", jpeg)).toBe(true);
    const elf = identify(bytes(0x7f, "ELF")).kind;
    expect(extensionMatches("program", elf)).toBe(true);
    expect(extensionMatches("x.bin", identify(new Uint8Array([0, 1, 2, 3, 255, 254, 0, 0])).kind)).toBeNull();
  });

  it("dumps hex", () => {
    expect(hexDump(bytes("AB", 0, 255))).toBe("00000000  41 42 00 ff                                      AB..");
    expect(hexDump(new Uint8Array(20)).split("\n")).toHaveLength(2);
    expect(hexDump(new Uint8Array(20)).split("\n")[1].startsWith("00000010  ")).toBe(true);
  });
});
