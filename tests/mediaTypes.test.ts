/**
 * The cheap first pass over a dropped file.
 *
 * The engine is still the authority on whether something can be decoded; this
 * only has to answer the cases that need no engine at all, and be generous
 * about everything else.
 */
import { describe, expect, it } from "vitest";

import {
  fileExtension,
  looksLikeMedia,
  MEDIA_ACCEPT,
  rejectFile,
  VIDEO_ACCEPT,
} from "@/lib/mediaTypes";

const file = (name: string, type = "", size = 1024) =>
  new File([new Uint8Array(size)], name, { type });

describe("fileExtension", () => {
  it("reads the last extension, lower-cased", () => {
    expect(fileExtension("holiday.MP4")).toBe("mp4");
    expect(fileExtension("archive.tar.mkv")).toBe("mkv");
  });

  it("returns null when there is not one", () => {
    expect(fileExtension("VIDEO_TS")).toBeNull();
    expect(fileExtension(".hidden")).toBeNull();
    expect(fileExtension("trailing.")).toBeNull();
  });
});

describe("looksLikeMedia", () => {
  it("takes the browser's word when it has one", () => {
    expect(looksLikeMedia(file("clip.mp4", "video/mp4"))).toBe(true);
    expect(looksLikeMedia(file("song.mp3", "audio/mpeg"))).toBe(true);
  });

  it("falls back to the extension, which is all Matroska ever gets", () => {
    expect(looksLikeMedia(file("clip.mkv", ""))).toBe(true);
    expect(looksLikeMedia(file("footage.mts", ""))).toBe(true);
    expect(looksLikeMedia(file("recording.opus", ""))).toBe(true);
  });

  it("says no to things with no reading at all", () => {
    expect(looksLikeMedia(file("notes.txt", "text/plain"))).toBe(false);
    expect(looksLikeMedia(file("report.pdf", "application/pdf"))).toBe(false);
    expect(looksLikeMedia(file("photos.zip", "application/zip"))).toBe(false);
  });
});

describe("rejectFile", () => {
  it("passes anything worth handing to ffmpeg", () => {
    expect(rejectFile(file("clip.mp4", "video/mp4"))).toBeNull();
    // Random bytes with a video extension are a real case - a truncated
    // download - and only a probe can tell. It gets to try.
    expect(rejectFile(file("corrupt.mp4", ""))).toBeNull();
  });

  it("explains a file that is not media, naming the extension", () => {
    const reason = rejectFile(file("notes.txt", "text/plain"));
    expect(reason?.message).toMatch(/not a video or audio file/);
    expect(reason?.hint).toContain(".txt");
  });

  it("explains an empty file rather than blaming its format", () => {
    const reason = rejectFile(file("clip.mp4", "video/mp4", 0));
    expect(reason?.message).toMatch(/empty/);
  });
});

describe("accept lists", () => {
  it("pair the MIME wildcards with the extensions browsers have no type for", () => {
    expect(VIDEO_ACCEPT).toContain("video/*");
    expect(VIDEO_ACCEPT).toContain(".mkv");
    expect(VIDEO_ACCEPT).not.toContain("audio/*");
  });

  it("only offer audio where a tool actually takes it", () => {
    expect(MEDIA_ACCEPT).toContain("audio/*");
    expect(MEDIA_ACCEPT).toContain(".flac");
  });
});
