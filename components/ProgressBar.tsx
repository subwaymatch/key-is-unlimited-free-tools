"use client";

import { Progress } from "@base-ui/react/progress";

import styles from "./ProgressBar.module.css";

interface ProgressBarProps {
  /** 0..1, or null to show an indeterminate bar. */
  ratio: number | null;
  /** Accessible description of what is progressing. */
  label: string;
  tone?: "accent" | "success" | "danger";
}

/**
 * A determinate bar when ffmpeg can report a ratio, and a moving indeterminate
 * bar when it cannot - so a running job never looks like a frozen one.
 *
 * Base UI's Progress treats a null value as indeterminate, which is the same
 * shape this component already had, and sets `data-indeterminate` on the root
 * so the sweeping animation is selected in CSS rather than toggled by a class.
 */
export function ProgressBar({ ratio, label, tone = "accent" }: ProgressBarProps) {
  const isIndeterminate = ratio === null;
  const percent = isIndeterminate ? null : Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  return (
    <Progress.Root
      value={percent}
      aria-label={label}
      aria-valuetext={percent === null ? "Working..." : `${percent}%`}
      data-tone={tone}
      className={styles.root}
    >
      {/* The keyframes are global, so the reduced-motion rule can reach them. */}
      <Progress.Track className={`${styles.track} progress-indeterminate`}>
        <Progress.Indicator className={styles.fill} />
      </Progress.Track>
    </Progress.Root>
  );
}
