# Handoff: تقرير ضمان جودة فحص الأشعة — العرض التنفيذي (X-Ray QA Executive Deck)

## Overview
A 21-slide right-to-left (Arabic) executive presentation reporting monthly quality-assurance results for X-ray screening at land and sea ports (ZATCA). It covers month KPIs, a glossary of risk levels and sampling terms, population/sample distribution, detection accuracy (clean vs. suspicion), per-port and per-level breakdowns, and advanced analyses (results matrix, level-1 vs level-2 comparison, agreement with security teams and the risk engine, effect of suspicion-location marking and image quality).

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype that shows the intended layout, typography, color, and slide behavior. They are **not production code to copy directly**. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, a reporting/BI tool, or a slide-generation pipeline) using its established patterns, component library, and data sources. If no environment exists yet, choose the most appropriate framework and implement the designs there.

All numbers in the deck are **placeholder/illustrative figures** derived to be internally consistent (see “Data Model & Figures”). They must be wired to the real QA dataset.

## Fidelity
**High-fidelity (hifi).** Final colors, Arabic typography, spacing, chart geometry, and slide composition. Recreate pixel-faithfully at a 1920×1080 slide canvas, then map to the codebase's own tokens where equivalents exist.

## Deck Architecture
- Canvas: **1920 × 1080 px** per slide, `dir="rtl"`.
- Slides are sibling `<section>` elements inside a `<deck-stage>` web component (`deck-stage.js`) that handles scaling to viewport, keyboard nav, thumbnail rail, speaker notes (`data-speaker-notes` attribute per slide), and print/PDF (one page per slide).
- Each slide is a `display:flex; flex-direction:column` box with padding `84px 100px 56px` (content slides) or `96px 120px 84px` (covers), `box-sizing:border-box`.
- Every content slide ends with a footer row: report name + `NN / 21` page indicator (LTR-isolated).
- Every slide fits exactly within 1080px (no scroll). Any re-layout must preserve that.

## Slides (in order)
1. **01 الغلاف** — dark cover. Logo + org lines, kicker "عرض تنفيذي · تقرير شهري", H1 110px, period block, footer meta row (report date, department, section, classification).
2. **02 المحتويات** — contents. Five rows, grid `120px 1fr 420px 130px`, row padding 18px, index number 44px gold, title 34px, description 26px, page range at left.
3. **المعجم — المصطلحات** — glossary of five key terms (definition cards).
4. **المعجم — مستويات المخاطر** — four risk-level columns (المستوى الأول–الرابع) with "ما يقيسه" and sampling weight per level; below the grid a highlighted bar: **6,250** = primary monthly target sample, with the note that levels 2–4 weights (40% + 30% + 30%) are drawn from it and level 1 is a full census outside that quota.
5. **مؤشرات الشهر** — six KPI cells in two rows of three: مجتمع الفحص 148,326 · العيّنة 7,563 · التغطية 5.1% · دقة النتيجة 92.4% · نسبة تحديد موقع الاشتباه 88.1% · الاشتباهات الفائتة 214.
6. **القسم الأول (divider)** — dark navy, 280px ghost numeral, section title, description, page list.
7. **مجتمع الفحص** — population and sample per risk level.
8. **توزيع المنافذ** — two tinted panels (land = sand `#f4efe4` + gold top rule; sea = `#eaeff5` + blue top rule). Table columns: المنفذ | الإجمالي | سليمة | اشتباه, every numeric cell formatted **population (sample)**, e.g. `21,480 (1,031)`; totals row per type; coverage 5.1% in the panel subhead.
9. **القسم الثاني (divider)**.
10. **دقة الرصد العامة** — top band of three tiles (دقة الرصد العامة 92.4% · دقة السليمة 98.2% · دقة الاشتباه 69.9%) + table of the two accuracies per risk level with counts in brackets.
11. **الدقة حسب المنفذ** — land/sea panels, per-port دقة السليمة / دقة الاشتباه / الدقة العامة with counts in brackets, nowrap single-line cells, uniform 56px rows.
12. **رسم الدقة حسب المنفذ** — one bar chart per type (land 6 bars, sea 4 bars) of الدقة العامة, dashed per-type average line (91.7% / 93.1%), scale 86–98%.
13. **رسم الدقة حسب المستوى** — four level groups, each two bars (سليمة green / اشتباه red), dashed average lines 98.2% and 69.9%, scale 60–100%.
14. **القسم الثالث (divider)**.
15. **مصفوفة نتائج الوسائل الآلية** — 2×2 confusion matrix, grid `220px 1fr 1fr 300px`: 11,807 توافق سليم · 214 اشتباه فائت · 936 اشتباه خاطئ · 2,169 توافق اشتباه; row/column totals at 38px with small labels; total cell 92.4% (15,126).
16. **دقة إجابات المستوى الأول والثاني** — two tinted panels, five metric rows each (النتائج المُقيَّمة، دقة السليمة، دقة الاشتباه، الدقة العامة، اشتباهات فائتة).
17. **دقة المستويين في المنافذ البرية** — single chart, one grouped pair per port (level 1 gold, level 2 blue), values labelled inside bars with %, one dashed type-average line (91.7%), scale 86–96%.
18. **دقة المستويين في المنافذ البحرية** — same chart, 4 ports, groups centered with fixed 16.2% group width so bar width/spacing matches slide 17 (type average 93.1%).
19. **توافق النتائج بين المستويات والفرق الأمنية** — grouped bars per team (الوسائل الحية · المعاين · التفتيش المعاكس) for level 1/level 2, dashed line "نسبة توافق الفرق الأمنية 69.3%", detail table (صور مشتركة، توافق كل مستوى بالنسبة والعدد، الكلي), plus a merged lower band **التوافق مع محرك المخاطر**: 68.2% (3,410) · 1,590 اختلاف · 38.5% (612) أيّدت الجودة المحرك, and a 3-segment distribution bar over 5,000 targeted images.
20. **أثر التحديد وجودة الصورة على الدقة** — symmetric two-column slide: left = with/without location marking (94.1% vs 79.8%, callout **+14.3%**), right = image quality tiers (94.6% / 90.1% / 82.4%, callout **−12.2%**); both plots equal height, callouts pinned to the bottom with `min-height:104px`.
21. **شكراً** — dark closing cover mirroring slide 1 (logo, kicker "ختام العرض", H1 150px, closing line, meta row).

## Chart Construction (critical)
All charts are pure DOM/CSS, no SVG. The pattern that must be preserved:
- Plot box: `position:relative` with a tinted background and a 2px `#10304f` bottom border — its bottom edge **is** the value baseline.
- Bars: an absolutely positioned row `position:absolute; inset:0; z-index:1; display:flex; align-items:stretch` whose cells are `flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-self:stretch; height:100%`. The bar div inside gets `height: <pct>%` — percentage heights only resolve because the cell has a resolved full height (do not switch the row to `align-items:flex-end`, which collapses them).
- Value labels live **inside** the bar top (`padding-top:10px`, white text). The bar row carries `z-index:1` so labels paint above the dashed reference lines.
- Reference lines: `position:absolute; right:0; left:0; bottom:<pct>%; border-top:3px dashed`, computed on the same scale as the bars: `pct = (value − min) / (max − min) × 100`.
- Axis captions/legends sit **outside** the plot box (title row or legend row) — never absolutely positioned inside it (they collide with bars).
- Category labels are a sibling row below the plot with the same gap/padding as the bar row so they align exactly under each bar/group.

## Data Model & Figures (placeholders — replace with real data)
- Population: 148,326 valid images; sample 7,563 images (coverage 5.1%); **two independent decisions per image** → 15,126 evaluated results.
- Split: 12,021 "سليم" results, 3,105 "اشتباه" results.
- Accuracy: دقة السليمة 98.2% (214 missed suspicions), دقة الاشتباه 69.9% (936 false suspicions), overall 92.4% (+2.4% vs prior period). Location-marking rate 88.1% (−1.9%).
- Primary monthly target sample: **6,250 images**; level 1 = full census, levels 2–4 = 40% / 30% / 30% of the 6,250.
- Ports: 6 land (77,488 population / 3,953 sample) and 4 sea (70,838 / 3,610).
- Levels: 3,220 / 5,000 / 3,750 / 3,156 evaluated results.
- Security-team agreement: 834 shared images, 578 agreed (69.3%); level 1 71.8% (599) vs level 2 66.8% (557).
- Risk engine: 5,000 targeted images, 68.2% agreement, 1,590 disagreements of which 612 upheld the engine.
- Marking effect: 13,326 with marking (94.1%) vs 1,800 without (79.8%); suspicion accuracy 73.4% vs 48.2%.
- Image quality: 9,832 good (94.6%), 4,102 medium (90.1%), 1,192 poor (82.4%).

## Terminology (locked wording)
Use exactly: **نتائج الوسائل الآلية** (not نتائج الفحص) · **صورة / صور** (not حالة/حالات) · **نتيجة / نتائج** (not قرار/قرارات) · **نسبة تحديد موقع الاشتباه** · **دقة السليمة**، **دقة الاشتباه**، **الدقة العامة** · security teams: **الوسائل الحية · المعاين · التفتيش المعاكس**. Differences are always expressed as **percentages with both compared values** (e.g. "+14.3% فرق في الدقة العامة (94.1% مقابل 79.8%)") — never "نقاط".

## Design Tokens
Colors
- Page background: `#f9f8f5`; panel/plot tint: `#f2f0ea`; land panel: `#f4efe4`; sea panel: `#eaeff5`; callout tint: `#eef1f5`; positive cell tint: `#eef3ee`; negative cell tint: `#f7eeeb`
- Primary navy: `#10304f`; cover navy: `#0f2b46`; body text: `#22303e`; muted text: `#5d6b7a`; hairline: `#e3e0d8`
- Gold accent: `#b48a3c` (dark variant `#8a6526`, light-on-dark `#c9a45e` / `#d9b877`)
- Blue accent: `#3f6fa8` (dark variant `#2c5580`)
- Green (سليمة / positive): `#2e7d4f`; red (اشتباه / negative): `#b8543f`; neutral bar: `#d9d5ca`

Typography — **Somar Sans** (woff files in `assets/fonts/`, weights 300/400/500/700), fallback `system-ui, sans-serif`.
- Cover H1 110px/1.18 700 · closing H1 150px · divider H1 82px/1.1 700
- Slide H2 56px/1.15 700 (some legacy slides 64px) · section kicker 26px 500 gold
- Panel/chart titles 28–30px 700 · big KPI numbers 96px / 84px / 78px / 66px / 52–44px 700 · table body 25px · table headers 25px 500 muted · bracket counts 24px 400 muted · footers/legends 24px
- Minimum type size anywhere: **24px** (1920×1080 rule)

Spacing / geometry
- Slide padding 84/100/56 (content), 96/120/84 (covers); header bottom margin 24–30px
- Grid/flex gaps: 48px (two-panel), 44–56px (multi-column), 26px (bar groups), 6–12px (bars inside a group)
- Table rows: fixed 56px height, cell padding `8px 0`; header/footer cell padding `10–12px 0`; `table-layout:fixed` with an explicit first-column width (34–36%) and `white-space:nowrap` on data cells
- Rules: 2px `#10304f` for table/section boundaries, 1px `#e3e0d8` hairlines, 5px inline-start bar on callouts, 5px top bar on tinted panels
- No border radius anywhere except 50% dots (16px) in panel titles; no shadows

## Interactions & Behavior
- Deck navigation: arrow keys / click, thumbnail rail, slide counter; presenter notes per slide from `data-speaker-notes`.
- Print/PDF: one slide per page at 1920×1080 (handled by the deck component).
- No hover states, no data drill-down, no animation in the current design. If the target is a live dashboard, add hover tooltips echoing the bracketed counts rather than changing labels.

## State Management
Presentation-only: current slide index (persisted by the host), notes visibility, thumbnail-rail visibility. Data is static per month; in a real implementation each slide binds to one aggregate query (month KPIs, per-level, per-port, per-team, engine agreement, marking, image quality).

## Assets
- `assets/zatca-logo.svg` — ZATCA logo (rendered white on dark covers via `filter:brightness(0) invert(1)`). Use the official brand asset from your own brand system.
- `assets/fonts/SomarSans-{Light,Regular,Medium,Bold}.woff` — licensed Arabic typeface; source it from your own licence.

## Files
- `Executive Report Deck v2.dc.html` — the full deck (all 21 slides, inline styles).
- `deck-stage.js` — slide-stage web component (scaling, nav, notes, print).
- `support.js` — runtime for the design-component format; not needed in production.
- `assets/` — logo and fonts.
