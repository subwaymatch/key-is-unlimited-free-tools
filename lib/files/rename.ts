/**
 * Files renamed in bulk by a pattern: a counter, a date, the old name
 * with something found and replaced, in a new case.
 */
import { fileStem } from "../mediaTypes";
import { uniqueNames } from "../zip/archive";

export type CaseChange = "keep" | "lower" | "upper" | "title";

export const CASE_CHANGES: readonly { id: CaseChange; label: string; blurb: string }[] = [
  { id: "keep", label: "As it is", blurb: "The name's own capitals" },
  { id: "lower", label: "lower case", blurb: "Every letter small" },
  { id: "upper", label: "UPPER CASE", blurb: "Every letter capital" },
  { id: "title", label: "Title Case", blurb: "A capital to start each word" },
];

export interface RenameSettings {
  /** The new name, with {name}, {ext}, {n}, {date} and {original} filled in. */
  pattern: string;
  /** Text to find in the name and what to put in its place, before the pattern is applied. */
  find: string;
  replace: string;
  caseChange: CaseChange;
  /** What {n} starts counting from, and how many digits it is padded to. */
  start: number;
  padding: number;
}

export const DEFAULT_RENAME_SETTINGS: RenameSettings = { pattern: "{name}", find: "", replace: "", caseChange: "keep", start: 1, padding: 2 };

export const PATTERN_PRESETS: readonly { pattern: string; label: string; blurb: string }[] = [
  { pattern: "{name}", label: "Keep the name", blurb: "Find and replace, or change the case" },
  { pattern: "{n}-{name}", label: "Numbered", blurb: "01-photo.jpg, 02-photo.jpg" },
  { pattern: "{date}-{name}", label: "Dated", blurb: "2024-06-01-photo.jpg, from when the file was last changed" },
  { pattern: "{name}-{n}", label: "Name, then a number", blurb: "photo-01.jpg" },
];

export interface RenameInput {
  name: string;
  /** Milliseconds since the epoch, as a File reports it. */
  lastModified: number;
}

/** Characters no file system takes in a name: the reserved punctuation and the control characters. */
const RESERVED = '\\/:*?"<>|';

function safeName(text: string): string {
  return Array.from(text)
    .filter((ch) => ch.charCodeAt(0) >= 32 && !RESERVED.includes(ch))
    .join("");
}

export function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-_.(\[])([a-z])/g, (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`);
}

function changeCase(text: string, change: CaseChange): string {
  switch (change) {
    case "lower":
      return text.toLowerCase();
    case "upper":
      return text.toUpperCase();
    case "title":
      return titleCase(text);
    default:
      return text;
  }
}

/** The extension as the name spells it, capitals and all, or "" for none. */
function ownExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : "";
}

function dateOf(lastModified: number): string {
  const date = new Date(lastModified);
  if (Number.isNaN(date.getTime())) return "undated";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The new name for one file, before names are made unique. */
export function renameOne(file: RenameInput, index: number, settings: RenameSettings): string {
  const extension = ownExtension(file.name);
  let stem = fileStem(file.name, "file");
  if (settings.find !== "") stem = stem.split(settings.find).join(settings.replace);
  stem = changeCase(stem, settings.caseChange);
  const counter = String(Math.max(0, Math.round(settings.start)) + index).padStart(Math.max(0, Math.min(8, Math.round(settings.padding))), "0");
  const pattern = settings.pattern.trim() || "{name}";
  let name = pattern
    .replace(/\{name\}/g, stem)
    .replace(/\{n\}/g, counter)
    .replace(/\{date\}/g, dateOf(file.lastModified))
    .replace(/\{original\}/g, file.name)
    .replace(/\{ext\}/g, extension);
  if (extension && !/\{ext\}/.test(pattern) && !/\{original\}/.test(pattern)) name = `${name}.${extension}`;
  name = safeName(name).trim();
  return name === "" || name === "." || name === ".." ? `file-${counter}${extension ? `.${extension}` : ""}` : name;
}

export interface Renamed {
  from: string;
  to: string;
}

/** Every file's new name, in order, with a repeated name told apart by a number. */
export function renamePlan(files: readonly RenameInput[], settings: RenameSettings): Renamed[] {
  const names = uniqueNames(files.map((file, index) => renameOne(file, index, settings)));
  return files.map((file, index) => ({ from: file.name, to: names[index] }));
}

/** Whether the pattern has anything that tells one file from the next. */
export function patternDistinguishes(pattern: string): boolean {
  return /\{name\}|\{n\}|\{original\}/.test(pattern);
}

/** "numbered, in lower case, 'IMG' replaced" for the panel's summary. */
export function describeRename(settings: RenameSettings): string {
  const parts: string[] = [];
  const preset = PATTERN_PRESETS.find((entry) => entry.pattern === settings.pattern.trim());
  parts.push(preset ? preset.label.toLowerCase() : `pattern "${settings.pattern.trim() || "{name}"}"`);
  if (settings.find !== "") parts.push(`"${settings.find}" replaced`);
  if (settings.caseChange !== "keep") parts.push(CASE_CHANGES.find((entry) => entry.id === settings.caseChange)?.label ?? settings.caseChange);
  return parts.join(", ");
}
