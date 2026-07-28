# deck2 three-system fan-out — `slide-cover` + `slide-sep-1/2/3` (Opus, 2026-07-28)

**Status:** implementation-ready. Supersedes §4 ("no fan-out") of `docs/superpowers/specs/2026-07-25-deck2-fanout-remaining-pages-plan.md` and closes the `slide-cover` gap that plan never covered. Author: Opus (dispatched via Agent tool per the standing "ask always opus 5" delegation — [[user_preferences]]), in response to the user's explicit instruction: "revise all pages and work even on separator pages and cover etc."

## 0. Correcting the prior §4 ruling (state this in the edit-log entry)

The prior "no fan-out for `slide-sep-1/2/3`" ruling rested on two claims, one wrong and one mispriced:

1. **Wrong:** "a variant would be a pure reskin of the slide shell, which spec §5 forbids." Spec §5 firewalls the *shell* (eyebrow/headline/subhead/rail/foot). `.v2-sep` is not the shell — it is the variant body, the same surface every other page re-composes. Re-composing it is in-contract.
2. **Mispriced:** it was costed as "3 pages × 3 selectors × 2 themes." It is **one builder** (`sectionSeparatorSlide`) rendering all three separators, with `tone` already parameterised. The real cost is 1 function × 3 systems.

What stands from the prior ruling, and is now a **hard constraint on this pass**: **no statistics return to the divider.** The owner's strip decision (recorded in the function's own doc comment) is not reversed. Differentiation here is **typographic and structural grammar only**, over the four fields the page already has (`sectionNo`, `title`, `blurb`, `tone`). No `model` is threaded into `sectionSeparatorSlide`. No new option is added to its `opts`.

**Pre-refused idea (do not implement):** a Ledger "section index" table built from `NAV_SECTIONS` with a "you are here" marker. It needs no new plumbing, so it will look tempting. Reject it: it duplicates `slide-toc` (which does it better, with page ranges), and it converts a boundary marker into a navigation page — the same category of change the owner rejected.

## 1. The governing rule for `slide-cover`: SCOPE, never FINDINGS

`coverSlide` already receives the full `ReportModel`. The question is not *can* it show figures but *which*.

**Rule:** the cover may state **scope** — what this document covers (`population.total`, `sample.total`, `sample.coverage`) — and must never state **findings** (accuracy, quality, agreement, detection, any port ranking).

Why this doesn't contradict the owner's separator strip: the owner's stated reason was adjacency — a divider's figure is restated *on the very next page*, so it is pure redundancy. The cover is separated from the first data page by the TOC, the glossary and a divider, and "how big is the thing this document is about" is part of identifying the document, not analysing it. Findings, by contrast, would be a conclusion stated before its basis.

Consequence: **no port ranking, no `briefingRankList`, on the cover.** Nothing on a cover is honestly rankable under the scope rule.

## 2. Constraints specific to these two pages (verify, do not re-derive)

- **The cover is dark in BOTH themes, by deliberate design** (`theme.ts` ~1228–1236). Every Ledger/Grid/Briefing selector added to the cover **must carry a matching `body.theme-light .slide.v2-cover …` re-override back to the dark treatment**, exactly as `.v2-cover-meta-item`/`.v2-cover-meta-value` already do. Inheriting the generic `.v2-lg-table-card`/`.v2-gd-panel`/`.v2-bf-lede-label` rules produces dark-ink-on-dark or a white card on a navy page. **Highest-risk trap in this pass.**
- **The separators DO follow the theme** (`body.theme-light .v2-sep-slide.gold{...}`). No re-override needed there.
- **The decorative layers stay, unvaried, for all 4 slots on both pages**: `coverMeshSvg`/`.v2-cover-mesh`, `coverBand()`, `.v2-sep-bg`, `dividerPatternSvg`/`.v2-sep-pattern`, `orgBlock`, `sideRail`, `pageFoot`. Rendered *outside* the variant body — they are the page's section-tone identity. Do not strip them "because Ledger is austere" — that's a shell change and out of contract.
- **Slot 0 must stay byte-identical.** Add a byte-identity pin for each page in `deck2.test.ts` (neither currently exists), matching the `EXPECTED_VARIANT0` convention.
- **`slide-sep-*` share a family key** (`familyKeyOf` strips trailing `-\d+`). An admin choosing Grid on any separator sets all three — desirable, document it, but it also means per-separator mixing is impossible by design. `slide-cover` has no trailing digits → no collision.
- **Tone mapping.** `sectionSeparatorSlide`'s `tone` is `"gold" | "cyan"`. `BriefingTone` has no `cyan` — map explicitly: `const bfTone: BriefingTone = tone === "cyan" ? "blue" : "gold";`. Page tones: `slide-cover`→gold, `slide-sep-1`→gold, `slide-sep-2`→blue (from cyan), `slide-sep-3`→gold.
- Standing rules still bind: no hex literals, both themes for every new selector, builders pure, edit-log entry with real `count-lines` arithmetic before the edit.

## 3. New shared primitive — exactly one

**`gridFieldCells`** — `slideKit.ts`. Used by `slide-cover` (Grid) and `slide-sep-1/2/3` (Grid).

```ts
/**
 * Grid system (slot 3) label-over-value cell field: the system's uniform
 * hairline-cell grammar applied to pages that have real fields but NO
 * comparable numeric domains, so metricMatrix would be dishonest.
 * Column count/geometry is set by the wrapping page-local .v2-gd-* class —
 * this function only emits the field, never its geometry.
 * `numeric` adds tabular-nums to the value. `wide` marks a cell spanning the
 * full row (page CSS decides how). Labels/values are escaped here.
 */
export function gridFieldCells(
  cells: Array<{ label: string; value: string; numeric?: boolean; wide?: boolean }>,
): string;
```

Markup:
```html
<div class="v2-gd-field">
  <div class="v2-gd-field-cell[ num][ wide]">
    <span class="v2-gd-field-label">…</span>
    <span class="v2-gd-field-value">…</span>
  </div>…
</div>
```

Shared CSS (both themes, in the `.v2-sys-grid` block): square corners, 1px `var(--line)` hairlines between cells, uniform padding, label `var(--slate)` `.68rem`/700, value `.95rem`/800 in `#fff` (dark)/`#0a2d4a` (light). **No magnitude tint** (see §5 Grid for why).

## 4. `slide-cover` — `coverSlide` (slides.ts ~96)

Available: `model.summary.periodId`, `model.population.total`, `model.sample.total`, `model.sample.coverage`, `generatedAt`, `ORGANIZATION_PATH[1]`/`[2]`.

**Field-conservation requirement:** every slot must carry all four meta fields (فترة الدراسة/تاريخ الإصدار/الإدارة/القسم) plus the classification.

### Ledger — the issue record
Wrapper `v2-sys-ledger v2-lg-cover`. Hero column: keep `.v2-cover-title`+`.v2-cover-lockup` verbatim; drop `.v2-cover-kicker` (ornament) and `.v2-cover-badge` (classification moves to table foot); new `.v2-lg-cover-rule` (1px full-width `var(--line)`) replaces the gold gradient rule. Record column: one `ledgerTableCard` (`cardClass:"v2-lg-cover-card"`, `span:3`, `rowCount:0`, no title), `theadCells: <th></th><th>البند</th><th>القيمة</th>`, 7 rows each with `ledgerIdx(i)`:
1. فترة الدراسة → periodId
2. تاريخ الإصدار → formatDate(generatedAt)
3. الإدارة → department
4. القسم → section
5. مجتمع الصور → `${fmtNum(population.total)} صورة`
6. حجم العيّنة → `${fmtNum(sample.total)} صورة`
7. تغطية العيّنة → `fmtPct(sample.coverage,1)`

`totalsRowHtml` = not a totals row — classification footnote instead: `<tr class="v2-lg-foot-note"><td colspan="3">داخلي — للاستخدام التنفيذي</td></tr>` (reuse `.v2-lg-foot-note` if already defined elsewhere; else add once, shared). Page-local CSS: 2-col grid `1fr 1.15fr`; `.v2-lg-cover-card` translucent panel over the mesh + light-theme re-override back to dark.

### Briefing — one figure, then the document
Wrapper `v2-sys-brief v2-bf-cover`, single centred column. Order: title first, then lede, then support (a cover's title cannot be demoted below a statistic).
1. `.v2-cover-kicker` + `.v2-cover-title` + `.v2-cover-rule` verbatim, centred.
2. `briefingLede({figure: fmtNum(population.total), tone:"gold", label:"صورة في مجتمع الفحص — "+periodId, basis: department+" · "+section+" · صدر في "+formatDate(generatedAt)})`. **No `arc`** — the only arc-able number (coverage) is a different unit than the lede figure (a count); it goes in support instead.
3. `briefingSupport([{iconName:"layers", value:fmtNum(sample.total), label:"حجم العيّنة"}, {iconName:"gauge", value:fmtPct(sample.coverage,1), label:"تغطية العيّنة"}, {iconName:"shield", value:"داخلي", label:"تصنيف الوثيقة"}])` — third chip absorbs the badge, so drop `.v2-cover-badge` here too.
No `briefingRankList` (§1 scope rule). Page-local CSS: centred flex column; lede figure bumped to `4.2rem`; light-theme re-overrides for `.v2-bf-lede-label`/`.v2-bf-lede-basis`/`.v2-totals-item` back to dark.

### Grid — the modular identification plate
**No `metricMatrix`** (one entity, 4 strings + 3 figures in 3 different units — nothing to compare on a shared scale). **No `gridPanel` either** (its light-theme rule paints a white card, a hard break on the always-dark cover). Composition: `.v2-cover-title` verbatim + a `.v2-gd-cover-rule` hairline (drop kicker + badge — badge becomes a cell); `gridFieldCells([...])`, 8 cells in 4 cols × 2 rows via `.v2-gd-cover .v2-gd-field{grid-template-columns:repeat(4,1fr)}`:
- Row 1: فترة الدراسة · تاريخ الإصدار · الإدارة · القسم
- Row 2: مجتمع الصور (numeric) · حجم العيّنة (numeric) · تغطية العيّنة (numeric) · التصنيف: داخلي

**No magnitude tint** — the three figures share no scale/denominator; a `--w` tint would be invented magnitude (document in comment). **The "ink always `var(--navy)`" rule does not apply** — that rule exists for opaque tinted matrix fills; these cells are unfilled, so ink follows the cover's own dark palette in both themes (document in comment so a reviewer doesn't flag it). Light-theme re-overrides required (§2 trap).

## 5. `slide-sep-1/2/3` — `sectionSeparatorSlide` (slides.ts ~1013)

Input set closed: `sectionNo`, `title`, `blurb`, `tone`. All three slots drop `.v2-sep-watermark`/`.v2-sep-badge` (slot-0 vocabulary). Decorative layers untouched.

### Ledger — the ruled document opener
**Deliberately no table** — no data exists, and a one-row table would be theatre (same reasoning the prior plan used to reject dressing up `s3-quality`'s reasons list as a matrix). Ledger's identity here is its rules/ordinality/document typography. `v2-sys-ledger v2-lg-sep`, start-aligned, vertically centred:
1. Full-width 1px `var(--line)` rule.
2. `ledgerIdx(sectionNo-1)` (reuse — it's 0-based, renders `i+1`) + `<span class="v2-lg-sep-eyebrow">القسم</span>` (slate, `.72rem`, 700, letter-spacing `.08em`).
3. `<h2 class="v2-lg-sep-title">` — `2rem`/800/`#fff` (light: `#0a2d4a`), start-aligned. Deliberately smaller than slot 0's `2.6rem` — a heading, not a poster.
4. Full-width 1px rule.
5. Blurb as a hanging-label definition line: fixed-width `<span class="v2-lg-sep-key">التعريف</span>` + `<p class="v2-lg-sep-def">` (`.92rem`, line-height 1.85, max-width 640px).
6. Closing full-width 1px rule.

### Briefing — `briefingLede` alone
Cleanest reuse in the whole fan-out — the divider's 3 fields map 1:1 onto the lede's 3 slots. `v2-sys-brief v2-bf-sep`, exactly:
```ts
briefingLede({ figure: String(sectionNo), tone: bfTone, label: esc(title), basis: esc(blurb) })
```
No support strip (nothing to put in it — `briefingSupport([])` returns `""`, precedent: glossary-1). No rank list. Page-local CSS: `.v2-bf-lede-figure{font-size:6.4rem}` (divider scale); `.v2-bf-lede-basis` restyled from its default bordered-pill look to a plain paragraph (`border:0;background:transparent;max-width:620px;margin-inline:auto;font-size:.96rem;line-height:1.85`) — a ~30-word blurb in a pill looks broken (same page-local-restyle licence the prior plan granted glossary-levels' `.v2-bf-rank-secondary`). Matching light-theme form. **Drop the watermark in this slot** — if both the outlined watermark and the solid lede figure shipped, the two variants would read as the same page.

### Grid — the section card
`v2-sys-grid v2-gd-sep`, one full-width `gridPanel`:
```ts
gridPanel({
  title: title,
  sub: `القسم ${sectionNo}`,
  variant: tone,   // "gold" | "cyan"
  chartHtml: gridFieldCells([
    { label: "رقم القسم", value: String(sectionNo), numeric: true },
    { label: "التعريف", value: blurb, wide: true },
  ]),
})
```
Page-local CSS: `.v2-gd-panel{max-width:820px;margin:auto}`; `.v2-gd-field{grid-template-columns:0.6fr 2.4fr}`; tone-bordered variants modelled on the existing `.v2-gd-port-population .v2-gd-panel.land/.sea` rules, both themes (separator follows the theme — no dark re-override needed here). The section number appearing in both the panel sub and a cell is Grid's own idiom (every Grid page prints a column's domain in the header and its value in the cell) — document, don't "fix" later. Same unfilled-cell ink note as cover Grid.

### Slot-reuse check
All three separator slots are genuinely differentiated (start-aligned ruled record / centred giant figure / bordered modular card) — each recognisable as its system from a thumbnail, matching the bar the other 17 pages meet. No slot defaults to unchanged reuse.

## 6. `slide-month-numbers`

**Stays explicitly skipped, unchanged.** `SHOW_MONTH_NUMBERS_SLIDE=false` short-circuits the call site — slots 1-3 would never render in production or preview. Revisit only if the gate flips.

## 7. Verification

- `npm run test:run`, `typecheck`, `lint`, `check:hex-literals`, `check:bundle-size` clean.
- New byte-identity slot-0 pins for `coverSlide` and `sectionSeparatorSlide` (neither exists yet).
- New unit test: `sectionSeparatorSlide({tone:"cyan"})`'s Briefing lede emits `v2-bf-lede-figure blue`, never `cyan`.
- `deck-preview.html` for both pages × slots 1-3 × **both themes** — the cover's light-theme pass is not optional, it's where the dark-cover trap manifests.
- Cover Ledger: confirm the 7-row table + tfoot doesn't clip.
- Separator Briefing: confirm the 6.4rem figure + longest blurb (section 3's) clears `pageFoot`.

**Files touched:** `slides.ts` (`coverSlide`, `sectionSeparatorSlide`), `slideKit.ts` (`gridFieldCells`), `theme.ts` (shared `.v2-gd-field*` + 6 page-local blocks, each with light-theme form), `deck2.test.ts` (2 byte-identity pins + 1 tone-mapping test), edit-log entry.
