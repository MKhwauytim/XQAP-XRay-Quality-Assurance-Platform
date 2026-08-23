/**
 * Wrong-keyboard-layout tolerance for password entry.
 *
 * The problem is mundane and constant in an Arabic-first deployment: the
 * password is `mhmd`, the operator's keyboard is still on Arabic, and the four
 * keys they press produce `ةاةي`. Nothing is wrong with their memory or their
 * typing — the same physical keys, in the same order — but the string that
 * reaches the form is a different one and the login is rejected. The password
 * field masks its content, so there is nothing on screen to explain it either.
 *
 * This module maps between what the keys PRODUCE under the two layouts, so a
 * login attempt can be checked against the other reading of the same keystrokes.
 *
 * ## Layout
 *
 * Arabic (101) — the Windows default for `ar-SA` and what these machines run.
 * Only the unshifted alphanumeric block is mapped: that is where a typed
 * password lives, and the shifted row produces diacritics and punctuation whose
 * mapping is neither stable across layouts nor plausible in this scenario.
 * Arabic-Indic digits fold to ASCII as well, since a numeric password typed on
 * a keypad set to `٠١٢٣` fails for exactly the same reason.
 *
 * ## Security
 *
 * This lets one submitted attempt be checked against at most four candidate
 * strings instead of one — a factor-4 reduction in an attacker's work, which is
 * nothing against Argon2id (m=19 MiB, t=2) behind a five-attempt lockout. It
 * does NOT widen what counts as a correct password: each candidate is verified
 * against the stored hash in full, and a wrong password stays wrong under every
 * reading. The lockout counts submitted ATTEMPTS, not candidates, so this
 * cannot be used to buy extra guesses.
 *
 * Pure: no I/O, no clock, no randomness. Same input ⇒ same output.
 */

import { verifyPasswordHash, type PasswordHashRecord } from "./passwordCrypto";

/**
 * Latin key → what that key produces on Arabic (101), unshifted.
 *
 * Written in this direction because it is the direction the layout is actually
 * documented in; the reverse map below is DERIVED from it, so the two can never
 * disagree.
 */
const LATIN_TO_ARABIC: ReadonlyArray<readonly [string, string]> = [
  ["q", "ض"], ["w", "ص"], ["e", "ث"], ["r", "ق"], ["t", "ف"],
  ["y", "غ"], ["u", "ع"], ["i", "ه"], ["o", "خ"], ["p", "ح"],
  ["[", "ج"], ["]", "د"],
  ["a", "ش"], ["s", "س"], ["d", "ي"], ["f", "ب"], ["g", "ل"],
  ["h", "ا"], ["j", "ت"], ["k", "ن"], ["l", "م"], [";", "ك"], ["'", "ط"],
  ["z", "ئ"], ["x", "ء"], ["c", "ؤ"], ["v", "ر"], ["b", "لا"],
  ["n", "ى"], ["m", "ة"], [",", "و"], [".", "ز"], ["/", "ظ"],
];

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const latinToArabic = new Map(LATIN_TO_ARABIC);

/**
 * Arabic → Latin, longest key first.
 *
 * The sort is load-bearing: `b` produces the two-character sequence `لا`, so a
 * shortest-first scan would consume only its `ل` and leave a stray alef behind.
 *
 * **This direction is genuinely ambiguous, and pretending otherwise is what a
 * naive implementation gets wrong.** `لا` is both the single `b` key AND the
 * ordinary sequence `g`+`h` (`ل` then `ا`) — the Arabic layout is not injective,
 * so `لا` has two equally valid readings and no amount of ordering picks the
 * right one. `arabicKeysToLatin` therefore takes an explicit choice and
 * `passwordLayoutCandidates` offers BOTH, rather than guessing at one and
 * failing a login that would have succeeded under the other.
 */
const arabicToLatin: ReadonlyArray<readonly [string, string]> = LATIN_TO_ARABIC
  .map(([latin, arabic]) => [arabic, latin] as const)
  .sort((left, right) => right[0].length - left[0].length);

/** Single-character entries only — the reading that decomposes `لا` into `g`+`h`. */
const arabicToLatinSingles = arabicToLatin.filter(([arabic]) => arabic.length === 1);

function foldDigit(char: string): string | null {
  const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(char);
  if (arabicIndex >= 0) return String(arabicIndex);
  const extendedIndex = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(char);
  return extendedIndex >= 0 ? String(extendedIndex) : null;
}

/**
 * What these keystrokes would have produced with the keyboard on English.
 *
 * Characters with no mapping (Latin letters, digits, symbols the layout shares)
 * pass through untouched, so a password that mixes scripts still converts the
 * half that needs it.
 *
 * `splitLigatures` picks which reading of `لا` to take: `false` (the default)
 * reads it as the single `b` key, `true` as `g`+`h`. Both are correct — see
 * `arabicToLatin`.
 */
export function arabicKeysToLatin(text: string, splitLigatures = false): string {
  const table = splitLigatures ? arabicToLatinSingles : arabicToLatin;
  let out = "";
  let index = 0;
  outer: while (index < text.length) {
    for (const [arabic, latin] of table) {
      if (text.startsWith(arabic, index)) {
        out += latin;
        index += arabic.length;
        continue outer;
      }
    }
    const digit = foldDigit(text[index]!);
    out += digit ?? text[index]!;
    index += 1;
  }
  return out;
}

/** The mirror image: what these keystrokes would produce with the keyboard on Arabic. */
export function latinKeysToArabic(text: string): string {
  let out = "";
  for (const char of text) {
    out += latinToArabic.get(char.toLowerCase()) ?? char;
  }
  return out;
}

/**
 * Every reading of one submitted password, the literal one first.
 *
 * Order matters for cost, not for correctness: the exact string is checked
 * before any transliteration, so a correctly-typed password still costs exactly
 * one Argon2id verification and the feature is free for everyone it does not
 * help. Duplicates are dropped, so an all-digit or all-symbol password (which
 * every map leaves unchanged) also stays at one.
 *
 * At most four: the literal, the two readings of the Arabic→Latin direction
 * (they differ only for a password containing `لا`), and the Latin→Arabic one.
 * Bounded by construction, so no password can turn one submitted attempt into
 * an unbounded number of hash verifications.
 */
export function passwordLayoutCandidates(typed: string): string[] {
  const candidates = [typed];
  const readings = [
    arabicKeysToLatin(typed),
    // The other reading of `لا`, which is a real alternative rather than a
    // fallback — see `arabicToLatin`. Identical to the first for any password
    // without that sequence, and then deduped away at no cost.
    arabicKeysToLatin(typed, true),
    latinKeysToArabic(typed),
  ];
  for (const candidate of readings) {
    if (candidate !== "" && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

/**
 * Verify a submitted password against a stored hash, tolerating a wrong
 * keyboard layout.
 *
 * Returns the plaintext that MATCHED, or `null`. Returning the string rather
 * than a boolean is what makes the transparent Argon2id rehash on login safe:
 * re-hashing `password` as typed would, for an operator who logged in with the
 * keyboard on the wrong layout, silently replace their stored hash with one for
 * `ةاةي` — changing their password to a string they never chose and cannot
 * reproduce deliberately. Callers must rehash THIS value.
 */
export async function verifyPasswordWithLayoutFallback(
  typed: string,
  record: PasswordHashRecord
): Promise<string | null> {
  for (const candidate of passwordLayoutCandidates(typed)) {
    if (await verifyPasswordHash(candidate, record)) return candidate;
  }
  return null;
}
