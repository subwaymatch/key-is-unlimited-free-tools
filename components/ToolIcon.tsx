import {
  Activity,
  AudioLines,
  AudioWaveform,
  Captions,
  FileText,
  Gauge,
  Headphones,
  ImagePlay,
  Languages,
  LayoutGrid,
  ListOrdered,
  Merge,
  MessageSquareText,
  Music,
  RefreshCw,
  RotateCw,
  Scaling,
  Scissors,
  ShieldCheck,
  Shrink,
  Type,
  VolumeX,
} from "lucide-react";

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
  trim: Scissors,
  gif: ImagePlay,
  mute: VolumeX,
  clean: ShieldCheck,
  speed: Gauge,
  merge: Merge,
  subtitles: Captions,
  transcribe: MessageSquareText,
  music: Music,
  loudness: AudioWaveform,
  resize: Scaling,
  rotate: RotateCw,
  thumbnails: LayoutGrid,
  captions: FileText,
  burn: Type,
  channels: Headphones,
  waveform: Activity,
  chapters: ListOrdered,
  bilingual: Languages,
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
