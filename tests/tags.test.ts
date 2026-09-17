import { describe, expect, it } from "vitest";

import { countTags, coverPath, EMPTY_TAGS, tagArgs, tagsFormat, type CoverSource } from "@/lib/engine/tags";

import { AAC, context, joined, MP3, probe } from "./fixtures";

const cover: CoverSource = { name: "front.jpg", bytes: new Uint8Array([255, 216]), mimeType: "image/jpeg", key: "front-2-9" };
const tags = { ...EMPTY_TAGS, title: "Song", artist: "Someone", track: "3/12", date: "2024" };

describe("tags", () => {
  it("writes only the fields that were filled in, under ffmpeg's generic names", () => {
    expect(countTags(EMPTY_TAGS)).toBe(0);
    expect(countTags(tags)).toBe(4);
    expect(tagArgs(tags)).toEqual(["-metadata", "title=Song", "-metadata", "artist=Someone", "-metadata", "date=2024", "-metadata", "track=3/12"]);
    expect(tagArgs({ ...EMPTY_TAGS, albumArtist: " Band " })).toEqual(["-metadata", "album_artist=Band"]);
    expect(coverPath(cover)).toBe("/cover.jpg");
    expect(coverPath({ ...cover, mimeType: "image/png" })).toBe("/cover.png");
  });

  it("re-tags an MP3 over its own tags, keeping any cover it has", () => {
    const format = tagsFormat(tags, null);
    expect(format.label).toBe("4 tags");
    const plan = format.plan(probe({ video: null, audio: MP3 }), context({ sourceExtension: "mp3" }));
    expect(joined(plan.args)).toBe("-map 0:a:0 -map 0:v? -sn -dn -c copy -metadata title=Song -metadata artist=Someone -metadata date=2024 -metadata track=3/12 -id3v2_version 3");
    expect(plan.extension).toBe("mp3");
    expect(plan.mode).toBe("copy");
    expect(plan.kind).toBe("audio");
    expect(plan.stripsMetadata).toBe(true);
    expect(plan.fileSuffix).toBe("-tagged");
  });

  it("clears the file first when the switch is on", () => {
    const plan = tagsFormat(tags, null).plan(probe({ video: null, audio: AAC }), context({ sourceExtension: "m4a", stripMetadata: true }));
    expect(joined(plan.args)).toBe(
      "-map 0:a:0 -map 0:v? -sn -dn -c copy -map_metadata -1 -map_metadata:s -1 -map_chapters -1 -fflags +bitexact -metadata title=Song -metadata artist=Someone -metadata date=2024 -metadata track=3/12 -movflags +faststart",
    );
    expect(plan.extension).toBe("m4a");
  });

  it("puts a new cover in, in place of the old one", () => {
    const format = tagsFormat(EMPTY_TAGS, cover);
    expect(format.id).toMatch(/-cover-front-2-9$/);
    expect(format.label).toBe("0 tags and a cover");
    const plan = format.plan(probe({ video: null, audio: MP3 }), context({ sourceExtension: "mp3" }));
    expect(joined(plan.args)).toBe(
      "-i /cover.jpg -map 0:a:0 -map 1:v:0 -sn -dn -c copy -disposition:v:0 attached_pic -metadata:s:v:0 title=Album cover -metadata:s:v:0 comment=Cover (front) -id3v2_version 3",
    );
    expect(plan.scratchFiles).toEqual([{ path: "/cover.jpg", contents: cover.bytes }]);
    const flac = tagsFormat(EMPTY_TAGS, cover).plan(probe({ video: null, audio: { ...AAC, codec: "flac" } }), context({ sourceExtension: "flac" }));
    expect(joined(flac.args)).toBe("-i /cover.jpg -map 0:a:0 -map 1:v:0 -sn -dn -c copy -disposition:v:0 attached_pic");
  });

  it("titles a video with its streams copied", () => {
    const plan = tagsFormat({ ...EMPTY_TAGS, title: "Holiday" }, null).plan(probe(), context({ sourceExtension: "mov" }));
    expect(joined(plan.args)).toBe("-map 0:v:0 -map 0:a? -map 0:s? -dn -c copy -metadata title=Holiday -movflags +faststart");
    expect(plan.extension).toBe("mov");
    expect(plan.kind).toBe("video");
  });

  it("refuses nothing to write, a cover where none can go, and an oversized one", () => {
    expect(tagsFormat(EMPTY_TAGS, null).blocker?.(probe(), context())?.severity).toBe("info");
    expect(tagsFormat(EMPTY_TAGS, cover).blocker?.(probe(), context())?.message).toMatch(/audio file, not a video/);
    const opus = probe({ video: null, audio: { ...AAC, codec: "opus" } });
    expect(tagsFormat(tags, cover).blocker?.(opus, context({ sourceExtension: "opus" }))?.message).toBe("A OPUS file cannot carry a cover picture.");
    expect(tagsFormat(tags, null).blocker?.(opus, context({ sourceExtension: "opus" }))).toBeNull();
    const big = { ...cover, bytes: new Uint8Array(10_000_001) };
    expect(tagsFormat(tags, big).blocker?.(probe({ video: null, audio: MP3 }), context({ sourceExtension: "mp3" }))?.message).toMatch(/too large for a cover/);
    expect(tagsFormat(tags, cover).blocker?.(probe({ video: null, audio: MP3 }), context({ sourceExtension: "mp3" }))).toBeNull();
  });
});
