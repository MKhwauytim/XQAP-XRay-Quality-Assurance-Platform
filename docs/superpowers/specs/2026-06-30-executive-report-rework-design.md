# Executive Report Rework — Design Spec

**Date:** 2026-06-30
**Status:** Approved design (pending user review of this document)
**Owner:** Reporting (`src/data/reporting/executive/`)

> Companion reference: the user's "Executive X-Ray Quality Assurance Report" master
> description (report concept, mockup register, data inventory, processing logic, and
> analytical rules). That document is the **content/requirements** source of truth; this
> document is the **engineering design** for delivering it.
>
> **Content blueprint:** the page-by-page (document) / slide-by-slide (deck) structure,
> narrative spine, and analytical method catalog live in
> [`2026-06-30-executive-report-content-blueprint.md`](./2026-06-30-executive-report-content-blueprint.md).
> **Spine:** we judge **L1/L2 accuracy**; the QA reviewer is the gold standard; other teams
> are **corroborating evidence**. Executive lens = **security-risk first** (Missed Suspicion
> is the headline). Every analytical page/slide is **layered**: 5-second headline on top,
> advanced depth below.

---

## 1. Problem statement

The current executive report renders as a single dark-navy HTML "viewer" (~25 slide
pages) plus a 6-sheet XLSX. The higher-ups / audited departments are the audience, and
the current output reads as "AI-made": random/wasteful whitespace, emoji glyphs instead
of icons, a childish presentation feel, and metrics computed ad-hoc in multiple places.

The deliverable is **three artifacts driven from one analytical layer**:

1. **The Document** — full, detailed, A4-portrait report (HTML → print-perfect PDF).
2. **The Presentation** — curated, higher-level slide deck (HTML → 16:9 landscape PDF).
3. **The Workbook** — real `.xlsx` carrying raw → processed → analytical data.

### Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Output formats | Print-perfect **HTML → PDF** for document + deck; **real `.xlsx`** for data. No Office (.pptx/.docx) generation. |
| Document vs deck | **Deck = curated highlights** (e.g. top-5 employees per port, key decisions) for fast decisions in a live meeting. **Document = full detail** (all employees, all ports, full analysis). |
| Build strategy | **Evolve** the engine. Keep the proven KPI math; rebuild the analytical *granularity* and the *visual/layout* system. |
| Charts | **Static inline SVG** chart primitives (optionally using `d3-shape`/`d3-scale` for path/scale math). No runtime chart library, no canvas — print-safe and on-brand. |
| Employee identity | Inspector (L1/L2) accuracy keyed off **system IDs from BI mapping** (shown as IDs, never real names). Reviewers (app users) shown as display names only in workload/distribution context. |
| Spec's May-2026 numbers | Used as **unit-test fixtures only**. All report content is driven from live system data. |
| Result sources | **Five result sources per image** (L1, L2, manual inspection, opposite inspection, live means) + the **study reviewer** (QA gold standard). All carried and compared per image; each team's agreement-vs-reviewer is computed. |
| Audit depth | **Employee-level accountability is L1/L2 only** (our inspection). Other teams contribute their *answer* for comparison; we do **not** build per-employee pages/priority actions for them (they often lack employee identity and are out of audit scope). |
| Data fix location | The 3 dropped result sources are recovered **at the source** — revise the population pipeline + `PreparedPopulationRow` + saved `population.final.json` (versioned schema migration), not via a report-only workaround. |

---

## 2. Architecture overview

```text
                 ┌─────────────────────────────────────────────┐
   live data ───▶│  Analytical layer  (compute ONCE)           │
   (population,  │  decisionFactTable → aggregates → ReportModel│
    sample,      └─────────────────────────────────────────────┘
    distribution,                 │
    answers,        ┌─────────────┼─────────────┐
    template,       ▼             ▼             ▼
    BI)        Document        Deck         Workbook
            (A4 portrait)  (16:9 land.)    (.xlsx)
              HTML→PDF       HTML→PDF      raw+processed
```

**Governing principle (from the master description §22):** the report must never blur
`cases`, `assignments`, `events`, `employee decisions`, `review responses`, and
`evaluable decisions`. Each metric is computed once in the analytical layer and reused;
renderers display validated data, they do not recompute.

---

## 2.5 Result-source model & data-pipeline revision (prerequisite)

The data carries **five independent result sources per image**, plus the study reviewer's
verdict. Three of the five are normalized but **dropped** before reaching
`PreparedPopulationRow`. The comparison the report needs ("our L1/L2 vs other teams vs the
reviewer") therefore requires fixing the **pipeline**, not just the renderer.

### 2.5.1 The result sources ("teams")

| Key | Arabic | Risk column | BI result (+ code) | BI employee | Role |
|---|---|---|---|---|---|
| `levelOne` | المستوى الأول | `نتيجة المستوى الأول` | ✅ `levelOneResult` | ✅ `levelOneEmployee` | **ours (audited)** |
| `levelTwo` | المستوى الثاني | `نتيجة المستوى الثاني` | ✅ `levelTwoResult` | ✅ `levelTwoEmployee` | **ours (audited)** |
| `manual` | التفتيش اليدوي / المعاين | `نتيجة المعاين` | ✅ `manualInspectionResult` | ✖ none | other team (answer only) |
| `opposite` | التفتيش المعاكس | `نتيجة المفتش المعاكس` | ✅ `oppositeInspectionResult` | ✅ `oppositeInspectionEmployee` | other team (answer only) |
| `liveMeans` | الوسائل الحية | `نتيجة الوسائل الحية` | ✅ `liveMeansResult` | ✅ `liveMeansEmployee` | other team (answer only) |
| `review` | نتيجة المراجعة | — (inspection answers) | reviewer = app user | — | **QA gold standard** |

`notes` (`ملاحظة المستويات`) and the per-source result **codes** are also carried for
traceability.

### 2.5.2 Pipeline changes (population layer — `src/components/Sidebar/Tabs/Population/`)

1. **`PreparedPopulationRow`** (`src/data/population/populationTypes.ts`) gains a normalized
   `results` panel — for each non-L1/L2 source: `{ result: "سليمة"|"اشتباه"|null, code, employeeId }`.
   L1/L2 keep their existing fields. Each source's result runs through the existing
   `normalizeResultValue` so all teams use the same سليمة/اشتباه domain.
2. **`toPreparedDraftRow` + `enrichDraftRowFromBi`** (`populationProcessor.ts`): carry the three
   risk results; BI-enrich each source's result/code/employee when blank (mirroring the
   existing L1/L2 enrichment). The other sources are **optional** — a blank result is `null`,
   never a reason to drop the row (the existing L1/L2 validity gate at line 680 is unchanged).
3. **Schema migration:** bump `population.final.json` `schemaVersion` via `JsonEnvelope`;
   old files without the `results` panel read back with all other-team sources as `null`
   (graceful — they simply show `—` in comparisons).
4. **XLSX/exporters** that mirror the population (`populationExporter.ts`, workbook rows)
   gain the new columns.

Tests: extend `populationProcessor.test.ts` to assert the three results survive, BI
enrichment fills them, and a blank other-team result does not exclude the row.

---

## 3. The analytical layer (foundation)

New folder: **`src/data/reporting/executive/model/`**

Today the report is **image-centric**: `buildExecutiveReportRows` produces one row per
X-ray with `levelOneResult` / `levelTwoResult` collapsed into a single `imageResult` and
one `expertResult`. The master description §8 requires a **decision-level fact table** —
up to two records per case (L1 + L2), each owned by an employee — which is what makes the
port-by-port employee analysis and the deck's "top-N employees" correct.

Two distinct granularities, both built here:

- **Image-level result panel** (`ImageResultComparison`) — all six sources side by side for
  one image, used for the multi-team comparison and agreement analytics (§2.5).
- **Decision-level fact table** (`DecisionRecord`) — one record per **L1/L2** decision,
  used for employee accountability. We do **not** emit decision records for the other
  teams (audit scope is L1/L2 only), though their answers feed the image-level comparison.

### 3.1 `decisionFactTable.ts`

Explodes each `ExecutiveReportRow` into 1–2 `DecisionRecord`s:

```ts
type DecisionRecord = {
  periodId: string;
  xrayImageId: string;
  portCode: string | null;
  portName: string | null;
  portType: string | null;
  movementType: string | null;      // افراد / بري / عبور / بحري  (master §4.5)
  stage: string | null;
  decisionLevel: "LEVEL_1" | "LEVEL_2";
  inspectorId: string | null;        // levelOneEmployee / levelTwoEmployee (BI-mapped ID)
  employeeDecision: "سليمة" | "اشتباه";
  studyReviewResult: "سليمة" | "اشتباه" | null;
  imageAvailable: boolean | null;
  markingAvailable: boolean | null;
  imageQuality: "عالي" | "متوسط" | "منخفض" | null;
  reviewCompleted: boolean;
  decisionEvaluable: boolean;        // master §9 evaluability rule
  outcomeClass:
    | "correct-clean" | "correct-suspicion"
    | "missed-suspicion" | "false-suspicion" | null;
  reviewerId: string | null;         // assignedTo (app user) — workload context only
  assignedAt: string | null;
  completedAt: string | null;
  sourceRowNumber: number;
  dataSufficiencyGroup: "sufficient" | "limited" | "insufficient" | "none";
};

type ResultSource = "levelOne" | "levelTwo" | "manual" | "opposite" | "liveMeans" | "review";

type ImageResultComparison = {
  xrayImageId: string;
  portName: string | null;
  results: Record<ResultSource, "سليمة" | "اشتباه" | null>;  // null = team didn't act → "—"
  // agreement of each non-review source with the reviewer (when both present):
  agreesWithReview: Partial<Record<Exclude<ResultSource, "review">, boolean | null>>;
};
```

`aggregates.ts` rolls `ImageResultComparison` into two agreement views:

- **Reviewer-focused (primary, exec-facing):** each team vs the QA reviewer — agree /
  disagree / N-A, with missed-suspicion and false-suspicion per team. This is the headline
  used on the deck and the lead comparison page.
- **Full N×N cross-team matrix:** every team vs every other team (incl. L1 vs L2). Denser;
  lives on its own document page and the workbook's Cross-team Agreement sheet, not the deck.

Agreement is only counted on images where **both** sources compared have a result; missing
sources render `—`, never `0%`. Population entry still **requires valid L1 and L2** (the
existing gate is unchanged); other-team results remain optional context.

**Outcome classification (master §9):** the existing `verificationCategory` already
encodes this at the image level; the fact table re-applies it per decision level so L1 and
L2 are scored independently. Terminology is aligned to the master glossary:
`excess-suspicious` → **False Suspicion** (دقة قرار الاشتباه denominator), `missed-suspicious`
→ **Missed Suspicion**.

### 3.2 `dataSufficiency.ts`

Replaces today's single `minimumReliableSampleSize: 30` boolean with the four-band rule
(master §10), applied to any unit (employee, port, stage):

| Evaluable decisions | Band |
|---|---|
| 0 | `none` — display `—`, never `0%` |
| 1–9 | `insufficient` — never ranked top/bottom |
| 10–19 | `limited` — shown with caveat |
| 20+ | `sufficient` |

Thresholds live in `ExecutiveReportConfig` (overridable; master notes final thresholds
need management approval).

### 3.3 `aggregates.ts`

Folds the fact table into every aggregate the master §13 lists: population by port /
stage / movement; original results by level; sample by port & stage; completion;
accuracy by port & stage; image quality by port; **employee by port and level**; error
types by employee & port; text-category summaries (see §3.5). Reuses the existing
`calculateExecutiveKPIs` math where correct; moves employee aggregation out of the
ad-hoc `buildEmployeeProfiles` into this layer so document, deck, and workbook share it.

### 3.4 Employee identity model (critical)

Two distinct populations, never conflated (master §22):

- **Inspectors** — the L1/L2 decision-makers under audit. Identity = `inspectorId`
  (`levelOneEmployee` / `levelTwoEmployee`), populated by **BI enrichment**. Shown as
  **system IDs**, never real names. Employee **accuracy** pages key off this.
- **Reviewers** — app users who recorded the study result (`assignedTo` / `answeredBy`).
  Shown as **display names**, but only in **workload / distribution** context, not as
  "inspection accuracy."

**Current-state behavior:** BI did not match this period, so `inspectorId` is `null`
everywhere. Employee-accuracy pages must render an explicit
**"هوية المفتش غير مرتبطة (لم تتم مطابقة BI)"** empty-state — not fabricated names and not
reviewer data mislabeled as inspector accuracy. When BI mapping lands (future: mapping
into risk data), the same pages populate automatically. This matches the master's
limitation #8 and the BI rules in §4.7 / §5 step 5.

### 3.5 Free-text taxonomy (master §15)

`suspectedTypes` and `smuggleMethod` are raw free text today. Add a light normalization
(`textTaxonomy.ts`): preserve original, trim, normalize Arabic variants, map to an
approved taxonomy with an `Unclassified` bucket and stored mapping confidence + taxonomy
version. Many-to-many preserved. No destructive rewriting.

### 3.6 `reportModel.ts`

Assembles one typed `ReportModel` (the in-memory equivalent of the master §14
`report.*.json` files): `summary`, `population`, `sample`, `distribution`, `portAccuracy`,
`imageQuality`, `employeeOverview`, `employeeByPort`, `errorAnalysis`, `actions`,
`exclusions`, `dataQuality`. Built once per generation, passed to all three renderers.

### 3.7 Missing / zero / N-A discipline (master §16)

A formatting contract enforced in the analytical layer and helpers:

| Meaning | Render |
|---|---|
| Missing / unavailable | `—` |
| True zero | `0` |
| Not applicable | `N/A` (or approved Arabic) |
| Insufficient volume | `بيانات غير كافية` |

`fmtPct(null)` already returns `—`; audit every call site so an empty denominator never
prints `0%`, and BI-unavailable fields render `—`, not `0`.

---

## 4. The visual / layout system

New: **`src/data/reporting/executive/ui/`** (`icons.ts`, `charts.ts`, `tokens.ts`),
refactoring `theme.ts` and `primitives.ts`.

### 4.1 Kill the auto-scale hack

The current `fitPages()` JS shrinks any overflowing page with `transform: scale()`,
producing inconsistent type sizes and the "random/wasteful" whitespace. **Remove it.**
Replace with **fixed A4 page boxes and a per-page content budget**: each page is composed
to fit by design; long tables paginate explicitly (a `paginateRows()` helper splits a
table across N pages with repeated headers) rather than being scaled down at runtime.

### 4.2 Icon set (no emoji)

`icons.ts` — a small set of **stroke-based inline-SVG line icons** (shield, port/gate,
scan, gauge, flag, alert, check, layers, users, document, chart). Replaces every emoji
glyph: `⌁` brand mark, `›` / `•` / `◌` bullets, and the emoji `.icon` on dividers. Icons
inherit `currentColor` so they theme with the gold/level palette.

### 4.3 Chart primitives (`charts.ts`)

Static inline SVG, themed, print-safe, no runtime JS:

- horizontal bar / ranked bar (port comparison, reasons)
- donut / gauge (coverage, accuracy KPIs)
- grouped/stacked bars (L1 vs L2, clean vs suspicious by port)
- quadrant scatter (master page 16 — accuracy × detection)
- heatmap (item × method matrix; image-quality × marking)
- sparkline / trend (stability & workload)

Optional helper deps: `d3-shape` (arc/area/line path strings) and `d3-scale` (linear/band
scales) — pure functions, no DOM, tree-shakeable, bundle cleanly into the single-file
build. If they add meaningful weight, fall back to hand-rolled path math (arcs/bars are
simple). Decision deferred to implementation; either way the **output is static SVG**.

### 4.4 Design tokens

`tokens.ts` centralizes the spacing/type scale so pages are consistent. Palette, Somar
font, right-rail, and level colors are already on-spec (master §2.2–2.4) and stay — only
tightened. The light-page print variant remains for any high-density tables.

---

## 5. Deliverable A — The Document

Folder: **`src/data/reporting/executive/document/`** (evolves today's `pages/`).

Full A4-portrait report. **Page-by-page structure is in the content blueprint §2**, organized
into front matter + 5 parts (Scope & Method → Inspection Quality → Corroboration →
Accountability → Risk & Actions) + appendix, one page per port. Every analytical page is
layered (headline visual + advanced depth) and closes with the §21 pattern
(**What the data shows / Why it matters / Required action**).

Key changes vs today:
- Built on `ReportModel`, not recomputed per page.
- Employee-by-port pages keyed on inspector ID + data-sufficiency bands; explicit
  unmapped-BI empty state (per §3.4).
- Emoji → icons; auto-scale → explicit pagination; charts via `charts.ts`.
- `Employee Agreement Matrix` removed (master §12).
- Exclusions page (the 14 dropped rows) + data-quality/limitations appendix (master §17).
- **New: cross-team result comparison section** — a lead page (each team vs the QA
  reviewer, where our L1/L2 calls diverge, missed-suspicion emphasis) plus a dedicated full
  N×N matrix page. Other teams shown by answer only; no employee breakdown.

Print: `@page { size: A4 portrait }`, sidebar hidden, one `.page` per sheet — already in
place; verified after the layout rebuild.

## 6. Deliverable B — The Presentation

Folder: **`src/data/reporting/executive/deck/`** (new).

~14–18 landscape 16:9 slides from the *same* `ReportModel`. **Slide-by-slide structure is
in the content blueprint §3** — same spine, curated to top-N (e.g. top-5 inspectors by
volume), one message + one hero visual + the decision it supports per slide. Big charts,
minimal text. Reviewer/inspector identity rules from §3.4 apply (IDs for inspectors).

Print: `@page { size: 297mm 167mm landscape }` (16:9), one slide per page, no sidebar.

## 7. Deliverable C — The Workbook

File: **`src/data/reporting/executive/workbook/`** (evolves `executiveReport.ts`'s
`buildExecutiveXlsx`).

Expand from 6 processed sheets to the full raw → processed → analytical chain (master
§14):

- **Raw — Risk** (source rows as ingested, from `rawRow` / source sheet)
- **Raw — BI** (BI source rows when present; note unavailable when not)
- **Exclusions** (the dropped rows + reason + source traceability — master §3 step 3)
- **Decision Fact Table** (the §3.1 records — the analytical spine)
- **Result Comparison** (per image: all six sources + per-team agreement-with-reviewer)
- existing processed/aggregate sheets (KPI summary, ports, stages, image quality, result
  quality, all image rows), plus **Employee by Port/Level**, **Error Analysis**, and a
  **Cross-team Agreement** summary sheet.

Inspector columns show IDs; reviewer columns show display names; other-team columns show
their result (+ code, + employee ID when present). Missing/zero/N-A per §3.7.

## 8. Reports-tab integration

The Reports tab exposes **three explicit actions** — "تنزيل التقرير التفصيلي (PDF)",
"تنزيل العرض التنفيذي (PDF)", "تنزيل بيانات التقرير (Excel)" — each building the shared
`ReportModel` once then invoking the matching renderer. Existing single-HTML open flow is
preserved for on-screen review of the document.

---

## 9. Phasing (each independently shippable + verifiable)

0. **Pipeline revision** (§2.5) — carry all 5 result sources + codes + employees through
   `PreparedPopulationRow`, BI enrichment, schema migration, and population exporters.
   Foundational: everything downstream depends on the data existing.
1. **Analytical layer** (§3) — fact table, image result comparison, aggregates +
   cross-team agreement, data-sufficiency, report model, employee-identity split.
   Unit-tested against the master's May-2026 figures as fixtures (population 386, events
   774, stage/port/movement splits, etc.).
2. **Visual system** (§4) — icons, charts, tokens, remove auto-scale, pagination helper.
3. **Document** (§5) — rebuild pages on the new layer (incl. cross-team comparison).
4. **Presentation** (§6) — new curated deck.
5. **Workbook** (§7) — raw + analytical + comparison sheets.

## 10. Testing & verification

- **Unit (Vitest, node env):** pipeline — the 3 other-team results survive processing, BI
  enrichment fills them, and a blank other-team result never excludes a row; population
  schema migration reads old files with other-team sources as `null`. Analytical —
  fact-table explosion (1–2 records/case; same employee at both levels → two records),
  outcome classification truth table (master §9), cross-team agreement (only counted when
  both source + reviewer present), data-sufficiency bands, aggregate reconciliation
  (port/stage/movement totals = population total), missing/zero/N-A formatting. Fixtures
  use `createMemoryDirectory()` and the master's stated numbers as expected values.
- **Render verification:** generate each artifact from a seeded fixture; confirm no
  content overflows the A4/16:9 boundary, no overlap with the right rail, no emoji glyphs,
  no `0%`-on-empty-denominator, page numbers correct (master §18 render checklist).
- **Build:** `npm run build` still emits one self-contained `dist/index.html`; re-check
  bundle size after adding chart helpers (CLAUDE.md gotcha).

## 11. Edit-log compliance

Per CLAUDE.md, every code edit in the implementation phases records a `docs/EDIT_LOG.md`
entry (version bump, before/after). This design doc itself is documentation, not a code
edit. Phase 1 (new analytical layer) is a major addition → minor-to-major version bump at
implementation time.

## 12. Out of scope (YAGNI)

- Generating native `.pptx` / `.docx` (explicitly rejected in favor of HTML→PDF).
- A full free-text ML taxonomy — only deterministic normalization + approved-list mapping
  (master §15) is in scope; ML classification is future work.
- Backend / server rendering — everything stays client-side per the no-backend constraint.
- Multi-reviewer adjudication rules (master §11 step 11) — surfaced as a limitation, not
  implemented, until management approves a rule.
- **Per-employee analysis for the other teams** (manual / opposite / live means) — they
  contribute their answer to the cross-team comparison only. Employee pages, priority
  actions, and accountability remain L1/L2 (our inspection). Their employee IDs are carried
  in the data for future use but not analyzed now.
```
