import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { applyDelta, commitsOf, GitError, readBundleHeader, readPack, resolveRef, walkTree } from "@/lib/files/gitBundle";

const decode = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

// Made by git 2.43: three commits to main, an annotated tag v1.0, then
// `git bundle create full.bundle --all` and `git bundle create thin.bundle main~1..main`.
const FULL = decode(
  "IyB2MiBnaXQgYnVuZGxlCjIyOTlhZWRjMmZjNWQ3N2I0YWNmMjg2NWY1YzA4OGU1MTQ3ZDBjODUgcmVmcy9oZWFkcy9tYWluCjc0" +
  "ZGY4YzFkYzkyZjgwMTgxZDVhMzgzNTI2NjE2ZjhhZTAyMTAxODQgcmVmcy90YWdzL3YxLjAKMjI5OWFlZGMyZmM1ZDc3YjRhY2Yy" +
  "ODY1ZjVjMDg4ZTUxNDdkMGM4NSBIRUFECgpQQUNLAAAAAgAAAA6REHiclc3BasMwEATQu75i74UgyZJWhlKae39irZ3ggmwZR23S" +
  "v68u/YDO8Q3D9BOgIiEypxzEZZtvnn1Ry1mXUPwUc0CZcAtSzCEn9k5eRVN0VoHEMrmYXEDgMkefNS2MPPOShI189bWddFWhj/aN" +
  "KgX0KirveMp2VFxK297I8TiZc7CWXuyIGbp99o7/L831OLAr9UZ9Be2t4z5wyF1+aEWt7a97tLPqxfwCVxxNkskIeJwVy7EOwiAQ" +
  "gOGdp7jdpAHkBBLT6O7sfj2OpqaUppJG3976T9/y1+El3MDaGEkS28yYvB8ccbbhghlZhyBonE+aA6r2XQW4ljI11WiE3XT6j1E2" +
  "uCeCR91lJha4UqKbfKiss3TH0IPxZwwxOK3hpI+Uesr2nuoCdRH1A2XxKZaZDniclctBCsIwEEbhfU4xe0EyaZo0IKILd15ikvyh" +
  "hbYpNYrHt1dw8xYPvrYDFLo+cXRaUFyJsEWQjGXmIXS5Y04hwgXu1SY71kbRahRjh+B09jFowETr7RBNnxEMfCpaa2Yl7zbWne5Z" +
  "6Fk/mCWBLpLlhq8s24xzqsuV2Hf9wOYgdDqi1XGXqTX8L9UjT42E5mkFTSu1EbTWhpf6AYI5RUidCniclYxBCsIwEADvecXeBdkm" +
  "m2wLInrx5CfWzYqFhpQYxedb8AXOcWCmNzNQvieKeAscchpJyXCgMConb8w2+SREPGUnr/6oDc5Z4FrftogaHCTLyT5S1sX2WssR" +
  "Bg6RfUyIsMMNt9ky927/l+4yt2eH38B9AWHNM1WjBHicMzQwMDMxUcjLL0kt1iupKGEQXCLMyMZ1UshWN8eM4d6uZ9sPsKwyMQAC" +
  "heKiZAYms4iSBhUVqyeLTtp8rXkf9WJFx0QAzwcYuqMCeJwzNDAwMzFRyE3MzNMrqGSYn3lZo1i4286I88b2X0s/R6+d8fwlANPa" +
  "DyqjBHicMzQwMDMxUcjLL0kt1iupKGH4d/+G+DHt61NaLkWf+/fYx6Hq8vq1JgZAoFBclMzgWBG49mP0FpVP2usk0pYd/rjsQPEc" +
  "ANI3HxOjAnicMzQwMDMxUchNzMzTK6hkENwYLeXasqF/ifLSypS9+xm7eRdcBQDHGw0eowR4nDM0MDAzMVHIyy9JLdYrqShh+Ktx" +
  "0XcPw4eFk5mLXmxdumFu9f1rN00MgEChuCiZwbEicO3H6C0qn7TXSaQtO/xx2YHiOQCwch6Guc8FeJyl2Dtu3DAARdHeq1CZdHyU" +
  "RIrZjWILzgDKOBgPHGT38WzhuCaeGl3oc87L9ZjKj+n+65j2637+u1+e93M6rq+Pg7/H/nG8T/v5evy87Zfn6c9+vx+36/vT+TgO" +
  "7iruZtwtuFtx13DXcbfhbuh952C0mGgy0Wai0USriWYT7SYaTrScquVUftZoOVXLqVpO1XKqllO1nKrlVC1n1nJmLWfm15SWM2s5" +
  "s5YzazmzljNrObOWs2g5i5azaDkLf+FoOYuWs2g5i5azaDmLlrNqOauWs2o5q5az8sexlrNqOauWs2o5q5bTtJym5TQtp2k5Tctp" +
  "/F+l5TQtp2k5TcvpWk7XcrqW07WcruV0LafzL7mW07WcruVsWs6m5WxazqblbFrOpuVsWs7GmqPlbFrO0HKGljO0nKHlDC1naDlD" +
  "yxlazmAIdAks07fj5XI/Xr7zJRgFC6tgYRYs7IKFYbCwDBamwcI2WDimL7gyN+Sy7LTstuy47LrsvOy+zMAcFuYwMYeNOYzMYWUO" +
  "M3PYmcPQHJbmMDWHrTmMzWFtDnNz2JvD4BwW5zA5h805jM5hdQ6zc9idw/AclucwPYftOYzPYX0O83PYn8MAHRboMEGHDTqM0GGF" +
  "DjN02KHDEB2W6DBFhy06jNFhjQ5zdNijwyAdFukwSYdNOozSYZUOs3TYpcMwHZbpME2HbTqM02GdDvN02KfDQB0W6jBRh406jNRh" +
  "pQ4zddipw1AdluowVYetOozVYa0Oc3XYqyNg/fZ5+vvtdkyPSzz9Bxk3Ohxng054nPsZ+Tpyw2sdABL5BF7gAYNgeJz7GfkocoOT" +
  "2OSH4pabW8TSxQBGiQcktgF4nCsoyswr0VDKSM3JyddRKM8vyklR0uQCAFwAB1U/eJwrKMrMK9FQykjNyclX0uQCACw7BOEEdNM5" +
  "7+0JI19oQSGPL1Ic4pymLw==",
);
const THIN = decode(
  "IyB2MiBnaXQgYnVuZGxlCi0yZGFkNjUxMGRlZTY3YTMxNTYxNGU0N2M5NTI4ZDZiN2U4OTdiNmE3IEVkaXQgYSBsaW5lIGluIHRo" +
  "ZSBub3RlcwoyMjk5YWVkYzJmYzVkNzdiNGFjZjI4NjVmNWMwODhlNTE0N2QwYzg1IHJlZnMvaGVhZHMvbWFpbgoKUEFDSwAAAAIA" +
  "AAAFkRB4nJXNwWrDMBAE0Lu+Yu+FIMmSVoZSmnt/Yq2d4IJsGUdt0r+vLv2AzvENw/QToCIhMqccxGWbb559UctZl1D8FHNAmXAL" +
  "UswhJ/ZOXkVTdFaBxDK5mFxA4DJHnzUtjDzzkoSNfPW1nXRVoY/2jSoF9Coq73jKdlRcStveyPE4mXOwll7siBm6ffaO/y/N9Tiw" +
  "K/VGfQXtreM+cMhdfmhFre2ve7Sz6sX8AlccTZKjBHicMzQwMDMxUcjLL0kt1iupKGEQXCLMyMZ1UshWN8eM4d6uZ9sPsKwyMQAC" +
  "heKiZAYms4iSBhUVqyeLTtp8rXkf9WJFx0QAzwcYuqMCeJwzNDAwMzFRyE3MzNMrqGSYn3lZo1i4286I88b2X0s/R6+d8fwlANPa" +
  "Dyr2Af7f2BfGK9eUhNJbzv7jTEB606+teJx7HfkzcsNrHb78vFSF3PyiVIWczLxULgB8DwlTtgF4nCsoyswr0VDKSM3JyddRKM8v" +
  "yklR0uQCAFwAB1VRlGLEJC260PHEjbAi5aNEtTaq0Q==",
);

const HEAD = "2299aedc2fc5d77b4acf2865f5c088e5147d0c85";

describe("a whole bundle", () => {
  it("reads the refs, and every object with git's own ids, deltas applied", () => {
    const header = readBundleHeader(FULL);
    expect(header.version).toBe(2);
    expect(header.refs).toEqual([
      { id: HEAD, name: "refs/heads/main" },
      { id: "74df8c1dc92f80181d5a383526616f8ae0210184", name: "refs/tags/v1.0" },
      { id: HEAD, name: "HEAD" },
    ]);
    expect(header.prerequisites).toEqual([]);
    const pack = readPack(FULL, header.packStart, header.objectFormat);
    expect(pack.counts).toEqual({ commit: 3, tree: 5, blob: 5, tag: 1 });
    expect(pack.deltas).toBe(2);
    expect(pack.missingBases).toBe(0);
    expect(pack.objects.has(HEAD)).toBe(true);
    expect(resolveRef(pack.objects, "74df8c1dc92f80181d5a383526616f8ae0210184")).toBe(HEAD);
  });

  it("lists the commits newest first, and the files at any of them", () => {
    const header = readBundleHeader(FULL);
    const pack = readPack(FULL, header.packStart, header.objectFormat);
    const commits = commitsOf(pack.objects);
    expect(commits.map((commit) => commit.message.split("\n")[0])).toEqual(["Append to the notes", "Edit a line in the notes", "First commit"]);
    expect(commits[0]).toMatchObject({ id: HEAD, parents: ["2dad6510dee67a315614e47c9528d6b7e897b6a7"], author: { name: "Ada Lovelace", email: "ada@example.com", time: Date.UTC(2025, 0, 3, 10), zone: "+0000" } });
    const files = walkTree(pack.objects, commits[0].tree);
    expect(files.map((file) => file.path)).toEqual(["notes.txt", "src/main.py"]);
    expect(new TextDecoder().decode(files[1].data!)).toBe('print("hello, world")\n');
    const notes = new TextDecoder().decode(files[0].data!).split("\n");
    expect(notes[100]).toBe("line 100 (edited): the analytical engine weaves algebraic patterns");
    expect(notes[200]).toBe("one more line");
    const first = walkTree(pack.objects, commits[2].tree);
    expect(new TextDecoder().decode(first[1].data!)).toBe('print("hello")\n');
  });
});

describe("a thin bundle", () => {
  it("names the commits it needs, and counts the deltas whose bases it lacks", () => {
    const header = readBundleHeader(THIN);
    expect(header.prerequisites).toEqual([{ id: "2dad6510dee67a315614e47c9528d6b7e897b6a7", comment: "Edit a line in the notes" }]);
    const pack = readPack(THIN, header.packStart, header.objectFormat);
    // The new notes.txt is a delta against the version in the prerequisite, which only the receiver has.
    expect(pack.counts).toEqual({ commit: 1, tree: 2, blob: 1, tag: 0 });
    expect(pack).toMatchObject({ deltas: 1, missingBases: 1 });
    expect(commitsOf(pack.objects)[0].id).toBe(HEAD);
  });
});

describe("pieces", () => {
  it("applies copy and insert instructions", () => {
    const base = new TextEncoder().encode("hello, world");
    // Base size 12, result size 11: copy 7 bytes from offset 0, then insert "moon".
    const delta = Uint8Array.from([12, 11, 0x90, 7, 4, ...new TextEncoder().encode("moon")]);
    expect(new TextDecoder().decode(applyDelta(base, delta))).toBe("hello, moon");
    expect(() => applyDelta(base, Uint8Array.from([5, 1, 1, 0x41]))).toThrow(GitError);
  });

  it("reads a bare packfile, and refuses what is neither", () => {
    const blob = new TextEncoder().encode("just one blob\n");
    // One object: type 3 (blob), size 14, which fits the first header byte.
    const header = Uint8Array.from([0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2, 0, 0, 0, 1, 0x30 | blob.length]);
    const pack = new Uint8Array([...header, ...deflateSync(blob), ...new Uint8Array(20)]);
    expect(readBundleHeader(pack).packStart).toBe(0);
    const read = readPack(pack, 0, "sha1");
    // The id `git hash-object` gives the same bytes.
    expect([...read.objects.keys()]).toEqual(["b2b7129b20474610202590a1ac8c1cce65fd7d73"]);
    expect(() => readBundleHeader(new TextEncoder().encode("hello"))).toThrow(GitError);
  });
});
