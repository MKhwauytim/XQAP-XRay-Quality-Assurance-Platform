# Executive Deck (deck2) — Visual Upgrade Plan

**Date:** 2026-07-14 · **Status:** awaiting owner approval
**Scope:** the live executive deck (deck2). A final phase propagates the winning patterns to the sample/distribution/management decks (shared `reportChrome`), so all four presentations stay one visual family.

## 0. Where the deck stands today (audit)

**Strengths — keep, don't touch:**
- Strong ZATCA identity: navy surface, gold accent, tone-coded stages (gold/blue/green/coral), RTL, 16:9 print-ready, side nav + progress, dark/light toggle, classification badge.
- Solid layout engineering: pixel-exact totals pinning, pagination with compact tier, ghost rows / ruled fillers (v51.2–v51.4), tinted totals rows.
- Data integrity chrome: source-revisions footer.

**Weaknesses — the plan targets these:**
1. **Zero charts.** Slides 5–12 are tables end-to-end. The tested SVG chart library in `executive/ui/charts.ts` (rankedBar, donut, gauge, stackedBars, heatmap, sparkline — used by deck v1, XSS/data-tested) is not imported by deck2 at all. Tables tell; nothing shows.
2. **No headline.** The deck opens into TOC/glossary; there is no "the month in 6 numbers" moment. An executive should get the verdict in slide 3, not reconstruct it from tables.
3. **Uniform density.** Every content slide has the same visual weight — no rhythm of hero number → chart → detail table.
4. **Numbers without proportion.** Percent cells (`pctCell`) and counts are plain text; the eye can't compare rows without reading every digit.
5. **No month-over-month context.** Every figure is an island; even one prior-month delta arrow would add meaning. (Data exists on disk in prior month folders.)
6. **Typography scale is flat.** Table text ~0.6–0.78rem everywhere; hero figures barely larger than body.

## 1. Design direction (one sentence)

**Keep the ZATCA navy/gold identity exactly as-is; change the information rhythm — every section opens with a visual (chart/stat), tables become scannable with proportional ink, and the deck gains a headline slide.**

All additions follow the dataviz method already used for the KPI p-charts: one axis, fixed categorical order, recessive grids, direct labels, status colors reserved and never color-alone, palette validated with the CVD checker, text in text tokens.

## 2. The work — three waves

### Wave V1 — Hierarchy & headline (foundation)
| # | Change | Where |
|---|--------|-------|
| V1.1 | **New "الشهر في أرقام" headline slide** (after TOC): 6 stat tiles — population, sample + coverage %, studied + completion %, suspicion rate, referral count, accuracy % — big tabular numbers, small captions, tone-coded icons. Each tile gets a prior-month delta chip (▲/▼ + value) when a prior month exists on disk; hidden otherwise. | new `slides.ts` builder + `ReportModel` (deltas: small loader reads prior month's population/sample counts — already how the switching-rule advisory works) |
| V1.2 | **Type scale**: define 4 sizes as CSS vars (hero 2.2rem / section 1.1rem / body 0.78rem / caption 0.62rem), apply consistently; `font-variant-numeric: tabular-nums` everywhere numbers align. | `theme.ts` |
| V1.3 | **Section separators upgraded**: current plain dividers get the section's one key figure + a one-line takeaway (e.g. "عيّنة هذا الشهر: ٤٦٠ حالة — تغطية ٩٫٢٪"). | `slides.ts` dividers |
| V1.4 | Print QA pass: page-break rules per slide, backgrounds forced (`print-color-adjust`), verify light-print output. | `theme.ts` |

### Wave V2 — Charts (reuse `ui/charts.ts`, zero new dependencies)
| # | Change | Where |
|---|--------|-------|
| V2.1 | **Risk-stages slide**: add a horizontal **stacked proportion bar** (population share by stage, tone-coded) above the 4 tiles; tiles keep the exact numbers. | `stackedBars`/custom single-bar SVG |
| V2.2 | **Coverage gauge**: donut/gauge (sample vs population, target marker) on the sample section opener. | `gauge` |
| V2.3 | **In-table data bars**: proportional background bars behind الحالات/التغطية cells in the land/sea tables and behind percent cells in quality/accuracy tables (pure CSS `linear-gradient` sized by an inline `--w` var — no layout change, no row-height risk). Thresholded tint for accuracy (below-target rows get the reserved warning tone + a ⚠ glyph, never color alone). | `slides.ts` cell builders + `theme.ts` |
| V2.4 | **Suspicion funnel**: population → sample → studied → اشتباه → confirmed as a compact horizontal funnel on the results-section opener. | small SVG builder (pattern from `rankedBar`) |
| V2.5 | **Top-ports chart**: the port-population slide's first page gains a `rankedBar` (top 8 ports) beside the table (table paginates as today from page 2). | `rankedBar` |
| V2.6 | Any new color pairs run through the dataviz palette validator (CVD ≥ 12) before merge. | check |

### Wave V3 — Owner-choice styling pass (uses the existing variant machinery)
| # | Change |
|---|--------|
| V3.1 | For the 3 highest-impact slides (headline, risk-stages, results opener) ship **2–3 style variants each** via the existing `v2-variant-stack` + arrow-cycling preview (`/deck-preview.html` already persists choices to `deck-style-choices.json`). You click through, pick, and reply with the choices — then the winners are baked and the variant markup removed. |
| V3.2 | Glossary slide de-densified: 12 cards → 8 essential terms + smaller two-line definitions (rest move to the document edition). |
| V3.3 | Cover refinement variants: current vs. a version with a subtle geometric Saudi-pattern band + larger period lockup. |
| V3.4 | Light-theme parity + print output re-verified per slide; final anti-pattern checklist (label collisions, overflow, legend presence, digit consistency `ar-SA-u-nu-latn`). |

### Wave V4 (optional, after V1–V3 sign-off) — Family propagation
Apply the winning patterns (headline tiles, data bars, section-opener charts) to the **sample, distribution, and management decks** via `shared/reportChrome.ts`, so all four reports present identically. Document edition gets the data bars + delta chips only (it is a reading document, not a presentation).

## 3. Constraints honored
- **Single self-contained HTML** — all charts are inline SVG from `ui/charts.ts`; no new dependencies; no webfonts embedded in v1–v3 (system Arabic stack stays; an embedded IBM Plex Sans Arabic subset is a separate decision — ~150 kB bundle cost — flagged, not planned).
- **No layout-math risk**: in-table bars are cell *backgrounds* (no new rows/heights); charts go on slides with free vertical budget or new slides.
- **Numbers never change**: every visual is derived from the same `ReportModel` the tables already render — charts show, tables stay authoritative.
- **RTL**: SVG builders take an RTL flag (charts.ts already handles this for deck v1); axes/labels mirrored.
- Gates after each wave (`tsc -b`, lint, full Vitest incl. XSS tests extended to new builders), EDIT_LOG entries, verified in `/deck-preview.html` (fixture already mirrors real data shape), one commit per wave.

## 4. Effort & sequence
V1 ≈ one focused session · V2 ≈ one-two sessions · V3 ≈ one session + your picks · V4 ≈ one session. Each wave is independently shippable; stop after any wave and the deck is coherent.
