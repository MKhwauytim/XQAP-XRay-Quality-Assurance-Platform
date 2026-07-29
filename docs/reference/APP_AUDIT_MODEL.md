# App Purpose & Audit Model

Working reference for *why* this app exists and how its analytical model is structured —
captured from the domain owner's explanation, then cross-checked against what's actually
implemented in the executive report (`src/data/reporting/executive/deck2/section3/`). Every
claim below is grounded in real code, not just stated intent.

## Core mission (domain owner's framing)

> This app is developed for a department to **supervise the answers of Level 1 and Level 2**.
> Our main focus is L1 and L2, as an **audit on them**. We might use other levels (inspector,
> live-means/K9) alongside L1/L2 for the sake of understanding accuracy, or how well answers
> match across levels. The data stored, the reports, and the templates we study and fill exist
> to calculate any possible risk — either from the data itself, or from our own answers.

This is confirmed almost verbatim in code — `decisionFactTable.ts:5-11`:

> "Each X-ray case carries exactly two of OUR decisions — Level 1 and Level 2 — and each is
> owned by an inspector. We explode every `ExecutiveReportRow` into 1–2 `DecisionRecord`s (one
> per level). We never emit decision records for the other teams (manual / opposite / live-means):
> **audit scope is L1/L2 only.**"

So: **L1 and L2 are the audit target.** Every other result source (manual/معاين,
opposite/مفتش معاكس, liveMeans/K9) exists **only as a corroborating signal** to help judge
whether L1/L2 got it right — never as an audit target in its own right.

## The measurement model

Three types, all in [`decisionFactTable.ts`](../../src/data/reporting/executive/model/decisionFactTable.ts):

```ts
type DecisionLevel = "LEVEL_1" | "LEVEL_2";           // the two audit targets

type ResultSource =                                    // everything comparable to a decision
  | "levelOne" | "levelTwo"                             // ← the audit targets themselves
  | "manual" | "opposite" | "liveMeans"                 // ← corroborating signals only
  | "review";                                            // ← the ground truth (see below)

type OutcomeClass =                                     // how one L1/L2 decision gets scored
  | "correct-clean"       // said سليمة, reviewer agreed
  | "correct-suspicion"   // said اشتباه, reviewer agreed
  | "missed-suspicion"    // said سليمة, reviewer said اشتباه — a miss
  | "false-suspicion"     // said اشتباه, reviewer said سليمة — a false alarm
  | null;                 // no reviewer verdict yet — not evaluable
```

**"المراجع" (the reviewer) is the ground truth.** A study reviewer records an independent
verdict (`studyReviewResult`) on the sampled subset of images. `classifyOutcome(employeeDecision,
studyReviewResult)` (`decisionFactTable.ts:129`) scores each L1/L2 decision against that verdict
— this is the literal mechanism behind "supervising the answers of L1 and L2." It's a sample-only
comparison (the reviewer only answers sampled images, not the whole month's population) —
every section-3 page that compares against `review` discloses this scope difference explicitly.

**How the reviewer reaches that verdict — corrected 2026-07-29:** this is a **document/image
study, not a physical inspection.** Our own team (the one this app — XQAP — is built for) never
opens or physically handles the shipment; المعاين/التفتيش المعاكس/الوسائل الحية are the
*physically* hands-on teams, and their results are only corroborating signals (see above). Our
reviewer instead reviews every document related to the shipment (الارسالية) plus the X-ray image
itself from the internal system, and records the verdict by filling out a **template**
(checklist) inside the app — this *is* `ItemAnswer` (`src/data/answers/`, submitted via the
Template Builder / `ew/inspection-form`, see the earlier answers-model research in this
conversation). `studyReviewResult` is that submitted answer.

**Important — don't confuse this with the sampling "stage" concept.** المستوى الأول/الثاني/
الثالث/الرابع also appears elsewhere in the app (`DEFAULT_STAGE_MAPPINGS`, sample draw
allocation) as **four categorical detection *scenarios*, not a severity ranking** — the
department's own glossary slide defines exactly what each of the four captures, see
[`DEPARTMENT_GLOSSARY.md`](DEPARTMENT_GLOSSARY.md) and [[risk-levels-are-categorical]]. That is a
completely different axis from `DecisionLevel` (`LEVEL_1`/`LEVEL_2`) here, which are the two
**X-ray inspection passes** on every image. The code is emphatic about this exact distinction in
multiple places (e.g. `levelAccuracy.ts:9-19`, `sourceAgreement.ts:16-19`) — never let the two
"مستوى" concepts blend together in writing or UI copy.

## The six audit reports already built (`القسم 3 — التحاليل المتقدمة`)

This is Section 3 of the executive deck (`deck2/section3/`), and it directly answers the example
questions from the domain owner's brief:

| Page | File | Question it answers |
|---|---|---|
| دقة إجابات المستوى الأول والثاني | `levelAccuracy.ts` | How accurate is L1 vs. L2 against the reviewer's verdict, per port — and which of the two does better? |
| توافق المستويات حسب المنفذ | `portAgreement.ts` | Which ports show the most internal disagreement *between L1 and L2*, and how does each line up with the reviewer there? |
| **توافق النتائج بين المستويات والمصادر** | `sourceAgreement.ts` | **This is literally "ما هي نسبة توافق المستوى الأول مع الثاني" / "...مع المعاين أو الوسائل الحية"** — a 6×6 matrix of pairwise agreement rates across all C(6,2)=15 pairs of `levelOne, levelTwo, manual, opposite, liveMeans, review`, plus a dedicated "every source vs. the reviewer" table. |
| الأداء حسب حجم الأعمال | `workloadAccuracy.ts` | Is a port's low accuracy explained by its handling too much volume? |
| أثر جودة الصورة على الدقة | `qualityImpact.ts` | Does image quality track with decision accuracy? |
| أثر وجود التحديد على الدقة | `markingImpact.ts` | Do images with a تحديد (a marking the inspecting team drew) end up more or less accurate? |

`sourceAgreement.ts`'s `SOURCE_LABELS` map is the canonical Arabic naming for the six sources:

```ts
const SOURCE_LABELS: Record<ResultSource, string> = {
  levelOne: "المستوى الأول",
  levelTwo: "المستوى الثاني",
  manual: "التفتيش اليدوي",      // = inspectorResult (المعاين)
  opposite: "التفتيش المعاكس",   // = oppositeInspectorResult
  liveMeans: "الوسائل الحية",    // = liveMeansResult (K9)
  review: "المراجع (المعيار)",   // = the ground-truth verdict
};
```

## Risk, the two ways this app means it

1. **Risk inherent in the data itself** — `targetedByRiskEngine`, `riskMessage`, `stage` (the
   sampling/detection-scenario concept) on the risk side; whether a shipment was already flagged
   by the customs risk engine before it ever reached an X-ray screen.
2. **Risk surfaced by our own team's answers** — low L1/L2 accuracy against the reviewer, low
   agreement between L1 and L2, or low agreement between L1/L2 and the corroborating sources
   (معاين / معاكس / وسائل حية) are themselves a risk signal: they suggest missed detections,
   inconsistent screening, or a level that needs retraining/support — exactly what Section 3
   is built to surface.

Both senses of "risk" feed the same reports; the inspection templates employees fill (per
`src/data/answers/`) and the reviewer's sampled verdicts are what make sense #2 measurable at all.
