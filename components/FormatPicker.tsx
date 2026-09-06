"use client";

import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Check } from "lucide-react";

import { isFormatAvailable, OUTPUT_FORMATS, type OutputFormatId } from "@/lib/engine/formats";
import type { EngineCapabilities } from "@/lib/engine/types";

import styles from "./Settings.module.css";

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

  return (
    <fieldset disabled={disabled} className={styles.fieldset}>
      <legend className={styles.legend}>Output formats</legend>
      <p className={styles.intro}>
        Applied to files you add next. Each file can get more formats afterwards.
      </p>

      <CheckboxGroup
        value={selected}
        onValueChange={(value) => onChange(value as OutputFormatId[])}
        className={styles.grid}
      >
        {OUTPUT_FORMATS.map((format) => {
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
