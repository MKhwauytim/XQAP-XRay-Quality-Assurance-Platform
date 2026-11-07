/**
 * The image-result grain used by every report that answers "what did we
 * find" rather than "was screening right" (that's `classifyOutcome`'s
 * reviewer-accuracy 4-way split — a different question, deliberately not
 * this one). Shared so the OR-rule can't drift between call sites; mirrors
 * `riskEngineVerdict.ts`'s precedent for a small, pure, population-layer
 * classifier with no UI or I/O dependency.
 */
export type ImageResult = "سليمة" | "اشتباه";

/**
 * A level result that is not recorded yet: "" on a case added from Excel
 * before its L1/L2 results were known (v159.3), or a missing value. Such a
 * case has no verdict, so every tally must skip it rather than classify it:
 * classifyImageResult alone would call it «سليمة» and invent a clean result.
 */
export function isBlankResult(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/** Both levels recorded, so the case has an image result to count. */
export function hasRecordedResults(
  levelOneResult: string | null | undefined,
  levelTwoResult: string | null | undefined
): boolean {
  return !isBlankResult(levelOneResult) && !isBlankResult(levelTwoResult);
}

/**
 * The owner's third category (2026-11-07): a case whose L1/L2 results are
 * not recorded yet stays in every report as «نتائج أخرى» (label
 * `result_other`), never folded into «سليمة» or «اشتباه».
 */
export const OTHER_RESULT = "other" as const;
export type ImageResultOrOther = ImageResult | typeof OTHER_RESULT;

/** classifyImageResult, or «نتائج أخرى» for a case whose results are not recorded yet. */
export function classifyImageResultOrOther(
  levelOneResult: string | null | undefined,
  levelTwoResult: string | null | undefined
): ImageResultOrOther {
  return hasRecordedResults(levelOneResult, levelTwoResult) ? classifyImageResult(levelOneResult, levelTwoResult) : OTHER_RESULT;
}

/** classifyImageResult, or null for a case whose results are not recorded yet. */
export function classifyRecordedImageResult(
  levelOneResult: string | null | undefined,
  levelTwoResult: string | null | undefined
): ImageResult | null {
  return hasRecordedResults(levelOneResult, levelTwoResult) ? classifyImageResult(levelOneResult, levelTwoResult) : null;
}

export function classifyImageResult(
  levelOneResult: string | null | undefined,
  levelTwoResult: string | null | undefined
): ImageResult {
  return levelOneResult === "اشتباه" || levelTwoResult === "اشتباه" ? "اشتباه" : "سليمة";
}
