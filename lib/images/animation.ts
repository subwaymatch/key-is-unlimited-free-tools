/**
 * Whether a picture moves.
 *
 * A canvas draws one frame, so every tool here turns an animated GIF, an
 * APNG or an animated WebP into a still of its first frame. That is often
 * what someone wants and sometimes a surprise, and the difference is worth
 * a line on the card - so this counts the frames from the file's own bytes,
 * without decoding anything.
 *
 * Pure byte handling, so it is unit-tested without a browser.
 */

/** Past this many frames the exact count stops mattering; the walk stops. */
const MAX_FRAMES = 1_000;

function startsWith(bytes: Uint8Array, text: string, at = 0): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * The frames in a GIF, by walking its blocks.
 *
 * A GIF is a header, a screen descriptor, an optional colour table, and then
 * a stream of blocks: extensions (0x21), images (0x2C) and the trailer
 * (0x3B). Each image descriptor is one frame. Sub-block lists are
 * length-prefixed runs ending in a zero byte, so nothing has to be decoded
 * to step over them.
 */
export function gifFrameCount(bytes: Uint8Array): number {
  if (!startsWith(bytes, "GIF8")) return 0;
  let at = 6;
  const packed = bytes[at + 4];
  at += 7;
  if (packed === undefined) return 0;
  if (packed & 0x80) at += 3 * 2 ** ((packed & 0x07) + 1);

  const skipSubBlocks = () => {
    for (;;) {
      const length = bytes[at];
      if (length === undefined || length === 0) {
        at += 1;
        return;
      }
      at += 1 + length;
    }
  };

  let frames = 0;
  while (at < bytes.length && frames < MAX_FRAMES) {
    const block = bytes[at];
    if (block === 0x21) {
      at += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames += 1;
      const local = bytes[at + 9];
      at += 10;
      if (local !== undefined && local & 0x80) at += 3 * 2 ** ((local & 0x07) + 1);
      at += 1; // LZW minimum code size.
      skipSubBlocks();
    } else {
      // The trailer, or bytes this does not recognise.
      break;
    }
  }
  return frames;
}

/** Whether a PNG is an APNG: the animation control chunk says so. */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, "\x89PNG")) return false;
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    if (startsWith(bytes, "acTL", at + 4)) return true;
    if (startsWith(bytes, "IDAT", at + 4)) return false;
    at += 12 + length;
  }
  return false;
}

/** Whether a WebP carries an animation: the extended format's ANMF chunks. */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, "RIFF") || !startsWith(bytes, "WEBP", 8)) return false;
  let at = 12;
  while (at + 8 <= bytes.length) {
    if (startsWith(bytes, "ANMF", at)) return true;
    const length = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0, true);
    at += 8 + length + (length % 2);
  }
  return false;
}

/** How many frames a picture holds, or 1 for a still and 0 when it cannot be told. */
export function frameCount(bytes: Uint8Array): number {
  if (startsWith(bytes, "GIF8")) return gifFrameCount(bytes);
  if (startsWith(bytes, "\x89PNG")) return isAnimatedPng(bytes) ? 2 : 1;
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8)) return isAnimatedWebp(bytes) ? 2 : 1;
  return 0;
}

/**
 * What to say on the card when the source moves and what comes back will
 * not, or null when nothing needs saying.
 *
 * Only the first 64 KB are read: a GIF's frames are all described in its
 * block stream, and the second image descriptor is what settles the
 * question.
 */
export async function stillFrameNote(file: File): Promise<string | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    const frames = frameCount(head);
    if (frames < 2) return null;
    const many = frames >= MAX_FRAMES ? `${MAX_FRAMES} or more frames` : `${frames} frames`;
    const isGif = startsWith(head, "GIF8");
    return `This picture moves: it holds ${many}, and only the first is in what comes back, because a canvas draws one frame.${isGif ? " For the movement, use GIF to MP4." : ""}`;
  } catch {
    return null;
  }
}
