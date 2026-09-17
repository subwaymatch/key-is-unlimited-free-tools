"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_PIECE_RULE,
  describeRule,
  MAX_PIECES,
  parsePieceMinutes,
  PIECE_COUNTS,
  PIECE_LENGTHS,
  pieceFormatIds,
  pieceFormats,
  type PieceRule,
} from "@/lib/engine/pieces";
import { AUDIO_ACCEPT, VIDEO_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also cut out:",
  busyLabel: "Splitting",
};

const CUSTOM = "custom";

const RULE_OPTIONS = [
  ...PIECE_LENGTHS.map((entry) => ({ value: `s${entry.seconds}`, label: `Every ${entry.label}`, blurb: `Cut into pieces ${entry.label} long` })),
  ...PIECE_COUNTS.map((count) => ({ value: `n${count}`, label: `Into ${count} parts`, blurb: `${count} pieces of equal length` })),
  { value: CUSTOM, label: "Custom length", blurb: "Any number of minutes" },
];

function isPieceRule(value: unknown): value is PieceRule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<{ kind: string; seconds: number; count: number }>;
  if (candidate.kind === "length") return typeof candidate.seconds === "number" && candidate.seconds >= 6;
  if (candidate.kind === "count") return PIECE_COUNTS.includes(candidate.count ?? 0);
  return false;
}

function choiceFor(rule: PieceRule): string {
  if (rule.kind === "count") return `n${rule.count}`;
  return PIECE_LENGTHS.some((entry) => entry.seconds === rule.seconds) ? `s${rule.seconds}` : CUSTOM;
}

interface SplitPartsAppProps {
  slug: "split-video" | "split-audio";
}

/**
 * Equal parts, for video and for audio: one page each, one machine.
 *
 * The outputs come from the file's length and the rule, so the queue opens
 * every file and takes its formats from the probe, the way the chapter
 * splitter does; the rule lives in the closure the queue is handed.
 */
export function SplitPartsApp({ slug }: SplitPartsAppProps) {
  const tool = requireTool(slug);
  const video = slug === "split-video";
  const [rule, setRule] = useState<PieceRule>(DEFAULT_PIECE_RULE);
  const [choice, setChoice] = useState<string>(choiceFor(DEFAULT_PIECE_RULE));
  const [customText, setCustomText] = useState("20");

  useStoredSettings(
    storageKey("settings", slug),
    rule,
    (stored) => {
      setRule(stored);
      setChoice(choiceFor(stored));
      if (stored.kind === "length" && choiceFor(stored) === CUSTOM) setCustomText(String(stored.seconds / 60));
    },
    isPieceRule,
  );

  const customSeconds = customText.trim() === "" ? null : parsePieceMinutes(Number(customText));
  const customInvalid = choice === CUSTOM && customSeconds === null;

  const queue = useMemo<QueueOptions>(
    () => ({
      key: slug,
      formats: pieceFormats(rule),
      defaultFormatIds: [],
      formatsForFile: pieceFormatIds(rule),
      expects: video ? "video" : "audio",
      openWithoutOutputs: true,
      waveform: false,
      phase: ({ label }) => `Cutting ${label}...`,
    }),
    [rule, slug, video],
  );

  const choose = (value: string) => {
    setChoice(value);
    if (value === CUSTOM) {
      if (customSeconds !== null) setRule({ kind: "length", seconds: customSeconds });
    } else if (value.startsWith("s")) {
      setRule({ kind: "length", seconds: Number(value.slice(1)) });
    } else {
      setRule({ kind: "count", count: Number(value.slice(1)) });
    }
  };

  const toolSettings: ToolSettings = {
    title: "Where to cut",
    defaultOpen: true,
    invalid: () => (customInvalid ? "A length in minutes is needed before a file can be split." : null),
    summary: () => (customInvalid ? "no length chosen" : describeRule(rule)),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Cut</legend>
        <p className={styles.intro}>
          Every so many minutes, or into a number of equal parts. A last piece under a second long
          joins the one before it. At most {MAX_PIECES} pieces per file.
        </p>
        <RadioCards aria-label="Cut" value={choice} onValueChange={choose} options={RULE_OPTIONS} />
        {choice === CUSTOM && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Minutes per piece</span>
              <input
                type="number"
                inputMode="decimal"
                min={0.1}
                step="0.5"
                value={customText}
                aria-invalid={customInvalid}
                onChange={(event) => {
                  setCustomText(event.target.value);
                  const seconds = parsePieceMinutes(Number(event.target.value));
                  if (seconds !== null) setRule({ kind: "length", seconds });
                }}
                className={styles.input}
              />
            </label>
            <p className={styles.panelNote}>
              {customInvalid ? "Type a length in minutes. Nothing will start until you do." : `Cutting ${describeRule(rule)}.`}
            </p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead={
        video
          ? "Drop a long video and get it back in pieces: every ten minutes, every half hour, or into two, three or ten parts of the same length. Each piece is cut by stream copy, so a three-hour recording comes apart in the time it takes to read it. Nothing is uploaded."
          : "Drop a long recording and get it back in pieces: every ten minutes, every half hour, or into two, three or ten parts of the same length. Each piece is copied without re-encoding, so a three-hour recording comes apart in the time it takes to read it. Nothing is uploaded."
      }
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: video ? VIDEO_ACCEPT : AUDIO_ACCEPT,
        inputLabel: video ? "Choose video files" : "Choose audio files",
        headline: video ? "Drop video files here" : "Drop audio files here",
        subhead: customInvalid ? "Choose a length below before adding a file" : `Each file will be cut ${describeRule(rule)} - change it below`,
      }}
      note={
        video
          ? "Pieces are cut without re-encoding, so each starts on the keyframe before its cut and can begin a few seconds early; the sound is cut to the frame. A cut to the exact frame is a re-encode of every piece, which is the precise cut on the trimmer, one piece at a time. The chapter splitter cuts at a file's own markers instead of at fixed lengths."
          : "Pieces are cut on a frame of the codec, a few hundredths of a second, without re-encoding, so nothing is lost. A recording with chapter markers can be cut at those instead with the chapter splitter."
      }
    />
  );
}
