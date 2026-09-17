import {
  Activity,
  ArrowLeftRight,
  AudioLines,
  AudioWaveform,
  Blend,
  Captions,
  Clapperboard,
  FastForward,
  FileText,
  Film,
  Gauge,
  Headphones,
  ImagePlay,
  Languages,
  Layers,
  LayoutGrid,
  ListOrdered,
  Merge,
  MessageSquareText,
  Music,
  Music2,
  RefreshCw,
  Repeat,
  RotateCw,
  Scaling,
  Scissors,
  ShieldCheck,
  Shrink,
  Slice,
  Split,
  SquareSplitHorizontal,
  Subtitles,
  Tag,
  Type,
  Volume2,
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
  split: Split,
  tracks: Layers,
  addaudio: Music2,
  volume: Volume2,
  sync: ArrowLeftRight,
  softsubs: Subtitles,
  loop: Repeat,
  film: Film,
  tags: Tag,
  cut: Slice,
  parts: SquareSplitHorizontal,
  clapper: Clapperboard,
  fade: Blend,
  tempo: FastForward,
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
