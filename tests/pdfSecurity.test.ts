import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PlainError } from "@/lib/plainQueue";
import { describePermissions, hardenedHash, md5, permissionBits, protectPdf, rc4, unlockPdf, utf8Password } from "@/lib/pdf/security";

import { ENCRYPTED_FIXTURES, encryptedFixture } from "./encryptedPdfs";

async function threePages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle("Secret plans");
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page += 1) document.addPage([300, 200]).drawText(`Page ${page} says hello`, { x: 20, y: 100, size: 14, font });
  return document.save();
}

/** The text of every page and the title, as PDF.js - Firefox's reader - sees them. */
async function readWithPdfJs(bytes: Uint8Array, password?: string): Promise<{ pages: string[]; title: string | undefined }> {
  const task = getDocument({ data: bytes.slice(), password, useWorkerFetch: false, disableFontFace: true, verbosity: 0 });
  const document = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
  }
  const info = (await document.getMetadata()).info as { Title?: string };
  await task.destroy();
  return { pages, title: info.Title };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

// pdf-lib warns about every object stream it cannot inflate, which is every
// encrypted one; the unlocker reads those itself.
const warn = vi.spyOn(console, "warn");
beforeAll(() => warn.mockImplementation(() => {}));
afterAll(() => warn.mockRestore());

describe("the primitives", () => {
  it("RC4 and MD5 match their published vectors", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(Buffer.from(rc4(text("Key"), text("Plaintext"))).toString("hex")).toBe("bbf316e8d940af0ad3");
    expect(Buffer.from(rc4(text("Secret"), text("Attack at dawn"))).toString("hex")).toBe("45a01f645fc35b383552544b9bf5");
    expect(Buffer.from(md5(text("abc"))).toString("hex")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("clears only the permission bits asked for", () => {
    expect(permissionBits({ print: true, copy: true, edit: true })).toBe(-4);
    const locked = permissionBits({ print: false, copy: false, edit: false });
    expect(describePermissions(locked)).toEqual(["printing", "copying text", "editing", "comments", "filling forms", "assembling pages"]);
    expect(locked & 512).toBe(512);
    expect(describePermissions(permissionBits({ print: true, copy: false, edit: true }))).toEqual(["copying text"]);
  });

  it("normalizes a password before hashing it, and caps it at 127 bytes", async () => {
    expect(utf8Password("\ufb01le")).toEqual(new TextEncoder().encode("file"));
    expect(utf8Password("x".repeat(200))).toHaveLength(127);
    const salt = new Uint8Array(8);
    expect(await hardenedHash(utf8Password("a"), salt, new Uint8Array(0), 6)).toHaveLength(32);
  });
});

describe("unlocking qpdf's encrypted files", () => {
  for (const name of ENCRYPTED_FIXTURES) {
    const restricted = name === "r6-restricted";
    it(`opens ${name} with ${restricted ? "no password" : "the user password and with the owner password"}`, async () => {
      const bytes = encryptedFixture(name);
      const result = await unlockPdf(bytes, restricted ? "" : "user");
      expect(result).not.toBeNull();
      expect(result!.owner).toBe(false);
      expect(result!.openedWithoutPassword).toBe(restricted);
      expect(result!.description).toBe("3 pages, 106 x 71 mm");
      expect(result!.encryption).toBe(name.includes("aes-256") || restricted ? "AES-256" : name.includes("aes-128") ? "AES-128" : name.includes("40") ? "RC4 40-bit" : "RC4 128-bit");
      const read = await readWithPdfJs(result!.bytes);
      expect(read.pages).toEqual(["Page 1 says hello", "Page 2 says hello", "Page 3 says hello"]);
      expect(read.title).toBe("Secret plans");
      const reopened = await PDFDocument.load(result!.bytes);
      expect(reopened.isEncrypted).toBe(false);
      expect(reopened.getTitle()).toBe("Secret plans");
      if (restricted) {
        expect(result!.restrictions).toEqual(expect.arrayContaining(["copying text", "editing"]));
      } else {
        const asOwner = await unlockPdf(bytes, "owner");
        expect(asOwner!.owner).toBe(true);
        expect((await readWithPdfJs(asOwner!.bytes)).pages[1]).toBe("Page 2 says hello");
      }
    });
  }

  it("refuses a wrong password, and asks for one when none was typed", async () => {
    const bytes = encryptedFixture("r4-aes-128");
    const wrong = await rejection(unlockPdf(bytes, "guess"));
    expect(wrong).toBeInstanceOf(PlainError);
    expect(wrong.message).toBe("That password does not open this PDF.");
    expect((await rejection(unlockPdf(bytes, ""))).message).toBe("This PDF needs its password to open.");
    expect((await rejection(unlockPdf(encryptedFixture("r6-aes-256"), "User"))).message).toBe("That password does not open this PDF.");
  });

  it("says when there was nothing to unlock", async () => {
    expect(await unlockPdf(await threePages(), "")).toBeNull();
  });
});

describe("protecting a PDF", () => {
  it("writes AES-256 that PDF.js opens with the password and refuses without it", async () => {
    const plain = await threePages();
    const { bytes: locked, description } = await protectPdf(plain, { userPassword: "correct horse", permissions: { print: true, copy: false, edit: false } });
    expect(description).toBe("3 pages, 106 x 71 mm");
    const text = new TextDecoder("latin1").decode(locked);
    expect(text).toContain("/AESV3");
    expect(text).not.toContain("says hello");
    expect(text).not.toContain("Secret plans");
    const read = await readWithPdfJs(locked, "correct horse");
    expect(read.pages).toEqual(["Page 1 says hello", "Page 2 says hello", "Page 3 says hello"]);
    expect(read.title).toBe("Secret plans");
    const refused = await rejection(readWithPdfJs(locked));
    expect(refused.name).toBe("PasswordException");
    const wrong = await rejection(readWithPdfJs(locked, "wrong"));
    expect(wrong.name).toBe("PasswordException");
  });

  it("writes a file that opens freely but carries its restrictions", async () => {
    const { bytes: locked } = await protectPdf(await threePages(), { userPassword: "", permissions: { print: false, copy: false, edit: true } });
    expect((await readWithPdfJs(locked)).pages[0]).toBe("Page 1 says hello");
    const unlocked = await unlockPdf(locked, "");
    expect(unlocked!.openedWithoutPassword).toBe(true);
    expect(unlocked!.restrictions).toEqual(["printing", "copying text"]);
  });

  it("round-trips through unlock with the user password and with a chosen owner password", async () => {
    const { bytes: locked } = await protectPdf(await threePages(), { userPassword: "p\u00e4ss", ownerPassword: "boss", permissions: { print: true, copy: true, edit: true } });
    expect((await readWithPdfJs((await unlockPdf(locked, "p\u00e4ss"))!.bytes)).pages[2]).toBe("Page 3 says hello");
    const asOwner = await unlockPdf(locked, "boss");
    expect(asOwner!.owner).toBe(true);
    expect((await PDFDocument.load(asOwner!.bytes)).getPageCount()).toBe(3);
  });

  it("refuses a file that already has a password", async () => {
    expect((await rejection(protectPdf(encryptedFixture("r4-aes-128"), { userPassword: "x", permissions: { print: true, copy: true, edit: true } }))).message).toBe("This PDF already has a password.");
  });
});
