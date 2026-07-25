# Deck2 — Risk-Stages Slide, Variant 2/4 — Design Spec

**Date:** 2026-07-25
**Status:** Approved by owner (2026-07-25), pending spec-file review
**Owner:** Reporting / dev preview (`src/data/reporting/executive/deck2/`)

> Scope note: this is a **dev-preview design-exploration slot**, not a production change.
> Per `docs/archive/plans-history/specs/2026-07-05-deck2-style-switcher-design.md`, every
> deck2 slide renders exactly 4 pre-built body variants (`bodyVariants: [string, string,
> string, string]`), and production (`variantPreview: false`) always renders
> `bodyVariants[0]` only — variant 0 is never removed or altered. This spec fills in
> variant slot **1** ("2 / 4" in the on-screen switcher) for one slide only: the risk-stages
> population page (`riskStagesSlide`, "مجتمع الصور بناءً على المخاطر"). Slots 2 and 3
> ("3 / 4", "4 / 4") stay duplicates of slot 0 until a future variant is designed for them.

---

## 1. Problem statement

The current design for this slide (variant 0 — 4 gauge-tiles + one stacked proportion bar)
is the only design ever built for it; the 2026-07-05 style-switcher spec had already
catalogued 3 alternate directions for this exact slide ("risk-level population") but none
were implemented. The owner asked for a more professional, easier-to-read treatment,
without touching or replacing the current design — it must land as an additional variant,
selectable via the existing arrow-cycle switcher, so variant 0 keeps shipping to
production unchanged.

Of the pre-catalogued directions (risk-heatmap-matrix, KPI-card row, compare-bars +
exact-figures table), the owner chose **compare-bars + exact-figures table**: it reads
exact numbers most directly and lets the new table reuse the deck's existing
`.deck-table` visual language (borders, header weight, tone-highlighted totals row)
already established by the deck's other tables, so the new variant looks consistent with
the deck's newest (section-3) pages rather than introducing a fourth visual dialect.

---

## 2. Data (no new business logic)

All figures come from `model.population.byStage: StageProfile[]` (already the sole input
to variant 0) and `LEVEL_DRAW_WEIGHTS` (already used by variant 0's tiles and by
`stageShortTag`). No new aggregation, no new fields on `StageProfile` or `ReportModel`.

Per level `i`, `stage = model.population.byStage[i]`:

| Value | Expression | Already computed by variant 0? |
|---|---|---|
| Level name | `stage.stageLabel` | yes |
| Share of population | `(stage.population / populationTotal) * 100` | yes (`share`) |
| Population | `stage.population` | yes |
| Sample size | `stage.sampleSize` | yes |
| Coverage % | `stage.coverage` | yes |
| Draw weight | `LEVEL_DRAW_WEIGHTS[i]` (nullable) | yes (via `stageShortTag`) |
| Tone | `STAGE_TONES[i % STAGE_TONES.length]` | yes |

Totals row uses the exact totals variant 0 already renders in its bottom band:
`model.population.total`, `model.sample.total`, `model.sample.coverage`.

---

## 3. Layout

Body variant 1, top to bottom:

1. **Compare-bars** — one horizontal bar per level (4 total), RTL (label on the right,
   value on the left, bar fills right→left), tone-colored per `STAGE_TONES`, value =
   share % (`fmtPct(share, 0)`). New function `stageCompareBars(stages, populationTotal)`
   in `slides.ts`, placed next to the existing `stageProportionBar()` (same file, same
   input shape) — a sibling, not a replacement.
2. **Exact-figures table** — one `<table class="deck-table">` row per level:
   `#` (numbered badge, same `pad(i+1)` convention as the tiles) · المستوى (name) · وزن
   العينة (draw weight %, "—" when null, matching `levelCard`'s own null handling) · من
   المجتمع (share %) · صورة (population, `fmtNum`) · العيّنة (sample, `fmtNum`) · تغطية
   العيّنة (coverage %). Totals `<tfoot>` row: "الإجمالي" · "—" (weight has no aggregate
   meaning) · "100%" · `model.population.total` · `model.sample.total` ·
   `model.sample.coverage`. New function `levelFiguresTable(stages, populationTotal,
   totals)` in `slides.ts`.
3. Variant 0's bottom totals band (`v2-totals-band`) is **not repeated** in variant 1 —
   its three numbers now live in the table's totals row instead, avoiding showing the same
   figures twice on one slide.

`riskStagesSlide`'s `bodyVariants` array (slides.ts:726) changes from
`[body, body, body, body]` to `[body, body2, body, body]`. `body` (variant 0) is untouched
byte-for-byte. `body2` is the new function composing `stageCompareBars` + `levelFiguresTable`.

---

## 4. New CSS (theme.ts)

One new scoped block (~15–20 lines), following the existing convention of scoping
`.deck-table` styling to a container class (cf. `.v2-port-col .deck-table`,
`.v2-stage-port-card .deck-table` — there is no bare `.deck-table{}` base rule).
New container class: `.v2-level-table-card`. Reuses existing tokens only —
`var(--gold/--blue/--green/--coral)` for tone accents, `var(--slate)`/`var(--line)` for
neutral ink/borders — no new colors introduced. Needs both the dark (default) and
`body.theme-light` override, matching every other deck2 component.

New compare-bars CSS (~10 lines): `.v2-cbar`, `.v2-cbar-row`, `.v2-cbar-track`,
`.v2-cbar-fill` (tone classes `.gold/.blue/.green/.coral` mirroring
`.v2-prop-seg.{tone}`), `.v2-cbar-label`, `.v2-cbar-value`.

---

## 5. Non-goals / guarantees

- No change to `bodyVariants[0]`, `stageProportionBar`, `levelCard`, `stageShortTag`, or
  any `ReportModel`/`StageProfile` type or aggregation.
- No change to any other slide's variants.
- No change to production output (`buildExecutiveDeckV2` with no `opts` /
  `variantPreview: false`) — verified by the existing `deck2.test.ts` byte-identity
  assertions for variant-0-only rendering (same test guarantee the 2026-07-05 spec
  established for the whole switcher).
- No new page/pagination logic — 4 data rows + 1 totals row is far under
  `BASE_ROWS_PER_PAGE = 7`, so no compress/paginate branch is needed (unlike the
  port tables, which is why `portTableCard`'s pagination options are intentionally
  *not* reused here).

---

## 6. Testing / verification

- Extend `deck2.test.ts` (or add a focused test) asserting: variant-0-only production
  output is unchanged; in `variantPreview: true` mode, slot 1 of the risk-stages slide
  contains the new table with the correct per-level numbers against the existing
  synthetic fixture, and the totals row matches `model.population.total` /
  `model.sample.total` / `model.sample.coverage`.
- Manual verification in the live dev-preview: cycle the risk-stages slide to "2 / 4",
  confirm no clipped/overflowing table, confirm both dark and light theme render
  correctly, confirm the bars' relative lengths match the printed share percentages.
