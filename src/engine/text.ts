/**
 * Text and token constants shared across the engine. Each is defined here once and imported by every
 * consumer, so validation, layout, lint and writers cannot drift apart.
 *
 * Global (`g`) regexes are used only with `replace`, `match` and `matchAll`, which reset `lastIndex`;
 * never call `.test` on them.
 */

/** En dash and em dash: never shipped in output text (T3). */
export const LONG_DASH = /[–—]/gu;

/** Any `{{...}}` placeholder; group 1 is its body (`measure:id` or `param:id`). */
export const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
/** `{{measure:id}}`; group 1 is the measure id. */
export const MEASURE_PLACEHOLDER = /\{\{measure:([^}]+)\}\}/g;
/** `{{slot:id}}` in a catalog design's text; group 1 is the slot id. Replaced at bind time. */
export const SLOT_PLACEHOLDER = /\{\{slot:([^}]+)\}\}/g;
/** `{{param:id}}`; group 1 is the param id. */
export const PARAM_PLACEHOLDER = /\{\{param:([^}]+)\}\}/g;

/** The smallest font any box may use, in px (F4). */
export const MIN_FONT_PX = 20;

/** Arabic-Indic digits U+0660..U+0669. */
export const ARABIC_INDIC_DIGITS = "٠-٩";
/** Extended (Persian) Arabic-Indic digits U+06F0..U+06F9. */
export const EXT_ARABIC_INDIC_DIGITS = "۰-۹";
/** One digit of any script the engine recognises. Not global: safe for `.test`. */
export const ANY_DIGIT = new RegExp(`[0-9${ARABIC_INDIC_DIGITS}${EXT_ARABIC_INDIC_DIGITS}]`, "u");

/** A theme colour: `#RGB` or `#RRGGBB`, nothing else. Not global: safe for `.test`. */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** `#RGB` / `#RRGGBB` as upper-case `RRGGBB`, or undefined for anything that is not a valid theme colour. */
export function hexDigits(color: string): string | undefined {
  if (!HEX_COLOR.test(color)) return undefined;
  const h = color.slice(1);
  return (h.length === 3 ? [...h].map((c) => c + c).join("") : h).toUpperCase();
}

const FIGURE = /\d[\d,]*(\.\d+)?%?/g;

/** Number tokens in `s`, commas removed. */
export const figureTokens = (s: string): string[] => [...s.matchAll(FIGURE)].map((m) => m[0].replace(/,/g, ""));

/**
 * `s` with whole figure tokens taken out as a multiset (each token of `remove` once, first occurrence first),
 * each replaced by a space. A token is matched whole, so removing "0" leaves "2026-05" intact. The result's
 * figure tokens are exactly `figureTokens(s)` minus `remove`.
 */
export function withoutTokens(s: string, remove: string[]): string {
  const left = new Map<string, number>();
  for (const t of remove) left.set(t, (left.get(t) ?? 0) + 1);
  return s.replace(FIGURE, (m) => {
    const t = m.replace(/,/g, "");
    const n = left.get(t) ?? 0;
    if (n === 0) return m;
    left.set(t, n - 1);
    return " ";
  });
}
