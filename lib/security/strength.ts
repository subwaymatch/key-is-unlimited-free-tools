/**
 * How many guesses a password would take, estimated the way zxcvbn does it.
 *
 * zxcvbn (Dan Wheeler, Dropbox; MIT licence) finds every pattern an
 * attacker would try in a password - common passwords, dictionary words
 * and names, reversed or with l33t substitutions, keyboard walks, repeats,
 * sequences, years and dates - estimates the guesses each would take, and
 * then finds the sequence of patterns and brute-forced gaps covering the
 * whole password that needs the fewest guesses in all. That minimum is
 * the estimate: a password is only as strong as the cheapest way to guess
 * it. This is a port of zxcvbn 4.4.2's matching and scoring, checked
 * against the original on thousands of passwords. The one change is that
 * years up to 2099 count as recent, where the original stops at 2019.
 */
import { GRAPHS, type AdjacencyGraph } from "./keyboards";

/* ---- Dictionaries --------------------------------------------------------- */

export type DictionaryName = "passwords" | "english_wikipedia" | "female_names" | "surnames" | "us_tv_and_film" | "male_names" | "user_inputs";

export type RankedDictionaries = { name: DictionaryName; ranks: Map<string, number> }[];

export interface WordLists {
  PASSWORDS: string;
  ENGLISH_WIKIPEDIA: string;
  FEMALE_NAMES: string;
  SURNAMES: string;
  US_TV_AND_FILM: string;
  MALE_NAMES: string;
}

function ranked(words: readonly string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  // Rank starts at 1; a word listed twice keeps its later rank, as an object built in order would.
  words.forEach((word, index) => ranks.set(word, index + 1));
  return ranks;
}

/** The lists ranked, in zxcvbn's order, which decides between equally good matches. */
export function rankLists(lists: WordLists): RankedDictionaries {
  return [
    { name: "passwords", ranks: ranked(lists.PASSWORDS.split(",")) },
    { name: "english_wikipedia", ranks: ranked(lists.ENGLISH_WIKIPEDIA.split(",")) },
    { name: "female_names", ranks: ranked(lists.FEMALE_NAMES.split(",")) },
    { name: "surnames", ranks: ranked(lists.SURNAMES.split(",")) },
    { name: "us_tv_and_film", ranks: ranked(lists.US_TV_AND_FILM.split(",")) },
    { name: "male_names", ranks: ranked(lists.MALE_NAMES.split(",")) },
  ];
}

/** The lists, fetched with the page that needs them rather than with every page. */
export async function loadDictionaries(): Promise<RankedDictionaries> {
  return rankLists(await import("./wordLists"));
}

/* ---- Matches -------------------------------------------------------------- */

interface Base {
  i: number;
  j: number;
  token: string;
  guesses?: number;
  guessesLog10?: number;
}

export interface DictionaryMatch extends Base {
  pattern: "dictionary";
  matchedWord: string;
  rank: number;
  dictionaryName: DictionaryName;
  reversed: boolean;
  l33t: boolean;
  sub?: Record<string, string>;
  baseGuesses?: number;
  uppercaseVariations?: number;
  l33tVariations?: number;
}

export interface SpatialMatch extends Base {
  pattern: "spatial";
  graph: string;
  turns: number;
  shiftedCount: number;
}

export interface RepeatMatch extends Base {
  pattern: "repeat";
  baseToken: string;
  baseGuesses: number;
  baseMatches: Match[];
  repeatCount: number;
}

export interface SequenceMatch extends Base {
  pattern: "sequence";
  sequenceName: "lower" | "upper" | "digits" | "unicode";
  sequenceSpace: number;
  ascending: boolean;
}

export interface RegexMatch extends Base {
  pattern: "regex";
  regexName: "recent_year";
}

export interface DateMatch extends Base {
  pattern: "date";
  separator: string;
  year: number;
  month: number;
  day: number;
}

export interface BruteforceMatch extends Base {
  pattern: "bruteforce";
}

export type Match = DictionaryMatch | SpatialMatch | RepeatMatch | SequenceMatch | RegexMatch | DateMatch | BruteforceMatch;

const L33T_TABLE: Record<string, string[]> = {
  a: ["4", "@"],
  b: ["8"],
  c: ["(", "{", "[", "<"],
  e: ["3"],
  g: ["6", "9"],
  i: ["1", "!", "|"],
  l: ["1", "|", "7"],
  o: ["0"],
  s: ["$", "5"],
  t: ["+", "7"],
  x: ["%"],
  z: ["2"],
};

const RECENT_YEAR = /19\d\d|20\d\d/g;

const DATE_MAX_YEAR = 2050;
const DATE_MIN_YEAR = 1000;
const DATE_SPLITS: Record<number, [number, number][]> = {
  4: [
    [1, 2],
    [2, 3],
  ],
  5: [
    [1, 3],
    [2, 3],
  ],
  6: [
    [1, 2],
    [2, 4],
    [4, 5],
  ],
  7: [
    [1, 3],
    [2, 3],
    [4, 5],
    [4, 6],
  ],
  8: [
    [2, 4],
    [4, 6],
  ],
};

const sorted = <T extends Match>(matches: T[]): T[] => matches.sort((a, b) => a.i - b.i || a.j - b.j);

const reverse = (text: string) => text.split("").reverse().join("");

function dictionaryMatch(password: string, dictionaries: RankedDictionaries): DictionaryMatch[] {
  const matches: DictionaryMatch[] = [];
  const lower = password.toLowerCase();
  for (const { name, ranks } of dictionaries) {
    for (let i = 0; i < password.length; i += 1) {
      for (let j = i; j < password.length; j += 1) {
        const word = lower.slice(i, j + 1);
        const rank = ranks.get(word);
        if (rank !== undefined) matches.push({ pattern: "dictionary", i, j, token: password.slice(i, j + 1), matchedWord: word, rank, dictionaryName: name, reversed: false, l33t: false });
      }
    }
  }
  return sorted(matches);
}

function reverseDictionaryMatch(password: string, dictionaries: RankedDictionaries): DictionaryMatch[] {
  const matches = dictionaryMatch(reverse(password), dictionaries);
  for (const match of matches) {
    match.token = reverse(match.token);
    match.reversed = true;
    [match.i, match.j] = [password.length - 1 - match.j, password.length - 1 - match.i];
  }
  return sorted(matches);
}

/** The substitutions this password could be using, each a map from the substitute to the letter. */
function l33tSubs(password: string): Record<string, string>[] {
  const table: [string, string[]][] = [];
  for (const [letter, subs] of Object.entries(L33T_TABLE)) {
    const relevant = subs.filter((sub) => password.includes(sub));
    if (relevant.length > 0) table.push([letter, relevant]);
  }
  let subs: [string, string][][] = [[]];
  for (const [letter, substitutes] of table) {
    const next: [string, string][][] = [];
    for (const substitute of substitutes) {
      for (const sub of subs) {
        const duplicate = sub.findIndex(([character]) => character === substitute);
        if (duplicate === -1) next.push([...sub, [substitute, letter]]);
        else {
          const alternative = sub.slice();
          alternative.splice(duplicate, 1);
          alternative.push([substitute, letter]);
          next.push(sub, alternative);
        }
      }
    }
    const seen = new Set<string>();
    subs = next.filter((sub) => {
      const label = sub
        .map((pair) => pair.join(","))
        .sort()
        .join("-");
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  }
  return subs.map((sub) => Object.fromEntries(sub));
}

function l33tMatch(password: string, dictionaries: RankedDictionaries): DictionaryMatch[] {
  const matches: DictionaryMatch[] = [];
  for (const sub of l33tSubs(password)) {
    if (Object.keys(sub).length === 0) break;
    const subbed = password
      .split("")
      .map((character) => sub[character] ?? character)
      .join("");
    for (const match of dictionaryMatch(subbed, dictionaries)) {
      const token = password.slice(match.i, match.j + 1);
      // Only the matches that use a substitution.
      if (token.toLowerCase() === match.matchedWord) continue;
      const used: Record<string, string> = {};
      for (const [substitute, letter] of Object.entries(sub)) if (token.includes(substitute)) used[substitute] = letter;
      matches.push({ ...match, l33t: true, token, sub: used });
    }
  }
  // Single characters would match 'i' and 'a' everywhere.
  return sorted(matches.filter((match) => match.token.length > 1));
}

const SHIFTED = /[~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?]/;

function spatialMatchIn(password: string, graph: AdjacencyGraph, name: string): SpatialMatch[] {
  const matches: SpatialMatch[] = [];
  let i = 0;
  while (i < password.length - 1) {
    let j = i + 1;
    let lastDirection: number | null = null;
    let turns = 0;
    let shiftedCount = (name === "qwerty" || name === "dvorak") && SHIFTED.test(password.charAt(i)) ? 1 : 0;
    for (;;) {
      const adjacents = graph[password.charAt(j - 1)] ?? [];
      let found = false;
      if (j < password.length) {
        const current = password.charAt(j);
        for (let direction = 0; direction < adjacents.length; direction += 1) {
          const adjacent = adjacents[direction];
          if (!adjacent || !adjacent.includes(current)) continue;
          found = true;
          // Index 1 on a key is its shifted character.
          if (adjacent.indexOf(current) === 1) shiftedCount += 1;
          if (lastDirection !== direction) {
            turns += 1;
            lastDirection = direction;
          }
          break;
        }
      }
      if (found) j += 1;
      else {
        if (j - i > 2) matches.push({ pattern: "spatial", i, j: j - 1, token: password.slice(i, j), graph: name, turns, shiftedCount });
        i = j;
        break;
      }
    }
  }
  return matches;
}

function spatialMatch(password: string): SpatialMatch[] {
  return sorted(GRAPHS.flatMap(({ name, graph }) => spatialMatchIn(password, graph, name)));
}

function repeatMatch(password: string, dictionaries: RankedDictionaries): RepeatMatch[] {
  const matches: RepeatMatch[] = [];
  const greedy = /(.+)\1+/g;
  const lazy = /(.+?)\1+/g;
  const lazyAnchored = /^(.+?)\1+$/;
  let lastIndex = 0;
  while (lastIndex < password.length) {
    greedy.lastIndex = lazy.lastIndex = lastIndex;
    const greedyMatch = greedy.exec(password);
    const lazyMatch = lazy.exec(password);
    if (!greedyMatch || !lazyMatch) break;
    let match: RegExpExecArray;
    let baseToken: string;
    if (greedyMatch[0].length > lazyMatch[0].length) {
      // 'aabaab': greedy finds the whole, and its repeated part may itself repeat.
      match = greedyMatch;
      baseToken = lazyAnchored.exec(match[0])![1];
    } else {
      match = lazyMatch;
      baseToken = match[1];
    }
    const [i, j] = [match.index, match.index + match[0].length - 1];
    const base = mostGuessableMatchSequence(baseToken, omnimatch(baseToken, dictionaries));
    matches.push({ pattern: "repeat", i, j, token: match[0], baseToken, baseGuesses: base.guesses, baseMatches: base.sequence, repeatCount: match[0].length / baseToken.length });
    lastIndex = j + 1;
  }
  return matches;
}

const MAX_DELTA = 5;

function sequenceMatch(password: string): SequenceMatch[] {
  if (password.length === 1) return [];
  const result: SequenceMatch[] = [];
  const update = (i: number, j: number, delta: number) => {
    if (!(j - i > 1 || Math.abs(delta) === 1)) return;
    if (!(Math.abs(delta) > 0 && Math.abs(delta) <= MAX_DELTA)) return;
    const token = password.slice(i, j + 1);
    const [sequenceName, sequenceSpace]: [SequenceMatch["sequenceName"], number] = /^[a-z]+$/.test(token) ? ["lower", 26] : /^[A-Z]+$/.test(token) ? ["upper", 26] : /^\d+$/.test(token) ? ["digits", 10] : ["unicode", 26];
    result.push({ pattern: "sequence", i, j, token, sequenceName, sequenceSpace, ascending: delta > 0 });
  };
  let i = 0;
  let lastDelta: number | null = null;
  for (let k = 1; k < password.length; k += 1) {
    const delta = password.charCodeAt(k) - password.charCodeAt(k - 1);
    if (lastDelta === null) lastDelta = delta;
    if (delta === lastDelta) continue;
    const j = k - 1;
    update(i, j, lastDelta);
    i = j;
    lastDelta = delta;
  }
  update(i, password.length - 1, lastDelta!);
  return result;
}

function regexMatch(password: string): RegexMatch[] {
  const matches: RegexMatch[] = [];
  RECENT_YEAR.lastIndex = 0;
  for (let found = RECENT_YEAR.exec(password); found; found = RECENT_YEAR.exec(password)) {
    matches.push({ pattern: "regex", token: found[0], i: found.index, j: found.index + found[0].length - 1, regexName: "recent_year" });
  }
  return sorted(matches);
}

function twoToFourDigitYear(year: number): number {
  if (year > 99) return year;
  return year > 50 ? year + 1900 : year + 2000;
}

function intsToDm(ints: number[]): { day: number; month: number } | null {
  for (const [d, m] of [ints, ints.slice().reverse()]) if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return { day: d, month: m };
  return null;
}

function intsToDmy(ints: number[]): { year: number; month: number; day: number } | null {
  if (ints[1] > 31 || ints[1] <= 0) return null;
  let over12 = 0;
  let over31 = 0;
  let under1 = 0;
  for (const value of ints) {
    if ((value > 99 && value < DATE_MIN_YEAR) || value > DATE_MAX_YEAR) return null;
    if (value > 31) over31 += 1;
    if (value > 12) over12 += 1;
    if (value <= 0) under1 += 1;
  }
  if (over31 >= 2 || over12 === 3 || under1 >= 2) return null;
  const splits: [number, number[]][] = [
    [ints[2], ints.slice(0, 2)],
    [ints[0], ints.slice(1, 3)],
  ];
  for (const [year, rest] of splits) {
    if (year >= DATE_MIN_YEAR && year <= DATE_MAX_YEAR) {
      const dm = intsToDm(rest);
      // A four-digit year whose other two numbers are not a day and a month is not a date.
      return dm ? { year, month: dm.month, day: dm.day } : null;
    }
  }
  for (const [year, rest] of splits) {
    const dm = intsToDm(rest);
    if (dm) return { year: twoToFourDigitYear(year), month: dm.month, day: dm.day };
  }
  return null;
}

function dateMatch(password: string, referenceYear: number): DateMatch[] {
  const matches: DateMatch[] = [];
  const noSeparator = /^\d{4,8}$/;
  const withSeparator = /^(\d{1,4})([\s/\\_.-])(\d{1,2})\2(\d{1,4})$/;
  for (let i = 0; i <= password.length - 4; i += 1) {
    for (let j = i + 3; j <= i + 7 && j < password.length; j += 1) {
      const token = password.slice(i, j + 1);
      if (!noSeparator.test(token)) continue;
      const candidates = DATE_SPLITS[token.length].map(([k, l]) => intsToDmy([parseInt(token.slice(0, k), 10), parseInt(token.slice(k, l), 10), parseInt(token.slice(l), 10)])).filter((candidate) => candidate !== null);
      if (candidates.length === 0) continue;
      // Of the readings, the one with a year closest to now takes the fewest guesses.
      let best = candidates[0];
      let distance = Math.abs(best.year - referenceYear);
      for (const candidate of candidates.slice(1)) {
        const next = Math.abs(candidate.year - referenceYear);
        if (next < distance) [best, distance] = [candidate, next];
      }
      matches.push({ pattern: "date", token, i, j, separator: "", ...best });
    }
  }
  for (let i = 0; i <= password.length - 6; i += 1) {
    for (let j = i + 5; j <= i + 9 && j < password.length; j += 1) {
      const token = password.slice(i, j + 1);
      const found = withSeparator.exec(token);
      if (!found) continue;
      const dmy = intsToDmy([parseInt(found[1], 10), parseInt(found[3], 10), parseInt(found[4], 10)]);
      if (dmy) matches.push({ pattern: "date", token, i, j, separator: found[2], ...dmy });
    }
  }
  // Dates inside longer dates are noise: 2015_06_04 also holds 15_06_04.
  return sorted(matches.filter((match) => !matches.some((other) => other !== match && other.i <= match.i && other.j >= match.j)));
}

let referenceYearNow = new Date().getFullYear();

/** Every pattern in the password, sorted by where it starts and ends. */
export function omnimatch(password: string, dictionaries: RankedDictionaries): Match[] {
  const matches: Match[] = [...dictionaryMatch(password, dictionaries), ...reverseDictionaryMatch(password, dictionaries), ...l33tMatch(password, dictionaries), ...spatialMatch(password), ...repeatMatch(password, dictionaries), ...sequenceMatch(password), ...regexMatch(password), ...dateMatch(password, referenceYearNow)];
  return sorted(matches);
}

/* ---- Guesses -------------------------------------------------------------- */

const BRUTEFORCE_CARDINALITY = 10;
const MIN_GUESSES_BEFORE_GROWING_SEQUENCE = 10000;
const MIN_SUBMATCH_GUESSES_SINGLE_CHAR = 10;
const MIN_SUBMATCH_GUESSES_MULTI_CHAR = 50;
const MIN_YEAR_SPACE = 20;

function nCk(n: number, k: number): number {
  if (k > n) return 0;
  if (k === 0) return 1;
  let result = 1;
  for (let d = 1; d <= k; d += 1) {
    result *= n;
    result /= d;
    n -= 1;
  }
  return result;
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

const log10 = (n: number) => Math.log(n) / Math.log(10);

function averageDegree(graph: AdjacencyGraph): number {
  const keys = Object.keys(graph);
  return keys.reduce((sum, key) => sum + graph[key].filter(Boolean).length, 0) / keys.length;
}

const QWERTY_GRAPH = GRAPHS[0].graph;
const KEYPAD_GRAPH = GRAPHS[2].graph;
const KEYBOARD_AVERAGE_DEGREE = averageDegree(QWERTY_GRAPH);
const KEYPAD_AVERAGE_DEGREE = averageDegree(KEYPAD_GRAPH);
const KEYBOARD_STARTING_POSITIONS = Object.keys(QWERTY_GRAPH).length;
const KEYPAD_STARTING_POSITIONS = Object.keys(KEYPAD_GRAPH).length;

export const START_UPPER = /^[A-Z][^A-Z]+$/;
const END_UPPER = /^[^A-Z]+[A-Z]$/;
export const ALL_UPPER = /^[^a-z]+$/;
const ALL_LOWER = /^[^A-Z]+$/;

function uppercaseVariations(word: string): number {
  if (ALL_LOWER.test(word) || word.toLowerCase() === word) return 1;
  // Capitalised, all capitals and a capital at the end are common enough to count as doubling.
  for (const pattern of [START_UPPER, END_UPPER, ALL_UPPER]) if (pattern.test(word)) return 2;
  const upper = word.split("").filter((character) => /[A-Z]/.test(character)).length;
  const lower = word.split("").filter((character) => /[a-z]/.test(character)).length;
  let variations = 0;
  for (let i = 1; i <= Math.min(upper, lower); i += 1) variations += nCk(upper + lower, i);
  return variations;
}

function l33tVariations(match: DictionaryMatch): number {
  if (!match.l33t) return 1;
  let variations = 1;
  for (const [subbed, unsubbed] of Object.entries(match.sub ?? {})) {
    const characters = match.token.toLowerCase().split("");
    const s = characters.filter((character) => character === subbed).length;
    const u = characters.filter((character) => character === unsubbed).length;
    if (s === 0 || u === 0) variations *= 2;
    else {
      let possibilities = 0;
      for (let i = 1; i <= Math.min(u, s); i += 1) possibilities += nCk(u + s, i);
      variations *= possibilities;
    }
  }
  return variations;
}

function spatialGuesses(match: SpatialMatch): number {
  const [s, d] = match.graph === "qwerty" || match.graph === "dvorak" ? [KEYBOARD_STARTING_POSITIONS, KEYBOARD_AVERAGE_DEGREE] : [KEYPAD_STARTING_POSITIONS, KEYPAD_AVERAGE_DEGREE];
  let guesses = 0;
  const length = match.token.length;
  // Every pattern of this length or shorter with this many turns or fewer.
  for (let i = 2; i <= length; i += 1) {
    const possibleTurns = Math.min(match.turns, i - 1);
    for (let j = 1; j <= possibleTurns; j += 1) guesses += nCk(i - 1, j - 1) * s * Math.pow(d, j);
  }
  if (match.shiftedCount) {
    const shifted = match.shiftedCount;
    const unshifted = match.token.length - match.shiftedCount;
    if (shifted === 0 || unshifted === 0) guesses *= 2;
    else {
      let variations = 0;
      for (let i = 1; i <= Math.min(shifted, unshifted); i += 1) variations += nCk(shifted + unshifted, i);
      guesses *= variations;
    }
  }
  return guesses;
}

function guessesFor(match: Match): number {
  switch (match.pattern) {
    case "bruteforce": {
      let guesses = Math.pow(BRUTEFORCE_CARDINALITY, match.token.length);
      if (guesses === Number.POSITIVE_INFINITY) guesses = Number.MAX_VALUE;
      // One more than the smallest submatch, so a real pattern over the same span wins.
      return Math.max(guesses, match.token.length === 1 ? MIN_SUBMATCH_GUESSES_SINGLE_CHAR + 1 : MIN_SUBMATCH_GUESSES_MULTI_CHAR + 1);
    }
    case "dictionary":
      match.baseGuesses = match.rank;
      match.uppercaseVariations = uppercaseVariations(match.token);
      match.l33tVariations = l33tVariations(match);
      return match.baseGuesses * match.uppercaseVariations * match.l33tVariations * (match.reversed ? 2 : 1);
    case "spatial":
      return spatialGuesses(match);
    case "repeat":
      return match.baseGuesses * match.repeatCount;
    case "sequence": {
      const first = match.token.charAt(0);
      let base = ["a", "A", "z", "Z", "0", "1", "9"].includes(first) ? 4 : /\d/.test(first) ? 10 : 26;
      if (!match.ascending) base *= 2;
      return base * match.token.length;
    }
    case "regex":
      return Math.max(Math.abs(parseInt(match.token, 10) - referenceYearNow), MIN_YEAR_SPACE);
    case "date": {
      let guesses = Math.max(Math.abs(match.year - referenceYearNow), MIN_YEAR_SPACE) * 365;
      if (match.separator) guesses *= 4;
      return guesses;
    }
  }
}

function estimateGuesses(match: Match, password: string): number {
  if (match.guesses !== undefined) return match.guesses;
  let minimum = 1;
  if (match.token.length < password.length) minimum = match.token.length === 1 ? MIN_SUBMATCH_GUESSES_SINGLE_CHAR : MIN_SUBMATCH_GUESSES_MULTI_CHAR;
  match.guesses = Math.max(guessesFor(match), minimum);
  match.guessesLog10 = log10(match.guesses);
  return match.guesses;
}

/* ---- The search ------------------------------------------------------------ */

export interface GuessResult {
  password: string;
  guesses: number;
  guessesLog10: number;
  sequence: Match[];
}

/**
 * The run of patterns covering the password that takes the fewest guesses,
 * where a run of l patterns costs l! times the product of their guesses,
 * plus 10000^(l-1) for the shorter runs an attacker would try first.
 */
export function mostGuessableMatchSequence(password: string, matches: Match[], excludeAdditive = false): GuessResult {
  const n = password.length;
  const byEnd: Match[][] = Array.from({ length: n }, () => []);
  for (const match of matches) byEnd[match.j].push(match);
  for (const list of byEnd) list.sort((a, b) => a.i - b.i);
  // For each prefix end k and run length l: the last match, the product term, and the total.
  const optimalM: Map<number, Match>[] = Array.from({ length: n }, () => new Map());
  const optimalPi: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const optimalG: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const ascending = <V>(map: Map<number, V>) => [...map.entries()].sort((a, b) => a[0] - b[0]);

  const update = (match: Match, l: number) => {
    const k = match.j;
    let pi = estimateGuesses(match, password);
    if (l > 1) pi *= optimalPi[match.i - 1].get(l - 1)!;
    let g = factorial(l) * pi;
    if (!excludeAdditive) g += Math.pow(MIN_GUESSES_BEFORE_GROWING_SEQUENCE, l - 1);
    for (const [competingL, competingG] of ascending(optimalG[k])) {
      if (competingL > l) continue;
      if (competingG <= g) return;
    }
    optimalG[k].set(l, g);
    optimalM[k].set(l, match);
    optimalPi[k].set(l, pi);
  };

  const bruteforce = (i: number, j: number): BruteforceMatch => ({ pattern: "bruteforce", token: password.slice(i, j + 1), i, j });

  const bruteforceUpdate = (k: number) => {
    update(bruteforce(0, k), 1);
    for (let i = 1; i <= k; i += 1) {
      const match = bruteforce(i, k);
      for (const [l, last] of ascending(optimalM[i - 1])) {
        // Two brute-forced spans side by side are never better than one covering both.
        if (last.pattern === "bruteforce") continue;
        update(match, l + 1);
      }
    }
  };

  for (let k = 0; k < n; k += 1) {
    for (const match of byEnd[k]) {
      if (match.i > 0) for (const [l] of ascending(optimalM[match.i - 1])) update(match, l + 1);
      else update(match, 1);
    }
    bruteforceUpdate(k);
  }

  const sequence: Match[] = [];
  let bestL = 0;
  if (n > 0) {
    let bestG = Infinity;
    for (const [l, g] of ascending(optimalG[n - 1])) {
      if (g < bestG) {
        bestL = l;
        bestG = g;
      }
    }
    for (let k = n - 1, l = bestL; k >= 0; l -= 1) {
      const match = optimalM[k].get(l)!;
      sequence.unshift(match);
      k = match.i - 1;
    }
  }
  const guesses = n === 0 ? 1 : optimalG[n - 1].get(sequence.length)!;
  return { password, guesses, guessesLog10: log10(guesses), sequence };
}

/* ---- Times and feedback --------------------------------------------------- */

export type Scenario = "onlineThrottled" | "onlineUnthrottled" | "offlineSlow" | "offlineFast";

export const SCENARIOS: { id: Scenario; perSecond: number; label: string; blurb: string }[] = [
  { id: "onlineThrottled", perSecond: 100 / 3600, label: "Online, rate-limited", blurb: "A login page that allows 100 tries an hour" },
  { id: "onlineUnthrottled", perSecond: 10, label: "Online, no limit", blurb: "A login page that allows 10 tries a second" },
  { id: "offlineSlow", perSecond: 1e4, label: "Offline, slow hash", blurb: "A stolen database hashed with bcrypt, scrypt or PBKDF2" },
  { id: "offlineFast", perSecond: 1e10, label: "Offline, fast hash", blurb: "A stolen database of unsalted MD5 or SHA-1, on many GPUs" },
];

export function guessesToScore(guesses: number): 0 | 1 | 2 | 3 | 4 {
  const DELTA = 5;
  if (guesses < 1e3 + DELTA) return 0;
  if (guesses < 1e6 + DELTA) return 1;
  if (guesses < 1e8 + DELTA) return 2;
  if (guesses < 1e10 + DELTA) return 3;
  return 4;
}

export function displayTime(seconds: number): string {
  const minute = 60;
  const hour = minute * 60;
  const day = hour * 24;
  const month = day * 31;
  const year = month * 12;
  const century = year * 100;
  if (seconds < 1) return "less than a second";
  const units: [number, string][] = [
    [minute, "second"],
    [hour, "minute"],
    [day, "hour"],
    [month, "day"],
    [year, "month"],
    [century, "year"],
  ];
  const divisors = [1, minute, hour, day, month, year];
  for (let index = 0; index < units.length; index += 1) {
    if (seconds < units[index][0]) {
      const value = Math.round(seconds / divisors[index]);
      return `${value} ${units[index][1]}${value === 1 ? "" : "s"}`;
    }
  }
  return "centuries";
}

export interface Feedback {
  warning: string;
  suggestions: string[];
}

function dictionaryFeedback(match: DictionaryMatch, soleMatch: boolean): Feedback {
  let warning = "";
  if (match.dictionaryName === "passwords") {
    if (soleMatch && !match.l33t && !match.reversed) warning = match.rank <= 10 ? "This is a top-10 common password" : match.rank <= 100 ? "This is a top-100 common password" : "This is a very common password";
    else if ((match.guessesLog10 ?? Infinity) <= 4) warning = "This is similar to a commonly used password";
  } else if (match.dictionaryName === "english_wikipedia") {
    if (soleMatch) warning = "A word by itself is easy to guess";
  } else if (match.dictionaryName === "surnames" || match.dictionaryName === "male_names" || match.dictionaryName === "female_names") {
    warning = soleMatch ? "Names and surnames by themselves are easy to guess" : "Common names and surnames are easy to guess";
  }
  const suggestions: string[] = [];
  if (START_UPPER.test(match.token)) suggestions.push("Capitalization doesn't help very much");
  else if (ALL_UPPER.test(match.token) && match.token.toLowerCase() !== match.token) suggestions.push("All-uppercase is almost as easy to guess as all-lowercase");
  if (match.reversed && match.token.length >= 4) suggestions.push("Reversed words aren't much harder to guess");
  if (match.l33t) suggestions.push("Predictable substitutions like '@' instead of 'a' don't help very much");
  return { warning, suggestions };
}

function matchFeedback(match: Match, soleMatch: boolean): Feedback | null {
  switch (match.pattern) {
    case "dictionary":
      return dictionaryFeedback(match, soleMatch);
    case "spatial":
      return { warning: match.turns === 1 ? "Straight rows of keys are easy to guess" : "Short keyboard patterns are easy to guess", suggestions: ["Use a longer keyboard pattern with more turns"] };
    case "repeat":
      return { warning: match.baseToken.length === 1 ? 'Repeats like "aaa" are easy to guess' : 'Repeats like "abcabcabc" are only slightly harder to guess than "abc"', suggestions: ["Avoid repeated words and characters"] };
    case "sequence":
      return { warning: "Sequences like abc or 6543 are easy to guess", suggestions: ["Avoid sequences"] };
    case "regex":
      return { warning: "Recent years are easy to guess", suggestions: ["Avoid recent years", "Avoid years that are associated with you"] };
    case "date":
      return { warning: "Dates are often easy to guess", suggestions: ["Avoid dates and years that are associated with you"] };
    default:
      return null;
  }
}

export function feedbackFor(score: number, sequence: Match[]): Feedback {
  if (sequence.length === 0) return { warning: "", suggestions: ["Use a few words, avoid common phrases", "No need for symbols, digits, or uppercase letters"] };
  if (score > 2) return { warning: "", suggestions: [] };
  let longest = sequence[0];
  for (const match of sequence.slice(1)) if (match.token.length > longest.token.length) longest = match;
  const feedback = matchFeedback(longest, sequence.length === 1);
  const extra = "Add another word or two. Uncommon words are better.";
  if (feedback) return { warning: feedback.warning, suggestions: [extra, ...feedback.suggestions] };
  return { warning: "", suggestions: [extra] };
}

/* ---- All of it -------------------------------------------------------------- */

export interface Strength extends GuessResult {
  score: 0 | 1 | 2 | 3 | 4;
  crackSeconds: Record<Scenario, number>;
  feedback: Feedback;
}

/**
 * The estimate for a password. Words about the person - their name, e-mail,
 * the site - count as a dictionary of their own, ranked in the order given.
 */
export function estimateStrength(password: string, dictionaries: RankedDictionaries, userInputs: readonly string[] = [], referenceYear = new Date().getFullYear()): Strength {
  referenceYearNow = referenceYear;
  const inputs = userInputs.map((input) => input.toLowerCase());
  const all: RankedDictionaries = [...dictionaries, { name: "user_inputs", ranks: ranked(inputs) }];
  const result = mostGuessableMatchSequence(password, omnimatch(password, all));
  const score = guessesToScore(result.guesses);
  const crackSeconds = Object.fromEntries(SCENARIOS.map((scenario) => [scenario.id, result.guesses / scenario.perSecond])) as Record<Scenario, number>;
  return { ...result, score, crackSeconds, feedback: feedbackFor(score, result.sequence) };
}
