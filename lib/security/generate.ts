/**
 * Passwords and passphrases made from the browser's cryptographic random
 * numbers, with their true strength: since the recipe is known, the bits are
 * counted exactly rather than estimated.
 *
 * Every pick is uniform. A 32-bit random number is only used when it falls
 * below the largest multiple of the choice count, so no choice is favoured
 * by the remainder, and a password that must contain every chosen kind of
 * character is drawn again until it does rather than patched afterwards.
 */

/** A uniform whole number from 0 to count - 1. */
export type RandomIndex = (count: number) => number;

export const cryptoIndex: RandomIndex = (count) => {
  if (count < 1 || count > 2 ** 32) throw new RangeError("count out of range");
  const limit = Math.floor(2 ** 32 / count) * count;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % count;
  }
};

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  /** One digit added to the end of one word, chosen at random. */
  digit: boolean;
}

export interface Generated {
  text: string;
  /** log2 of the number of equally likely results the recipe could have given. */
  bits: number;
}

export function generatePassphrase(options: PassphraseOptions, wordList: readonly string[], random: RandomIndex = cryptoIndex): Generated {
  const words = Array.from({ length: options.words }, () => wordList[random(wordList.length)]);
  const shown = words.map((word) => (options.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word));
  let bits = options.words * Math.log2(wordList.length);
  if (options.digit && shown.length > 0) {
    const at = random(shown.length);
    shown[at] += String(random(10));
    bits += Math.log2(shown.length * 10);
  }
  return { text: shown.join(options.separator), bits };
}

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Leave out characters that are easy to misread: 0 O o, 1 l I |, and the quote marks. */
  avoidAmbiguous: boolean;
}

const SETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!#$%&()*+,-./:;<=>?@[]^_{}~",
} as const;

const AMBIGUOUS = /[0Oo1lI|'"`]/g;

export function characterSets(options: PasswordOptions): string[] {
  return (Object.keys(SETS) as (keyof typeof SETS)[]).filter((name) => options[name]).map((name) => (options.avoidAmbiguous ? SETS[name].replace(AMBIGUOUS, "") : SETS[name]));
}

export function generatePassword(options: PasswordOptions, random: RandomIndex = cryptoIndex): Generated {
  const sets = characterSets(options);
  if (sets.length === 0) throw new RangeError("Choose at least one kind of character.");
  if (options.length < sets.length) throw new RangeError("The password is too short to hold one of each kind of character.");
  const alphabet = sets.join("");
  for (;;) {
    let text = "";
    for (let index = 0; index < options.length; index += 1) text += alphabet[random(alphabet.length)];
    if (sets.every((set) => [...text].some((character) => set.includes(character)))) {
      // Requiring one of each kind removes a sliver of the possibilities; the count below leaves them out.
      return { text, bits: Math.log2(countWithEvery(sets.map((set) => set.length), options.length)) };
    }
  }
}

/** Strings of the length over the sets' union that use every set at least once, by inclusion-exclusion. */
function countWithEvery(sizes: number[], length: number): number {
  let total = 0;
  for (let mask = 0; mask < 1 << sizes.length; mask += 1) {
    let left = 0;
    let removed = 0;
    sizes.forEach((size, index) => {
      if (mask & (1 << index)) removed += 1;
      else left += size;
    });
    total += (removed % 2 === 0 ? 1 : -1) * Math.pow(left, length);
  }
  return total;
}

/** A strength word for a number of bits, for the generator. */
export function describeBits(bits: number): string {
  if (bits < 40) return "weak";
  if (bits < 60) return "fair";
  if (bits < 80) return "strong";
  return "very strong";
}
