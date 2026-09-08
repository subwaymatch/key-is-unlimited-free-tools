"use client";

import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Check } from "lucide-react";

import { isFormatAvailable } from "@/lib/engine/formats";
import type { EngineCapabilities, OutputFormat } from "@/lib/engine/types";

import styles from "./Settings.module.css";

interface FormatPickerProps {
  /** The tool's catalogue, in the order it should be offered. */
  formats: readonly OutputFormat[];
  selected: string[];
  onChange: (formats: string[]) => void;
  /** Null until the engine has loaded and reported what it can encode. */
  capabilities: EngineCapabilities | null;
  disabled?: boolean;
  /** Sentence above the options. */
  intro?: string;
}

/**
 * Output format selection.
 *
 * Formats whose encoder is missing from the loaded core are disabled rather
 * than allowed to fail partway through a conversion. Until the engine has
 * loaded, everything is offered: the capability list is not knowable yet.
 */
export function FormatPicker({
  formats,
  selected,
  onChange,
  capabilities,
  disabled = false,
  intro = "Applied to files you add next. Each file can get more formats afterwards.",
}: FormatPickerProps) {

  return (
    /*
     * The visible legend duplicated the disclosure's own "Output formats &
     * trim" heading, so it is a label rather than a legend now: the group
     * keeps its name for a screen reader without repeating it on screen.
     */
    <fieldset aria-label="Output formats" disabled={disabled} className={styles.fieldset}>
      <p className={styles.intro}>{intro}</p>

      <CheckboxGroup
        value={selected}
        onValueChange={(value) => onChange(value as string[])}
        className={styles.grid}
      >
        {formats.map((format) => {
          const unavailable = !isFormatAvailable(format, capabilities);
          const isChecked = selected.includes(format.id) && !unavailable;

          return (
            <label
              key={format.id}
              className={`${styles.option} ${isChecked ? styles.optionChecked : ""} ${
                unavailable || disabled ? styles.optionDisabled : ""
              }`}
            >
              <Checkbox.Root
                value={format.id}
                disabled={unavailable || disabled}
                className={styles.control}
              >
                <Checkbox.Indicator className={styles.controlIndicator}>
                  <Check aria-hidden="true" size={12} strokeWidth={3} />
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span className={styles.optionBody}>
                <span className={styles.optionHead}>
                  <span className={styles.optionLabel}>{format.label}</span>
                  {format.lossless && <span className={styles.badge}>Lossless</span>}
                </span>
                <span className={styles.optionBlurb}>
                  {unavailable
                    ? `Unavailable - this ffmpeg build has no ${format.requiredEncoder} encoder`
                    : format.blurb}
                </span>
              </span>
            </label>
          );
        })}
      </CheckboxGroup>

      {selected.length === 0 && (
        <p className={styles.warning}>
          Select at least one format, or files will convert with the defaults.
        </p>
      )}
    </fieldset>
  );
}
