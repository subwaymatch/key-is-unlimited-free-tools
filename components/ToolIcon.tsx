import {
  Activity,
  AppWindow,
  ArchiveRestore,
  Binary,
  ArrowLeftRight,
  AudioLines,
  AudioWaveform,
  Blend,
  Captions,
  Clapperboard,
  CopyCheck,
  Crop,
  Eraser,
  FastForward,
  FileImage,
  FileMinus2,
  FileText,
  FileType,
  Film,
  Fingerprint,
  FolderArchive,
  Hash,
  Gauge,
  Headphones,
  Image,
  ImageDown,
  ImagePlay,
  Images,
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
  ScanEye,
  Scissors,
  ShieldCheck,
  Shrink,
  Slice,
  Split,
  SquareSplitHorizontal,
  Stamp,
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
  picture: Image,
  shrinkpicture: ImageDown,
  hidden: ScanEye,
  imagepdf: FileImage,
  deletepages: FileMinus2,
  numbers: Hash,
  checksum: Fingerprint,
  archive: FolderArchive,
  unarchive: ArchiveRestore,
  stamp: Stamp,
  frames: Images,
  crop: Crop,
  favicon: AppWindow,
  code: Binary,
  text: FileType,
  erase: Eraser,
  copies: CopyCheck,
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
