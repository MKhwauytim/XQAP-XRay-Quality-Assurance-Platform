/**
 * Arabic text folding for the ad-hoc import module.
 *
 * The same character classes the rest of the app already folds when matching
 * operator-supplied text against known labels — alef forms, ya/alef-maqsura,
 * ta-marbuta/ha, tatweel, optional-vowel diacritics, and the zero-width and
 * directional marks that survive a copy-paste out of a diacritized document.
 * None of these change a word's meaning, so folding them is risk-free; NOT
 * folding them is how an exact-match lookup silently rejects every row of a
 * perfectly good file (the 2026-08-12 incident: 246,627 parsed, 0 accepted).
 *
 * Deliberately duplicated rather than imported from
 * `Population/components/columnMappingHints.ts`: owner correction C1 requires
 * the ad-hoc path to own its parsing, and importing a component-subtree module
 * into `src/data/` is the exact coupling that correction removes. The rules are
 * pinned by tests on both sides, so a divergence fails a suite rather than
 * quietly changing how one screen parses.
 *
 * Written with explicit \u escapes (not literal invisible characters) so the
 * no-irregular-whitespace lint rule does not flag this source file itself.
 */

const DIACRITIC_AND_ZERO_WIDTH_PATTERN = new RegExp(
  "[" +
    "\\u064b-\\u065f" + // Arabic diacritics (تشكيل)
    "\\u200b-\\u200f" + // ZWSP, ZWNJ, ZWJ, LRM, RLM
    "\\ufeff" +         // BOM / zero-width no-break space
  "]",
  "g"
);

/**
 * Folds a header or a cell value to its comparison key. Lowercases, so Latin
 * headers (`XRAY_SCAN_ID`, `Image ID`) compare case-insensitively too.
 *
 * Collapses interior whitespace rather than stripping it: `"رقم  البيان"` and
 * `"رقم البيان"` must match, but `"رقمالبيان"` is a different token and
 * treating it as equal would produce false positives on short Arabic words.
 */
export function foldArabic(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(DIACRITIC_AND_ZERO_WIDTH_PATTERN, "")
    .toLowerCase();
}

/** True when two operator-supplied strings are the same after folding. */
export function foldedEquals(left: string, right: string): boolean {
  return foldArabic(left) === foldArabic(right);
}

/**
 * Arabic-Indic and Eastern Arabic-Indic digits → ASCII, so a month or count
 * typed as "٢٠٢٦" compares equal to "2026". Separate from `foldArabic` because
 * a NAME containing digits should keep them as written; only numeric parsing
 * wants this.
 */
export function foldDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}
