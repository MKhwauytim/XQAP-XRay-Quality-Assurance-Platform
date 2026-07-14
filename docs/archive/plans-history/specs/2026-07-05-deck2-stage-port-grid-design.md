# deck2: Stage×Port grid pages (population + sample) — Design

**Status:** design approved by user in conversation; not yet implemented.
**Scope:** two NEW slides added to the executive deck v2 (`src/data/reporting/executive/deck2/`),
alongside (not replacing) the existing land/sea port-split slides
(`portPopulationSlideBuilders`, `portSampleSlideBuilders` in `slides.ts`).

## 1. Goal

Add two slides that cross-tabulate **risk stage × port** instead of **land × sea**:

1. **مجتمع حالات الفحص حسب المستوى والمنفذ** — population count per port, grouped into one
   card per risk stage (1–4), 2×2 grid.
2. **عيّنة الفحص المسحوبة حسب المستوى والمنفذ** — sample count + coverage per port, same
   per-stage 2×2 grid.

Reference layout: user-supplied mockup screenshots (4 colored cards — gold/blue/green/coral
for stages 1–4 — each a small table of ports, arranged 2×2). These mockups use placeholder
"00" data and a generic port list; real implementation uses live `model.rows` and real port
names, top-5-by-volume per card.

## 2. Data mapping

### 2.1 Source

Both pages read `model.rows: ExecutiveReportRow[]` (see
`docs/superpowers/specs/executive-report-data-mapping.md` §"ctx.rows" for the full field
reference). Relevant fields per row:

| Field | Used for |
|---|---|
| `row.stage` | Groups the row into one of the 4 stage cards. Matches `model.population.byStage[i].stageLabel` exactly (same source: `executiveReportData.ts`'s stage classification). `null` rows are bucketed under `"غير محدد"` and excluded from the 4 stage cards (there is no 5th card — matches how `riskStagesSlide` already only iterates `model.population.byStage`, which itself excludes unclassified rows). |
| `row.portName` | Groups the row by port within its stage. `null` → `"غير محدد"`. |
| `row.imageResult` | `"سليمة"` / `"اشتباه"` — tallied per (stage, port) for the population page. |
| `row.selectedInSample` | `true` rows also tally into the sample page's per-(stage, port) counts. |

### 2.2 New collector function — `collectStagePortStats(model)`

One new function in `slides.ts`, modeled directly on the existing `collectPortStats` (same
file, ~line 432) but keyed by `stage` instead of `portType`:

```ts
type StagePortRow = {
  name: string;           // port name
  total: number;          // population count for this (stage, port)
  clean: number;
  suspicious: number;
  sampleTotal: number;    // sample count for this (stage, port)
  sampleClean: number;
  sampleSuspicious: number;
};

function collectStagePortStats(model: ReportModel): Map<string /* stageLabel */, StagePortRow[]>
```

Single pass over `model.rows`, same tally logic `collectPortStats` already uses (`total`,
`clean`/`suspicious` from `imageResult`; `sampleTotal`/`sampleClean`/`sampleSuspicious` gated
on `selectedInSample`), keyed by `(row.stage, row.portName)` instead of by land/sea. Ports
within each stage sorted by `total` descending (same sort key `collectPortStats` uses), so
"top port" means the same thing on both new pages.

**Consistency caveat (found during Task 1 review, corrected here):** the original version of
this section claimed the collector's per-stage sums always equal
`model.population.byStage[i].population`/`.sampleSize`, "since both are derived from the same
`model.rows`." That is only true when `StageProfile` is built from `model.rows` directly —
`calculateExecutiveKPIs`'s fallback branch (`executiveReportData.ts` ~line 393), used when
there's no sample or no `stageAllocations`. In the **normal production case**
(`sample.stageAllocations` present — the standard Phase-3 sampling output), `StageProfile.
population`/`.sampleSize` instead come from a `StageAllocation` record **frozen at
sample-draw time** (`executiveReportData.ts` ~line 377, sourced from `sampleAlgorithm.ts`),
not from a fresh count of `model.rows`. `collectStagePortStats` always counts *current*
`model.rows` fresh, so in the production case its sums are **not** guaranteed to equal
`StageProfile`'s numbers — the two can legitimately diverge if population data changed after
the sample was drawn.

**Implication for §2.4/§2.5 (card layout):** to avoid an on-slide inconsistency (a card's
الإجمالي row disagreeing with its own header, or with the "مجتمع الحالات بناءً على المخاطر"
page which already displays `model.population.byStage[i].population`/`.sampleSize` directly),
each card's totals row uses `stage.population`/`stage.sampleSize` (the canonical
`StageProfile` figures — same source already used by `riskStagesSlide` and by this card's own
header) for the **total** column, not a fresh sum over `collectStagePortStats`' ports. The
per-port breakdown rows (top-5) and the total row's **سليمة/اشتباه** split (population page
only — `StageProfile` has no clean/suspicious fields) have no alternative source and
necessarily come from `collectStagePortStats`'s live row counts. This is a deliberate,
documented seam, not an oversight: the total column matches the rest of the deck; the
سليمة/اشتباه split is the best available breakdown and, in the rare case population changed
post-sampling, may not sum to exactly the pinned total.

### 2.3 Per-card top-N

Each stage card is a quarter-slide — too small for all ports (14 in the preview fixture, and
real months will have more). Following this deck's existing "curated top-N, never the full
table" convention (already used by `portTable`, `qualityTable`, `accuracyTable`, and
documented in CLAUDE.md), each card shows:

- **Top 5 ports by population** (`total` descending) for that stage.
- An **الإجمالي** row summing *every* port in that stage (not just the top 5 shown) — so the
  total is always accurate even though the long tail isn't listed individually.

No "متفرقة" (scattered/other) grouping bucket — the mockup's grouped labels
("منافذ برية متفرقة (أ)") are cosmetic filler in the placeholder design, not a data
requirement; the الإجمالي row already accounts for everyone.

### 2.4 Page 1 — مجتمع حالات الفحص حسب المستوى والمنفذ (population)

**Top summary band** (reuses `.v2-totals-band`, same 3-tile pattern already in
`riskStagesSlide`, but with population-page-relevant stats instead of sample/coverage):

| Tile | Value |
|---|---|
| إجمالي المجتمع | `model.population.total` |
| إجمالي سليمة | `sum of row.imageResult === "سليمة"` across all rows |
| إجمالي اشتباه | `sum of row.imageResult === "اشتباه"` across all rows |

**Per stage card** (×4, one per `model.population.byStage` entry, tone/icon from the existing
`STAGE_TONES` array — gold/blue/green/coral, same order already used by `riskStagesSlide`):

- Header: stage icon + `stageLabel` (e.g. "المستوى الأول"), same header style as
  `.v2-stage-card` already has.
- Table, columns **المنفذ | سليمة | اشتباه | الإجمالي** (note: total column is LAST here,
  matching the reference mockup — the existing land/sea `portTable` puts total right after
  the port name; this page's column order deliberately differs to match the reference):
  - Top-5 rows: `port.name`, `port.clean`, `port.suspicious`, `port.total`.
  - `الإجمالي` row: **الإجمالي column is pinned to `stage.population`** (the `StageProfile`
    figure, not a fresh sum) — see the consistency caveat above for why. **سليمة/اشتباه
    columns** are summed across *all* ports in the stage from `collectStagePortStats`' own
    rows (no alternative source exists — `StageProfile` has no clean/suspicious fields).

### 2.5 Page 2 — عيّنة الفحص المسحوبة حسب المستوى والمنفذ (sample)

**Top summary band** — reuses the *exact* 3-tile totals band already in `riskStagesSlide`
(this is a natural fit — it's literally a sample-coverage recap, and the reference mockup's
top band is also a sample/coverage recap):

| Tile | Value |
|---|---|
| إجمالي المجتمع | `model.population.total` |
| إجمالي العيّنة | `model.sample.total` |
| نسبة التغطية | `model.sample.coverage` |

The mockup's 4th tile ("CertScan 0") is omitted — it doesn't map to any field on `ReportModel`
and isn't essential to this page's story; flagged here as an intentional omission, not an
oversight.

**Per stage card** (×4, same tone/icon mapping as page 1):

- Header: stage icon + `stageLabel`, **plus** a big `"{sampleSize} / {population}"` figure
  (matches the reference's "١١ / ١١" style header), sourced from
  `model.population.byStage[i].sampleSize` / `.population` — NOT recomputed from the
  per-port rows, so it always matches the KPI totals shown elsewhere in the deck (e.g. the
  "مجتمع الحالات بناءً على المخاطر" slide) even if a per-port rounding quirk existed.
- Table, columns **المنفذ | مجتمع المرحلة | العيّنة المستهدفة | نسبة التغطية**, as **plain
  numbers** (not the stacked "N من M" `.v2-frac` cell the land/sea sample table uses — the
  reference shows two separate plain columns instead, which is simpler and is what this page
  will do):
  - Top-5 rows: `port.name`, `port.total`, `port.sampleTotal`,
    `fmtPct(port.total > 0 ? port.sampleTotal / port.total * 100 : 0)`.
  - `الإجمالي` row: **مجتمع المرحلة and العيّنة المستهدفة columns are pinned to
    `stage.population`/`stage.sampleSize`** (same figures as the card header, and the same
    consistency reasoning as §2.4's totals row) rather than fresh sums over
    `collectStagePortStats`' ports. **نسبة التغطية** is computed from those same two pinned
    figures (`sampleSize / population * 100`), so all three totals-row cells and the header
    figure are internally consistent by construction — none of them depend on a fresh
    per-port sum.

## 3. Layout

- Both slides are regular `v2Slide()` slides (section `section1`, same as the existing
  land/sea pages), inserted **after** the existing `portPopulationSlideBuilders`/
  `portSampleSlideBuilders` output in `buildDeckV2Slides` — additive, per the user's choice to
  keep land/sea and add these as new slides rather than replace them.
- Body: totals band → short classification note (reuses the existing
  "تُصنَّف الحالة اشتباهًا إذا…" copy already used on the land/sea population page) → a
  `grid-template-columns: 1fr 1fr` grid of the 4 stage cards.
- RTL note: no manual reordering needed. In DOM order stage1→stage4, a plain 2-column CSS
  grid in this RTL document places stage1 top-right, stage2 top-left, stage3 bottom-right,
  stage4 bottom-left automatically — exactly the arrangement in the reference screenshots.
- Card row budget: each card is roughly a quarter of the slide's vertical space (half of the
  existing `TABLE_BUDGET_PX`, minus room for the totals band + note above the grid). Exact
  pixel budget will be measured live in the browser during implementation, the same way
  `METRICS_NORMAL`/`METRICS_COMPACT`/`TABLE_BUDGET_PX` were originally tuned — this doc does
  not guess a number up front.
- Reuses existing CSS classes (`.v2-stage-card`, `.deck-table`, `.v2-totals-band`,
  `.kpi-band`) wherever they already fit; only new CSS needed is for the table sizing inside
  a quarter-card (a new budget constant, not a new component).

## 4. Non-goals / explicit deviations from the literal mockup

- No "متفرقة" (scattered) port-grouping bucket — top-5 + الإجمالي covers it (§2.3).
- No CertScan tile on the sample page's totals band (§2.5) — not backed by any model field.
- Top summary band is the existing 3-tile pattern reused verbatim, not the mockup's specific
  4-tile arrangement (total + stage2 + stage3 + stage4, skipping stage1) — the reused pattern
  is simpler, already proven in `riskStagesSlide`, and doesn't arbitrarily omit stage 1.
- Column order on the population page's per-card table (سليمة، اشتباه، الإجمالي) intentionally
  differs from the existing land/sea `portTable`'s order (الحالات، سليمة، اشتباه) to match the
  reference mockup — this page and the land/sea page will NOT have identical column order,
  which is a deliberate inconsistency accepted for mockup fidelity, not an oversight.

## 5. Testing

- Unit test for `collectStagePortStats`: per-stage sums of `total`/`sampleTotal` must equal
  `model.population.byStage[i].population`/`.sampleSize` for every stage (the invariant noted
  in §2.2).
- Visual check in `deck-preview.html` (dev harness) once implemented — both new slides render,
  top-5 truncation and الإجمالي rows look correct against the synthetic preview fixture
  (14 ports, weighted-random stage assignment).
