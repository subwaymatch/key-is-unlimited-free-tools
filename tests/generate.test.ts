import { describe, expect, it } from "vitest";

import { EFF_WORDS } from "@/lib/security/effWords";
import { characterSets, cryptoIndex, generatePassphrase, generatePassword, type RandomIndex } from "@/lib/security/generate";

const words = EFF_WORDS.split(" ");

/** A repeatable stand-in for the crypto source. */
function seeded(seed = 1): RandomIndex {
  let state = seed;
  return (count) => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state % count;
  };
}

describe("the word list", () => {
  it("is EFF's 7,776 words, one per roll of five dice, all different", () => {
    expect(words).toHaveLength(7776);
    expect(new Set(words).size).toBe(7776);
    expect(words[0]).toBe("abacus");
    expect(words[7775]).toBe("zoom");
  });
});

describe("passphrases", () => {
  it("joins the words as asked, and counts 12.9 bits a word", () => {
    const result = generatePassphrase({ words: 5, separator: "-", capitalize: true, digit: false }, words, seeded());
    const parts = result.text.split("-");
    expect(parts).toHaveLength(5);
    for (const part of parts) {
      expect(part[0]).toBe(part[0].toUpperCase());
      expect(words).toContain(part.toLowerCase());
    }
    expect(result.bits).toBeCloseTo(5 * Math.log2(7776), 10);
  });

  it("adds a digit to one word and counts where and which", () => {
    const result = generatePassphrase({ words: 4, separator: " ", capitalize: false, digit: true }, words, seeded(7));
    expect(result.text.split(" ").filter((part) => /\d$/.test(part))).toHaveLength(1);
    expect(result.bits).toBeCloseTo(4 * Math.log2(7776) + Math.log2(40), 10);
  });
});

describe("random passwords", () => {
  it("uses every kind of character asked for, and nothing else", () => {
    const options = { length: 16, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false };
    for (let seed = 1; seed < 200; seed += 1) {
      const { text } = generatePassword(options, seeded(seed));
      expect(text).toHaveLength(16);
      expect(/[a-z]/.test(text) && /[A-Z]/.test(text) && /\d/.test(text) && /[^a-zA-Z0-9]/.test(text)).toBe(true);
      expect([...text].every((character) => characterSets(options).join("").includes(character))).toBe(true);
    }
  });

  it("leaves out characters that are easy to misread", () => {
    const options = { length: 64, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true };
    const alphabet = characterSets(options).join("");
    for (const character of "0Oo1lI|'\"`") expect(alphabet).not.toContain(character);
    expect(generatePassword(options, seeded(3)).text).not.toMatch(/[0Oo1lI|]/);
  });

  it("counts the bits exactly, less the strings missing a kind", () => {
    // Digits only: 10^8 strings, every one of them valid.
    expect(generatePassword({ length: 8, lower: false, upper: false, digits: true, symbols: false, avoidAmbiguous: false }, seeded()).bits).toBeCloseTo(8 * Math.log2(10), 10);
    // Lower and digits, length 2: 36^2 - 26^2 - 10^2 = 520 strings with one of each.
    expect(generatePassword({ length: 2, lower: true, upper: false, digits: true, symbols: false, avoidAmbiguous: false }, seeded()).bits).toBeCloseTo(Math.log2(520), 10);
  });

  it("refuses what cannot be made", () => {
    expect(() => generatePassword({ length: 8, lower: false, upper: false, digits: false, symbols: false, avoidAmbiguous: false })).toThrow(RangeError);
    expect(() => generatePassword({ length: 3, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false })).toThrow(RangeError);
  });
});

describe("the random source", () => {
  it("is uniform across a count that does not divide 2^32", () => {
    const counts = new Array(7).fill(0);
    for (let index = 0; index < 70000; index += 1) counts[cryptoIndex(7)] += 1;
    // Each face within 5% of its share.
    for (const count of counts) expect(Math.abs(count - 10000)).toBeLessThan(500);
  });
});
