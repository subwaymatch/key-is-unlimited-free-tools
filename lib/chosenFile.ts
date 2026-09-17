/**
 * A second file a tool takes through its panel: the audio to add, the
 * subtitles to mux, a cover, a backdrop.
 *
 * Unlike the files in the queue these are read whole into memory, since
 * they are written into the core's filesystem for the run; the tools cap
 * their size for the same reason. The key tells two choices apart in a
 * format id without hashing the bytes.
 */

/** Something stable for one chosen file, safe in an id and a filename. */
export function fileKey(file: File): string {
  const name = file.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 24);
  return `${name || "file"}-${file.size}-${file.lastModified.toString(36)}`;
}

/** The file's bytes, for a scratch file. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** "image/jpeg" or "image/png" from the browser's word or the extension, or null for anything else. */
export function imageMimeType(file: File): "image/jpeg" | "image/png" | null {
  if (file.type === "image/jpeg" || file.type === "image/png") return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return null;
}
