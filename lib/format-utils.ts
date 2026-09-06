/** Presentation helpers shared by the UI components. */
import { formatTimecode, trimDuration } from "./engine/trim";
import type { TrimRange } from "./engine/types";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 1536 -> "1.5 KB". Uses decimal units, matching what file managers show. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1000) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${BYTE_UNITS[unit]}`;
}

/** 3725 -> "1:02:05"; 65 -> "1:05". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";

  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** 0.42 -> "42%". */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "";
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}

/** 92_400 -> "1m 32s"; 850 -> "0.9s". */
export function formatElapsed(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "-";
  const seconds = milliseconds / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** Compact description of an audio stream, e.g. "AAC, 48 kHz, stereo". */
export function describeAudio(audio: {
  codec: string;
  sampleRate: number | null;
  channelLayout: string | null;
  bitrateKbps: number | null;
} | null): string {
  if (!audio) return "No audio";
  const parts = [audio.codec.toUpperCase()];
  if (audio.sampleRate) parts.push(`${(audio.sampleRate / 1000).toFixed(audio.sampleRate % 1000 === 0 ? 0 : 1)} kHz`);
  if (audio.channelLayout) parts.push(audio.channelLayout);
  if (audio.bitrateKbps) parts.push(`${audio.bitrateKbps} kbps`);
  return parts.join(", ");
}

/** Media types the <audio> element can be expected to play. */
const PLAYABLE_EXTENSIONS = new Set(["m4a", "mp3", "wav", "opus", "ogg", "flac", "mp2", "aac"]);

export function isLikelyPlayable(extension: string): boolean {
  return PLAYABLE_EXTENSIONS.has(extension.toLowerCase());
}

/** "0:03 -> 3:12, 3:09 long", for labelling a clipped output. */
export function describeTrim(
  trim: TrimRange | null,
  durationSeconds: number | null,
): string {
  if (!trim) return "Full audio";
  const end =
    trim.endSeconds !== null
      ? formatTimecode(trim.endSeconds)
      : durationSeconds !== null
        ? formatTimecode(durationSeconds)
        : "end";
  const length = trimDuration(trim, durationSeconds);
  const span = `${formatTimecode(trim.startSeconds)} -> ${end}`;
  return length === null ? span : `${span}, ${formatDuration(length)} long`;
}
