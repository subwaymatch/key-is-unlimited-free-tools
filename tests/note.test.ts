import { describe, expect, it } from "vitest";

import { NoteFormatError, noteArmor, noteLink, parseNote } from "@/lib/crypto/note";
import { decryptBlob, encryptBlob } from "@/lib/crypto/passphrase";

async function sealText(text: string, passphrase: string): Promise<Uint8Array> {
  return new Uint8Array(await (await encryptBlob(new Blob([text]), passphrase, { iterations: 1000 })).arrayBuffer());
}

async function openText(sealed: Uint8Array, passphrase: string): Promise<string> {
  return (await decryptBlob(new Blob([sealed as BlobPart]), passphrase)).text();
}

describe("encrypted notes", () => {
  it("travel as a link whose fragment holds only the sealed note", async () => {
    const sealed = await sealText("The door code is 4417.", "fairly long passphrase");
    const link = noteLink("https://key.is", sealed);
    expect(link.startsWith("https://key.is/encrypt-note#note=")).toBe(true);
    // base64url: nothing a chat app would mangle, and no padding.
    expect(link.split("#")[1]).toMatch(/^note=[A-Za-z0-9_-]+$/);
    expect(link).not.toContain("passphrase");
    expect(await openText(parseNote(link), "fairly long passphrase")).toBe("The door code is 4417.");
  });

  it("travel as an armoured block, wrapped at 64 characters, and survive being re-wrapped", async () => {
    const note = "Line one\nLine two \u2014 with a dash and caf\u00e9";
    const sealed = await sealText(note, "passphrase here");
    const armor = noteArmor(sealed);
    const lines = armor.split("\n");
    expect(lines[0]).toBe("-----BEGIN KEY.IS ENCRYPTED NOTE-----");
    expect(lines[lines.length - 1]).toBe("-----END KEY.IS ENCRYPTED NOTE-----");
    expect(lines.slice(1, -2).every((line) => line.length === 64)).toBe(true);
    const mangled = `Hi, here it is:\n\n${armor.replace(/\n/g, "\r\n  ")}\n\nBye`;
    expect(await openText(parseNote(mangled), "passphrase here")).toBe(note);
  });

  it("read bare base64 too", async () => {
    const sealed = await sealText("x", "passphrase here");
    const bare = noteArmor(sealed).split("\n").slice(1, -1).join("");
    expect(await openText(parseNote(bare), "passphrase here")).toBe("x");
  });

  it("explain what is wrong with text that is not a note", () => {
    expect(() => parseNote("")).toThrow(NoteFormatError);
    expect(() => parseNote("hello there!")).toThrow(/characters a note never has/);
    expect(() => parseNote("aGVsbG8gd29ybGQ=")).toThrow(/not an encrypted note/);
    expect(() => parseNote("-----BEGIN KEY.IS ENCRYPTED NOTE-----\nS0VZSVNFTkM=")).toThrow(/END line is missing/);
  });
});
