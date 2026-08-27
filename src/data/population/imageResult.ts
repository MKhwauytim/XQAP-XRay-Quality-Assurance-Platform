/**
 * The image-result grain used by every report that answers "what did we
 * find" rather than "was screening right" (that's `classifyOutcome`'s
 * reviewer-accuracy 4-way split — a different question, deliberately not
 * this one). Shared so the OR-rule can't drift between call sites; mirrors
 * `riskEngineVerdict.ts`'s precedent for a small, pure, population-layer
 * classifier with no UI or I/O dependency.
 */
export type ImageResult = "سليمة" | "اشتباه";

export function classifyImageResult(
  levelOneResult: string | null | undefined,
  levelTwoResult: string | null | undefined
): ImageResult {
  return levelOneResult === "اشتباه" || levelTwoResult === "اشتباه" ? "اشتباه" : "سليمة";
}
