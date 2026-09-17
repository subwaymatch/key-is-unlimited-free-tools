"use client";

/**
 * The image tools' shared steps: a picture decoded, drawn at a size, and
 * encoded as a format, named for the download.
 */
import { decodeImage, drawImage, encodeCanvas, mayHaveTransparency, MIME_EXTENSIONS, type DecodedImage, type ImageMime, type Size } from "./canvas";
import { fileStem } from "../mediaTypes";
import { PlainError } from "../plainQueue";

/** The picture decoded, or the reason it could not be, worded for the card. */
export async function readPicture(file: File): Promise<DecodedImage> {
  try {
    return await decodeImage(file);
  } catch (error) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const hint =
      extension === "heic" || extension === "heif"
        ? "Only Safari opens HEIC. On another browser, export the photo as JPEG from your phone or photo app first."
        : extension === "tif" || extension === "tiff"
          ? "Browsers do not open TIFF files. Export it as PNG or JPEG from an image editor first."
          : error instanceof Error
            ? error.message
            : "The browser could not decode it.";
    throw new PlainError("This picture could not be opened.", hint, { cause: error });
  }
}

export interface EncodedPicture {
  blob: Blob;
  size: Size;
}

/**
 * The picture drawn at a size and encoded. A JPEG has no transparency, so
 * anything see-through is painted white first rather than black.
 */
export async function encodePicture(image: DecodedImage, file: File, size: Size, mime: ImageMime, quality: number | null): Promise<EncodedPicture> {
  const background = mime === "image/jpeg" && mayHaveTransparency(file) ? "#ffffff" : null;
  const canvas = drawImage(image, size, background);
  const blob = await encodeCanvas(canvas, mime, quality ?? undefined);
  return { blob, size };
}

/** "photo-1600px.webp": the source's stem, a suffix, and the format's extension. */
export function pictureName(file: File, mime: ImageMime, suffix = ""): string {
  const stem = fileStem(file.name, "picture");
  const extension = MIME_EXTENSIONS[mime];
  const sameExtension = file.name.toLowerCase().endsWith(`.${extension}`) || (extension === "jpg" && /\.jpe?g$/i.test(file.name));
  // The same extension and no suffix would land in the folder under the source's own name.
  return `${stem}${suffix || (sameExtension ? "-converted" : "")}.${extension}`;
}

/** Every 4 MB of a file, for a streamed read. */
export async function* fileChunks(file: File, size = 4 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < file.size; at += size) {
    yield new Uint8Array(await file.slice(at, at + size).arrayBuffer());
  }
}
