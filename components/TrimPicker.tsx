"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

import type { TrimMode, TrimSettings } from "@/lib/useConversionQueue";

import { Select } from "./ui/Select";
import styles from "./Settings.module.css";

interface TrimPickerProps {
  settings: TrimSettings;
  onChange: (settings: TrimSettings) => void;
  disabled?: boolean;
}

const MODES: Array<{ id: TrimMode; label: string; blurb: string }> = [
  {
    id: "full",
    label: "Full audio",
    blurb: "Extract the whole track",
  },
  {
    id: "silence",
    label: "Trim silence",
    blurb: "Listen first, then cut the quiet head and tail",
  },
];

/**
 * How aggressive silence detection should be.
 *
 * The two knobs of `silencedetect` are exposed as one choice because they move
 * together in practice: a noisier recording needs both a higher threshold and a
 * longer minimum before a pause counts as the end of the audio.
 */
const SENSITIVITIES = [
  { label: "Only true silence", thresholdDb: -60, minDurationSeconds: 1 },
  { label: "Balanced", thresholdDb: -50, minDurationSeconds: 0.5 },
  { label: "Also room tone", thresholdDb: -40, minDurationSeconds: 0.3 },
];

const SENSITIVITY_OPTIONS = SENSITIVITIES.map((entry, index) => ({
  value: index,
  label: `${entry.label} (${entry.thresholdDb} dB for ${entry.minDurationSeconds}s)`,
}));

/**
 * Trim settings for files added next.
 *
 * Only the two decisions that can be made before a file exists: take the whole
 * track, or find the silence. Clipping to a range needs a duration to validate
 * against and something to listen to, so it lives on the file card instead.
 */
export function TrimPicker({ settings, onChange, disabled = false }: TrimPickerProps) {
  const sensitivityIndex = SENSITIVITIES.findIndex(
    (entry) =>
      entry.thresholdDb === settings.silence.thresholdDb &&
      entry.minDurationSeconds === settings.silence.minDurationSeconds,
  );

  return (
    <fieldset disabled={disabled} className={styles.fieldset}>
      <legend className={styles.legend}>Trim</legend>
      <p className={styles.intro}>
        Applied to files you add next. Each file can be clipped again afterwards.
      </p>

      <RadioGroup
        value={settings.mode}
        onValueChange={(value) => onChange({ ...settings, mode: value as TrimMode })}
        disabled={disabled}
        className={`${styles.grid} ${styles.gridThree}`}
      >
        {MODES.map((mode) => {
          const isChecked = settings.mode === mode.id;
          return (
            <label
              key={mode.id}
              className={`${styles.option} ${isChecked ? styles.optionChecked : ""} ${
                disabled ? styles.optionDisabled : ""
              }`}
            >
              <Radio.Root value={mode.id} disabled={disabled} className={styles.controlRadio}>
                <Radio.Indicator className={styles.controlRadioDot} />
              </Radio.Root>
              <span className={styles.optionBody}>
                <span className={styles.optionLabel}>{mode.label}</span>
                <span className={styles.optionBlurb}>{mode.blurb}</span>
              </span>
            </label>
          );
        })}
      </RadioGroup>

      {settings.mode === "silence" && (
        <div className={styles.panel}>
          <label>
            <span className={styles.fieldLabel}>What counts as silence</span>
            <Select
              aria-label="What counts as silence"
              value={sensitivityIndex === -1 ? 1 : sensitivityIndex}
              disabled={disabled}
              options={SENSITIVITY_OPTIONS}
              onValueChange={(index) =>
                onChange({
                  ...settings,
                  silence: {
                    thresholdDb: SENSITIVITIES[index].thresholdDb,
                    minDurationSeconds: SENSITIVITIES[index].minDurationSeconds,
                  },
                })
              }
            />
          </label>
          <p className={styles.panelNote}>
            Only silence at the very beginning and end is removed - pauses in the middle are left
            alone. Detection decodes the audio once first, so a long file takes noticeably longer.
          </p>
        </div>
      )}
    </fieldset>
  );
}
