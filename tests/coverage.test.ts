import { describe, expect, it } from "vitest";

import { coverageWarning, unsupportedScript } from "@/lib/subtitles/coverage";

/*
 * Sample text spelled in code points, with what it says beside it.
 *
 * The characters themselves are the whole point of these cases, and this
 * repository is written in ASCII, so they go in as escapes: the source stays
 * ASCII and the strings the tests see are the real thing.
 */
const COVERED = {
  greek: "\u039a\u03b1\u03bb\u03b7\u03bc\u03ad\u03c1\u03b1", // Kalimera
  cyrillic: "\u041f\u0440\u0438\u0432\u0435\u0442", // Privet
  hebrew: "\u05e9\u05dc\u05d5\u05dd", // Shalom
  arabic: "\u0645\u0631\u062d\u0628\u0627", // Marhaba
};

const MISSING = {
  japanese: "\u3053\u3093\u306b\u3061\u306f", // Konnichiwa, in hiragana
  chinese: "\u4f60\u597d", // Ni hao
  korean: "\uc548\ub155", // Annyeong, in hangul
  thai: "\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35", // Sawasdee
  devanagari: "\u0928\u092e\u0938\u094d\u0924\u0947", // Namaste
  emoji: "\u{1f600}", // A grinning face, which is past the basic plane
};

describe("what the shipped font can draw", () => {
  it("passes the scripts DejaVu Sans covers", () => {
    expect(unsupportedScript("Hello there.")).toBeNull();
    expect(unsupportedScript("Cafe creme, naive")).toBeNull();
    for (const [name, text] of Object.entries(COVERED)) {
      expect(unsupportedScript(text), name).toBeNull();
    }
  });

  it("names the script when it cannot", () => {
    expect(unsupportedScript(MISSING.japanese)).toBe("Japanese");
    expect(unsupportedScript(MISSING.chinese)).toBe("Chinese");
    expect(unsupportedScript(MISSING.korean)).toBe("Korean");
    expect(unsupportedScript(MISSING.thai)).toBe("Thai");
    expect(unsupportedScript(MISSING.devanagari)).toBe("Devanagari");
  });

  it("finds it anywhere in the text, not only at the front", () => {
    expect(unsupportedScript(`Subtitle one\nand then ${MISSING.chinese}`)).toBe("Chinese");
  });

  it("counts anything above the basic plane too", () => {
    expect(unsupportedScript(`Nice ${MISSING.emoji}`)).toBe("emoji");
  });

  it("writes a line for the card, or nothing at all", () => {
    expect(coverageWarning("Hello there.", "DejaVu Sans")).toBeNull();
    const warning = coverageWarning(MISSING.japanese, "DejaVu Sans");
    expect(warning).toContain("Japanese text");
    expect(warning).toContain("DejaVu Sans");
    expect(warning).toContain("empty boxes");
  });
});
