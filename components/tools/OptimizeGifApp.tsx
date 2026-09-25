"use client";

import { useMemo, useState } from "react";

import { formatBytes, formatDuration } from "@/lib/format-utils";
import { decodeGif, GifError, optimizeGif } from "@/lib/images/gif";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("optimize-gif");

/** Every frame is kept whole while it is optimised: about 400 MB of pixels at most. */
const MAX_PIXELS = 50_000_000;

interface GifSettings {
  colours: "lossless" | "128" | "64" | "32";
}

const COLOURS: { value: GifSettings["colours"]; label: string; blurb: string }[] = [
  { value: "lossless", label: "Lossless", blurb: "Every pixel of every frame exactly as it was" },
  { value: "128", label: "128 colours", blurb: "Smaller; hard to tell apart from the original" },
  { value: "64", label: "64 colours", blurb: "Smaller again; gradients start to band" },
  { value: "32", label: "32 colours", blurb: "Smallest; fine for flat drawings and screen captures" },
];

function isSettings(value: unknown): value is GifSettings {
  return typeof value === "object" && value !== null && COLOURS.some((option) => option.value === (value as Partial<GifSettings>).colours);
}

function rejectNonGif(file: File) {
  return /\.gif$/i.test(file.name) || file.type === "image/gif" ? null : { message: "This is not a GIF.", hint: "Only animated and still GIFs can be optimised here; Compress image handles other pictures." };
}

/** An animated GIF written again smaller, frame for frame, with the option to reduce its colours. */
export function OptimizeGifApp() {
  const [settings, setSettings] = useState<GifSettings>({ colours: "lossless" });
  useStoredSettings(storageKey("settings", "optimize-gif"), settings, setSettings, isSettings);

  const queue = useMemo<PlainQueueOptions<GifSettings>>(
    () => ({
      key: "optimize-gif",
      settings,
      reject: rejectNonGif,
      preview: true,
      run: async (file, current, report) => {
        report("Playing the frames through...", null);
        // Let the progress line paint before the frames are worked through on this thread.
        await new Promise((resolve) => setTimeout(resolve, 0));
        let gif;
        try {
          gif = decodeGif(new Uint8Array(await file.arrayBuffer()), MAX_PIXELS);
        } catch (error) {
          if (error instanceof GifError) throw new PlainError(error.message, "Check that the file opens in a browser; a GIF that does not cannot be optimised.");
          throw error;
        }
        const seconds = gif.frames.reduce((sum, frame) => sum + frame.delay, 0) / 1000;
        const facts = [`${gif.width} x ${gif.height}`, `${gif.frames.length} ${gif.frames.length === 1 ? "frame" : "frames"}${gif.frames.length > 1 && seconds > 0 ? `, ${formatDuration(seconds)}` : ""}`];
        report(`Optimising ${gif.frames.length} ${gif.frames.length === 1 ? "frame" : "frames"}...`, null);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const colours = current.colours === "lossless" ? null : Number(current.colours);
        const result = optimizeGif(gif, { colours });
        const notes: string[] = [];
        if (result.merged > 0) notes.push(`${result.merged} ${result.merged === 1 ? "frame was" : "frames were"} the same as the one before and merged into it, the delays added together.`);
        if (result.reduced) notes.push("Its frames together hold more colours than one GIF frame may, so they were reduced to 255.");
        if (gif.truncated) notes.push("The file was cut short; the frames before the cut are kept, as a browser plays them.");
        if (gif.extraBytes > 0) notes.push(`${formatBytes(gif.extraBytes)} of comments and application data were dropped.`);
        if (result.bytes.length >= file.size) {
          return {
            facts,
            notes,
            outputs: [],
            nothing: {
              message: "This GIF is already as small as it gets here.",
              hint: colours === null ? `Written again it came out at ${formatBytes(result.bytes.length)}, against ${formatBytes(file.size)}, so the original is handed back untouched. Fewer colours would make it smaller, or GIF to MP4 a fraction of the size.` : `With ${colours} colours it came out at ${formatBytes(result.bytes.length)}, against ${formatBytes(file.size)}. GIF to MP4 makes a video a fraction of the size.`,
            },
          };
        }
        const saved = Math.round((1 - result.bytes.length / file.size) * 100);
        return {
          facts,
          notes,
          outputs: [
            {
              label: colours === null ? "Optimised GIF" : `GIF, ${colours} colours`,
              fileName: `${fileStem(file.name, "animation")}-optimized.gif`,
              blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: "image/gif" }),
              kind: "image",
              note: `${formatBytes(result.bytes.length)} from ${formatBytes(file.size)}, ${saved}% smaller${colours === null ? ", every frame unchanged" : ""}`,
            },
          ],
        };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Colours",
    summary: () => COLOURS.find((option) => option.value === settings.colours)?.label.toLowerCase() ?? settings.colours,
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Colours</legend>
        <RadioCards aria-label="Colours" value={settings.colours} onValueChange={(colours) => setSettings({ colours })} options={COLOURS} columns={2} />
      </fieldset>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop animated GIFs and get them back smaller, playing exactly as before: each frame is written as only the part that changed, repeated frames are merged, and the padding and comments GIF makers leave are dropped. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      dropZone={{ accept: "image/gif,.gif", inputLabel: "Choose GIFs", headline: "Drop GIFs here", subhead: "Animated or still" }}
      busyLabel="Optimising"
      note="Lossless keeps every pixel of every frame and every delay exactly; screen recordings and GIFs saved without optimisation shrink the most, often by half. Fewer colours share one palette across the whole animation, chosen by median cut, which is smaller still at some cost in smooth gradients. A GIF is a heavy format whatever is done to it; for the web, GIF to MP4 makes a video a tenth of the size."
    />
  );
}
