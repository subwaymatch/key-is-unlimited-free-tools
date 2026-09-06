import { AudioLines, RefreshCw, Shrink } from "lucide-react";

import type { ToolIconName } from "@/lib/tools";

/*
 * Resolves a registry icon key to a lucide icon.
 *
 * The indirection keeps lib/tools.ts free of React, so app/sitemap.ts can
 * import the registry without dragging icons into its module graph. A test
 * asserts every key in the union has an entry here.
 */
export const TOOL_ICONS = {
  audio: AudioLines,
  compress: Shrink,
  convert: RefreshCw,
} as const satisfies Record<ToolIconName, unknown>;

interface ToolIconProps {
  name: ToolIconName;
  className?: string;
}

export function ToolIcon({ name, className }: ToolIconProps) {
  const Icon = TOOL_ICONS[name];
  // Decorative: the tool name sits next to it, so a label here would be noise
  // for a screen reader rather than help.
  return <Icon aria-hidden="true" className={className} size={18} strokeWidth={1.75} />;
}
