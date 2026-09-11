"use client";

/**
 * Saves text as a file, through the browser's own download path.
 *
 * For the tools whose outputs are strings rather than blobs from the engine:
 * a URL is made for the click and revoked once the click has taken it, so a
 * page that converts on every keystroke does not accumulate one per render.
 */
export function downloadText(fileName: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
