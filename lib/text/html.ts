/**
 * HTML as text, the forgiving way: no parser, so it copes with markup that
 * is not well-formed, which is most of the HTML in e-mail and plenty in
 * e-books. Blocks become paragraphs, line breaks stay, tags go, and
 * entities are expanded.
 */
import { decodeEntities } from "./xml";

export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|section|pre|ul|ol|table)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split(/\n{2,}/)
    .map((block) => block.replace(/[ \t\r\f\u00a0]+/g, " ").replace(/ *\n */g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}
