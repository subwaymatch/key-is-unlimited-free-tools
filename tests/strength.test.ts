import { describe, expect, it } from "vitest";

import { buildGraph, GRAPHS } from "@/lib/security/keyboards";
import { displayTime, estimateStrength, guessesToScore, rankLists } from "@/lib/security/strength";
import * as lists from "@/lib/security/wordLists";

const dictionaries = rankLists(lists);

/**
 * What zxcvbn 4.4.2 itself says of each password, with "ada" and "lovelace"
 * as the person's own words, in 2026, and its recent-year pattern widened
 * to 2099 as this port's is: guesses, score, the patterns it settled on and
 * its warning.
 */
const ZXCVBN: [string, number, number, string, string][] = [
  ["", 1, 0, "", ""],
  ["password", 3, 0, "dictionary:password", "This is a top-10 common password"],
  ["Password1", 379, 0, "dictionary:Password1", "This is a very common password"],
  ["p@ssw0rd", 9, 0, "dictionary:p@ssw0rd", "This is similar to a commonly used password"],
  ["P4$$w0rD!", 13520, 1, "dictionary:P4$$w0rD|bruteforce:!", "This is similar to a commonly used password"],
  ["drowssap", 5, 0, "dictionary:drowssap", "This is similar to a commonly used password"],
  ["correct horse battery staple", 213811968952000000000, 4, "dictionary:correct|bruteforce: horse |dictionary:battery|bruteforce: |dictionary:staple", ""],
  ["Tr0ub4dor&3", 100000000001, 4, "bruteforce:Tr0ub4dor&3", ""],
  ["qwerty123", 220, 0, "dictionary:qwerty123", "This is a very common password"],
  ["zxcvbnm,./", 3889.0000000000005, 1, "spatial:zxcvbnm,./", "Straight rows of keys are easy to guess"],
  ["1q2w3e4r5t", 291, 0, "dictionary:1q2w3e4r5t", "This is a very common password"],
  ["!QAZ2wsx", 346082, 1, "dictionary:!QAZ2wsx", "This is a very common password"],
  ["aoeuidhtns", 3889.0000000000005, 1, "spatial:aoeuidhtns", "Straight rows of keys are easy to guess"],
  ["7894561230", 4137, 1, "dictionary:7894561230", "This is a very common password"],
  ["abcdef", 25, 0, "sequence:abcdef", "Sequences like abc or 6543 are easy to guess"],
  ["ZYXWVU", 49, 0, "sequence:ZYXWVU", "Sequences like abc or 6543 are easy to guess"],
  ["13579", 21, 0, "sequence:13579", "Sequences like abc or 6543 are easy to guess"],
  ["aaaaaaaa", 97, 0, "repeat:aaaaaaaa", "Repeats like \"aaa\" are easy to guess"],
  ["abcabcabc", 40, 0, "repeat:abcabcabc", "Repeats like \"abcabcabc\" are only slightly harder to guess than \"abc\""],
  ["ilovejessica", 514100, 1, "dictionary:ilove|dictionary:jessica", "Common names and surnames are easy to guess"],
  ["jessica2019", 15000, 1, "dictionary:jessica|regex:2019", "Common names and surnames are easy to guess"],
  ["Jessica1987", 15200, 1, "dictionary:Jessica|regex:1987", "Common names and surnames are easy to guess"],
  ["2019-02-24", 29201, 1, "date:2019-02-24", "Dates are often easy to guess"],
  ["31.12.1999", 39421, 1, "date:31.12.1999", "Dates are often easy to guess"],
  ["111504", 8031, 1, "date:111504", "Dates are often easy to guess"],
  ["adalovelace99", 100750000, 3, "dictionary:ada|dictionary:lovelace|repeat:99", ""],
  ["Lovelace", 5, 0, "dictionary:Lovelace", ""],
  ["ASDFasdf", 33373, 1, "dictionary:ASDFasdf", "This is a very common password"],
  ["rWibMFACxAUGZmxhVncy", 100000000000000000000, 4, "bruteforce:rWibMFACxAUGZmxhVncy", ""],
  ["kvnhszx7", 100000001, 2, "bruteforce:kvnhszx7", ""],
  ["thisisnotapassword", 15100000000, 4, "dictionary:this|bruteforce:isnota|dictionary:password", ""],
  ["\u03a9\u03bc\u03ad\u03b3\u03b1123", 10010000, 2, "bruteforce:\u03a9\u03bc\u03ad\u03b3\u03b1|sequence:123", ""],
  ["p\u00e4ssw\u00f6rd", 100000001, 2, "bruteforce:p\u00e4ssw\u00f6rd", ""],
  ["hunter2", 8037, 1, "dictionary:hunter2", "This is a very common password"],
  ["letmein!", 11100, 1, "dictionary:letmein|bruteforce:!", "This is similar to a commonly used password"],
  ["monkey123monkey", 785100, 1, "dictionary:monkey123|dictionary:monkey", "This is similar to a commonly used password"],
  ["dragon2024", 15000, 1, "dictionary:dragon|regex:2024", "This is similar to a commonly used password"],
  ["x", 12, 0, "bruteforce:x", ""],
  ["ab", 9, 0, "sequence:ab", "Sequences like abc or 6543 are easy to guess"],
];

describe("estimating guesses", () => {
  for (const [password, guesses, score, sequence, warning] of ZXCVBN) {
    it(`${JSON.stringify(password)}: as zxcvbn estimates it`, () => {
      const result = estimateStrength(password, dictionaries, ["ada", "lovelace"], 2026);
      expect(result.guesses / guesses).toBeCloseTo(1, 12);
      expect(result.score).toBe(score);
      expect(result.sequence.map((match) => `${match.pattern}:${match.token}`).join("|")).toBe(sequence);
      expect(result.feedback.warning).toBe(warning);
    });
  }

  it("counts the person's own words as a dictionary", () => {
    // zxcvbn: 1,357,328 guesses as a first name and a surname, 15,000 as the person's own words.
    const alone = estimateStrength("adalovelace", dictionaries, [], 2026);
    const known = estimateStrength("adalovelace", dictionaries, ["Ada", "Lovelace"], 2026);
    expect(alone.guesses).toBe(1357328);
    expect(known.guesses).toBe(15000);
    expect(known.sequence.map((match) => (match.pattern === "dictionary" ? match.dictionaryName : match.pattern))).toEqual(["user_inputs", "user_inputs"]);
  });

  it("gives crack times for each attack", () => {
    const result = estimateStrength("kvnhszx7", dictionaries, [], 2026);
    expect(result.crackSeconds.offlineFast).toBeCloseTo(result.guesses / 1e10, 12);
    expect(result.crackSeconds.onlineThrottled).toBeCloseTo(result.guesses * 36, 6);
  });
});

describe("the pieces", () => {
  it("builds keyboard graphs with neighbours in a fixed order of directions", () => {
    const qwerty = GRAPHS[0].graph;
    // Left, up-left, up-right, right, down-right, down-left.
    expect(qwerty.g).toEqual(["fF", "tT", "yY", "hH", "bB", "vV"]);
    expect(qwerty["`"]).toEqual([null, null, null, "1!", null, null]);
    const keypad = buildGraph("\n7 8 9\n4 5 6\n1 2 3\n", false);
    expect(keypad["5"]).toEqual(["4", "7", "8", "9", "6", "3", "2", "1"]);
  });

  it("scores and words times as zxcvbn does", () => {
    expect([1e3, 1e3 + 5, 1e6 + 5, 1e8 + 5, 1e10 + 5].map(guessesToScore)).toEqual([0, 1, 2, 3, 4]);
    expect([0.5, 1, 59, 90, 7200, 86400 * 3, 86400 * 31 * 2, 86400 * 31 * 12 * 5, 1e12].map(displayTime)).toEqual(["less than a second", "1 second", "59 seconds", "2 minutes", "2 hours", "3 days", "2 months", "5 years", "centuries"]);
  });
});
