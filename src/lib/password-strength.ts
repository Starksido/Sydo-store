// Password strength, with zxcvbn (dictionaries of common passwords, names and words, keyboard
// patterns, sequences, repeats and dates). No database or server-only imports: the server refuses
// weak passwords with it (`src/lib/auth.ts`) and the forms load it for their strength meter.
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary as commonDictionary } from "@zxcvbn-ts/language-common";
import { dictionary as englishDictionary, translations } from "@zxcvbn-ts/language-en";

/** zxcvbn scores 0–4; 3 ("safely unguessable") is the least a password may have. */
export const MIN_PASSWORD_SCORE = 3;

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  ok: boolean;
  label: "Too weak" | "Weak" | "Fair" | "Strong" | "Very strong";
  /** What's wrong with it, e.g. "This is a commonly used password." */
  warning: string | null;
  suggestions: string[];
};

const LABELS = ["Too weak", "Weak", "Fair", "Strong", "Very strong"] as const;

let factory: ZxcvbnFactory | undefined;

function zxcvbn() {
  factory ??= new ZxcvbnFactory({
    translations,
    graphs: adjacencyGraphs,
    dictionary: { ...commonDictionary, ...englishDictionary },
    useLevenshteinDistance: true,
  });
  return factory;
}

/**
 * How strong `password` is. `userInputs` (the person's name and email, and the store's name) count
 * as easy to guess, so a password built from them scores low.
 */
export function checkPassword(password: string, userInputs: (string | null | undefined)[] = []): PasswordStrength {
  const inputs = ["sydo", ...userInputs.flatMap((input) => (input ? [input, ...input.split(/[@\s.]+/)] : []))].filter(
    (input) => input.length >= 3,
  );
  // zxcvbn only looks at the first 100 characters; anything that long is strong anyway.
  const { score, feedback } = zxcvbn().check(password.slice(0, 100), inputs);
  return {
    score,
    ok: score >= MIN_PASSWORD_SCORE,
    label: LABELS[score],
    warning: feedback.warning || null,
    suggestions: feedback.suggestions,
  };
}
