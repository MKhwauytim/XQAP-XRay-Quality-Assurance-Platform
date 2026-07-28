# Deck2 — Source-Agreement Slide, Levels-vs-Teams Matrix — Design Spec

**Date:** 2026-07-28
**Status:** Approved by owner (2026-07-28), pending spec-file review
**Owner:** Reporting / deck2 (`src/data/reporting/executive/deck2/section3/sourceAgreement.ts`)

---

## 1. Problem statement

`slide-s3-source-agreement` ("توافق النتائج بين المستويات والمصادر") renders a 6×6
lower-triangle heatmap of all `C(6,2)=15` source pairs (`levelOne`, `levelTwo`, `manual`,
`opposite`, `liveMeans`, `review`), with column headers reduced to bare numbers `1..6`
because 6 full Arabic source names collide across the chart's top edge. The owner reviewed
the rendered page and found this unreadable: the numeric axis is meaningless without
cross-referencing the row labels, and with real data only 3 of the 15 cells are populated
(the other sources currently have no comparable images this month), so the matrix reads as
mostly empty dashes.

The owner's actual question for this page is narrower than "every source vs every other
source": **how do the two X-ray inspection levels (the report's own primary method) compare
against each of the other inspection teams** — manual, opposite, live-means. Level-vs-level
agreement and level-vs-reviewer agreement are both already answered elsewhere on this same
slide (a standalone stat, and the existing reviewer card, respectively), so folding them
into the same grid was judged redundant rather than helpful.

---

## 2. Data (no new business logic)

All figures still come from `model.resultComparison.crossTeamMatrix` (already computed and
tested by `model/aggregates.ts`) — no new aggregation. The change is which of the existing
15 cells get surfaced in the chart, and how they're indexed.

**New chart data — 2×3 rectangle, directly indexed (no triangle math):**

| | التفتيش اليدوي (`manual`) | التفتيش المعاكس (`opposite`) | الوسائل الحية (`liveMeans`) |
|---|---|---|---|
| **المستوى الأول** (`levelOne`) | `pairAt(levelOne, manual)` | `pairAt(levelOne, opposite)` | `pairAt(levelOne, liveMeans)` |
| **المستوى الثاني** (`levelTwo`) | `pairAt(levelTwo, manual)` | `pairAt(levelTwo, opposite)` | `pairAt(levelTwo, liveMeans)` |

Each cell uses the same `gatedRate(cell.comparable, cell.agreementRate)` sufficiency gate as
today (muted "—" below the rankability cut) and the same `cell.comparable` count.

**New standalone stat — level1↔level2:**

Pulled from `pairAt(levelOne, levelTwo)` (today's single highest-value cell, 97% in the
owner's sample data): rate via `gatedRate`, count via `cell.comparable`. Rendered as a small
bordered callout above the grid — icon + `"توافق المستوى الأول مع الثاني: {rate} · {n} صورة"`
— not a grid cell, since it's a different comparison kind (level-vs-level, not
level-vs-team).

**Dropped from this chart** (still available elsewhere): `review` column (level-vs-reviewer
numbers already live in the adjacent reviewer card — see §5), and all pairs not involving a
level (`manual`↔`opposite`, `manual`↔`liveMeans`, `opposite`↔`liveMeans`) — these remain
visible in the Ledger variant's existing 15-row pair table (§4).

---

## 3. New chart component shape

Rows (2) ≠ columns (3), so this is a genuine rectangle, not a symmetric matrix — the
lower-triangle indexing (`ci < ri`), the `SOURCE_ORDER`-based numbering, and the "why numbers
not names" doc comment all go away entirely for this chart. `percentHeatmap` (the shared,
already-tested primitive) is still reused — same 2-tone tint scale, same gold/primary tones,
same legend copy (`"توافق أعلى"` / `"توافق أقل"`) — just called with:

- `rows: ["المستوى الأول", "المستوى الثاني"]`
- `cols: ["التفتيش اليدوي", "التفتيش المعاكس", "الوسائل الحية"]` (real names — 3 columns has
  room where 6 didn't)
- `values`: the 2×3 grid above

Because `percentHeatmap`'s cell text is percentage-only by contract (no per-cell
annotation), the sample count (ن) companion table is kept but shrinks from a 6×6 triangle to
a plain 2×3 table — same pattern as today (`comparableGrid`), simplified since there's no
triangle/void-cell logic needed anymore.

---

## 4. Where this applies (per-variant scope)

| Variant | Change |
|---|---|
| Default/port (`pageBody` → `matrixCard`) | Full rework: 2×3 heatmap + level1↔2 stat callout + 2×3 counts table, replacing the 6×6 heatmap + ن triangle. |
| Grid (`gridBody` → `matrixPanel`) | Same rework — it renders the identical `percentHeatmap` chart with the identical data, so it has the identical problem. |
| Ledger (`ledgerBody` → `pairsLedgerCard`) | **Untouched.** Already a plain 15-row table (no chart), wasn't flagged as confusing, and keeping full 15-pair coverage visible somewhere in the deck is useful. |
| Briefing (`briefingBody`) | **Untouched.** No matrix chart today (rank list over the same 15 pairs); not flagged. |

The reviewer card (`reviewerCard` / `ledgerReviewerTable` / `gridReviewerMatrix`) is
**untouched** in every variant — still all 5 non-reviewer sources (including both levels) vs.
the reviewer.

---

## 5. Why no `review` column in the new grid

The reviewer card sitting immediately next to this chart already shows level1-vs-reviewer
and level2-vs-reviewer (its first two rows). Repeating those same two numbers inside the new
grid would duplicate information the owner is already looking at one glance away, so the new
grid's scope is deliberately "levels vs. the three non-reviewer teams" only.

---

## 6. Code/complexity impact

Net simplification, not just a relabel:

- Removed: `SOURCE_ORDER`-walking `buildHeatMatrix` lower-triangle logic (for this chart's
  two call sites only — `orderedPairs`/`pairsLedgerCard`/Briefing's use of the full 15-pair
  walk stay as they are, since Ledger/Briefing are unchanged), the numeric column-label
  comment block, the triangle `comparableGrid` void-cell branching for this chart.
- Added: a small direct 2×3 lookup helper, the level1↔2 stat callout markup + minimal
  page-local CSS (a bordered pill, consistent with `.s3sa-foot`'s existing look rather than
  inventing a new visual language), a plain 2×3 counts table (reusing `.s3sa-ngrid`'s cell/
  border styling, dropping only the void-cell/triangle-specific rules).
- `SOURCE_AGREEMENT_CSS`: triangle-specific rules (`.s3sa-void`) become unused for the
  default/Grid chart's counts table (still fine to keep `.s3sa-ngrid` itself, since Ledger's
  table doesn't use it and nothing else references `.s3sa-void` after this change — confirm
  during implementation and delete truly-dead CSS rather than leaving it).

---

## 7. Testing

- Existing `sourceAgreement.test.ts` assertions about the 6×6 matrix (numeric columns,
  `SOURCE_ORDER`-based row count, triangle void cells) for the default and Grid variants
  need updating to assert the new 2×3 shape, the 3 real column labels, and the level1↔2 stat
  callout's presence/values.
- Assertions covering Ledger's 15-row pair table, the "15-row Ledger budget" describe block,
  and Briefing's rank list are **unaffected** (those variants are unchanged) and must
  continue passing unmodified.
- Add a case for the sufficiency-gate boundary on the new 2×3 grid (a `manual`/`opposite`/
  `liveMeans` cell below the rankability cut still renders muted "—", same as today).
- Add a case for the level1↔2 stat when `pairAt(levelOne, levelTwo)` is itself gated out
  (comparable count below the cut) — callout should show "—", never a fabricated rate.

---

## 8. Out of scope (explicitly deferred, per owner's answers)

- General font/spacing pass on this page — owner confirmed the confusing chart was the core
  readability complaint, not text size or overall density.
- Restructuring Ledger's pair table to match the new 2×3 scope — owner chose to keep Ledger's
  full 15-pair coverage as-is.
- Any change to the reviewer card in any variant.
