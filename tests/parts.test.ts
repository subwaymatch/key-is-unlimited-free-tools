import { describe, expect, it } from "vitest";

import { joinCommands, orderParts, parsePartName, partCount, partName } from "@/lib/files/parts";

describe("naming pieces", () => {
  it("counts and names them with a number wide enough", () => {
    expect(partCount(0, 10)).toBe(1);
    expect(partCount(10, 10)).toBe(1);
    expect(partCount(11, 10)).toBe(2);
    expect(partName("video.mp4", 3, 12)).toBe("video.mp4.003");
    expect(partName("video.mp4", 1234, 5000)).toBe("video.mp4.1234");
    expect(parsePartName("video.mp4.003")).toEqual({ base: "video.mp4", index: 3 });
    expect(parsePartName("backup.tar.part12")).toEqual({ base: "backup.tar", index: 12 });
    expect(parsePartName("archive.z01")).toEqual({ base: "archive", index: 1 });
    expect(parsePartName("video.mp4")).toBeNull();
    expect(parsePartName("photo.7")).toBeNull();
  });
});

describe("ordering pieces", () => {
  it("sorts by number whatever order they came in, and reports gaps and repeats", () => {
    const ordered = orderParts([{ name: "a.bin.003" }, { name: "a.bin.001" }, { name: "a.bin.002" }]);
    expect(ordered.ordered.map((file) => file.name)).toEqual(["a.bin.001", "a.bin.002", "a.bin.003"]);
    expect(ordered).toMatchObject({ base: "a.bin", problems: [] });
    expect(orderParts([{ name: "a.bin.001" }, { name: "a.bin.003" }]).problems).toEqual(["Piece 2 is missing."]);
    expect(orderParts([{ name: "a.bin.001" }, { name: "a.bin.005" }]).problems).toEqual(["Pieces 2 to 4 are missing."]);
    expect(orderParts([{ name: "a.bin.002" }, { name: "a.bin.003" }]).problems).toEqual(["The first piece is number 2; the set may be missing its start."]);
    expect(orderParts([{ name: "a.bin.001" }, { name: "a.bin.001" }]).problems).toEqual(["Piece 1 is here twice."]);
    expect(orderParts([{ name: "a.bin.001" }, { name: "b.bin.002" }]).problems[0]).toContain("2 different names");
  });

  it("has an answer for no pieces at all, since the page asks before any land", () => {
    expect(orderParts([])).toEqual({ ordered: [], base: "joined", problems: [] });
  });

  it("keeps the order given when the names are not pieces, and says so", () => {
    const result = orderParts([{ name: "second" }, { name: "first.001" }]);
    expect(result.ordered.map((file) => file.name)).toEqual(["second", "first.001"]);
    expect(result.problems[0]).toContain("One file is not named as a piece");
  });

  it("writes the commands to join them elsewhere", () => {
    expect(joinCommands("video.mp4", 3)).toEqual({ unix: "cat video.mp4.??? > video.mp4", windows: "copy /b video.mp4.??? video.mp4" });
    expect(joinCommands("my file.zip", 1200).unix).toBe("cat 'my file.zip.????' > 'my file.zip'");
    expect(joinCommands("my file.zip", 2).windows).toBe('copy /b "my file.zip.???" "my file.zip"');
  });
});
