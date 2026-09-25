import type { ToolCategory, ToolIconName } from "@/lib/tools";

import { ToolIcon } from "./ToolIcon";
import styles from "./IconTile.module.css";

interface IconTileProps {
  icon: ToolIconName;
  /** Picks the hue: every category has one, used only here. */
  category: ToolCategory;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * A tool's icon on a tinted square.
 *
 * The one place colour is used to mean a category, so an index of a hundred
 * cards can be scanned by hue and a tool page says what kind of tool it is
 * before the title is read.
 */
export function IconTile({ icon, category, size = "md", className }: IconTileProps) {
  return (
    <span
      className={className ? `${styles.tile} ${className}` : styles.tile}
      data-category={category}
      data-size={size}
    >
      <ToolIcon name={icon} className={styles.icon} />
    </span>
  );
}
