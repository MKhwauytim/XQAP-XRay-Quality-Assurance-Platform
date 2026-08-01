# Deck2 Section 3 (التحليلات المتقدمة) — Review & Improvement Proposal

**Date:** 2026-07-28
**Status:** PROPOSED — pending owner review. Nothing in this document has been implemented.
**Scope:** `src/data/reporting/executive/deck2/section3/` — the 6 "Advanced Analytics" pages
(`workloadAccuracy.ts`, `levelAccuracy.ts`, `sourceAgreement.ts`, `portAgreement.ts`,
`markingImpact.ts`, `qualityImpact.ts`).
**Trigger:** owner asked for a follow-on pass identifying what section 3 shows, what gaps and
duplication exist, and further improvement opportunities — run overnight while the owner was
away, with independent review from two other models before presenting back.

---

## 0. How this document was produced

1. A research/audit pass read all 6 section-3 page files plus their tests, `model/aggregates.ts`,
   `model/reportModel.ts`, and the shared chart primitives, and (where reachable) the live
   dev-preview render. Full catalog in §2.
2. This proposal (§3) was drafted from that audit.
3. Independent review passes from two other models (Opus 5, then Fable 5) follow in §4 — each
   was asked to find flaws in this proposal, not to rubber-stamp it.
4. §5 is the final, notes-incorporated recommendation set.

**Nothing here should be implemented without the owner reading it first.** Two items in particular
(§3.2 dead-code fate, §3.1's reconciliation direction if the numbers do diverge) are product
decisions, not engineering calls this process is authorized to make alone.

---

## 1. What section 3 already does well (so it's not lost in the findings below)

The audit found the section is, on the whole, carefully built:
- Every page that could double-count an image (two decision records per image) explicitly grains
  its aggregation to avoid it, and says so in a doc comment (`markingImpact.ts`, `qualityImpact.ts`).
- Every page that mixes two different denominators (e.g. `portAgreement.ts`'s L1↔L2 agreement over
  the whole population vs. L1/L2-vs-reviewer over the sample only) discloses the split verbatim on
  the slide, not just in a comment.
- Causal-vs-correlation caveats are rendered on every page whose title could be misread as a causal
  claim (`workloadAccuracy.ts`, `markingImpact.ts`).
- `workloadAccuracy.ts`'s scatter chart was deliberately removed in favor of plain tables after
  direct owner feedback ("I want table not graph … this graph make no sense") — evidence this
  section already has a working feedback loop, not just an initial design nobody revisited.
- No other page repeats the exact defect just fixed on `sourceAgreement.ts` (numeric/abbreviated
  axis where real names would fit, or a chart that's mostly empty with typical data).

This proposal is a small set of pointed follow-ups, not a rewrite.

---

## 2. Per-page catalog (condensed — full detail in the audit transcript)

| Page | Question answered | Data source | Notable design choice |
|---|---|---|---|
| `workloadAccuracy.ts` | Does high volume at a port associate with lower accuracy? | `model.rows` + `model.portAccuracy` | Table-only by owner request; explicitly reuses `portAccuracy` (not `population.byPort`) to avoid disagreeing with a section-2 page |
| `levelAccuracy.ts` | Per port, how accurate is L1 vs. L2 against the reviewer? | `model.factTable` folded by `(port, level)` | Reversed-domain diverging color scale for الفارق, contract-tested |
| `sourceAgreement.ts` | How much do L1/L2 agree with each other, the other 3 teams, and the reviewer? | `model.resultComparison` | Just reworked this session — 2×3 levels×teams grid replaces the old 6×6 numeric heatmap |
| `portAgreement.ts` | Per port, how much do L1/L2 disagree, and how does each match the reviewer? | `model.resultComparison.images` folded by port | Discloses its two-different-denominators split verbatim on the slide |
| `markingImpact.ts` | Does a تحديد marking predict accuracy? | `model.rows`, image-grain | Widest single Ledger table in the deck, self-documented as such |
| `qualityImpact.ts` | Does image quality track with accuracy? | `model.rows`, image-grain, 3 fixed strata | Three genuinely distinct bases, each labelled at its own point of use |

---

## 3. Findings and proposed actions

### 3.1 `levelAccuracy.ts` and `portAgreement.ts` compute what looks like the same per-port statistic via two independent code paths (highest priority)

**Finding.** `levelAccuracy.ts`'s per-port "دقة المستوى الأول/الثاني" is
`rateOf(correctClean + correctSuspicion, evaluable)`, where the denominator is "a reviewer verdict
exists" (`outcomeClass !== null`, computed purely from `classifyOutcome(employeeDecision,
studyReviewResult)`). `portAgreement.ts`'s per-port "مطابقة الأول/الثاني للمراجع" is
`l1RevAgree / l1RevComparable` from `model.resultComparison.images`, computed as
`levelOne === review` over images where `review !== null`. Since `ExecutiveReportRow.levelOneResult`/
`levelTwoResult` are non-nullable, both pages appear to fold the same population (every reviewed
image, per port) with the same "level result equals reviewer result" numerator — just reached by
two independently-written aggregation paths and shown under two different labels ("دقة" vs.
"مطابقة") on two different slides. Neither file's header comment acknowledges the other; only
`portAgreement.ts` pre-empts confusion with `sourceAgreement.ts` specifically, not with
`levelAccuracy.ts`.

**Why this matters.** If a reader compares the two pages and sees numbers that don't match, they
have no way to know whether that's expected (a real, documented difference in scope) or a bug in
one of the two aggregation paths. Right now there is a real, unverified risk of silent divergence:
`levelAccuracy.ts`'s gate (`outcomeClass !== null`) is not provably identical to `portAgreement.ts`'s
gate (`review !== null`) — the audit flagged that `decisionEvaluable`-style stricter gates elsewhere
in the codebase also check `imageAvailable === true` and `inspectorId !== null`, which `outcomeClass`
alone may or may not enforce. This needs to be checked before deciding what to do about it.

**Proposed action (in order):**
1. **Write a reconciliation check first, before touching either page.** A small script or test that
   builds `ReportModel` from a shared fixture and asserts, per port, that `levelAccuracy`'s L1/L2
   accuracy figures equal `portAgreement`'s L1/L2-vs-reviewer match figures. Run it against both a
   synthetic edge-case fixture (images with a decision but no `inspectorId`, images marked
   unavailable, etc.) and, if feasible, a real production month's data.
2. **If they never diverge:** the two pages are legitimately showing the same fact from two angles
   (per-level summary vs. per-port drill-down) — add a one-line cross-reference comment in each
   file's header pointing at the other, so a future editor knows the overlap is intentional and
   verified, not an oversight. No behavior change.
3. **If they do diverge on some inputs:** this is the point where a decision is needed on which
   semantics is "correct" (this is a product/domain question — does "reviewed" mean has a verdict,
   or does it also require `inspectorId`/`imageAvailable`?) — surface the specific diverging cases
   to the owner rather than picking one path to keep unilaterally.

**Explicitly not proposed:** deleting either page, or silently changing one page's aggregation to
match the other's, without doing step 1 first.

### 3.2 `Aggregates.byStage` / `Aggregates.byMovement` are computed, tested, and never surfaced anywhere

**Finding.** `model/aggregates.ts` folds the fact table by `stage` and by `movementType` using the
exact same `foldBy` helper section 3 already uses for `byPort` — and `model.test.ts` asserts their
totals reconcile — but `ReportModel`'s own type never exposes a `byStage`/`byMovement` accuracy
field, so no page (not just no section-3 page) can read them. This is distinct from
`model.population.byStage`, which is population/coverage counts with no accuracy dimension at all.

**Why this matters.** This is pure dead computation running on every report generation with zero
consumers. Left alone, its semantics can silently drift out of sync with what a future page would
actually need, so if someone does try to wire it up later they may find it's already stale or
subtly wrong for the purpose they have in mind.

**Proposed action — genuinely a product decision, presented as two options rather than a
recommendation:**
- **(a) Surface it.** The exact per-port pattern `levelAccuracy.ts`/`workloadAccuracy.ts` already
  use could be reused for a "accuracy by risk stage" or "accuracy by movement type" cut — if
  there's an analytical reason those breakdowns matter (e.g. "is our risk-engine targeting actually
  correlating with catch rate by stage" reads as a genuinely useful question this report doesn't
  currently answer). This would be a new 7th section-3 page or a variant addition to an existing one.
- **(b) Remove it.** If there's no near-term plan to surface either breakdown, delete the dead
  `byStage`/`byMovement` folds from `aggregates.ts` (and their `model.test.ts` assertions) — YAGNI,
  keeps the aggregation layer's surface area matched to what's actually used.

This proposal leans toward (b) by default per this codebase's own stated YAGNI convention, but
flags it explicitly for the owner rather than doing it unasked, since "is there a future need for
this" is not something this process can determine on its own.

### 3.3 `portAgreement.ts`'s 6-column table is the densest in the section — worth a scale spot-check (lower priority)

**Finding.** `portAgreement.ts` fits 6 data columns into the same half-width card other section-3
pages use for 5, with compact-mode font down to `0.54rem`/`0.56rem`. This is self-acknowledged in
the file's own doc comment and was evidently already tuned in a 2026-07-25 CSS pass — not an
oversight, but the audit only verified it against demo-scale data (a handful of ports), not a
realistic production port count.

**Proposed action.** A quick verification pass — render this page with a synthetic fixture at
realistic production port counts (20-30+ ports) and confirm the compact tier is still legible, not
just that it fits its box. No code change proposed unless that check finds an actual problem.

### 3.4 `sourceAgreement.ts`'s new level1↔level2 stat and `portAgreement.ts`'s headline metric overlap conceptually (lowest priority)

**Finding.** The new standalone "توافق المستوى الأول مع الثاني" callout on `sourceAgreement.ts`
(month-wide) sits close in meaning to `portAgreement.ts`'s own pooled headline ("اتفاق
المستويين"). This reads as legitimate overview-vs-drill-down layering (an overall figure next to
its own per-port breakdown, a pattern already used elsewhere in the deck), not a duplication bug —
flagged only because a reader could wonder whether the two numbers are supposed to match exactly.

**Proposed action.** A one-line cross-reference comment in either file. No behavior change.

### 3.5 Not proposed for action, noted for awareness only

`model.reviewerKpis` (per-reviewer SPC p-charts, throughput, turnaround, referral rate) and
`model.errorAnalysis` (error-type breakdown by port) are both computed and used by the *old* deck
and the workbook/document builders, but appear nowhere in deck2 at all. This doesn't fit section 3's
current question set, so it isn't a section-3 gap — but if the owner has been assuming the reviewer
SPC charts exist somewhere in the new deck, they currently don't. Worth a one-line mention, not a
proposed change.

---

## 4. Independent model review

Two independent review passes (Opus 5, then Fable 5 — neither saw the other's notes) were run
against the §3 draft above. Both verified every factual citation in §1–§3 against source rather
than trusting this document, and both went further: each independently re-read 2-3 of the pages
this draft had cleared with "no findings," specifically to stress-test that clean bill of health.

**Both reviewers converged, independently, on the same two defects this draft's audit pass missed**
— which is strong evidence these are real, not an artifact of one model's reading:

1. **A determinism violation in `portAgreement.ts:177`** — `a.name.localeCompare(b.name, "ar")` as
   a tiebreaker, while the file's own header (`:24-25`) promises byte-identical output for the same
   input, and its two sibling pages (`levelAccuracy.ts:164-166`, `workloadAccuracy.ts:106-109`)
   explicitly document avoiding `localeCompare` for exactly this reason ("so the order cannot drift
   with the host's ICU data"). It only fires on full ties (rankability + rate + comparable count all
   equal), but it is the only `localeCompare` call in production deck2 code, contradicts this file's
   own documented contract, and is a one-line fix.

2. **The section's own stated sufficiency-gating discipline — "a rate is only shown when its own
   comparable count is rankable" — is followed by only 2 of 6 pages (`portAgreement.ts`,
   `sourceAgreement.ts`) and violated for a secondary rate in the other 4** (`workloadAccuracy.ts`,
   `levelAccuracy.ts`, `markingImpact.ts`, `qualityImpact.ts`). In each case a secondary rate (e.g.
   "missed-suspicion rate," "detection rate") is gated on the page's primary/arm-level count instead
   of that specific rate's own, smaller denominator — so a small-sample percentage can be published
   when it should be suppressed under the section's own rule. **This is independently confirmed with
   concrete evidence, not just a code-reading concern:** `markingImpact.test.ts:271` is a passing
   test, explicitly titled *"prints the per-arm detection rate through the denominator-gated
   helper,"* that asserts `85.7%` is published for a detection rate whose actual denominator is
   `correctSusp(6) + missedSusp(1) = 7` (fixture at `markingImpact.test.ts:150`). `band(7)` is
   `"insufficient"` (threshold table: 1–9 = insufficient, `model/dataSufficiency.ts:11,30`) — not
   rankable — while the gate actually used is the arm's own total (20 images), which clears the cut.
   The 85.7% is real output, sitting next to a printed «العيّنة 20» that has nothing to do with the
   7 images the 85.7% is actually computed from. I re-derived this independently (third confirmation,
   not just trusting either reviewer's citation).

Both reviewers also independently concluded §3.1's proposed empirical-reconciliation step is
unnecessary — the equivalence between `levelAccuracy.ts` and `portAgreement.ts`'s per-port figures
is provable directly from the type definitions (`levelOneResult`/`levelTwoResult` are non-nullable,
`classifyOutcome` returns `null` iff `reviewResult === null`, both derive from the same rows) — so
step 1 of §3.1's original plan (build a reconciliation harness, run against production data) is
replaced below with a much cheaper equivalent (one regression test).

Where the two reviewers disagreed with each other or added distinct findings, both are recorded:
- **Fable 5** additionally found that `levelAccuracy.ts` and `portAgreement.ts` can show *different
  port lists* (a port with zero reviewed images is entirely absent from `levelAccuracy` but present
  in `portAgreement` with muted reviewer columns) — a real, if minor, display-level asymmetry beyond
  the numeric-equivalence question §3.1 originally focused on.
- **Opus 5** additionally found: (a) `markingImpact.ts`/`qualityImpact.ts`'s image-grain
  "OR-combined" accuracy figure is a *different statistic* from `workloadAccuracy.ts`/
  `levelAccuracy.ts`'s decision-grain accuracy — both labelled «الدقة» with no disclosure that they
  measure different things, and systematically diverge (image-grain reads higher) whenever the two
  levels disagree with each other but not both with the reviewer; (b) deck2 never reads
  `model.dataQuality`/`model.employeeOverview` at all (no BI-unmapped/data-quality disclosure
  anywhere in the new deck, though both the old deck and the Reports tab have one); (c) a latent
  config-threshold divergence (`band()` calls in section 3 always use
  `DEFAULT_DATA_SUFFICIENCY_THRESHOLDS`, ignoring `config.dataSufficiencyThresholds`, currently
  harmless since every real call site passes the default config, but silently would desync if that
  ever changes); (d) `workloadAccuracy.ts:26-28`'s own header claims "no percentage is ever shown
  without its denominator," which the same secondary-rate gating gap falsifies for that page
  specifically.

Both reviewers confirmed §3.2 and §3.5 as originally stated, agreed §3.4 needs no code change (just
a clearer comment), and both flagged §3.3's originally-proposed "20-30 ports" check as targeting a
render state the pagination logic can't actually reach — `planPortPages` only enables the compact
tier when the larger of land/sea hits 8–10 ports (`slideKit.ts:556,566,570-580`); the check should
target that range specifically, not a larger count.

Both reviewers explicitly confirmed nothing here contradicts this codebase's own established
conventions (owner's "table not graph" feedback, YAGNI, byte-determinism, product decisions staying
with the owner) — if anything, the two new findings (M1 label-collision, M2 gating gap) are examples
of an *existing* convention (own-denominator gating, stated in this section's own header comments)
not being followed everywhere it's stated to apply.

---

## 5. Final recommendation set (post-review)

Ranked by both reviewers' converging assessment of actual risk/value, not by this document's
original (now superseded) ordering:

1. **Decide how to handle the two different «الدقة» definitions in section 3** (image-grain
   OR-combined in `markingImpact.ts`/`qualityImpact.ts` vs. decision-grain in
   `workloadAccuracy.ts`/`levelAccuracy.ts`). **Owner decision required** — this is a
   labeling/disclosure question, not a pure engineering call: either add a footnote/label
   distinguishing the two statistics on the two pages that use the image-grain version, or switch
   those two pages to the per-level `levelOneAccurate`/`levelTwoAccurate` fields already present on
   `ExecutiveReportRow` if decision-grain is what should be shown everywhere. **Not** a request to
   add a new chart (stays consistent with the owner's standing "table not graph" preference).
2. **Fix the sufficiency-gating gap: 4 of 6 pages gate a secondary rate on the wrong (larger) count
   instead of that rate's own denominator**, letting small-sample percentages through unsuppressed —
   confirmed with a concrete passing-test example (`markingImpact.test.ts:271`, `85.7%` published off
   a real denominator of 7, which the section's own threshold table marks "insufficient"). Two
   possible fixes, needs an owner call on which: (a) gate each secondary rate on `band()` of its own
   denominator (matching what `portAgreement.ts`/`sourceAgreement.ts` already do correctly), or (b)
   keep the current gate but always print the rate's own denominator alongside it (as
   `qualityImpact.ts` partially already does) so a reader can judge reliability themselves. Affects
   `workloadAccuracy.ts`, `levelAccuracy.ts`, `markingImpact.ts`, `qualityImpact.ts` — behavior
   change, needs updated test expectations (e.g. `markingImpact.test.ts:271`,
   `qualityImpact.test.ts:687-693` per this codebase's "characterize current output before changing"
   discipline) and its own edit-log entry.
3. **Fix `portAgreement.ts:177`'s `localeCompare` tiebreak** — replace with the same plain
   codepoint/ordinal compare its sibling pages already use (`levelAccuracy.ts:164-166`,
   `workloadAccuracy.ts:106-109`), restoring the byte-determinism this file's own header already
   claims. One line, low risk, no product decision needed — safe to do without further owner sign-off
   beyond this document, if the owner wants it done opportunistically.
4. **`levelAccuracy.ts` ↔ `portAgreement.ts` per-port figure overlap** — now downgraded from "needs
   investigation" to "provably the same statistic, needs disclosure": add a one-line cross-reference
   comment in both files (plus `workloadAccuracy.ts`, which pools the same figure — a three-way
   reference, not two) explaining the relationship, and a single regression test asserting the
   per-port equality as a guard against future drift. No behavior change. Also note the port-list
   asymmetry Fable 5 found (a zero-reviewed-images port appears on one page but not the other) in the
   same comment, since it's a real, explainable, but currently undocumented difference.
5. **`Aggregates.byStage`/`byMovement` dead-code fate** — unchanged from §3.2, still an owner
   decision between surfacing or removing. Both reviewers leaned toward removal (YAGNI, plus one
   reviewer's additional point: a "the four risk levels are detection scenarios, not a severity
   ranking" project convention makes a stage-ranked accuracy page a specific misreading risk, not a
   neutral feature request).
6. **Latent config-threshold divergence** (`band()` always using default thresholds regardless of
   `config.dataSufficiencyThresholds`) — awareness note only, harmless today, worth a comment or a
   follow-up if/when threshold overrides ship.
7. **`sourceAgreement.ts` ↔ `portAgreement.ts` level1↔level2 overlap** — comment-only, as originally
   proposed, but the comment should now say plainly that they're the same number by construction
   (both derive from the same per-image pair), not just "conceptually close."
8. **`portAgreement.ts` density spot-check** — rescoped from "20-30 ports" to specifically 8-10 ports
   in the larger of the land/sea groups (the actual range that triggers the compact CSS tier per
   `slideKit.ts`'s pagination logic) — the original range would never have exercised the tier it was
   meant to test.
9. **Awareness-only, no action proposed:** `reviewerKpis`/`errorAnalysis` absent from deck2 entirely
   (unchanged from §3.5); deck2 also never reads `model.dataQuality`/`model.employeeOverview` at all,
   meaning there is currently no BI-unmapped/data-quality disclosure anywhere in the new deck, though
   both the old deck and the Reports tab have one — flagging in case the owner is assuming parity
   with the old deck on this point.

**Explicitly deferred to the owner, not decided by this process:** items 1, 2 (which of the two
fixes), and 5 all require a product/domain judgment this review process is not authorized to make
alone. Items 3, 4, and 7 are safe to execute without further owner input if the owner wants them done
opportunistically, since they're comment-only or clearly-correct one-line fixes with no behavior
change to the rendered report (other than the localeCompare fix, whose only possible effect is
resolving an already-nondeterministic tiebreak into a deterministic one — never changing which rows
appear, only tie order in an edge case). **No code has been changed as part of this review — this
document is the complete deliverable for tonight**, per the process boundary already communicated:
implementation of any item here should wait for the owner's read-through, especially items 1 and 2,
which move rendered report output.
