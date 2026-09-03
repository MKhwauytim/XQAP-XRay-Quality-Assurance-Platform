// The risk-engine column's vocabulary, and the ONE rule that maps it to a
// verdict. Shared, not duplicated.
//
// This lived inside `reporting/executive/deck2/section3/riskEngineAgreement.ts`
// until a second consumer needed the same rule. Two copies of a free-text
// vocabulary drift the moment one of them learns a new value from a real
// month, so the vocabulary and the mapping live here — in the population layer
// that OWNS `PreparedPopulationRow.targetedByRiskEngine` — and every consumer
// imports it. Today those are the executive deck's risk-engine pages (deck2
// `riskEngineAgreement.ts`, which re-exports it, and deck3 `slides.ts`).
//
// ── NOT the employee queue's «مستهدف المؤشر» chip ───────────────────────────
// That chip used to read this, and no longer does: the owner defined its
// membership as "reached the queue through the regular monthly population
// process off the Risk file" — pipeline origin, not a per-row column read (see
// the module header in
// `components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/caseFilter.ts`).
// The two are genuinely different measures that share a near-identical Arabic
// name, so a row can sit in that chip while `engineVerdictOf` returns `null`
// for it. Do not "reconcile" them.
//
// ── The correctness core: a blank is NOT سليمة ──────────────────────────────
// `targetedByRiskEngine` is free text off the risk file, with a vocabulary that
// is UNKNOWN at design time (see `ExecutiveReportRow.targetedByRiskEngine`'s
// own doc comment). `engineVerdictOf` maps it to a سليمة/اشتباه verdict for a
// small, explicit recognized set; everything else — including every blank —
// maps to `null`. A blank means "we do not know what the engine said", never
// "the engine cleared it". In the executive deck that distinction keeps every
// agreement rate off a fabricated denominator.
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
