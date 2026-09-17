"use client";

/**
 * Saving what a tool produced, through the browser's own download path.
 *
 * Two ways down: one file at a time, and everything at once as a ZIP. The
 * second is what "Download all" does, because the alternative - a burst of
 * synthetic clicks a quarter of a second apart - makes Chrome ask whether
 * the site may "download multiple files", drops the answer on the floor in
 * some settings, and leaves twenty files loose in the downloads folder
 * either way. The site already ships a ZIP writer for the Create ZIP tool,
 * and it streams, so packing is one pass with nothing held twice.
 */
import { createZip } from "./zip/archive";

/** One blob saved under a name, with the URL revoked once the click has taken it. */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  saveUrl(fileName, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A URL the caller owns, saved under a name. */
export function saveUrl(fileName: string, url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Saves text as a file.
 *
 * For the tools whose outputs are strings rather than blobs from the engine:
 * a URL is made for the click and revoked once the click has taken it, so a
 * page that converts on every keystroke does not accumulate one per render.
 */
export function downloadText(fileName: string, text: string, mimeType: string): void {
  saveBlob(fileName, new Blob([text], { type: `${mimeType};charset=utf-8` }));
}

/** One file at a time, a quarter of a second apart: the fallback, and the old way. */
export function saveOneByOne(files: readonly { fileName: string; url: string }[]): void {
  files.forEach((file, index) => {
    window.setTimeout(() => saveUrl(file.fileName, file.url), index * 250);
  });
}

/** What goes into an archive: a name and the bytes, however they were made. */
export interface Savable {
  fileName: string;
  blob: Blob;
  /** An object URL the caller already holds, for the one-at-a-time fallback. */
  url?: string;
}

/**
 * Everything in one ZIP, saved under `zipName`.
 *
 * A single file is saved as itself: wrapping one download in an archive
 * only makes it something to unpack. An archive too large for classic ZIP -
 * past 4 GB, which this writer cannot address - falls back to saving the
 * files one at a time rather than failing, since that still gets them out.
 */
export async function downloadAllAsZip(files: readonly Savable[], zipName: string): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    saveBlob(files[0].fileName, files[0].blob);
    return;
  }
  try {
    const zip = await createZip(files.map((file) => new File([file.blob], file.fileName, { lastModified: Date.now() })));
    saveBlob(zipName, zip);
  } catch {
    saveOneByOne(files.map((file) => ({ fileName: file.fileName, url: file.url ?? URL.createObjectURL(file.blob) })));
  }
}

/** "key-is-compress-video-2026-09-17.zip": what the archive lands under. */
export function archiveName(slug: string): string {
  return `${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
}
