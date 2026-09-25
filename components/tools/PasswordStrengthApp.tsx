"use client";

import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { characterSets, describeBits, generatePassphrase, generatePassword, type Generated } from "@/lib/security/generate";
import { displayTime, estimateStrength, loadDictionaries, SCENARIOS, type Match, type RankedDictionaries } from "@/lib/security/strength";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { requireTool } from "@/lib/tools";

import { PlainFootnote } from "../PlainToolApp";
import { ToolFrame } from "../ToolFrame";
import { Button } from "../ui/Button";
import { CheckboxCards } from "../ui/CheckboxCards";
import { RadioCards } from "../ui/RadioCards";
import jwt from "./DecodeJwtApp.module.css";
import styles from "./PasswordStrengthApp.module.css";

const tool = requireTool("password-strength");

/** zxcvbn's matching grows with the square of the length; past this the rest adds only strength. */
const MAX_LENGTH = 100;

const SCORE_LABELS = ["Too guessable", "Very guessable", "Somewhat guessable", "Safely unguessable", "Very unguessable"];
const SCORE_BLURBS = [
  "Among the first thousand guesses anyone would try.",
  "Stops only an attacker limited to a few guesses an hour.",
  "Holds against an online attack, not against a stolen database.",
  "Holds against a stolen database stored with a slow hash.",
  "Holds even against a stolen database on fast hardware.",
];

const DICTIONARY_LABELS: Record<string, string> = {
  passwords: "a common password",
  english_wikipedia: "an English word",
  female_names: "a first name",
  male_names: "a first name",
  surnames: "a surname",
  us_tv_and_film: "a word from films and TV",
  user_inputs: "one of your own words",
};

function formatGuesses(guesses: number): string {
  if (guesses < 10_000) return Math.round(guesses).toLocaleString("en");
  const scales: [number, string][] = [
    [1e15, "quadrillion"],
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  if (guesses >= 1e18) return `10^${Math.round(Math.log10(guesses))}`;
  const [scale, word] = scales.find(([value]) => guesses >= value)!;
  const value = guesses / scale;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${word}`;
}

function describeMatch(match: Match): string {
  switch (match.pattern) {
    case "dictionary": {
      const extras = [match.reversed ? "reversed" : "", match.l33t ? `with ${Object.entries(match.sub ?? {}).map(([from, to]) => `${from} for ${to}`).join(", ")}` : "", (match.uppercaseVariations ?? 1) > 1 ? "capitalised" : ""].filter(Boolean);
      return `${DICTIONARY_LABELS[match.dictionaryName] ?? "a word"}, number ${match.rank.toLocaleString("en")} on its list${extras.length > 0 ? `, ${extras.join(", ")}` : ""}`;
    }
    case "spatial":
      return `a pattern on a ${match.graph === "qwerty" ? "QWERTY" : match.graph === "dvorak" ? "Dvorak" : "number"} keyboard, ${match.turns} ${match.turns === 1 ? "turn" : "turns"}${match.shiftedCount > 0 ? `, ${match.shiftedCount} shifted` : ""}`;
    case "repeat":
      return `"${match.baseToken}" ${match.repeatCount} times`;
    case "sequence":
      return `a sequence, ${match.ascending ? "counting up" : "counting down"}`;
    case "regex":
      return "a recent year";
    case "date":
      return `a date, ${match.year}-${String(match.month).padStart(2, "0")}-${String(match.day).padStart(2, "0")}`;
    case "bruteforce":
      return `${match.token.length} ${match.token.length === 1 ? "character" : "characters"} with no pattern, guessed one by one`;
  }
}

type Kind = "passphrase" | "random";
type CharacterKind = "lower" | "upper" | "digits" | "symbols";

interface GeneratorSettings {
  kind: Kind;
  words: number;
  separator: string;
  capitalize: boolean;
  digit: boolean;
  length: number;
  kinds: CharacterKind[];
  avoidAmbiguous: boolean;
}

const DEFAULT_GENERATOR: GeneratorSettings = { kind: "passphrase", words: 5, separator: "-", capitalize: false, digit: false, length: 20, kinds: ["lower", "upper", "digits", "symbols"], avoidAmbiguous: true };

const SEPARATORS = [
  { value: "-", label: "Hyphens" },
  { value: " ", label: "Spaces" },
  { value: ".", label: "Dots" },
  { value: "", label: "Nothing" },
];

function isGenerator(value: unknown): value is GeneratorSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GeneratorSettings>;
  return (
    (candidate.kind === "passphrase" || candidate.kind === "random") &&
    typeof candidate.words === "number" &&
    candidate.words >= 3 &&
    candidate.words <= 12 &&
    SEPARATORS.some((separator) => separator.value === candidate.separator) &&
    typeof candidate.capitalize === "boolean" &&
    typeof candidate.digit === "boolean" &&
    typeof candidate.length === "number" &&
    candidate.length >= 8 &&
    candidate.length <= 64 &&
    Array.isArray(candidate.kinds) &&
    candidate.kinds.length > 0 &&
    typeof candidate.avoidAmbiguous === "boolean"
  );
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

/** A password's strength estimated as it is typed, and strong ones made. */
export function PasswordStrengthApp() {
  const [dictionaries, setDictionaries] = useState<RankedDictionaries | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [personal, setPersonal] = useState("");
  const [generator, setGenerator] = useState<GeneratorSettings>(DEFAULT_GENERATOR);
  const [effWords, setEffWords] = useState<string[] | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  useStoredSettings(storageKey("settings", "password-strength"), generator, setGenerator, isGenerator);

  useEffect(() => {
    let live = true;
    loadDictionaries()
      .then((loaded) => live && setDictionaries(loaded))
      .catch(() => live && setLoadError(true));
    import("@/lib/security/effWords").then(({ EFF_WORDS }) => live && setEffWords(EFF_WORDS.split(" "))).catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, []);

  const personalWords = useMemo(() => personal.split(/[\s,;@.]+/).map((word) => word.trim()).filter((word) => word.length >= 2), [personal]);
  const checked = password.slice(0, MAX_LENGTH);
  const result = useMemo(() => (dictionaries && checked ? estimateStrength(checked, dictionaries, personalWords) : null), [dictionaries, checked, personalWords]);

  const generatorProblem = generator.kind === "random" && generator.kinds.length === 0 ? "Choose at least one kind of character." : null;

  const generate = useCallback(() => {
    if (generatorProblem) return;
    if (generator.kind === "passphrase") {
      if (!effWords) return;
      setGenerated(generatePassphrase({ words: generator.words, separator: generator.separator, capitalize: generator.capitalize, digit: generator.digit }, effWords));
    } else {
      setGenerated(generatePassword({ length: generator.length, lower: generator.kinds.includes("lower"), upper: generator.kinds.includes("upper"), digits: generator.kinds.includes("digits"), symbols: generator.kinds.includes("symbols"), avoidAmbiguous: generator.avoidAmbiguous }));
    }
  }, [effWords, generator, generatorProblem]);

  // A fresh one whenever the recipe changes, and once the word list is in.
  useEffect(() => {
    generate();
  }, [generate]);

  const alphabet = generator.kind === "random" ? characterSets({ length: generator.length, lower: generator.kinds.includes("lower"), upper: generator.kinds.includes("upper"), digits: generator.kinds.includes("digits"), symbols: generator.kinds.includes("symbols"), avoidAmbiguous: generator.avoidAmbiguous }).join("").length : 0;

  return (
    <ToolFrame
      tool={tool}
      lead="Type a password to see how many guesses it would take to crack, what it is made of, and how long that takes a website's login page or a thief holding a stolen database - or make a strong passphrase or password. Nothing you type leaves this page, and nothing is saved."
      footer={
        <PlainFootnote note="The estimate is zxcvbn's, the method Dropbox built and published: it finds every pattern an attacker tries first - 30,000 common passwords, English words, names and surnames, the same reversed or with @ for a, keyboard walks, repeats, sequences, years and dates - and takes the cheapest way to cover the whole password. It is ported here and gives the same answers as the original. Words about you, such as your name or your pet's, are treated as a list an attacker who knows you would try first. The generator uses the browser's cryptographic random numbers and EFF's long word list for passphrases, 7,776 words chosen to be easy to type and remember; its strength is counted exactly, since the recipe is known." />
      }
    >
      <section className={jwt.card}>
        <label htmlFor="password" className={jwt.label}>
          Password
        </label>
        <div className={styles.inputRow}>
          <input id="password" className={styles.password} type={shown ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" data-1p-ignore data-lpignore="true" placeholder="Type or paste a password" />
          <Button onClick={() => setShown((value) => !value)} aria-label={shown ? "Hide the password" : "Show the password"} aria-pressed={shown}>
            {shown ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
          </Button>
        </div>
        <label htmlFor="personal" className={jwt.label} style={{ marginTop: "0.875rem" }}>
          Words about you <span className={jwt.hint}>(optional: your name, e-mail, birthday, pet, the site)</span>
        </label>
        <input id="personal" className={jwt.keyInput} value={personal} onChange={(event) => setPersonal(event.target.value)} autoComplete="off" spellCheck={false} placeholder="ada lovelace, ada@example.com, 1815" />

        {loadError && <p className={jwt.hint}>The word lists could not be loaded; reload the page to try again.</p>}
        {!dictionaries && !loadError && <p className={jwt.hint}>Loading the word lists...</p>}
        {result && (
          <div aria-live="polite">
            <div className={styles.meter} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((segment) => (
                <span key={segment} className={`${styles.segment} ${segment <= result.score ? styles[`score${result.score}`] : ""}`} />
              ))}
            </div>
            <div className={styles.verdict}>
              <span className={styles.verdictLabel}>
                {SCORE_LABELS[result.score]} ({result.score} of 4)
              </span>
              <span className={jwt.hint}>
                About {formatGuesses(result.guesses)} guesses, like {Math.round(Math.log2(result.guesses))} bits
              </span>
            </div>
            <p className={jwt.hint}>{SCORE_BLURBS[result.score]}</p>
            {(result.feedback.warning || result.feedback.suggestions.length > 0) && (
              <ul className={jwt.warnings}>
                {result.feedback.warning && <li>{result.feedback.warning}.</li>}
                {result.feedback.suggestions.map((suggestion) => (
                  <li key={suggestion} style={{ color: "var(--muted-foreground)" }}>
                    {suggestion.replace(/\.?$/, ".")}
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.times}>
              {SCENARIOS.map((scenario) => (
                <div key={scenario.id} className={styles.time}>
                  <p className={styles.timeLabel}>
                    {scenario.label}: <span className={styles.timeValue}>{displayTime(result.crackSeconds[scenario.id])}</span>
                  </p>
                  <p className={styles.timeBlurb}>{scenario.blurb}</p>
                </div>
              ))}
            </div>
            <h2 className={jwt.sectionTitle} style={{ marginTop: "1rem" }}>
              How it would be guessed
            </h2>
            <div className={styles.patterns}>
              {result.sequence.map((match, index) => (
                <div key={`${match.i}-${index}`} className={styles.pattern}>
                  <span className={styles.patternToken}>{shown ? match.token : "*".repeat(match.token.length)}</span>
                  <span>{describeMatch(match)}</span>
                  <span className={styles.patternGuesses}>{formatGuesses(match.guesses ?? 1)}</span>
                </div>
              ))}
            </div>
            {password.length > MAX_LENGTH && <p className={jwt.hint}>Only the first {MAX_LENGTH} characters were checked; the rest can only make it stronger.</p>}
          </div>
        )}
      </section>

      <section className={jwt.card} style={{ marginTop: "1rem" }}>
        <h2 className={jwt.sectionTitle}>Make a strong one</h2>
        <div style={{ marginTop: "0.625rem" }}>
          <RadioCards
            aria-label="Kind"
            value={generator.kind}
            onValueChange={(kind) => setGenerator((previous) => ({ ...previous, kind }))}
            options={[
              { value: "passphrase" as const, label: "Passphrase", blurb: "Random words: easy to type and remember" },
              { value: "random" as const, label: "Random characters", blurb: "For a password manager to remember" },
            ]}
            columns={2}
          />
        </div>
        {generator.kind === "passphrase" ? (
          <div className={styles.options}>
            <label className={jwt.check}>
              Words
              <select className={styles.select} value={generator.words} onChange={(event) => setGenerator((previous) => ({ ...previous, words: Number(event.target.value) }))}>
                {[4, 5, 6, 7, 8, 10].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className={jwt.check}>
              Between them
              <select className={styles.select} value={generator.separator} onChange={(event) => setGenerator((previous) => ({ ...previous, separator: event.target.value }))}>
                {SEPARATORS.map((separator) => (
                  <option key={separator.label} value={separator.value}>
                    {separator.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={jwt.check}>
              <input type="checkbox" checked={generator.capitalize} onChange={(event) => setGenerator((previous) => ({ ...previous, capitalize: event.target.checked }))} /> Capitalise each word
            </label>
            <label className={jwt.check}>
              <input type="checkbox" checked={generator.digit} onChange={(event) => setGenerator((previous) => ({ ...previous, digit: event.target.checked }))} /> Add a digit
            </label>
          </div>
        ) : (
          <>
            <div className={styles.options}>
              <label className={jwt.check}>
                Length
                <select className={styles.select} value={generator.length} onChange={(event) => setGenerator((previous) => ({ ...previous, length: Number(event.target.value) }))}>
                  {[12, 16, 20, 24, 32, 48, 64].map((length) => (
                    <option key={length} value={length}>
                      {length}
                    </option>
                  ))}
                </select>
              </label>
              <label className={jwt.check}>
                <input type="checkbox" checked={generator.avoidAmbiguous} onChange={(event) => setGenerator((previous) => ({ ...previous, avoidAmbiguous: event.target.checked }))} /> Leave out look-alikes (0 O o 1 l I)
              </label>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <CheckboxCards
                aria-label="Characters"
                value={generator.kinds}
                onValueChange={(kinds) => setGenerator((previous) => ({ ...previous, kinds }))}
                options={[
                  { value: "lower" as const, label: "a-z" },
                  { value: "upper" as const, label: "A-Z" },
                  { value: "digits" as const, label: "0-9" },
                  { value: "symbols" as const, label: "Symbols", blurb: "!#$%&*+-=?@^_ and brackets" },
                ]}
              />
            </div>
          </>
        )}
        {generatorProblem ? (
          <p className={jwt.hint}>{generatorProblem}</p>
        ) : (
          generated && (
            <>
              <div className={styles.generated}>
                <output className={styles.generatedText} aria-label="Generated">
                  {generated.text}
                </output>
                <Button onClick={generate} aria-label="Make another">
                  <RefreshCw aria-hidden="true" size={15} /> Another
                </Button>
                <Button onClick={() => copyText(generated.text)} aria-label="Copy it">
                  <Copy aria-hidden="true" size={15} /> Copy
                </Button>
                <Button variant="ghost" onClick={() => setPassword(generated.text)}>
                  Check it above
                </Button>
              </div>
              <p className={jwt.hint} style={{ marginTop: "0.5rem" }}>
                {Math.round(generated.bits)} bits, {describeBits(generated.bits)}: one of about {formatGuesses(2 ** generated.bits)} {generator.kind === "passphrase" ? `equally likely passphrases (${generator.words} words from 7,776)` : `equally likely passwords (${generator.length} characters from ${alphabet})`}.
              </p>
            </>
          )
        )}
      </section>
    </ToolFrame>
  );
}
