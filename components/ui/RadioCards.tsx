"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

import styles from "../Settings.module.css";

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  blurb?: string;
}

interface RadioCardsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly RadioCardOption<T>[];
  /** Cards per row on a wide screen. */
  columns?: 2 | 3;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * One choice from a few, each with a line of explanation.
 *
 * The same card the trim picker draws, lifted out so every settings panel
 * offers its choices the same way.
 */
export function RadioCards<T extends string>({
  value,
  onValueChange,
  options,
  columns = 3,
  disabled = false,
  "aria-label": ariaLabel,
}: RadioCardsProps<T>) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`${styles.grid} ${columns === 3 ? styles.gridThree : ""}`}
    >
      {options.map((option) => {
        const isChecked = value === option.value;
        return (
          <label
            key={option.value}
            className={`${styles.option} ${isChecked ? styles.optionChecked : ""} ${
              disabled ? styles.optionDisabled : ""
            }`}
          >
            <Radio.Root value={option.value} disabled={disabled} className={styles.controlRadio}>
              <Radio.Indicator className={styles.controlRadioDot} />
            </Radio.Root>
            <span className={styles.optionBody}>
              <span className={styles.optionLabel}>{option.label}</span>
              {option.blurb && <span className={styles.optionBlurb}>{option.blurb}</span>}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
