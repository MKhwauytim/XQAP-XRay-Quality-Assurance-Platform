// The risk-engine column's vocabulary, and the ONE rule that maps it to a
// verdict. Shared, not duplicated.
//
// This lived inside `reporting/executive/deck2/section3/riskEngineAgreement.ts`
// until the employee case-queue filter needed the same rule. Two copies of a
// free-text vocabulary drift the moment one of them learns a new value from a
// real month, and importing the executive-deck section into an Employee
// Workspace view would drag a whole deck page (and its CSS) into that view's
// chunk for the sake of one six-line function. So the vocabulary and the
// mapping live here — in the population layer that OWNS
// `PreparedPopulationRow.targetedByRiskEngine` — and both consumers import it.
//
// ── The correctness core: a blank is NOT سليمة ──────────────────────────────
// `targetedByRiskEngine` is free text off the risk file, with a vocabulary that
// is UNKNOWN at design time (see `ExecutiveReportRow.targetedByRiskEngine`'s
// own doc comment). `engineVerdictOf` maps it to a سليمة/اشتباه verdict for a
// small, explicit recognized set; everything else — including every blank —
// maps to `null`. A blank means "we do not know what the engine said", never
// "the engine cleared it". In the executive deck that distinction keeps every
// agreement rate off a fabricated denominator; in the case-queue filter it is
// what keeps «مستهدف المؤشر» meaning "the engine actually said yes" rather than
// "the engine did not say no".
//
// Pure: no `Date.now()`, no `Math.random()`, no I/O. Same input ⇒ same output.

/** Recognized affirmative values, normalized (trimmed, lower-cased). Extend
 *  this list — with a test — once a real month reveals the actual vocabulary
 *  the risk file uses; `.v2-re-coverage` in `riskEngineAgreement.ts` exists
 *  precisely to surface that need instead of leaving it silently guessed at. */
const AFFIRMATIVE = new Set(["نعم", "مستهدف", "y", "yes", "true", "1"]);
const NEGATIVE = new Set(["لا", "غير مستهدف", "n", "no", "false", "0"]);

/** The two recognized verdicts; `null` means "unknown", never "cleared". */
export type RiskEngineVerdict = "اشتباه" | "سليمة";

/**
 * Map the RAW risk-engine column value to a سليمة/اشتباه verdict.
 *
 * Returns `null` for blank AND for unrecognized values, and both are excluded
 * from every rate on the executive deck's risk-engine page. A blank means "we
 * do not know what the engine said" — NOT "the engine cleared it". Mapping
 * blanks to سليمة would fabricate agreement across potentially most of the
 * month and inflate every figure there.
 */
export function engineVerdictOf(raw: string | null | undefined): RiskEngineVerdict | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (AFFIRMATIVE.has(key)) return "اشتباه";
  if (NEGATIVE.has(key)) return "سليمة";
  return null;
}
