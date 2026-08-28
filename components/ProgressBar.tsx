"use client";

interface ProgressBarProps {
  /** 0..1, or null to show an indeterminate bar. */
  ratio: number | null;
  /** Accessible description of what is progressing. */
  label: string;
  tone?: "accent" | "success" | "danger";
}

const TONE_CLASS = {
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
} as const;

/**
 * A determinate bar when ffmpeg can report a ratio, and a moving indeterminate
 * bar when it cannot — so a running job never looks like a frozen one.
 */
export function ProgressBar({ ratio, label, tone = "accent" }: ProgressBarProps) {
  const isIndeterminate = ratio === null;
  const percent = isIndeterminate ? 0 : Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isIndeterminate ? undefined : percent}
      aria-valuetext={isIndeterminate ? "Working…" : `${percent}%`}
      className={`relative h-1.5 w-full overflow-hidden rounded-full bg-border-subtle ${
        isIndeterminate ? "progress-indeterminate" : ""
      }`}
    >
      {!isIndeterminate && (
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-out ${TONE_CLASS[tone]}`}
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );
}
