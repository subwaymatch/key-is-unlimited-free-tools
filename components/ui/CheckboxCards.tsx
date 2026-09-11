"use client";

import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Check } from "lucide-react";

import styles from "../Settings.module.css";

export interface CheckboxCardOption<T extends string> {
  value: T;
  label: string;
  blurb?: string;
}

interface CheckboxCardsProps<T extends string> {
  value: readonly T[];
  onValueChange: (value: T[]) => void;
  options: readonly CheckboxCardOption<T>[];
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Any number of choices from a few, each with a line of explanation.
 *
 * The checkbox counterpart of RadioCards, on the same card styles, so a panel
 * that offers several outputs looks like one that offers one.
 */
export function CheckboxCards<T extends string>({
  value,
  onValueChange,
  options,
  disabled = false,
  "aria-label": ariaLabel,
}: CheckboxCardsProps<T>) {
  return (
    <CheckboxGroup
      value={[...value]}
      onValueChange={(next) => onValueChange(next as T[])}
      disabled={disabled}
      aria-label={ariaLabel}
      className={styles.grid}
    >
      {options.map((option) => {
        const isChecked = value.includes(option.value);
        return (
          <label
            key={option.value}
            className={`${styles.option} ${isChecked ? styles.optionChecked : ""} ${
              disabled ? styles.optionDisabled : ""
            }`}
          >
            <Checkbox.Root value={option.value} disabled={disabled} className={styles.control}>
              <Checkbox.Indicator className={styles.controlIndicator}>
                <Check aria-hidden="true" size={12} strokeWidth={3} />
              </Checkbox.Indicator>
            </Checkbox.Root>
            <span className={styles.optionBody}>
              <span className={styles.optionLabel}>{option.label}</span>
              {option.blurb && <span className={styles.optionBlurb}>{option.blurb}</span>}
            </span>
          </label>
        );
      })}
    </CheckboxGroup>
  );
}
