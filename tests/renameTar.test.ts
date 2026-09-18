import { gunzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DEFAULT_RENAME_SETTINGS, describeRename, patternDistinguishes, renameOne, renamePlan, titleCase } from "@/lib/files/rename";
import { BLOCK, parseTarHeader, TarReader } from "@/lib/zip/tar";
import { archivePaths, createTar, entryHeaders, splitTarName, tarBytes, tarHeader, tarPadding } from "@/lib/zip/tarWrite";

const MAY = Date.UTC(2024, 4, 6, 12);

describe("renaming", () => {
  it("fills the pattern's tokens", () => {
    const file = { name: "IMG_0042.JPG", lastModified: MAY };
    expect(renameOne(file, 0, DEFAULT_RENAME_SETTINGS)).toBe("IMG_0042.JPG");
    expect(renameOne(file, 2, { ...DEFAULT_RENAME_SETTINGS, pattern: "{n}-{name}" })).toBe("03-IMG_0042.JPG");
    expect(renameOne(file, 0, { ...DEFAULT_RENAME_SETTINGS, pattern: "{date}-{name}", caseChange: "lower" })).toBe("2024-05-06-img_0042.JPG");
    expect(renameOne(file, 0, { ...DEFAULT_RENAME_SETTINGS, pattern: "holiday-{n}.{ext}", start: 10, padding: 3 })).toBe("holiday-010.JPG");
    expect(renameOne(file, 0, { ...DEFAULT_RENAME_SETTINGS, find: "IMG_", replace: "photo " , caseChange: "title" })).toBe("Photo 0042.JPG");
    expect(renameOne({ name: "README", lastModified: MAY }, 0, { ...DEFAULT_RENAME_SETTINGS, pattern: "{n} {original}" })).toBe("01 README");
  });

  it("keeps names safe and never empty", () => {
    expect(renameOne({ name: "a/b:c.txt", lastModified: MAY }, 0, DEFAULT_RENAME_SETTINGS)).toBe("abc.txt");
    expect(renameOne({ name: "x.txt", lastModified: MAY }, 0, { ...DEFAULT_RENAME_SETTINGS, find: "x", replace: "", pattern: "{name}" })).toBe(".txt");
    expect(renameOne({ name: "x", lastModified: MAY }, 4, { ...DEFAULT_RENAME_SETTINGS, find: "x", replace: "" })).toBe("file-05");
    expect(renameOne({ name: "x.txt", lastModified: Number.NaN }, 0, { ...DEFAULT_RENAME_SETTINGS, pattern: "{date}" })).toBe("undated.txt");
  });

  it("tells repeated names apart and describes the settings", () => {
    const plan = renamePlan([{ name: "a.txt", lastModified: MAY }, { name: "b.txt", lastModified: MAY }], { ...DEFAULT_RENAME_SETTINGS, pattern: "same" });
    expect(plan.map((entry) => entry.to)).toEqual(["same.txt", "same (2).txt"]);
    expect(patternDistinguishes("same")).toBe(false);
    expect(patternDistinguishes("{n}")).toBe(true);
    expect(describeRename({ ...DEFAULT_RENAME_SETTINGS, pattern: "{n}-{name}", find: "IMG", caseChange: "lower" })).toBe('numbered, "IMG" replaced, lower case');
    expect(titleCase("hello-there_old friend (v2)")).toBe("Hello-There_Old Friend (V2)");
  });
});

describe("writing tar", () => {
  it("writes a header the reader checks out", () => {
    const block = tarHeader("hello.txt", 5, 1_700_000_000);
    expect(block).toHaveLength(BLOCK);
    expect(parseTarHeader(block)).toEqual({ name: "hello.txt", size: 5, modified: 1_700_000_000, type: "0" });
    expect(tarPadding(5)).toHaveLength(507);
    expect(tarPadding(512)).toHaveLength(0);
  });

  it("splits a long name into the prefix, or writes a long-name entry", () => {
    expect(splitTarName("short.txt")).toEqual({ prefix: "", name: "short.txt" });
    const deep = `${"folder/".repeat(20)}file.txt`;
    const split = splitTarName(deep);
    expect(split).not.toBeNull();
    expect(`${split!.prefix}/${split!.name}`).toBe(deep);
    expect(entryHeaders(deep, 1, 0)).toHaveLength(1);
    expect(parseTarHeader(entryHeaders(deep, 1, 0)[0])?.name).toBe(deep);
    const flat = "x".repeat(120);
    expect(splitTarName(flat)).toBeNull();
    const headers = entryHeaders(flat, 1, 0);
    expect(headers).toHaveLength(4);
    expect(parseTarHeader(headers[0])).toMatchObject({ name: "././@LongLink", type: "L", size: 121 });
  });

  it("round-trips through the reader, long names included", async () => {
    const encoder = new TextEncoder();
    const long = "y".repeat(150);
    const bytes = tarBytes([
      { name: "a.txt", data: encoder.encode("alpha"), modifiedSeconds: 1_700_000_000 },
      { name: "dir/b.bin", data: new Uint8Array(1000).fill(7) },
      { name: long, data: encoder.encode("z") },
    ]);
    expect(bytes.length % BLOCK).toBe(0);
    const reader = new TarReader();
    for (let at = 0; at < bytes.length; at += 700) reader.push(bytes.subarray(at, Math.min(bytes.length, at + 700)));
    const entries = reader.end();
    expect(entries.map((entry) => [entry.path, entry.size])).toEqual([["a.txt", 5], ["dir/b.bin", 1000], [long, 1]]);
    expect(entries[0].modified).toBe(1_700_000_000);
    expect(await entries[0].blob.text()).toBe("alpha");
  });

  it("names archive paths without leading slashes and tells repeats apart", () => {
    expect(archivePaths([{ name: "/a/b.txt" }, { name: "b.txt" }, { name: "b.txt" }, { name: "c\\d" }])).toEqual(["a/b.txt", "b.txt", "b (2).txt", "c/d"]);
  });

  it("makes a gzipped archive from files", async () => {
    const files = [new File(["hello"], "hello.txt", { lastModified: MAY }), new File([new Uint8Array(600)], "zeros.bin")];
    const plain = await createTar(files, false);
    expect(plain.type).toBe("application/x-tar");
    expect(plain.size).toBe(512 + 512 + 512 + 1024 + 1024);
    const gz = await createTar(files, true);
    expect(gz.type).toBe("application/gzip");
    const inflated = gunzipSync(new Uint8Array(await gz.arrayBuffer()));
    expect(inflated.length).toBe(plain.size);
    const reader = new TarReader();
    reader.push(inflated);
    const entries = reader.end();
    expect(entries.map((entry) => entry.path)).toEqual(["hello.txt", "zeros.bin"]);
    expect(entries[0].modified).toBe(Math.floor(MAY / 1000));
  });
});
