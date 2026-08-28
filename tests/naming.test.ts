import { describe, expect, it } from "vitest";

import { baseName, safeMountName } from "@/lib/engine/ffmpegEngine";
import { formatBytes, formatDuration, formatElapsed } from "@/lib/format-utils";

describe("safeMountName", () => {
  it("keeps the extension as a demuxer hint", () => {
    expect(safeMountName("holiday.mp4")).toBe("source.mp4");
    expect(safeMountName("recording.MKV")).toBe("source.mkv");
  });

  it("neutralises characters that ffmpeg could misread as a protocol or option", () => {
    expect(safeMountName("C:weird: name -i evil.mp4")).toBe("source.mp4");
    expect(safeMountName("what's up?.mov")).toBe("source.mov");
    expect(safeMountName("Ünïcødé 影片.webm")).toBe("source.webm");
  });

  it("handles files with no usable extension", () => {
    expect(safeMountName("VIDEO_TS")).toBe("source");
    expect(safeMountName(".hidden")).toBe("source");
    expect(safeMountName("trailing.")).toBe("source");
  });

  it("does not let a long extension through unbounded", () => {
    expect(safeMountName("clip.thisisaverylongextension")).toBe("source.thisisav");
  });
});

describe("baseName", () => {
  it("strips the extension so outputs inherit the source name", () => {
    expect(baseName("holiday video.mp4")).toBe("holiday video");
    expect(baseName("archive.tar.mkv")).toBe("archive.tar");
  });

  it("keeps names that have no extension", () => {
    expect(baseName("recording")).toBe("recording");
  });

  it("falls back to something usable for an empty name", () => {
    expect(baseName("")).toBe("audio");
    expect(baseName("   ")).toBe("audio");
  });
});

describe("formatBytes", () => {
  it("uses decimal units, like a file manager", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5_400_000_000)).toBe("5.4 GB");
  });

  it("drops the decimal once the number is big enough not to need it", () => {
    expect(formatBytes(45_600_000)).toBe("46 MB");
  });

  it("handles nonsense input", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("omits the hour component for short media", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(9)).toBe("0:09");
  });

  it("includes hours for long media", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(36000)).toBe("10:00:00");
  });

  it("renders an em dash when the duration is unknown", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });
});

describe("formatElapsed", () => {
  it("keeps sub-10-second timings precise", () => {
    expect(formatElapsed(850)).toBe("0.8s");
    expect(formatElapsed(2000)).toBe("2.0s");
  });

  it("rounds longer timings and switches to minutes", () => {
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(92_400)).toBe("1m 32s");
  });
});
