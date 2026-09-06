"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import styles from "./Select.module.css";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface SelectProps<T extends string | number> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  disabled?: boolean;
  /** Labels the trigger, since the visible label is rendered by the caller. */
  "aria-label"?: string;
}

/*
 * A styled select on Base UI's popup, replacing the native control.
 *
 * The popup is portaled, which is why the layout root sets `isolation: isolate`
 * in globals.css: it gives the page its own stacking context so the popup lands
 * above the content without anything here having to pick a z-index.
 */
export function Select<T extends string | number>({
  value,
  onValueChange,
  options,
  disabled = false,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  return (
    <BaseSelect.Root
      items={options as SelectOption<T>[]}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
    >
      <BaseSelect.Trigger aria-label={ariaLabel} className={styles.trigger}>
        <BaseSelect.Value />
        <BaseSelect.Icon className={styles.icon}>
          <ChevronDown aria-hidden="true" size={16} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className={styles.positioner}>
          <BaseSelect.Popup className={styles.popup}>
            {options.map((option) => (
              <BaseSelect.Item key={option.value} value={option.value} className={styles.item}>
                <BaseSelect.ItemIndicator className={styles.indicator}>
                  <Check aria-hidden="true" size={14} />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
