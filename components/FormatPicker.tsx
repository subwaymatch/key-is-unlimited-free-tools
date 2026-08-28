"use client";

import { OUTPUT_FORMATS, type OutputFormatId } from "@/lib/engine/formats";
import type { EngineCapabilities } from "@/lib/engine/types";

interface FormatPickerProps {
  selected: OutputFormatId[];
  onChange: (formats: OutputFormatId[]) => void;
  /** Null until the engine has loaded and reported what it can encode. */
  capabilities: EngineCapabilities | null;
  disabled?: boolean;
}

/**
 * Output format selection.
 *
 * Formats whose encoder is missing from the loaded core are disabled rather
 * than allowed to fail partway through a conversion. Until the engine has
 * loaded, everything is offered: the capability list is not knowable yet.
 */
export function FormatPicker({
  selected,
  onChange,
  capabilities,
  disabled = false,
}: FormatPickerProps) {
  const toggle = (id: OutputFormatId) => {
    onChange(
      selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id],
    );
  };

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-sm font-medium">Output formats</legend>
      <p className="mt-1 text-sm text-muted">
        Applied to files you add next. Each file can get more formats afterwards.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {OUTPUT_FORMATS.map((format) => {
          const unavailable = Boolean(
            capabilities &&
              format.requiredEncoder &&
              !capabilities.encoders.has(format.requiredEncoder),
          );
          const isChecked = selected.includes(format.id) && !unavailable;

          return (
            <label
              key={format.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                isChecked
                  ? "border-accent bg-accent-soft"
                  : "border-border-subtle bg-surface hover:border-border-strong"
              } ${unavailable || disabled ? "cursor-not-allowed opacity-55" : ""}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={unavailable || disabled}
                onChange={() => toggle(format.id)}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">{format.label}</span>
                  {format.lossless && (
                    <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                      Lossless
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {unavailable
                    ? `Unavailable — this ffmpeg build has no ${format.requiredEncoder} encoder`
                    : format.blurb}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {selected.length === 0 && (
        <p className="mt-2 text-xs text-warning">
          Select at least one format, or files will convert with the defaults.
        </p>
      )}
    </fieldset>
  );
}
