# Executive Deck (deck2) — Full Visual Overhaul (v2 plan, supersedes the incremental v1)

**Date:** 2026-07-14 · **Owner decision:** "big visual overhaul, not small" — approved direction, executing.
**Mode:** Redesign–Overhaul (new visual language; content, numbers, IA, and brand identity preserved).

## Design read
Government executive presentation for ZATCA leadership. Premium institutional data-storytelling: the deck should feel like a national authority's annual-report graphics team built it — bold hierarchy, chart-first slides, dramatic section covers — while staying print-to-PDF-perfect and RTL-native. Navy/gold identity stays and gets *amplified*, not replaced.

## What changes (slide-by-slide)

| Slide | Today | Overhaul |
|---|---|---|
| الغلاف (cover) | logo + text block | Full-bleed brand moment: layered navy depth gradients + subtle geometric band, giant month lockup (hero numeral scale), gold rule system, classification badge, issue metadata column |
| المحتويات (TOC) | list | Visual agenda: numbered tone-coded section cards with key figure per section |
| **NEW — الشهر في أرقام** | — | Headline dashboard: 1 dominant hero number (population) + 5 stat tiles (sample+coverage, studied+completion, suspicion rate, referrals, accuracy), delta chips vs prior month when available |
| المعجم (glossary) | 12 dense cards | 8 essential terms, larger icon badges, two-line definitions |
| فواصل الأقسام (separators) | plain divider | Full-bleed color-blocked section covers: giant outlined numeral, section key stat, one-line takeaway |
| مجتمع الحالات بناءً على المخاطر | 4 tiles | Proportion-first: full-width stacked stage bar (tone-coded) + redesigned tiles with coverage micro-gauges |
| مجتمع/عيّنة حالات الفحص (land/sea) | table-only | Split composition: `rankedBar` top-ports chart + table with in-cell data bars; page 2+ tables keep data bars |
| حسب المستوى والمنفذ (×2) | 4 tables | Keep fixed-geometry tables, add per-cell proportional data bars + stage tone accents |
| نتائج الجودة / الدقة | percent tables | Threshold-colored bar cells (below-target rows: warning tone + glyph, never color alone) + section-opener funnel: population → sample → studied → اشتباه |
| Closing | — | NEW closing slide: revision footer elevated into a "data provenance" block + contact/classification |

## Visual system (theme v3)
- **Type scale:** hero numerals 4–6rem, section display 1.6rem, body 0.78rem, caption 0.62rem; `tabular-nums` everywhere; weight-driven hierarchy (900/700/600).
- **Depth:** layered radial glows on navy, 1px gold hairline system, elevated cards with tinted shadows; no glassmorphism slop, no AI-purple, no pure black.
- **Charts:** reuse `executive/ui/charts.ts` (rankedBar, gauge, stackedBars, sparkline) + two bespoke SVG builders (proportion bar, funnel). All inline SVG, RTL-mirrored, direct-labeled, recessive grids; any new color pair passes the CVD validator (≥12).
- **Motion:** on-screen only — staggered slide-entrance fade/rise via CSS `animation-delay`, disabled under `@media print` and `prefers-reduced-motion`. Zero motion in PDF output.
- **Print:** every slide re-verified for print-color-adjust, page breaks, light-print parity.

## Hard constraints (unchanged)
Single self-contained HTML · zero new dependencies · same `ReportModel` (numbers cannot change) · `esc()` on all interpolations (XSS suite must stay green) · RTL-native · existing nav-rail/print-toggle/variant contracts preserved · pixel-budget table machinery (v51.2–v51.4) preserved for tables that keep pagination · EDIT_LOG entries + gates per merge.

## Execution
One Opus build wave (theme v3 + all slides), verified in `/deck-preview.html` (fixture mirrors real data shape), then owner reviews live and iterates. Old look recoverable via git (owner also keeps a copy).
