"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentPropsWithoutRef } from "react";

import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

interface ButtonProps extends ComponentPropsWithoutRef<typeof BaseButton> {
  variant?: Variant;
  size?: Size;
}

/*
 * The one button in the app.
 *
 * Base UI supplies the behaviour that a bare <button> gets wrong when it is
 * disabled: `focusableWhenDisabled` keeps a disabled control in the tab order
 * and announced, rather than silently unreachable, which matters here because
 * buttons disable themselves while a conversion runs.
 *
 * Variants are data attributes rather than separate classes, so the CSS module
 * selects on them the same way it selects on Base UI's own `data-disabled`.
 */
export function Button({
  variant = "secondary",
  size = "sm",
  className,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      {...props}
      data-variant={variant}
      data-size={size}
      className={className ? `${styles.button} ${className}` : styles.button}
    />
  );
}
