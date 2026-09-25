import { describe, expect, it } from "vitest";

import { interpretQrText, semicolonFields } from "@/lib/qr/content";
import { decodeModules, QrReadError } from "@/lib/qr/decode";
import { readQrCodes, readQrCodesAtScales } from "@/lib/qr/detect";
import { capacityBytes, encodeQr, modeFor, qrSvg, QrTooLongError, wifiText, type QrCode } from "@/lib/qr/encode";
import { correct, generator, remainder } from "@/lib/qr/galois";
import { alignmentPositions, blockLayout, ECC_LEVELS, formatWord, nearestFormat, versionWord } from "@/lib/qr/tables";

import { fixtureModules, SEGNO_FIXTURES } from "./qrFixtures";

// "HELLO WORLD" at level Q as segno draws it, which picks mask 1.
const HELLO_WORLD = [
  "111111100001001111111",
  "100000100100001000001",
  "101110100100101011101",
  "101110101101001011101",
  "101110100111001011101",
  "100000101111001000001",
  "111111101010101111111",
  "000000001101000000000",
  "011000100101101101000",
  "000101011010010111011",
  "011000100011011110010",
  "001110000110000000100",
  "110111111110111011111",
  "000000001000011101111",
  "111111100111010000110",
  "100000100000111000010",
  "101110100111011010101",
  "101110100000000001000",
  "101110101100001000011",
  "100000101110100100001",
  "111111100100001001011",
];

function rows(code: QrCode): string[] {
  const out: string[] = [];
  for (let y = 0; y < code.size; y += 1) out.push(Array.from(code.modules.subarray(y * code.size, (y + 1) * code.size)).join(""));
  return out;
}

/** The code drawn as a grey picture: `scale` pixels to a module, a quiet zone, dark on light. */
function picture(code: QrCode, scale: number, margin = 4, dark = 30, light = 225): { gray: Uint8Array; width: number } {
  const width = (code.size + margin * 2) * scale;
  const gray = new Uint8Array(width * width).fill(light);
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (!code.modules[y * code.size + x]) continue;
      for (let dy = 0; dy < scale; dy += 1) gray.fill(dark, ((y + margin) * scale + dy) * width + (x + margin) * scale, ((y + margin) * scale + dy) * width + (x + margin + 1) * scale);
    }
  }
  return { gray, width };
}

/** A picture mapped through a projective transform onto a larger canvas, by inverse bilinear sampling. */
function warp(source: Uint8Array, size: number, canvas: number, map: (x: number, y: number) => [number, number]): Uint8Array {
  const out = new Uint8Array(canvas * canvas).fill(225);
  for (let y = 0; y < canvas; y += 1) {
    for (let x = 0; x < canvas; x += 1) {
      const [sx, sy] = map(x + 0.5, y + 0.5);
      if (sx < 0 || sy < 0 || sx >= size - 1 || sy >= size - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const at = (xx: number, yy: number) => source[yy * size + xx];
      out[y * canvas + x] = Math.round(at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy);
    }
  }
  return out;
}

/** The projective map taking a quadrilateral, corners clockwise from top-left, onto the unit square. */
function quadToSquare(q: [number, number][]): (x: number, y: number) => [number, number] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  // Square to quad is [a b c; d e f; g h 1]; its adjoint maps back.
  const [a, b, c, d, e, f] = [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0];
  const m = [e - f * h, c * h - b, b * f - c * e, f * g - d, a - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  return (x, y) => {
    const w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  };
}

describe("the tables", () => {
  it("match the standard's format and version words and alignment positions", () => {
    // Level M, mask 5 is 100000011001110 in the standard's table; version 7's word is 000111110010010100.
    expect(formatWord("M", 5).toString(2).padStart(15, "0")).toBe("100000011001110");
    expect(versionWord(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    expect(blockLayout(5, "Q")).toMatchObject({ blocks: 4, eccPerBlock: 18, total: 134, short: 2, dataCodewords: 62 });
    expect(capacityBytes("L")).toBe(2953);
    expect(capacityBytes("H")).toBe(1273);
    expect(nearestFormat(formatWord("Q", 3) ^ 0b101)).toEqual({ level: "Q", mask: 3, distance: 2 });
  });
});

describe("Reed-Solomon", () => {
  it("builds the generator polynomial and corrects up to half the correction codewords", () => {
    expect(Array.from(generator(7))).toEqual([127, 122, 154, 164, 11, 68, 117]);
    const data = Array.from({ length: 30 }, (_, index) => (index * 37 + 11) & 0xff);
    const ecc = remainder(data, generator(16));
    const block = Uint8Array.from([...data, ...ecc]);
    const damaged = block.slice();
    for (const at of [0, 5, 17, 29, 31, 40, 44, 45]) damaged[at] ^= 0x5a;
    expect(correct(damaged, 16)).toBe(8);
    expect(Array.from(damaged)).toEqual(Array.from(block));
    const ruined = block.slice();
    for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8]) ruined[at] ^= 0xff;
    expect(() => correct(ruined, 16)).toThrow();
  });
});

describe("writing", () => {
  it("draws the same symbol as an independent encoder", () => {
    const code = encodeQr("HELLO WORLD", { level: "Q" });
    expect(code).toMatchObject({ version: 1, level: "Q", mode: "alphanumeric" });
    expect(rows(encodeQr("HELLO WORLD", { level: "Q", mask: 1 }))).toEqual(HELLO_WORLD);
  });

  it("picks the densest mode and the smallest version, and boosts the level when it is free", () => {
    expect(modeFor("0123")).toBe("numeric");
    expect(modeFor("HTTPS://KEY.IS")).toBe("alphanumeric");
    expect(modeFor("https://key.is")).toBe("byte");
    expect(encodeQr("1".repeat(41), { level: "L" }).version).toBe(1);
    expect(encodeQr("1".repeat(42), { level: "L" }).version).toBe(2);
    expect(encodeQr("a".repeat(17), { level: "L" }).version).toBe(1);
    expect(encodeQr("a".repeat(18), { level: "L" }).version).toBe(2);
    expect(encodeQr("hi", { level: "L", boost: true }).level).toBe("H");
    expect(() => encodeQr("x".repeat(3000), { level: "L" })).toThrow(QrTooLongError);
  });

  it("writes an SVG of runs, with a quiet zone", () => {
    const svg = qrSvg(encodeQr("A", { level: "L" }), { margin: 4, dark: "#000", light: "#fff" }, 290);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 29 29" width="290" height="290" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"\/><path fill="#000" d="M4 4h7v1h-7z/);
  });

  it("writes Wi-Fi details the way phones read them, special characters escaped", () => {
    expect(wifiText({ ssid: "Home;Net", password: 'p"a:ss', security: "WPA", hidden: false })).toBe('WIFI:T:WPA;S:Home\\;Net;P:p\\"a\\:ss;;');
    expect(wifiText({ ssid: "Cafe", password: "", security: "nopass", hidden: true })).toBe("WIFI:T:nopass;S:Cafe;H:true;;");
  });
});

describe("reading a grid", () => {
  it("reads back everything it writes, at every level", () => {
    const texts = ["0", "31415926535897932384626433832795", "HELLO WORLD $%*+-./:", "https://key.is/tools?q=1&x=\u00e9", "\u65e5\u672c\u8a9e\u306e\u30c6\u30ad\u30b9\u30c8", "x".repeat(1200)];
    for (const text of texts) {
      for (const level of ECC_LEVELS) {
        const code = encodeQr(text, { level });
        const read = decodeModules(code.modules, code.size);
        expect(read.text).toBe(text);
        expect(read).toMatchObject({ version: code.version, level, mask: code.mask, corrected: 0 });
      }
    }
  });

  it("reads codes made by segno: version information, kanji, an ECI and Latin-1 bytes", () => {
    for (const fixture of Object.values(SEGNO_FIXTURES)) {
      expect(decodeModules(fixtureModules(fixture), fixture.size).text).toBe(fixture.text);
    }
    expect(decodeModules(fixtureModules(SEGNO_FIXTURES.kanji), 21).modes).toEqual(["kanji"]);
    expect(decodeModules(fixtureModules(SEGNO_FIXTURES.eci), 21).modes).toEqual(["ECI 26", "byte"]);
    expect(decodeModules(fixtureModules(SEGNO_FIXTURES.v10), 57).version).toBe(10);
  });

  it("corrects damage up to the level's limit, and reads a mirror image", () => {
    const code = encodeQr("damaged but readable", { level: "H" });
    const damaged = code.modules.slice();
    // A block of modules in the middle blotted out.
    for (let y = 10; y < 15; y += 1) for (let x = 9; x < 14; x += 1) damaged[y * code.size + x] = 1;
    const read = decodeModules(damaged, code.size);
    expect(read.text).toBe("damaged but readable");
    expect(read.corrected).toBeGreaterThan(0);
    const mirrored = new Uint8Array(code.modules.length);
    for (let y = 0; y < code.size; y += 1) for (let x = 0; x < code.size; x += 1) mirrored[x * code.size + y] = code.modules[y * code.size + x];
    expect(decodeModules(mirrored, code.size)).toMatchObject({ text: "damaged but readable", mirrored: true });
    expect(() => decodeModules(new Uint8Array(21 * 21), 21)).toThrow(QrReadError);
  });
});

describe("reading a picture", () => {
  it("finds a code at any scale, where it is", () => {
    for (const scale of [1, 2, 4, 9]) {
      const code = encodeQr("https://key.is/read-qr-code", { level: "M" });
      const { gray, width } = picture(code, scale);
      const [found] = readQrCodes(gray, width, width);
      expect(found?.text, `scale ${scale}`).toBe("https://key.is/read-qr-code");
      expect(Math.round(found.corners[0].x)).toBe(4 * scale);
    }
  });

  it("reads codes turned, seen at an angle, and printed light on dark", () => {
    const code = encodeQr("rotated and warped, still read", { level: "Q" });
    const { gray, width } = picture(code, 5);
    const canvas = Math.round(width * 1.6);
    for (const degrees of [17, 90, 135, 200, 311]) {
      const angle = (degrees * Math.PI) / 180;
      const turned = warp(gray, width, canvas, (x, y) => {
        const dx = x - canvas / 2;
        const dy = y - canvas / 2;
        return [Math.cos(angle) * dx + Math.sin(angle) * dy + width / 2, -Math.sin(angle) * dx + Math.cos(angle) * dy + width / 2];
      });
      expect(readQrCodes(turned, canvas, canvas)[0]?.text, `${degrees} degrees`).toBe("rotated and warped, still read");
    }
    // Seen from below and to one side: the top edge shorter than the bottom.
    const corners: [number, number][] = [
      [canvas * 0.3, canvas * 0.12],
      [canvas * 0.74, canvas * 0.18],
      [canvas * 0.9, canvas * 0.86],
      [canvas * 0.1, canvas * 0.8],
    ];
    const toSource = quadToSquare(corners);
    const keystone = warp(gray, width, canvas, (x, y) => {
      const [u, v] = toSource(x, y);
      return [u * width, v * width];
    });
    expect(readQrCodes(keystone, canvas, canvas)[0]?.text).toBe("rotated and warped, still read");
    const inverted = gray.map((value) => 255 - value);
    expect(readQrCodes(inverted, width, width)[0]?.text).toBe("rotated and warped, still read");
  });

  it("finds several codes in one picture", () => {
    const texts = ["first", "second code", "THIRD 333", "fourth: \u00fc"];
    const width = 900;
    const height = 300;
    const gray = new Uint8Array(width * height).fill(230);
    texts.forEach((text, index) => {
      const drawn = picture(encodeQr(text, { level: "M" }), 6);
      for (let y = 0; y < drawn.width; y += 1) gray.set(drawn.gray.subarray(y * drawn.width, (y + 1) * drawn.width), (y + 20) * width + 20 + index * 215);
    });
    expect(readQrCodes(gray, width, height).map((found) => found.text).sort()).toEqual([...texts].sort());
  });

  it("reads a small code in a large picture, scaled for speed, and gives corners in the picture's own pixels", () => {
    const code = encodeQr("big picture", { level: "L" });
    const drawn = picture(code, 12);
    const width = 3200;
    const height = 2400;
    const gray = new Uint8Array(width * height).fill(210);
    for (let y = 0; y < drawn.width; y += 1) gray.set(drawn.gray.subarray(y * drawn.width, (y + 1) * drawn.width), (y + 1000) * width + 2000);
    const [found] = readQrCodesAtScales(gray, width, height);
    expect(found?.text).toBe("big picture");
    expect(Math.abs(found.corners[0].x - (2000 + 48))).toBeLessThan(6);
    expect(Math.abs(found.corners[0].y - (1000 + 48))).toBeLessThan(6);
  });

  it("finds nothing in a picture with no code", () => {
    const gray = new Uint8Array(400 * 300);
    for (let index = 0; index < gray.length; index += 1) gray[index] = (index * 7919) % 251;
    expect(readQrCodes(gray, 400, 300)).toEqual([]);
  });
});

describe("what a code holds", () => {
  it("spells out Wi-Fi details, escapes and all, and reads back what the writer makes", () => {
    const text = wifiText({ ssid: "Cafe;Main", password: "p\\ss:1", security: "WPA", hidden: true });
    expect(interpretQrText(text)).toEqual({ kind: "wifi", label: "Wi-Fi network", facts: ["Network: Cafe;Main", "Security: WPA", "Password: p\\ss:1", "Hidden: yes, the network does not announce itself"], warnings: [] });
    expect(interpretQrText("WIFI:S:Guest;T:nopass;;").warnings).toHaveLength(1);
    expect(semicolonFields("N:Doe,Jane;TEL:123;TEL:456;")).toEqual(new Map([["N", ["Doe,Jane"]], ["TEL", ["123", "456"]]]));
  });

  it("looks at links for the tricks that make a scanned code dangerous", () => {
    expect(interpretQrText("https://key.is/tools")).toEqual({ kind: "link", label: "Link", facts: ["Opens: key.is", "Address: https://key.is/tools"], warnings: [] });
    expect(interpretQrText("http://192.168.0.1/login").warnings).toHaveLength(2);
    expect(interpretQrText("https://bit.ly/abc").warnings[0]).toContain("shortener");
    expect(interpretQrText("https://xn--pypal-4ve.com/").warnings[0]).toContain("international characters");
    expect(interpretQrText("https://paypal.com@evil.example/").warnings[0]).toContain("@ sign");
    expect(interpretQrText("www.example.org/x").facts[0]).toBe("Opens: www.example.org");
  });

  it("reads contacts, e-mails, numbers, places, events and two-factor secrets", () => {
    expect(interpretQrText("BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada\nFN:Ada Lovelace\nTEL;TYPE=cell:+44 20 7946 0000\nEMAIL:ada@example.com\nEND:VCARD").facts).toEqual(["Name: Ada Lovelace", "Phone: +44 20 7946 0000", "Email: ada@example.com"]);
    expect(interpretQrText("MECARD:N:Lovelace,Ada;TEL:123;;").facts).toEqual(["Name: Ada Lovelace", "Phone: 123"]);
    expect(interpretQrText("mailto:hi@example.com?subject=Hello%20there").facts).toEqual(["To: hi@example.com", "Subject: Hello there"]);
    expect(interpretQrText("tel:+15551234").kind).toBe("phone");
    expect(interpretQrText("SMSTO:+15551234:On my way").facts).toEqual(["Number: +15551234", "Message: On my way"]);
    expect(interpretQrText("geo:51.5,-0.12").facts).toEqual(["Latitude: 51.5", "Longitude: -0.12"]);
    expect(interpretQrText("BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20261001T090000Z\nEND:VEVENT").facts).toEqual(["Event: Launch", "Starts: 2026-10-01 09:00 UTC"]);
    const otp = interpretQrText("otpauth://totp/Example:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example");
    expect(otp.kind).toBe("otp");
    expect(otp.warnings[0]).toContain("two-factor");
    expect(interpretQrText("just words").kind).toBe("text");
  });
});
