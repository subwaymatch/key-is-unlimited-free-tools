import { describe, expect, it } from "vitest";

import { coverageWarning, unsupportedScript } from "@/lib/subtitles/coverage";

describe("what the shipped font can draw", () => {
  it("passes the scripts DejaVu Sans covers", () => {
    expect(unsupportedScript("Hello there.")).toBeNull();
    expect(unsupportedScript("Cafe creme, naive")).toBeNull();
    expect(unsupportedScript("Καλημέρα")).toBeNull(); // Greek
    expect(unsupportedScript("Привет")).toBeNull(); // Cyrillic
    expect(unsupportedScript("שלום")).toBeNull(); // Hebrew
    expect(unsupportedScript("مرحبا")).toBeNull(); // Arabic
  });

  it("names the script when it cannot", () => {
    expect(unsupportedScript("こんにちは")).toBe("Japanese");
    expect(unsupportedScript("你好")).toBe("Chinese");
    expect(unsupportedScript("안녕")).toBe("Korean");
    expect(unsupportedScript("สวัสดี")).toBe("Thai");
    expect(unsupportedScript("नमस्ते")).toBe("Devanagari");
  });

  it("finds it anywhere in the text, not only at the front", () => {
    expect(unsupportedScript("Subtitle one\nand then 你好")).toBe("Chinese");
  });

  it("counts anything above the basic plane too", () => {
    expect(unsupportedScript("Nice \u{1F600}")).toBe("emoji");
  });

  it("writes a line for the card, or nothing at all", () => {
    expect(coverageWarning("Hello there.", "DejaVu Sans")).toBeNull();
    const warning = coverageWarning("こんにちは", "DejaVu Sans");
    expect(warning).toContain("Japanese text");
    expect(warning).toContain("DejaVu Sans");
    expect(warning).toContain("empty boxes");
  });
});
