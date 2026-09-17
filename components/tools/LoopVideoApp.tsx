"use client";

import { useMemo, useState } from "react";

import { describeLoop, LOOP_FORMATS, LOOP_LENGTHS, LOOP_TIMES, loopFormat, MAX_LOOP_TIMES, parseLoopTimes, type LoopTarget } from "@/lib/engine/loop";
import { MEDIA_ACCEPT } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import type { ToolFeatures } from "@/lib/toolFeatures";
import { requireTool } from "@/lib/tools";
import type { QueueOptions } from "@/lib/useConversionQueue";

import { ToolApp, type ToolSettings } from "../ToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("loop-video");

const FEATURES: ToolFeatures = {
  trim: false,
  silence: false,
  requireTrim: false,
  clipLabel: "",
  alsoLabel: "Also loop:",
  busyLabel: "Looping",
};

const CUSTOM = "custom";

const TARGET_OPTIONS = [
  ...LOOP_TIMES.map((times) => ({ value: `x${times}`, label: `${times} times`, blurb: times === 2 ? "The clip, then the clip again" : `The clip played ${times} times in a row` })),
  ...LOOP_LENGTHS.map((entry) => ({ value: `s${entry.seconds}`, label: entry.label, blurb: `Repeated until it is ${entry.label} long` })),
  { value: CUSTOM, label: "Custom", blurb: `Any number of times up to ${MAX_LOOP_TIMES}` },
];

function isLoopTarget(value: unknown): value is LoopTarget {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<{ kind: string; times: number; seconds: number }>;
  if (candidate.kind === "times") return typeof candidate.times === "number" && parseLoopTimes(candidate.times) === candidate.times;
  if (candidate.kind === "seconds") return LOOP_LENGTHS.some((entry) => entry.seconds === candidate.seconds);
  return false;
}

function choiceFor(target: LoopTarget): string {
  if (target.kind === "seconds") return `s${target.seconds}`;
  return LOOP_TIMES.includes(target.times) ? `x${target.times}` : CUSTOM;
}

/**
 * The looper: a number of times, or out to a length, every stream copied.
 */
export function LoopVideoApp() {
  const [target, setTarget] = useState<LoopTarget>({ kind: "times", times: 2 });
  const [choice, setChoice] = useState<string>("x2");
  const [customText, setCustomText] = useState("6");

  useStoredSettings(
    storageKey("settings", "loop-video"),
    target,
    (stored) => {
      setTarget(stored);
      setChoice(choiceFor(stored));
      if (stored.kind === "times" && !LOOP_TIMES.includes(stored.times)) setCustomText(String(stored.times));
    },
    isLoopTarget,
  );

  const customTimes = customText.trim() === "" ? null : parseLoopTimes(Number(customText));
  const customInvalid = choice === CUSTOM && customTimes === null;

  const queue = useMemo<QueueOptions>(() => {
    const current = loopFormat(target);
    return {
      key: "loop-video",
      formats: [current, ...LOOP_FORMATS.filter((format) => format.id !== current.id)],
      defaultFormatIds: [current.id],
      expects: "media",
      waveform: false,
      sourcePreview: true,
      phase: ({ label }) => `Looping ${label.toLowerCase()}...`,
    };
  }, [target]);

  const choose = (value: string) => {
    setChoice(value);
    if (value === CUSTOM) {
      if (customTimes !== null) setTarget({ kind: "times", times: customTimes });
    } else if (value.startsWith("x")) {
      setTarget({ kind: "times", times: Number(value.slice(1)) });
    } else {
      setTarget({ kind: "seconds", seconds: Number(value.slice(1)) });
    }
  };

  const toolSettings: ToolSettings = {
    title: "How many times",
    defaultOpen: true,
    invalid: () => (customInvalid ? `A whole number of times from 2 to ${MAX_LOOP_TIMES} is needed before a file can be looped.` : null),
    summary: () => (customInvalid ? "no count chosen" : describeLoop(target)),
    render: () => (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Repeat</legend>
        <p className={styles.intro}>
          A number of times, or until the file is at least this long: a ten-second clip looped to an
          hour is 360 plays. Applied to files you add next; each file&apos;s card offers the others.
        </p>
        <RadioCards aria-label="Repeat" value={choice} onValueChange={choose} options={TARGET_OPTIONS} />
        {choice === CUSTOM && (
          <div className={styles.panel}>
            <label>
              <span className={styles.fieldLabel}>Times</span>
              <input
                type="number"
                inputMode="numeric"
                min={2}
                max={MAX_LOOP_TIMES}
                step="1"
                value={customText}
                aria-invalid={customInvalid}
                onChange={(event) => {
                  setCustomText(event.target.value);
                  const times = parseLoopTimes(Number(event.target.value));
                  if (times !== null) setTarget({ kind: "times", times });
                }}
                className={styles.input}
              />
            </label>
            <p className={styles.panelNote}>
              {customInvalid ? `Type a whole number from 2 to ${MAX_LOOP_TIMES}. Nothing will start until you do.` : `Playing the file ${describeLoop(target)}.`}
            </p>
          </div>
        )}
      </fieldset>
    ),
  };

  return (
    <ToolApp
      tool={tool}
      lead="Drop a video or an audio file and get it back played two, three or ten times over, or repeated until it is a minute, ten minutes or an hour long. Every stream is copied, so a loop takes as long as reading the file that many times. Nothing is uploaded."
      queue={queue}
      features={FEATURES}
      settings={toolSettings}
      dropZone={{
        accept: MEDIA_ACCEPT,
        inputLabel: "Choose video or audio files",
        headline: "Drop video or audio files here",
        subhead: customInvalid ? "Choose a count below before adding a file" : `Each file will be played ${describeLoop(target)} - change it below`,
      }}
      note="The file is read again from the start each time round, with the timestamps carried on, so the seam is wherever the file itself begins and ends: a clip that starts and ends on the same frame loops without a jump, and one that does not shows the cut. Nothing is re-encoded, so nothing is lost, and the output is as many times the size as it is the length. To loop part of a file, cut that part out with the trimmer first."
    />
  );
}
