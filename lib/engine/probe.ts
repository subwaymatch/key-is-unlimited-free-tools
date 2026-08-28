/**
 * Parsers for ffmpeg's stderr.
 *
 * ffmpeg.wasm's core does not reliably ship `ffprobe`, so file metadata comes
 * from running `ffmpeg -i <input>` with no output file: ffmpeg prints the
 * stream table, then exits non-zero with "At least one output file must be
 * specified". That exit code is expected — the information we want is in the log.
 *
 * These functions are pure so they can be unit-tested without a browser.
 */
import type { AudioStreamInfo, ProbeResult } from "./types";

/** Named channel layouts ffmpeg prints, mapped to a channel count. */
const CHANNEL_LAYOUTS: Record<string, number> = {
  mono: 1,
  stereo: 2,
  downmix: 2,
  "2.1": 3,
  "3.0": 3,
  "3.1": 4,
  "4.0": 4,
  quad: 4,
  "5.0": 5,
  "5.1": 6,
  "6.0": 6,
  "6.1": 7,
  "7.0": 7,
  "7.1": 8,
  hexadecagonal: 16,
};

/**
 * Turns a channel-layout token into a count.
 * Handles "5.1(side)" and "8 channels" alongside the plain names.
 */
export function parseChannelCount(layout: string | null): number | null {
  if (!layout) return null;
  const base = layout.replace(/\([^)]*\)/g, "").trim().toLowerCase();
  if (base in CHANNEL_LAYOUTS) return CHANNEL_LAYOUTS[base];
  const explicit = base.match(/^(\d+)\s*channels?$/);
  if (explicit) return Number(explicit[1]);
  return null;
}

/** "00:04:03.15" -> 243.15 */
export function parseTimestamp(value: string): number | null {
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * Parses one `Stream #0:1...: Audio: <detail>` detail string.
 *
 * Example detail:
 *   aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
 */
function parseAudioDetail(detail: string): AudioStreamInfo {
  const codec = detail.match(/^([A-Za-z0-9_]+)/)?.[1] ?? "unknown";

  // The parenthetical straight after the codec is the profile ("LC", "HE-AAC"),
  // unless it is the fourcc tag, which always contains a slash.
  const firstParen = detail.match(/^[A-Za-z0-9_]+\s*\(([^)]*)\)/)?.[1] ?? null;
  const profile = firstParen && !firstParen.includes("/") ? firstParen : null;

  const sampleRate = detail.match(/(\d+)\s*Hz/)?.[1];
  const bitrate = detail.match(/(\d+)\s*kb\/s/)?.[1];

  // Channel layout is a bare comma-separated token; find whichever one we know.
  let channelLayout: string | null = null;
  for (const rawPart of detail.split(",")) {
    const part = rawPart.trim();
    if (parseChannelCount(part) !== null) {
      channelLayout = part;
      break;
    }
  }

  return {
    codec,
    profile,
    sampleRate: sampleRate ? Number(sampleRate) : null,
    channels: parseChannelCount(channelLayout),
    channelLayout,
    bitrateKbps: bitrate ? Number(bitrate) : null,
  };
}

/** Builds a ProbeResult from the lines ffmpeg printed for `ffmpeg -i <input>`. */
export function parseProbeOutput(log: string[]): ProbeResult {
  let durationSeconds: number | null = null;
  let formatName: string | null = null;
  let hasVideo = false;
  const audioStreams: AudioStreamInfo[] = [];

  for (const line of log) {
    if (formatName === null) {
      const input = line.match(/Input #\d+,\s*(.+?),\s*from\s/);
      if (input) formatName = input[1].trim();
    }

    if (durationSeconds === null) {
      const duration = line.match(/Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/);
      if (duration) durationSeconds = parseTimestamp(duration[1]);
    }

    const stream = line.match(
      /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*(Audio|Video):\s*(.+)$/,
    );
    if (!stream) continue;

    if (stream[1] === "Audio") {
      audioStreams.push(parseAudioDetail(stream[2]));
      continue;
    }

    // Embedded cover art is reported as a video stream, but a music file with
    // artwork is not a video, so it should not count as one.
    const isCoverArt =
      /attached pic/i.test(line) && /\b(?:mjpeg|png|bmp|gif|webp)\b/i.test(stream[2]);
    if (!isCoverArt) hasVideo = true;
  }

  return {
    durationSeconds,
    audioStreams,
    audio: audioStreams[0] ?? null,
    hasVideo,
    formatName,
    log,
  };
}

/**
 * Parses `ffmpeg -encoders` output into the set of available encoder names.
 *
 * The table looks like:
 *   Encoders:
 *    V..... = Video
 *    ...
 *    ------
 *    A....D aac                  AAC (Advanced Audio Coding)
 */
export function parseEncoders(log: string[]): Set<string> {
  const encoders = new Set<string>();
  let inTable = false;

  for (const line of log) {
    if (!inTable) {
      if (/^\s*-{4,}\s*$/.test(line)) inTable = true;
      continue;
    }
    const match = line.match(/^\s*[VAS.][F.][S.][X.][B.][D.]\s+(\S+)/);
    if (match) encoders.add(match[1]);
  }

  return encoders;
}

/**
 * Extracts a useful one-line reason from a failed ffmpeg run.
 *
 * ffmpeg's last lines are usually the actionable ones ("Invalid data found...",
 * "Unknown encoder ..."); everything before is banner and stream tables.
 */
export function summarizeFailure(log: string[]): string | null {
  const noise =
    /^(ffmpeg version|built with|configuration:|\s*lib(av|sw|postproc)|\s*Metadata:|\s*Duration:|\s*Stream #|\s*encoder\s*:|Input #|Output #|\s*Side data:|\s*handler_name|\s*vendor_id|\s*compatible_brands|\s*major_brand|\s*minor_version|Stream mapping:|\s*frame=|size=|video:|\[.*\] Using)/i;

  for (let i = log.length - 1; i >= 0; i -= 1) {
    const line = log[i].trim();
    if (!line || noise.test(line)) continue;
    if (/^(Press \[q\]|At least one output|Conversion failed|Error|.*: (No such file|Invalid|Unknown|Unable|Cannot))/i.test(line)) {
      return line;
    }
    // Any remaining trailing line is more informative than nothing.
    return line;
  }
  return null;
}
