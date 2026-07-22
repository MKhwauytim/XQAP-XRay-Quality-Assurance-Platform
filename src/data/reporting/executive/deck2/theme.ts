// Minimal v2-only CSS layered on top of the v1 deck theme (DECK_CSS).
// Content-first phase: just enough layout for the new pages to read clearly.
// The dedicated visual/design pass will replace or expand this later.

export const DECK_V2_CSS = `
/* ── Side navigation (on-screen only) ─────────────────────────────────────── */
/* Persistent left rail: current-section highlight + page progress. Populated
   and kept in sync by the inline script in index.ts (DECK_NAV_SCRIPT) from
   data-section/data-section-label attributes already on each slide — no
   separate section registry to keep in sync. Hidden in print (its own rule,
   far below) and on narrow screens where it would crowd the slide. */
.deck-nav{
  position:fixed;inset-inline-start:0;top:0;bottom:0;width:236px;z-index:60;
  display:flex;flex-direction:column;gap:22px;padding:22px 18px;
  background:rgba(2,16,30,.97);border-inline-end:1px solid rgba(255,255,255,.1);
  backdrop-filter:blur(10px);overflow-y:auto;
}
.deck-nav-brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:800;font-size:0.92rem;}
.deck-nav-brand-icon{display:inline-flex;color:var(--gold);}
.deck-nav-progress{display:flex;flex-direction:column;gap:8px;}
.deck-nav-progress-bar{height:6px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden;}
.deck-nav-progress-fill{height:100%;width:0%;background:var(--gold);border-radius:999px;transition:width .2s ease;}
.deck-nav-progress-text{font-size:0.72rem;font-weight:700;color:var(--slate);}
.deck-nav-sections{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
.deck-nav-item a{
  display:block;padding:10px 12px;border-radius:10px;font-size:0.8rem;font-weight:700;
  color:rgba(255,255,255,.62);text-decoration:none;border:1px solid transparent;
  transition:background .15s ease,color .15s ease,border-color .15s ease;
}
.deck-nav-item a:hover{background:rgba(255,255,255,.06);color:#fff;}
.deck-nav-item.active a{background:rgba(244,180,0,.13);border-color:rgba(244,180,0,.4);color:var(--gold);}

/* Full-screen review keeps the exit control available while fitting every
   16:9 slide inside the current viewport. */
body.deck-fullscreen{overflow-y:auto;scroll-snap-type:y mandatory;}
body.deck-fullscreen .deck-nav{display:none;}
body.deck-fullscreen .deck-viewer-v2{padding:78px 16px 16px;}
body.deck-fullscreen .deck-toolbar{
  position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:80;
  width:min(1120px,calc(100vw - 32px));margin:0;padding:9px 14px;
}
body.deck-fullscreen .slide{
  width:min(calc(100vw - 32px),calc((100dvh - 94px) * 297 / 167));
  margin:0 auto 18px;scroll-snap-align:start;scroll-snap-stop:always;
}
body.deck-fullscreen .srev-footer{display:none;}
body.theme-light .btn-fullscreen{color:#fff;}
.btn-fullscreen:focus-visible{outline:3px solid var(--gold);outline-offset:3px;}
@media screen and (min-width:1281px){
  .deck-viewer-v2{padding-inline-start:calc(236px + 16px);}
}
@media screen and (max-width:1280px){
  .deck-nav{display:none;}
}
@media print{
  .deck-nav{display:none!important;}
  .btn-fullscreen{display:none!important;}
}

/* ── Printed side tab rail (reference-mockup chrome, prints with the page) ── */
/* Vertical report-title strip + one rotated tab per section on each content
   slide's inline-start edge; active section gold. Arabic in vertical-rl
   renders rotated 90° in Chromium, matching the mockups' edge tabs. */
.v2-rail{
  position:absolute;top:0;bottom:0;inset-inline-start:0;width:46px;z-index:3;
  display:flex;flex-direction:column;align-items:stretch;gap:8px;
  padding:14px 7px;background:rgba(2,14,26,.62);
  border-inline-end:1px solid rgba(255,255,255,.08);
}
.v2-rail-title{
  flex:1;display:flex;align-items:center;justify-content:center;
  writing-mode:vertical-rl;
  font-size:0.6rem;font-weight:800;letter-spacing:.1em;color:rgba(255,255,255,.5);
  white-space:nowrap;overflow:hidden;
}
.v2-rail-tab{
  display:flex;align-items:center;justify-content:center;
  writing-mode:vertical-rl;padding:14px 0;
  font-size:0.6rem;font-weight:800;color:rgba(255,255,255,.5);white-space:nowrap;
  border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);
}
.v2-rail-tab.active{color:var(--navy);background:var(--gold);border-color:var(--gold);}
/* Content clears the rail (width-only change; row-height budgets untouched).
   The cover has no rail, so it keeps the default padding. */
.slide.v2 .slide-inner{padding-inline-start:68px;}
/* The cover's centered content (base CSS vertically centers .title-slide
   .slide-inner) used to overlap the absolutely-positioned .v2-org block in
   the top-inline-end corner once the headline + meta grid got tall enough.
   Anchoring to the top with a fixed clearance (org block's own height, ~98px,
   plus a small gap) instead of centering guarantees no overlap regardless of
   content height, at the cost of not being perfectly vertically centered. */
.slide.v2.title-slide .slide-inner{padding-inline-start:44px;justify-content:flex-start;padding-top:112px;}
/* Cover v3: the grid owns the vertical rhythm, so the inner just gives it room
   below the org header band and centers it in the remaining height. */
.slide.v2.title-slide.v2-cover .slide-inner{padding:100px 52px 40px;justify-content:center;align-items:stretch;text-align:start;}

/* ── Cover org block: logo + gold divider + org hierarchy lines ───────────── */
.v2-org{
  position:absolute;top:26px;inset-inline-start:44px;z-index:2;
  display:flex;align-items:center;gap:16px;
}
.v2-org-logo{height:48px;width:auto;filter:brightness(0) invert(1);opacity:.95;}
.v2-org-lines{
  display:flex;flex-direction:column;gap:3px;
  padding-inline-start:16px;border-inline-start:2px solid rgba(244,180,0,.55);
}
.v2-org-lines b{font-size:0.8rem;font-weight:800;color:#fff;}
.v2-org-lines span{font-size:0.66rem;font-weight:600;color:rgba(255,255,255,.6);}

/* ── Footer page number, centered with short gold rules either side ───────── */
.v2-page-foot{
  position:absolute;bottom:8px;left:0;right:0;z-index:2;
  display:flex;align-items:center;justify-content:center;gap:12px;
  font-size:0.68rem;font-weight:800;color:var(--slate);
  font-variant-numeric:tabular-nums;
}
.v2-page-foot::before,.v2-page-foot::after{
  content:"";width:26px;height:2px;border-radius:2px;background:rgba(244,180,0,.55);
}

/* ── Cover meta grid (period / issue date / department / section) ────────── */
.v2-cover-meta{
  display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:12px;
  margin-top:8px;max-width:760px;width:100%;
}
.v2-cover-meta-item{
  display:flex;align-items:center;gap:14px;text-align:start;
  border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 18px;
  background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));
  position:relative;overflow:hidden;
}
.v2-cover-meta-item::before{content:"";position:absolute;top:0;right:0;left:0;height:3px;background:var(--gold);opacity:.7;}
.v2-cover-meta-icon{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:38px;height:38px;border-radius:50%;border:1.5px solid rgba(244,180,0,.4);
  color:var(--gold);background:rgba(244,180,0,.08);
}
.v2-cover-meta-text{display:flex;flex-direction:column;gap:3px;min-width:0;}
.v2-cover-meta-label{font-size:0.7rem;font-weight:700;color:var(--slate);letter-spacing:.03em;}
.v2-cover-meta-value{font-size:0.95rem;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ── المحتويات agenda: plain numbered circle (v1's own default) + a small
   section icon beside the title text instead of crammed inside the circle
   (v39.30 — icon+number in one 46px circle read as cluttered). ──────────── */
.deck-agenda-icon{display:inline-flex;color:var(--gold);margin-inline-end:8px;vertical-align:-3px;}
.deck-agenda-item:nth-child(2) .deck-agenda-icon{color:var(--blue);}
.deck-agenda-item:nth-child(3) .deck-agenda-icon{color:var(--green);}
.deck-agenda-item:nth-child(4) .deck-agenda-icon{color:var(--coral);}

/* ── Glossary icon-card grid (reference design) ───────────────────────────── */
/* Glossary: two labeled category bands (sampling vocabulary / judgment
   vocabulary) — the chip + hairline header carries the category tone, and the
   cards inherit it, so accent color means membership, not decoration. */
.v2-term-section{display:flex;flex-direction:column;gap:16px;height:100%;}
.v2-term-band{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;}
.v2-term-band-head{display:flex;align-items:center;gap:14px;}
.v2-term-band-chip{
  display:inline-flex;align-items:center;gap:8px;flex-shrink:0;
  padding:5px 14px;border-radius:999px;font-size:0.72rem;font-weight:800;
  color:var(--gold);border:1px solid rgba(244,180,0,.4);background:rgba(244,180,0,.08);
}
.v2-term-band.coral .v2-term-band-chip{color:var(--coral);border-color:rgba(255,118,95,.4);background:rgba(255,118,95,.08);}
.v2-term-band-rule{flex:1;height:1px;background:linear-gradient(to left,rgba(244,180,0,.45),transparent);}
.v2-term-band.coral .v2-term-band-rule{background:linear-gradient(to left,rgba(255,118,95,.45),transparent);}
.v2-term-grid{
  display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:1fr;gap:14px;
  align-content:stretch;flex:1;min-height:0;
}
.v2-term-card{
  display:flex;flex-direction:column;gap:9px;min-width:0;
  border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px 14px 13px;
  background:linear-gradient(180deg,rgba(14,58,95,.6),rgba(7,39,67,.8));
  position:relative;overflow:hidden;
}
.v2-term-card::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--gold);}
.v2-term-card.blue::after{background:var(--blue);}
.v2-term-card.green::after{background:var(--green);}
.v2-term-card.coral::after{background:var(--coral);}
.v2-term-card.slate::after{background:var(--slate);}
.v2-term-card.purple::after{background:var(--purple);}
.v2-term-card.cyan::after{background:var(--cyan);}
.v2-term-card-head{display:flex;align-items:center;gap:10px;}
.v2-term-icon{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:38px;height:38px;border-radius:12px;border:1.6px solid currentColor;color:var(--gold);
  background:rgba(244,180,0,.08);
}
.v2-term-card.blue .v2-term-icon{background:rgba(107,169,248,.1);}
.v2-term-card.green .v2-term-icon{background:rgba(139,195,74,.1);}
.v2-term-card.coral .v2-term-icon{background:rgba(255,118,95,.1);}
.v2-term-card.slate .v2-term-icon{background:rgba(138,160,181,.1);}
.v2-term-card.purple .v2-term-icon{background:rgba(176,122,223,.12);}
.v2-term-card.cyan .v2-term-icon{background:rgba(50,197,210,.1);}
.v2-term-card.blue .v2-term-icon{color:var(--blue);}
.v2-term-card.green .v2-term-icon{color:var(--green);}
.v2-term-card.coral .v2-term-icon{color:var(--coral);}
.v2-term-card.slate .v2-term-icon{color:var(--slate);}
.v2-term-card.purple .v2-term-icon{color:var(--purple);}
.v2-term-card.cyan .v2-term-icon{color:var(--cyan);}
.v2-term-card-head b{font-size:0.92rem;font-weight:800;color:#fff;line-height:1.25;}
.v2-term-card p{margin:0;font-size:0.74rem;line-height:1.55;color:rgba(255,255,255,.82);}
body.theme-light .v2-term-band-chip{background:rgba(244,180,0,.12);}
body.theme-light .v2-term-band.coral .v2-term-band-chip{background:rgba(255,118,95,.12);}

/* ── Section separator ────────────────────────────────────────────────────── */
/* Decorative glow behind the separator content — reuses the cover page's
   radial-gradient language so both "big statement" slide types feel related. */
.v2-sep-bg{
  position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(ellipse 55% 50% at 50% 30%,rgba(244,180,0,.09),transparent 65%),
    radial-gradient(ellipse 60% 45% at 50% 90%,rgba(107,169,248,.06),transparent 65%);
}
.v2-sep{
  position:relative;z-index:1;
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;gap:12px;
}
.v2-sep-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:64px;height:64px;border-radius:50%;color:var(--gold);
  border:1.6px solid rgba(244,180,0,.4);background:rgba(244,180,0,.08);
  margin-bottom:4px;
}
.v2-sep-num{font-size:4.6rem;font-weight:900;color:var(--gold);opacity:.92;line-height:1;}
.v2-sep h2{font-size:2.6rem;color:#fff;margin:0;font-weight:900;}
.v2-sep-rule{height:3px;width:70px;background:var(--gold);border-radius:2px;opacity:.75;margin:2px 0;}
.v2-sep p{color:var(--muted);max-width:600px;font-size:0.95rem;line-height:1.75;margin:0;}

/* ── Risk-stage card (reference layout: numbered circle + title, a list of
   rows separated by divider lines, a short colored tag at the bottom).
   Alternating background tint for rhythm, adapted from the reference's
   light/white alternation to this deck's dark theme. Tone (gold/blue/green/
   coral) comes from the SAME per-level color already used across this
   report, applied to the number circle and the bottom tag only. ────────── */
.v2-stage-card{
  display:flex;flex-direction:column;height:100%;
  border:1px solid rgba(255,255,255,.13);border-radius:14px;padding:16px 16px 14px;
  background:rgba(255,255,255,.018);
}
.v2-stage-card:nth-child(even){background:rgba(255,255,255,.045);}
.v2-stage-head{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.v2-stage-num{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:28px;height:28px;border-radius:50%;font-size:0.85rem;font-weight:900;
  color:var(--navy);background:var(--gold);
}
.v2-stage-card.blue .v2-stage-num{background:var(--blue);}
.v2-stage-card.green .v2-stage-num{background:var(--green);}
.v2-stage-card.coral .v2-stage-num{background:var(--coral);}
.v2-stage-head b{font-size:0.86rem;font-weight:800;color:#fff;letter-spacing:.02em;}
.v2-stage-list{display:flex;flex-direction:column;flex:1;}
.v2-stage-row{
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 2px;border-bottom:1px solid rgba(255,255,255,.1);
  font-size:0.78rem;
}
.v2-stage-row:last-child{border-bottom:0;}
.v2-stage-row span{color:var(--slate);font-weight:600;}
.v2-stage-row b{color:#fff;font-weight:800;}
.v2-stage-tag{
  margin-top:12px;text-align:center;font-size:0.74rem;font-weight:800;color:var(--gold);
}
.v2-stage-card.blue .v2-stage-tag{color:var(--blue);}
.v2-stage-card.green .v2-stage-tag{color:var(--green);}
.v2-stage-card.coral .v2-stage-tag{color:var(--coral);}

/* ── Risk-stage totals band (icon + value/label per figure) ──────────────── */
.v2-totals-band{
  margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;
}
.v2-totals-item{
  display:flex;align-items:center;gap:12px;justify-content:center;
  border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 16px;
  background:rgba(255,255,255,.02);
}
.v2-totals-icon{display:inline-flex;color:var(--gold);flex-shrink:0;}
.v2-totals-item b{display:block;font-size:1.15rem;font-weight:900;color:#fff;line-height:1.2;}
.v2-totals-item small{display:block;font-size:0.7rem;color:var(--slate);margin-top:2px;}

/* ── Stage×port grid (2 cards per row, one per risk stage 1–4) ────────────── */
/* Reuses .v2-stage-card's border/background/tone classes (gold/blue/green/coral,
   already defined above) as the outer card — only the internal content differs
   (a compact table instead of the stat-row list riskStagesSlide uses). No
   manual RTL reordering needed: in this RTL document, a plain 2-column grid
   with cards in DOM order stage1→stage4 places stage1 top-right, stage2
   top-left, stage3 bottom-right, stage4 bottom-left — the exact arrangement
   in the reference mockups (2026-07-05 stage-port-grid design spec §3). */
.v2-stage-port-grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:14px;flex:1;min-height:0;}
.v2-stage-port-card{padding:12px 12px 10px;}
.v2-stage-port-card .v2-stage-head{margin-bottom:8px;}
.v2-stage-port-card .deck-table{width:100%;}
.v2-stage-port-card .deck-table th,.v2-stage-port-card .deck-table td{padding:3px 6px;font-size:0.6rem;}
.v2-stage-port-card .deck-table th{font-size:0.58rem;}
/* Totals row (الإجمالي): a distinct summary band tinted with the card's own
   stage tone, so it reads as a conclusion rather than a sixth data row.
   color-mix is safe — this app is Chromium-only (File System Access API). */
.v2-stage-port-card .deck-table tfoot td{
  font-weight:900;color:#fff;border-bottom:0;
  border-top:1.5px solid rgba(255,255,255,.25);background:rgba(255,255,255,.07);
}
.v2-stage-port-card.gold  .deck-table tfoot td{background:color-mix(in srgb, var(--gold) 16%, transparent);border-top-color:color-mix(in srgb, var(--gold) 55%, transparent);}
.v2-stage-port-card.blue  .deck-table tfoot td{background:color-mix(in srgb, var(--blue) 16%, transparent);border-top-color:color-mix(in srgb, var(--blue) 55%, transparent);}
.v2-stage-port-card.green .deck-table tfoot td{background:color-mix(in srgb, var(--green) 16%, transparent);border-top-color:color-mix(in srgb, var(--green) 55%, transparent);}
.v2-stage-port-card.coral .deck-table tfoot td{background:color-mix(in srgb, var(--coral) 16%, transparent);border-top-color:color-mix(in srgb, var(--coral) 55%, transparent);}
body.theme-light .v2-stage-port-card .deck-table tfoot td{color:#0a2d4a;}
/* The sample page's "{sampleSize} / {population}" figure in the card header —
   dir="ltr" on this span (set in slides.ts) prevents the same bidi-reversal
   bug the variant-switcher counter had (EDIT_LOG v40.7: "1 / 4" rendered as
   "4 / 1" without it). */
.v2-stage-port-figure{margin-inline-start:auto;font-size:0.85rem;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums;}
.v2-stage-port-card.blue .v2-stage-port-figure{color:var(--blue);}
.v2-stage-port-card.green .v2-stage-port-figure{color:var(--green);}
.v2-stage-port-card.coral .v2-stage-port-figure{color:var(--coral);}

/* ── Port population tables (land / sea, side by side) ────────────────────── */
/* Tinted cards per the reference design: green = بري, blue = بحري. Tables
   contain only real data rows followed directly by the الإجمالي totals row. */
.v2-port-split{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:stretch;height:100%;}
.v2-port-col{
  display:flex;flex-direction:column;gap:0;min-width:0;
  border:1px solid rgba(255,255,255,.14);border-radius:14px;overflow:hidden;
  background:linear-gradient(180deg,rgba(20,66,48,.55),rgba(10,40,30,.65));
  box-shadow:0 10px 24px rgba(0,0,0,.22);
}
.v2-port-col.sea{background:linear-gradient(180deg,rgba(16,52,92,.6),rgba(8,32,60,.7));}
.v2-port-col-head{
  display:flex;align-items:center;gap:12px;
  padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.04);
}
.v2-port-col-head .v2-port-col-icon{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:36px;height:36px;border-radius:50%;color:var(--green);
  border:1.5px solid rgba(139,195,74,.4);background:rgba(139,195,74,.1);
}
.v2-port-col.sea .v2-port-col-head .v2-port-col-icon{
  color:var(--blue);border-color:rgba(107,169,248,.4);background:rgba(107,169,248,.1);
}
.v2-port-col-head b{display:block;font-size:0.95rem;font-weight:800;color:#fff;}
.v2-port-col-head span{display:block;color:var(--slate);font-weight:600;font-size:0.72rem;margin-top:2px;}
.v2-port-col .deck-table{background:transparent;border-radius:0;}
.v2-port-col .deck-table th{background:rgba(255,255,255,.07);}
/* Common padding: sized for PLAIN single-line content (thead in both modes,
   and the population table's own body/foot). Sample's stacked "N من M" cells
   are inherently taller, so they get their own body/foot padding below
   rather than shrinking to fit this one (v39.16 — see file header for the
   ink-overlap bug this replaces). */
.v2-port-col .deck-table th,.v2-port-col .deck-table td{padding:10px 10px;font-size:0.78rem;}
.v2-port-col .deck-table tfoot td{
  font-weight:900;color:#fff;background:rgba(255,255,255,.07);
  border-top:1px solid rgba(255,255,255,.2);border-bottom:0;
}
/* Compact variant (small overflow, 1-3 rows): trims padding/font so a table
   can fit its full port list on one page instead of spilling a nearly empty
   continuation page. Sized to fit BASE_ROWS_PER_PAGE + COMPRESS_OVERFLOW_MAX
   rows inside the same row budget. Measured in the live preview (v39.9/16). */
.v2-port-col.compact .deck-table th,.v2-port-col.compact .deck-table td{padding:3.5px 6px;font-size:0.66rem;}
/* Sample-specific body/foot padding (both tiers) — smaller than the common
   padding above because the stacked frac cell needs more of its own internal
   room. Scoped to tbody/tfoot only so sample's thead stays on the common
   padding and matches thead everywhere else (v39.16). */
.v2-port-col.sample-mode .deck-table tbody td,
.v2-port-col.sample-mode .deck-table tfoot td{padding:7.5px 10px!important;}
.v2-port-col.sample-mode.compact .deck-table tbody td,
.v2-port-col.sample-mode.compact .deck-table tfoot td{padding:0px 6px!important;}
/* Auto-fit المنفذ: numeric columns shrink to content, the name column takes the rest. */
.v2-port-col .deck-table{table-layout:auto;}
.v2-port-col .deck-table th:first-child,.v2-port-col .deck-table td:first-child{
  width:auto;overflow:visible;text-overflow:clip;
}
.v2-port-col .deck-table th:not(:first-child),.v2-port-col .deck-table td:not(:first-child){width:1%;}
/* Stacked العيّنة cell: sample (big) over "من {population}" (small). Tuned
   (v39.16) against real font-metric ink measurements (canvas measureText
   actualBoundingBoxAscent/Descent), not just layout-box gaps — a layout gap
   of 0 does NOT mean the glyphs don't overlap if line-height is tight enough
   that a line's own ink overflows its box. Both lines here have a verified
   positive ink margin. Lands on the same total row height as a plain
   population cell (41px normal / 25px compact) given the padding above. */
.v2-frac{display:inline-flex;flex-direction:column;align-items:center;line-height:1.05;}
.v2-frac b{font-weight:800;font-size:0.7rem;}
.v2-frac span{font-size:0.5rem;color:var(--muted);white-space:nowrap;}
.v2-port-col.compact .v2-frac{line-height:1.15;}
.v2-port-col.compact .v2-frac b{font-size:.58rem;}
.v2-port-col.compact .v2-frac span{font-size:.46rem;}

/* ── Slide-level controls cluster (top-right corner, on-screen only) ──────── */
/* Groups the print-include toggle and (dev-preview only) style-variant
   switcher in one positioned wrapper so they sit next to each other. Sits in
   the top inline-END corner (physical left in RTL) so it never overlaps the
   printed side rail at the inline-start edge (v39.27). Previously the
   switcher was absolutely positioned INSIDE the slide's padded content box
   (\`.v2-variant-stack\`), which put it nowhere near the print toggle and
   sometimes over the slide's own headline — see slides.ts's
   \`slideControls()\`/\`variantSwitcher()\`.
   Known pre-existing limitation (not introduced by this change): \`.slide\`
   has \`isolation:isolate\` (its own stacking context), so no z-index here can
   ever win against the sticky \`.deck-toolbar\` outside it — whenever a
   slide's top-12px corner scrolls into the toolbar's 74px band, these
   controls are briefly covered. True fix needs restructuring the stacking
   context, out of scope for this pass. */
.slide-controls{
  position:absolute;top:12px;left:14px;z-index:6;
  display:flex;align-items:center;gap:8px;
}
@media print{.slide-controls{display:none!important;}}

/* Pure CSS, no script: unchecking a slide's switch excludes THAT slide from
   print/PDF via the :has() rule below. Safe to rely on :has() — this app
   already targets Chromium only (File System Access API requirement). */
.slide-print-toggle{display:flex;align-items:center;cursor:pointer;}
.slide-print-toggle input{position:absolute;opacity:0;width:1px;height:1px;}
.slide-print-toggle-track{
  display:block;width:34px;height:18px;border-radius:999px;
  background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);
  transition:background .15s ease;position:relative;
}
.slide-print-toggle-thumb{
  display:block;position:absolute;top:1px;left:1px;width:14px;height:14px;
  border-radius:50%;background:#fff;transition:transform .15s ease;
}
.slide-print-toggle input:checked + .slide-print-toggle-track{background:var(--gold);border-color:var(--gold);}
.slide-print-toggle input:checked + .slide-print-toggle-track .slide-print-toggle-thumb{transform:translateX(16px);}
.slide-print-toggle input:focus-visible + .slide-print-toggle-track{outline:2px solid var(--gold);outline-offset:2px;}
@media print{
  .slide:has(.slide-print-toggle input:not(:checked)){display:none!important;}
}

@media screen and (max-width:820px){
  .deck-viewer-v2{padding:12px 8px 36px;}
  .deck-toolbar{position:relative;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;}
  .deck-toolbar .deck-brand span{display:none;}
  .deck-toolbar-actions{gap:8px;flex-wrap:wrap;}
  .deck-toolbar .btn{padding:8px 11px;font-size:.72rem;}
  .slide.v2{aspect-ratio:auto;min-height:0;overflow:visible;}
  .slide.v2 .v2-rail{display:none;}
  .slide.v2 .slide-inner{padding:24px 16px 28px;}
  .slide.v2.title-slide.v2-cover .slide-inner{padding:100px 20px 36px;}
  .slide.v2 .slide-body{overflow:visible;}
  .v2-term-grid,.v2-port-split,.v2-cover-meta,.v2-stage-port-grid{grid-template-columns:1fr;grid-template-rows:auto;height:auto;}
  .v2-port-col{overflow-x:auto;}
  .v2-port-col .deck-table{min-width:0;table-layout:fixed;}
  .v2-port-col .deck-table th:first-child,.v2-port-col .deck-table td:first-child{width:34%;overflow-wrap:anywhere;}
  .v2-port-col .deck-table th:not(:first-child),.v2-port-col .deck-table td:not(:first-child){width:auto;}
  .v2-stage-port-card .deck-table{table-layout:fixed;}
  .v2-stage-port-card .deck-table th,.v2-stage-port-card .deck-table td{overflow-wrap:anywhere;}
}

/* ── Style-variant switcher (dev-preview only, never in production output) ── */
/* .v2-variant-stack takes over the flex-sizing role of whatever container it
   sits in (\`.slide-body\` or directly \`.slide-inner\`), so wrapping existing
   content in it does not change the slide's flex sizing
   — only the ACTIVE panel is flex/visible, matching the original single-child
   layout the budget math was measured against. The switcher UI itself now
   lives in \`.slide-controls\` (next to the print toggle), not inside the
   stack — this is just the panel-swapping container. */
.v2-variant-stack{
  flex:1 1 auto;min-height:0;display:flex;flex-direction:column;
}
.v2-variant-panel{display:none;flex:1 1 auto;min-height:0;flex-direction:column;}
.v2-variant-panel.active{display:flex;}
.v2-variant-switcher{
  display:flex;align-items:center;gap:6px;
  background:rgba(2,16,30,.72);border:1px solid rgba(255,255,255,.16);border-radius:999px;
  padding:3px 8px;font-size:0.68rem;font-weight:700;color:rgba(255,255,255,.75);
}
.v2-variant-switcher button{
  border:0;background:rgba(255,255,255,.08);color:#fff;border-radius:999px;
  width:20px;height:20px;display:grid;place-items:center;cursor:pointer;font-size:0.85rem;line-height:1;
  padding:0;
}
.v2-variant-switcher button:hover{background:var(--gold);color:var(--navy);}
.v2-variant-label{min-width:32px;text-align:center;font-variant-numeric:tabular-nums;}

/* ── Light theme re-skin (toolbar toggle) ─────────────────────────────────── */
/* Mirrors the old deck's \`.page.light\` pattern (theme.ts / EXEC_CSS): swap
   background/ink/border colors on top of whatever variant is currently
   showing, no new markup. deckTheme.ts covers components shared with v1
   (kpi-tile, deck-table, deck-card, ...); this block is deck2-only
   components (v2-term-card, v2-stage-card, v2-port-col, v2-rail, deck-nav).
   Every selector here matches or beats the specificity of the dark-theme
   rule it overrides (e.g. \`.v2-stage-head b\`, not just \`.v2-stage-head\`) —
   a lower-specificity override silently loses the cascade and leaves white
   text on the new white background. */
body.theme-light{background:#eef2f6;}
body.theme-light .slide{
  background:linear-gradient(150deg,#ffffff,#f4f6f9 65%);
  border-color:#dde4ea;color:#0a2d4a;
}
body.theme-light .slide-headline,body.theme-light h2{color:#0a2d4a;}
body.theme-light .slide-subhead{color:#8a6d1f;}
body.theme-light .muted,body.theme-light .v2-stage-row span{color:#607386;}
body.theme-light .kpi-tile,body.theme-light .v2-term-card,body.theme-light .v2-stage-card{
  background:#ffffff;border-color:#dde4ea;color:#0a2d4a;box-shadow:0 6px 16px rgba(10,45,74,.08);
}
body.theme-light .v2-term-card-head b,body.theme-light .v2-term-card p{color:#0a2d4a;}
body.theme-light .v2-stage-head b,body.theme-light .v2-stage-row b{color:#0a2d4a;}
body.theme-light .v2-totals-item{background:#ffffff;border-color:#dde4ea;}
body.theme-light .v2-totals-item b{color:#0a2d4a;}
body.theme-light .v2-totals-item small{color:#607386;}
body.theme-light .v2-sep h2{color:#0a2d4a;}
body.theme-light .v2-sep p{color:#607386;}
body.theme-light .v2-org-lines b{color:#0a2d4a;}
body.theme-light .v2-org-lines span{color:#607386;}
body.theme-light .v2-org-logo{filter:none;}
body.theme-light .v2-cover-meta-item{background:#ffffff;border-color:#dde4ea;}
body.theme-light .v2-cover-meta-value{color:#0a2d4a;}
body.theme-light .v2-cover-meta-label{color:#607386;}
body.theme-light .v2-port-col{
  background:linear-gradient(180deg,#eef7ee,#e4f1e4);box-shadow:0 6px 16px rgba(10,45,74,.08);
}
body.theme-light .v2-port-col.sea{background:linear-gradient(180deg,#eaf2fb,#dfeaf8);}
body.theme-light .v2-port-col-head{background:rgba(10,45,74,.04);border-bottom-color:#dde4ea;}
body.theme-light .v2-port-col-head b{color:#0a2d4a;}
body.theme-light .v2-port-col-head span{color:#607386;}
body.theme-light .deck-table{background:#ffffff;color:#0a2d4a;}
body.theme-light .deck-table th{background:#0e3a5f;color:#fff;}
body.theme-light .deck-table td{border-color:#e3e8ee;color:#0a2d4a;}
body.theme-light .v2-port-col .deck-table th{background:rgba(10,45,74,.07);color:#0a2d4a;}
body.theme-light .v2-port-col .deck-table tfoot td{color:#0a2d4a;background:rgba(10,45,74,.06);border-top-color:rgba(10,45,74,.18);}
body.theme-light .v2-frac span{color:#607386;}
body.theme-light .deck-table .insuff{color:#8a97a6;}
body.theme-light .deck-nav{background:rgba(255,255,255,.97);border-inline-end-color:#dde4ea;}
body.theme-light .deck-nav-brand{color:#0a2d4a;}
body.theme-light .deck-nav-progress-bar{background:rgba(10,45,74,.08);}
body.theme-light .deck-nav-item a{color:rgba(10,45,74,.62);}
body.theme-light .deck-nav-item a:hover{background:rgba(10,45,74,.06);color:#0a2d4a;}
body.theme-light .deck-nav-item.active a{background:rgba(244,180,0,.13);color:#8a6d1f;}
body.theme-light .v2-rail{background:linear-gradient(180deg,#f4f6f9,#e7edf2);border-color:#dde4ea;}
body.theme-light .v2-rail-title,body.theme-light .v2-rail-tab{color:#5b6b78;}
body.theme-light .v2-variant-switcher{background:rgba(255,255,255,.85);border-color:#dde4ea;color:#3a4a58;}
body.theme-light .v2-variant-switcher button{background:rgba(10,45,74,.08);color:#0a2d4a;}

/* ═══════════════════════════════════════════════════════════════════════════
   THEME v3 — visual overhaul layer (2026-07-14). Type scale, layered depth,
   gold hairline system, entrance motion, and every new component from the
   overhaul spec. Print + light-theme parity live at the end of this block.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Type scale (fixed rem — print-safe) + gold hairline token ──────────────── */
.slide.v2{--fs-hero:4.4rem;--fs-display:1.7rem;--fs-num-hero:5rem;--gold-hair:rgba(244,180,0,.5);}

/* ── Shared hex-texture card background (the ".v2-num-tile" motif, reused) ──
   One hand-copied hero-patterns "hexagons" motif baked at <=.05 alpha, defined
   ONCE here and referenced by every card that wants the same quiet texture —
   layer it as background-image's FIRST entry, with the card's own color/
   gradient as the second, e.g.:
     background-image:var(--v2-hex-tex), linear-gradient(...);
     background-repeat:repeat, no-repeat;
   and mirror with --v2-hex-tex-light under body.theme-light. Adding the
   texture to a new card is then a 2-line addition, not a copy-pasted data URI. */
.slide.v2{
  --v2-hex-tex:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill='%23ffffff' fill-opacity='0.045'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/svg%3E");
  --v2-hex-tex-light:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill='%230a2d4a' fill-opacity='0.04'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/svg%3E");
}

/* ── Entrance stagger (on-screen only; never in print or reduced-motion) ────── */
@keyframes v2-rise{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}
@media screen and (prefers-reduced-motion:no-preference){
  .slide.v2 .slide-eyebrow{animation:v2-rise .5s ease both;}
  .slide.v2 .slide-headline{animation:v2-rise .5s ease both;animation-delay:.06s;}
  .slide.v2 .slide-subhead{animation:v2-rise .5s ease both;animation-delay:.12s;}
  .slide.v2 .slide-body{animation:v2-rise .55s ease both;animation-delay:.18s;}
  .slide.v2-cover .v2-cover-grid,.slide.v2-sep-slide .v2-sep{animation:v2-rise .55s ease both;animation-delay:.1s;}
}
@media print{.slide.v2 .slide-eyebrow,.slide.v2 .slide-headline,.slide.v2 .slide-subhead,.slide.v2 .slide-body,.slide.v2 .v2-cover-grid,.slide.v2 .v2-sep{animation:none!important;}}

/* ── In-cell data bars (pure background — never change row height) ──────────── */
.v2-bar-cell{
  background-image:linear-gradient(to left,var(--bar,transparent) 0,var(--bar,transparent) var(--w,0%),transparent var(--w,0%));
  background-repeat:no-repeat;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.v2-bar-cell.neutral{--bar:rgba(255,255,255,.10);}
.v2-bar-cell.gold{--bar:rgba(244,180,0,.24);}
.v2-bar-cell.blue{--bar:rgba(107,169,248,.24);}
.v2-bar-cell.green{--bar:rgba(139,195,74,.24);}
.v2-bar-cell.coral{--bar:rgba(255,118,95,.26);}
.v2-bar-cell.ok{--bar:rgba(139,195,74,.24);}
.v2-bar-cell.warn{--bar:rgba(244,180,0,.30);}
.v2-cell-flag{display:inline-flex;vertical-align:-1px;margin-inline-end:3px;color:var(--coral);}
body.theme-light .v2-bar-cell.neutral{--bar:rgba(10,45,74,.10);}
body.theme-light .v2-bar-cell.gold{--bar:rgba(244,180,0,.28);}
body.theme-light .v2-bar-cell.blue{--bar:rgba(107,169,248,.28);}
body.theme-light .v2-bar-cell.green{--bar:rgba(139,195,74,.30);}
body.theme-light .v2-bar-cell.coral{--bar:rgba(255,118,95,.30);}
body.theme-light .v2-bar-cell.ok{--bar:rgba(139,195,74,.30);}
body.theme-light .v2-bar-cell.warn{--bar:rgba(244,180,0,.34);}

/* ── Cover v3 — layered navy depth + geometric band + month lockup ─────────── */
.slide.v2-cover{background:linear-gradient(155deg,#073257,#041d38 58%,#03152b),var(--navy);}
.slide.v2-cover .slide-art{
  background:
    radial-gradient(ellipse 52% 46% at 80% 20%,rgba(244,180,0,.13),transparent 60%),
    radial-gradient(ellipse 56% 52% at 12% 86%,rgba(107,169,248,.11),transparent 62%),
    radial-gradient(ellipse 40% 40% at 50% 50%,rgba(255,255,255,.02),transparent 70%);
}
/* The v3 cover has its own geometric band + glows, so drop the v1 title-slide's
   rotated-rectangle/diagonal-streak pseudo-elements (their left:-4% offset also
   inflated the slide's scrollWidth by ~53px, clipped but noisy). */
.slide.v2-cover .slide-art::before,.slide.v2-cover .slide-art::after{display:none;}
.v2-cover-band{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;}
.v2-cover-grid{position:relative;z-index:1;display:grid;grid-template-columns:1.42fr .9fr;gap:36px;align-items:center;width:100%;}
.v2-cover-hero{display:flex;flex-direction:column;gap:15px;min-width:0;}
.v2-cover-kicker{display:inline-flex;align-items:center;gap:10px;color:var(--gold);font-weight:800;font-size:0.8rem;letter-spacing:.16em;}
.v2-cover-kicker-dot{width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px rgba(244,180,0,.16);flex-shrink:0;}
.v2-cover-title{font-size:var(--fs-hero);font-weight:900;line-height:1.04;letter-spacing:-.01em;color:#fff;margin:0;}
.v2-cover-rule{height:4px;width:132px;border-radius:3px;background:linear-gradient(90deg,var(--gold),rgba(244,180,0,0));}
.v2-cover-lockup{display:flex;flex-direction:column;gap:2px;margin-top:2px;}
.v2-cover-lockup-label{font-size:0.72rem;font-weight:700;color:var(--slate);letter-spacing:.04em;}
.v2-cover-lockup-period{font-size:2.1rem;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums;line-height:1.1;}
.v2-cover-badge{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;margin-top:8px;padding:9px 18px;border:1px solid rgba(244,180,0,.4);border-radius:999px;font-size:0.78rem;font-weight:700;color:var(--gold);background:rgba(244,180,0,.07);}
.v2-cover-badge span{display:inline-flex;}
.v2-cover-meta-col{display:flex;flex-direction:column;gap:10px;}
.v2-cover-meta-col .v2-cover-meta-item{padding:12px 16px;}

/* ── TOC v3 — tone-coded numbered section cards + key figure ────────────────── */
.v2-toc-grid{display:flex;flex-direction:column;gap:13px;height:100%;justify-content:center;}
.v2-toc-card{
  display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;
  border:1px solid rgba(255,255,255,.13);border-radius:14px;padding:15px 20px;
  background:rgba(255,255,255,.022);position:relative;overflow:hidden;
}
.v2-toc-card::before{content:"";position:absolute;top:0;bottom:0;inset-inline-start:0;width:4px;background:var(--gold);}
.v2-toc-card.blue::before{background:var(--blue);}
.v2-toc-card.green::before{background:var(--green);}
.v2-toc-card.coral::before{background:var(--coral);}
.v2-toc-num{
  width:46px;height:46px;border-radius:13px;display:grid;place-items:center;
  font-size:1.3rem;font-weight:900;color:var(--navy);background:var(--gold);font-variant-numeric:tabular-nums;
}
.v2-toc-card.blue .v2-toc-num{background:var(--blue);}
.v2-toc-card.green .v2-toc-num{background:var(--green);}
.v2-toc-card.coral .v2-toc-num{background:var(--coral);}
.v2-toc-main{min-width:0;}
.v2-toc-main h4{margin:0 0 3px;font-size:1.02rem;color:#fff;font-weight:800;display:flex;align-items:center;gap:9px;}
.v2-toc-icon{display:inline-flex;color:var(--gold);}
.v2-toc-card.blue .v2-toc-icon{color:var(--blue);}
.v2-toc-card.green .v2-toc-icon{color:var(--green);}
.v2-toc-card.coral .v2-toc-icon{color:var(--coral);}
.v2-toc-main p{margin:0;font-size:0.82rem;color:rgba(255,255,255,.72);line-height:1.5;}
.v2-toc-side{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;text-align:end;}
.v2-toc-figure{font-size:1.4rem;font-weight:900;color:var(--gold);line-height:1;font-variant-numeric:tabular-nums;}
.v2-toc-card.blue .v2-toc-figure{color:var(--blue);}
.v2-toc-card.green .v2-toc-figure{color:var(--green);}
.v2-toc-card.coral .v2-toc-figure{color:var(--coral);}
.v2-toc-figure-label{font-size:0.64rem;font-weight:700;color:var(--slate);}
.v2-toc-range{margin-top:5px;font-size:0.72rem;font-weight:800;color:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:3px 12px;font-variant-numeric:tabular-nums;}

/* ── مؤشرات الشهر — compact hero + grouped stat tiles + port tables ─────────── */
/* Owner feedback 2026-07-20: this page absorbed the old standalone ports-chart
   page, so the top band (hero + tiles) had to shrink to leave room for the
   port tables below — hence \`.compact\` on the hero and the flatter tile
   groups instead of the old full-height 2-row tile grid. Raw population/
   sample tiles and the one reviewer-accuracy tile are separate \`.v2-tile-group\`
   blocks (own label caption) so the two data sources never read as one
   undifferentiated pile — the accuracy number comes from a STUDY, not a
   straight tally. */
.v2-summary-layout{display:flex;flex-direction:column;gap:14px;height:100%;}
.v2-summary-top{display:grid;grid-template-columns:.9fr 2.1fr;gap:16px;flex:0 0 auto;}
.v2-summary-tilegroups{display:flex;gap:14px;align-items:stretch;}
.v2-tile-group{display:flex;flex-direction:column;gap:7px;min-width:0;}
.v2-tile-group.raw{flex:3;}
.v2-tile-group.study{flex:1;}
.v2-tile-group-label{font-size:0.6rem;font-weight:800;color:var(--slate);letter-spacing:.03em;padding-inline-start:2px;}
.v2-tile-group .v2-num-tiles{flex:1;}
.v2-tile-group.raw .v2-num-tiles{grid-template-columns:repeat(3,1fr);}
.v2-tile-group.study .v2-num-tiles{grid-template-columns:1fr;height:100%;}
.v2-tile-group.study .v2-num-tile{height:100%;}
.v2-num-hero{
  display:flex;flex-direction:column;justify-content:center;gap:6px;padding:22px 24px;
  border:1px solid rgba(244,180,0,.28);border-radius:16px;
  background:linear-gradient(160deg,rgba(244,180,0,.12),rgba(244,180,0,.02));
}
.v2-num-hero.compact{padding:14px 18px;gap:4px;}
.v2-num-hero.compact .v2-num-hero-value{font-size:2.5rem;}
.v2-num-hero.compact .v2-num-hero-rule{margin:6px 0 2px;}
.v2-num-hero-label{font-size:0.82rem;font-weight:700;color:var(--slate);}
.v2-num-hero-value{font-size:var(--fs-num-hero);font-weight:900;line-height:.95;color:var(--gold);letter-spacing:-.02em;font-variant-numeric:tabular-nums;text-shadow:0 0 34px rgba(244,180,0,.22);}
.v2-num-hero-unit{font-size:0.84rem;color:rgba(255,255,255,.8);line-height:1.4;}
.v2-num-hero-rule{height:2px;width:100%;background:linear-gradient(90deg,var(--gold),rgba(244,180,0,.05));margin:10px 0 4px;border-radius:2px;}
.v2-num-hero-split{display:flex;gap:24px;}
.v2-num-hero-split span{display:flex;flex-direction:column;}
.v2-num-hero-split b{font-size:1.4rem;font-weight:900;color:#fff;line-height:1;font-variant-numeric:tabular-nums;}
.v2-num-hero-split small{font-size:0.72rem;color:var(--slate);margin-top:3px;}
.v2-num-tiles{display:grid;gap:14px;}
.v2-num-tile{
  display:flex;align-items:flex-start;gap:12px;min-width:0;
  border:1px solid rgba(255,255,255,.13);border-radius:14px;padding:14px 15px;
  background:linear-gradient(180deg,rgba(14,58,95,.6),rgba(7,39,67,.75));position:relative;overflow:hidden;
}
.v2-num-tile::before{content:"";position:absolute;top:0;bottom:0;inset-inline-start:0;width:3px;background:var(--gold);}
.v2-num-tile.blue::before{background:var(--blue);}.v2-num-tile.cyan::before{background:var(--cyan);}
.v2-num-tile.coral::before{background:var(--coral);}.v2-num-tile.purple::before{background:var(--purple);}
.v2-num-tile.green::before{background:var(--green);}
.v2-num-tile-icon{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:36px;height:36px;border-radius:11px;color:var(--gold);border:1.4px solid rgba(244,180,0,.35);background:rgba(244,180,0,.08);}
.v2-num-tile.blue .v2-num-tile-icon{color:var(--blue);border-color:rgba(107,169,248,.35);background:rgba(107,169,248,.1);}
.v2-num-tile.cyan .v2-num-tile-icon{color:var(--cyan);border-color:rgba(50,197,210,.35);background:rgba(50,197,210,.1);}
.v2-num-tile.coral .v2-num-tile-icon{color:var(--coral);border-color:rgba(255,118,95,.35);background:rgba(255,118,95,.1);}
.v2-num-tile.purple .v2-num-tile-icon{color:var(--purple);border-color:rgba(176,122,223,.35);background:rgba(176,122,223,.12);}
.v2-num-tile.green .v2-num-tile-icon{color:var(--green);border-color:rgba(139,195,74,.35);background:rgba(139,195,74,.1);}
.v2-num-tile-body{display:flex;flex-direction:column;gap:1px;min-width:0;}
.v2-num-tile-value{font-size:1.55rem;font-weight:900;color:#fff;line-height:1.05;letter-spacing:-.01em;font-variant-numeric:tabular-nums;}
.v2-num-tile-label{font-size:0.76rem;font-weight:800;color:rgba(255,255,255,.9);}
.v2-num-tile-sub{font-size:0.64rem;color:var(--slate);line-height:1.35;}

/* ── Section separator v3 — full-bleed color-blocked cover ──────────────────── */
.v2-sep-slide.gold{background:linear-gradient(150deg,#0a3a5f,#062a48 60%,#041f38),var(--navy);}
.v2-sep-slide.cyan{background:linear-gradient(150deg,#08404a,#062f3f 60%,#04202f),var(--navy);}
.v2-sep-slide .v2-sep-bg{
  position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(ellipse 55% 55% at 22% 32%,rgba(244,180,0,.12),transparent 62%),
    radial-gradient(ellipse 55% 50% at 85% 82%,rgba(107,169,248,.09),transparent 62%);
}
.v2-sep-slide.cyan .v2-sep-bg{background:radial-gradient(ellipse 55% 55% at 22% 32%,rgba(50,197,210,.14),transparent 62%),radial-gradient(ellipse 55% 50% at 85% 82%,rgba(139,195,74,.09),transparent 62%);}
.v2-sep-slide .v2-cover-band{z-index:0;}
.v2-sep{
  position:relative;z-index:1;flex:1;display:grid;
  grid-template-columns:auto 1fr auto;align-items:center;gap:30px;
}
.v2-sep-numeral{
  font-size:12rem;font-weight:900;line-height:.8;letter-spacing:-.04em;
  color:transparent;-webkit-text-stroke:2px rgba(244,180,0,.5);
  font-variant-numeric:tabular-nums;user-select:none;
}
.v2-sep-slide.cyan .v2-sep-numeral{-webkit-text-stroke-color:rgba(50,197,210,.55);}
.v2-sep-main{min-width:0;max-width:560px;}
.v2-sep-eyebrow{display:inline-flex;align-items:center;gap:9px;color:var(--gold);font-weight:800;font-size:0.78rem;letter-spacing:.14em;}
.v2-sep-slide.cyan .v2-sep-eyebrow{color:var(--cyan);}
.v2-sep-eyebrow-icon{display:inline-flex;}
.v2-sep h2{font-size:2.7rem;color:#fff;margin:12px 0 0;font-weight:900;line-height:1.08;}
.v2-sep-rule{height:3px;width:74px;background:var(--gold);border-radius:2px;margin:14px 0;}
.v2-sep-slide.cyan .v2-sep-rule{background:var(--cyan);}
.v2-sep p{color:var(--muted);font-size:0.92rem;line-height:1.7;margin:0;}
.v2-sep-takeaway{display:flex;align-items:center;gap:10px;margin-top:16px;padding:11px 16px;border-inline-start:3px solid var(--gold);border-radius:0 10px 10px 0;background:rgba(255,255,255,.03);font-size:0.86rem;font-weight:700;color:rgba(255,255,255,.9);}
.v2-sep-slide.cyan .v2-sep-takeaway{border-inline-start-color:var(--cyan);}
.v2-sep-takeaway-icon{display:inline-flex;color:var(--gold);flex-shrink:0;}
.v2-sep-slide.cyan .v2-sep-takeaway-icon{color:var(--cyan);}
.v2-sep-side{display:flex;flex-direction:column;align-items:stretch;gap:14px;width:250px;flex-shrink:0;}
.v2-sep-stat{
  display:flex;flex-direction:column;gap:3px;padding:16px 18px;text-align:center;
  border:1px solid rgba(244,180,0,.3);border-radius:16px;background:linear-gradient(160deg,rgba(244,180,0,.12),rgba(244,180,0,.02));
}
.v2-sep-slide.cyan .v2-sep-stat{border-color:rgba(50,197,210,.3);background:linear-gradient(160deg,rgba(50,197,210,.12),rgba(50,197,210,.02));}
.v2-sep-stat-value{font-size:2.6rem;font-weight:900;color:var(--gold);line-height:1;font-variant-numeric:tabular-nums;}
.v2-sep-slide.cyan .v2-sep-stat-value{color:var(--cyan);}
.v2-sep-stat-label{font-size:0.72rem;font-weight:700;color:var(--slate);line-height:1.35;}
.v2-sep-extra{border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px;background:rgba(2,20,37,.4);}
.v2-sep-extra svg{display:block;width:100%;height:auto;}

/* ── Risk-stages slide v3 — proportion bar + tiles with coverage gauges ─────── */
.v2-risk-layout{display:flex;flex-direction:column;gap:16px;height:100%;justify-content:center;}
.v2-prop{display:flex;flex-direction:column;gap:9px;}
.v2-prop-bar{display:flex;height:34px;border-radius:9px;overflow:hidden;border:1px solid rgba(255,255,255,.14);}
.v2-prop-seg{display:flex;align-items:center;justify-content:center;min-width:0;position:relative;border-inline-end:1px solid rgba(2,20,37,.35);-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.v2-prop-seg:last-child{border-inline-end:0;}
.v2-prop-seg.gold{background:var(--gold);}.v2-prop-seg.blue{background:var(--blue);}
.v2-prop-seg.green{background:var(--green);}.v2-prop-seg.coral{background:var(--coral);}
.v2-prop-seg-pct{font-size:0.72rem;font-weight:900;color:var(--navy);font-variant-numeric:tabular-nums;}
.v2-prop-legend{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:center;}
.v2-prop-key{display:inline-flex;align-items:center;gap:7px;font-size:0.72rem;font-weight:700;color:rgba(255,255,255,.82);}
.v2-prop-key i{width:11px;height:11px;border-radius:3px;background:var(--gold);flex-shrink:0;}
.v2-prop-key.blue i{background:var(--blue);}.v2-prop-key.green i{background:var(--green);}.v2-prop-key.coral i{background:var(--coral);}
.v2-stage-body{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:1;}
.v2-stage-figs{display:flex;flex-direction:column;gap:8px;}
.v2-stage-fig{display:flex;flex-direction:column;}
.v2-stage-fig b{font-size:1.3rem;font-weight:900;color:#fff;line-height:1;font-variant-numeric:tabular-nums;}
.v2-stage-fig small{font-size:0.68rem;color:var(--slate);margin-top:2px;}
.v2-stage-gauge{display:flex;flex-direction:column;align-items:center;gap:1px;color:var(--gold);}
.v2-stage-card.blue .v2-stage-gauge{color:var(--blue);}
.v2-stage-card.green .v2-stage-gauge{color:var(--green);}
.v2-stage-card.coral .v2-stage-gauge{color:var(--coral);}
.v2-micro-arc{display:block;}
.v2-stage-gauge-pct{font-size:0.86rem;font-weight:900;color:currentColor;font-variant-numeric:tabular-nums;margin-top:-2px;}
.v2-stage-gauge-label{font-size:0.6rem;color:var(--slate);font-weight:700;}

/* Risk page rework #2: all four levels get equal visual weight as a uniform
   2×2 tile grid (owner feedback 2026-07-20 — the old hero+row layout read as
   cluttered/unbalanced). Each tile reuses the same card anatomy (numbered
   badge, title+tag, share badge, population figure, coverage gauge, footer
   stats) so the eye learns the pattern once and scans all four the same way;
   tone color is confined to the badge/gauge/accent number, not the whole card. */
.v2-risk-layout{gap:12px;justify-content:stretch;}
.v2-risk-layout .v2-prop{gap:7px;}
.v2-risk-layout .v2-prop-bar{height:28px;}
.v2-risk-layout .v2-prop-legend{gap:4px 16px;}
.v2-risk-tile-grid{
  display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px;
  flex:1;min-height:0;
}
.v2-risk-tile{
  display:flex;flex-direction:column;min-width:0;overflow:hidden;
  border:1px solid rgba(255,255,255,.14);border-radius:14px;
  background:linear-gradient(165deg,rgba(244,180,0,.11),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));
}
.v2-risk-tile.blue{background:linear-gradient(165deg,rgba(58,140,214,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
.v2-risk-tile.green{background:linear-gradient(165deg,rgba(52,168,120,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
.v2-risk-tile.coral{background:linear-gradient(165deg,rgba(224,86,86,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
.v2-risk-tile-head{display:flex;align-items:center;gap:9px;padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,.1);}
.v2-risk-tile-titles{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;}
.v2-risk-tile-titles b{font-size:.78rem;color:#fff;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.v2-risk-tile-titles small{font-size:.58rem;color:var(--slate);font-weight:700;}
.v2-risk-tile-share{display:flex;flex-direction:column;align-items:flex-end;gap:0;flex-shrink:0;}
.v2-risk-tile-share b{font-size:1rem;line-height:1;color:var(--gold);font-weight:900;font-variant-numeric:tabular-nums;}
.v2-risk-tile.blue .v2-risk-tile-share b{color:var(--blue);}
.v2-risk-tile.green .v2-risk-tile-share b{color:var(--green);}
.v2-risk-tile.coral .v2-risk-tile-share b{color:var(--coral);}
.v2-risk-tile-share small{font-size:.54rem;color:var(--slate);font-weight:700;}
.v2-risk-tile-main{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:1;padding:8px 14px;}
.v2-risk-tile-figure{display:flex;flex-direction:column;gap:2px;min-width:0;}
.v2-risk-tile-figure b{font-size:1.55rem;line-height:1;color:#fff;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.v2-risk-tile-figure span{font-size:.6rem;color:var(--slate);font-weight:700;}
.v2-risk-tile-main .v2-micro-arc{width:52px;height:auto;color:var(--gold);flex-shrink:0;}
.v2-risk-tile.blue .v2-risk-tile-main .v2-micro-arc{color:var(--blue);}
.v2-risk-tile.green .v2-risk-tile-main .v2-micro-arc{color:var(--green);}
.v2-risk-tile.coral .v2-risk-tile-main .v2-micro-arc{color:var(--coral);}
.v2-risk-tile-foot{
  display:flex;align-items:center;justify-content:space-around;gap:8px;
  padding:7px 12px;background:rgba(2,20,37,.32);border-top:1px solid rgba(255,255,255,.1);
}
.v2-risk-tile-foot span{display:flex;flex-direction:column;align-items:center;gap:1px;}
.v2-risk-tile-foot b{font-size:.86rem;color:#fff;font-weight:900;line-height:1;font-variant-numeric:tabular-nums;}
.v2-risk-tile-foot small{font-size:.54rem;color:var(--slate);font-weight:700;}
.v2-risk-tile-foot span.accent b{color:var(--gold);}
.v2-risk-tile.blue .v2-risk-tile-foot span.accent b{color:var(--blue);}
.v2-risk-tile.green .v2-risk-tile-foot span.accent b{color:var(--green);}
.v2-risk-tile.coral .v2-risk-tile-foot span.accent b{color:var(--coral);}
.v2-risk-layout .v2-totals-band{margin-top:0;gap:10px;}
.v2-risk-layout .v2-totals-item{padding:9px 14px;}
.v2-risk-layout .v2-totals-item b{font-size:1.05rem;}
.v2-risk-layout .v2-totals-item small{font-size:.63rem;}
body.theme-light .v2-risk-tile{background:linear-gradient(165deg,rgba(244,180,0,.1),#fff 55%,#f5f8fb);border-color:#dde4ea;}
body.theme-light .v2-risk-tile-head{border-color:#e4e9ee;}
body.theme-light .v2-risk-tile-titles b,body.theme-light .v2-risk-tile-figure b,body.theme-light .v2-risk-tile-foot b{color:#0a2d4a;}
body.theme-light .v2-risk-tile-foot{background:rgba(10,45,74,.035);border-color:#e4e9ee;}
@media screen and (max-width:820px){
  .v2-risk-tile-grid{grid-template-columns:1fr;grid-template-rows:repeat(4,auto);}
}

/* ── Ports overview strip (bottom half of the merged summary page) — reuses
   .v2-port-col/.v2-port-col-head/deck-table (the SAME shell the detailed
   port-population pages use later in the deck), just this grid wrapper is
   local to the summary page's shorter bottom band. ──────────────────────── */
.v2-port-ovr{display:grid;grid-template-columns:1fr 1fr;gap:22px;flex:1;min-height:0;}
.v2-port-ovr .v2-port-col{height:100%;}
/* .summary: shrinks ONLY the card header (badge + padding), scoped separately
   from .compact (which the OTHER port pages also use, for row density under
   pagination overflow) so this fix never bleeds into those pages' headers. */
.v2-port-col.summary .v2-port-col-head{padding:6px 12px;gap:8px;}
.v2-port-col.summary .v2-port-col-head .v2-port-col-icon{width:22px;height:22px;}
.v2-port-col.summary .v2-port-col-head b{font-size:0.78rem;}
.v2-port-col.summary .v2-port-col-head span{font-size:0.6rem;margin-top:0;}

/* ── Stage×port card — stronger stage-tone header accent ────────────────────── */
.v2-stage-port-card .v2-stage-head{padding-bottom:6px;border-bottom:1.5px solid rgba(255,255,255,.12);}
.v2-stage-port-card.gold  .v2-stage-head{border-bottom-color:color-mix(in srgb,var(--gold) 55%,transparent);}
.v2-stage-port-card.blue  .v2-stage-head{border-bottom-color:color-mix(in srgb,var(--blue) 55%,transparent);}
.v2-stage-port-card.green .v2-stage-head{border-bottom-color:color-mix(in srgb,var(--green) 55%,transparent);}
.v2-stage-port-card.coral .v2-stage-head{border-bottom-color:color-mix(in srgb,var(--coral) 55%,transparent);}

/* ── Closing slide — data provenance + classification + organization ────────── */
.v2-closing{display:grid;grid-template-columns:1.5fr 1fr;gap:28px;height:100%;align-items:stretch;}
.v2-closing-main{display:flex;flex-direction:column;justify-content:center;}
.v2-closing-icon{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:16px;color:var(--gold);border:1.6px solid rgba(244,180,0,.4);background:rgba(244,180,0,.08);margin-bottom:12px;}
.v2-closing-main h2{font-size:1.9rem;font-weight:900;color:#fff;margin:0;}
.v2-closing-main p{font-size:0.86rem;color:var(--muted);line-height:1.7;margin:0 0 16px;max-width:520px;}
.v2-prov-block{border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 18px;background:rgba(2,20,37,.4);}
.v2-prov-title{display:flex;align-items:center;gap:8px;font-size:0.78rem;font-weight:800;color:var(--gold);letter-spacing:.04em;margin-bottom:10px;}
.v2-prov-title-icon{display:inline-flex;}
.v2-prov-list{display:flex;flex-direction:column;gap:7px;}
.v2-prov-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,.08);}
.v2-prov-item:last-child{border-bottom:0;padding-bottom:0;}
.v2-prov-file{font-family:"SFMono-Regular",Consolas,monospace;font-size:0.78rem;color:rgba(255,255,255,.86);}
.v2-prov-rev{font-size:0.76rem;font-weight:800;color:var(--gold);white-space:nowrap;font-variant-numeric:tabular-nums;}
.v2-prov-empty{font-size:0.8rem;color:var(--slate);}
.v2-closing-side{display:flex;flex-direction:column;justify-content:center;gap:16px;border-inline-start:1px solid rgba(255,255,255,.1);padding-inline-start:26px;}
.v2-closing-badge{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;padding:9px 16px;border:1px solid rgba(244,180,0,.4);border-radius:999px;font-size:0.76rem;font-weight:700;color:var(--gold);background:rgba(244,180,0,.07);}
.v2-closing-org{display:flex;flex-direction:column;gap:4px;}
.v2-closing-org b{font-size:0.92rem;font-weight:800;color:#fff;}
.v2-closing-org span{font-size:0.72rem;color:var(--slate);line-height:1.4;}
.v2-closing-period{font-size:1.5rem;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums;}

/* ── Light-theme parity for the v3 components ───────────────────────────────── */
body.theme-light .slide.v2-cover{background:linear-gradient(150deg,#ffffff,#eef3f8 60%,#e6edf4);}
body.theme-light .v2-cover-title{color:#0a2d4a;}
body.theme-light .v2-cover-lockup-label,body.theme-light .v2-num-hero-label,body.theme-light .v2-num-tile-sub,body.theme-light .v2-toc-figure-label,body.theme-light .v2-sep-stat-label{color:#607386;}
body.theme-light .v2-toc-card{background:#ffffff;border-color:#dde4ea;box-shadow:0 6px 16px rgba(10,45,74,.06);}
body.theme-light .v2-toc-main h4{color:#0a2d4a;}
body.theme-light .v2-toc-main p{color:#3a4a58;}
body.theme-light .v2-toc-range{color:#607386;border-color:#dde4ea;}
body.theme-light .v2-num-hero{background:linear-gradient(160deg,rgba(244,180,0,.14),rgba(244,180,0,.03));border-color:rgba(244,180,0,.4);}
body.theme-light .v2-num-hero-unit{color:#3a4a58;}
body.theme-light .v2-num-hero-split b{color:#0a2d4a;}
body.theme-light .v2-num-hero-split small,body.theme-light .v2-stage-fig small,body.theme-light .v2-stage-gauge-label,body.theme-light .v2-prop-key,body.theme-light .v2-prov-empty,body.theme-light .v2-closing-org span{color:#607386;}
body.theme-light .v2-num-tile{background:#ffffff;border-color:#dde4ea;box-shadow:0 6px 16px rgba(10,45,74,.06);}
body.theme-light .v2-num-tile-value,body.theme-light .v2-num-tile-label,body.theme-light .v2-stage-fig b,body.theme-light .v2-closing-main h2,body.theme-light .v2-closing-org b{color:#0a2d4a;}
body.theme-light .v2-sep-slide.gold{background:linear-gradient(150deg,#ffffff,#f3f7fb 60%,#eaf1f7);}
body.theme-light .v2-sep-slide.cyan{background:linear-gradient(150deg,#ffffff,#eef7f9 60%,#e4f1f4);}
body.theme-light .v2-sep h2{color:#0a2d4a;}
body.theme-light .v2-sep p{color:#607386;}
body.theme-light .v2-sep-takeaway{background:rgba(10,45,74,.04);color:#0a2d4a;}
body.theme-light .v2-sep-numeral{-webkit-text-stroke-color:rgba(244,180,0,.6);}
body.theme-light .v2-sep-slide.cyan .v2-sep-numeral{-webkit-text-stroke-color:rgba(50,197,210,.6);}
body.theme-light .v2-prop-bar{border-color:#dde4ea;}
body.theme-light .v2-prop-key i{outline:1px solid rgba(10,45,74,.08);}
body.theme-light .v2-port-ranked{background:#ffffff;border-color:#dde4ea;box-shadow:0 6px 16px rgba(10,45,74,.05);}
body.theme-light .v2-port-ranked-head{color:#0a2d4a;}
body.theme-light .v2-prov-block{background:#f6f9fc;border-color:#dde4ea;}
body.theme-light .v2-prov-file{color:#0a2d4a;}
body.theme-light .v2-closing-side{border-inline-start-color:#dde4ea;}
body.theme-light .v2-num-hero-value,body.theme-light .v2-cover-lockup-period,body.theme-light .v2-toc-figure,body.theme-light .v2-sep-stat-value,body.theme-light .v2-closing-period{text-shadow:none;}

/* ── Print: keep every new colored element ink-faithful, avoid mid-slide breaks ── */
@media print{
  .v2-bar-cell,.v2-prop-seg,.v2-num-tile,.v2-sep-stat,.v2-num-hero,.v2-toc-num,.v2-sep-numeral{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .v2-toc-card,.v2-num-tile,.v2-term-card,.v2-term-band,.v2-stage-card,.v2-risk-tile,.v2-port-col,.v2-prov-item{break-inside:avoid;}
  /* The compact .source-revisions footer (sourceRevisions.ts, shared across
     every report edition) is pure duplication here — closingSlide() already
     re-presents the same revisions in a designed provenance block as the
     deck's actual last slide. Left visible, the footer has nowhere to fit
     on the fixed-height last slide's page and spills onto its own stray
     trailing page in every printed deck2 PDF. Print-only: the on-screen
     compact footer stays (deliberate — see closingSlide()'s comment), only
     the printed duplicate is removed. Scoped to DECK_V2_CSS so deck v1 and
     the document viewers (which have no equivalent closing slide) keep
     printing it normally (2026-07-21). */
  .source-revisions{display:none!important;}
  /* Drop the --v2-hex-tex/--v2-hex-tex-light decorative background pattern
     in print. It's a tiny (28x49px) SVG data URI tiled via
     background-repeat:repeat across .v2-num-tile/.v2-term-card/.v2-toc-card/
     .v2-risk-tile/.v2-src-card — on screen that's cheap (the browser
     rasterizes the tile once and repeats the bitmap), but Chromium's
     print-to-PDF pipeline emits a repeated background-image as a PDF
     tiling-pattern XObject that the CONSUMING viewer (e.g. Edge's PDFium)
     must re-evaluate tile-by-tile at render time. On a page with many
     textured cards — the glossary page's term-cards especially — that is
     real, measurable per-page render cost in the PDF viewer: a strong,
     concrete match for "one specific slide is slow to paint, the rest are
     fine" (2026-07-21, owner-reported). Overriding both custom properties
     to none here turns that background-image layer into a no-op for
     every consumer at once (they all read the variable); the gradient
     layer each consumer also carries is untouched. */
  .slide.v2{--v2-hex-tex:none;--v2-hex-tex-light:none;}
}

/* ═══════════════════════════════════════════════════════════════════════════
   VIS wave (2026-07-14) — seeded generative art (cover mesh · divider patterns),
   provenance QR, and stat-tile texture. All art is deterministic per report and
   fully inlined (no network). Print + light-theme parity inline per rule.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Cover low-poly mesh — full-bleed, behind the glow/band, above the base bg. */
.slide.v2-cover .v2-cover-mesh{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;opacity:.6;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.slide.v2-cover .v2-cover-mesh svg{width:100%;height:100%;display:block;}
/* Keep the cover DARK in both themes: an executive cover reads best as a rich
   navy plate, and the seeded navy mesh + white cover text would clash on a light
   cover. (VIS decision — content slides still flip to light with the toggle.) */
body.theme-light .slide.v2-cover{background:linear-gradient(155deg,#073257,#041d38 58%,#03152b),var(--navy);}
body.theme-light .slide.v2-cover .v2-cover-title{color:#fff;}
body.theme-light .slide.v2-cover .v2-cover-lockup-label{color:var(--slate);}
body.theme-light .slide.v2-cover .v2-cover-meta-item{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));border-color:rgba(255,255,255,.12);}
body.theme-light .slide.v2-cover .v2-cover-meta-value{color:#fff;}
body.theme-light .slide.v2-cover .v2-cover-meta-label{color:var(--slate);}
body.theme-light .slide.v2-cover .v2-org-lines b{color:#fff;}
body.theme-light .slide.v2-cover .v2-org-lines span{color:rgba(255,255,255,.6);}
body.theme-light .slide.v2-cover .v2-org-logo{filter:brightness(0) invert(1);}

/* Section-separator seeded pattern — very low opacity so the white-on-dark
   headline contrast is untouched; above the color-block bg, below the content. */
.v2-sep-slide .v2-sep-pattern{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;opacity:.07;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.v2-sep-slide .v2-sep-pattern svg{width:100%;height:100%;display:block;}
body.theme-light .v2-sep-slide .v2-sep-pattern{opacity:.05;}

/* Closing provenance body — revisions list. */
.v2-prov-body{display:flex;gap:18px;align-items:stretch;}
.v2-prov-body .v2-prov-list,.v2-prov-body .v2-prov-empty{flex:1 1 auto;min-width:0;}

/* Data-source attribution cards (closing slide): which upload sources fed the
   month — risk-agency base file (gold, always) and the optional BI supporting
   file (blue when provided, muted "off" when absent). */
.v2-src-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0 14px;}
.v2-src-card{
  border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 14px;
  background:linear-gradient(180deg,rgba(14,58,95,.55),rgba(7,39,67,.75));
}
.v2-src-head{display:flex;align-items:center;gap:9px;margin-bottom:6px;}
.v2-src-head b{font-size:0.82rem;font-weight:800;color:#fff;}
.v2-src-tag{
  margin-inline-start:auto;flex-shrink:0;padding:2px 10px;border-radius:999px;
  font-size:0.58rem;font-weight:800;color:var(--gold);
  border:1px solid rgba(244,180,0,.4);background:rgba(244,180,0,.08);
}
.v2-src-card.blue .v2-src-tag{color:var(--blue);border-color:rgba(107,169,248,.4);background:rgba(107,169,248,.08);}
.v2-src-card.off .v2-src-tag{color:var(--slate);border-color:rgba(138,160,181,.35);background:rgba(138,160,181,.08);}
.v2-src-card p{margin:0;font-size:0.74rem;font-weight:600;color:rgba(255,255,255,.85);}
.v2-src-card.off{opacity:.72;}
.v2-src-card.off p{color:var(--slate);}
body.theme-light .v2-src-card{background:#fff;border-color:#dfe6ee;}
body.theme-light .v2-src-head b{color:#0a2d4a;}
body.theme-light .v2-src-card p{color:#33506a;}

/* Stat-tile texture — now the shared --v2-hex-tex component (see the .slide.v2
   var block above), layered above each card's own gradient as texture (not
   noise). Extended here to every card of the same "icon + text" shape family:
   glossary term cards, TOC section cards, risk-stage tiles, and the closing
   page's source-attribution cards — the tile treatment was the one owner
   feedback (2026-07-20) asked to spread everywhere, not just stat tiles. */
.v2-num-tile{background-image:var(--v2-hex-tex),linear-gradient(180deg,rgba(14,58,95,.6),rgba(7,39,67,.75));background-repeat:repeat,no-repeat;}
body.theme-light .v2-num-tile{background-image:var(--v2-hex-tex-light),linear-gradient(180deg,rgba(14,58,95,.6),rgba(7,39,67,.75));background-repeat:repeat,no-repeat;}
.v2-term-card{background-image:var(--v2-hex-tex),linear-gradient(180deg,rgba(14,58,95,.6),rgba(7,39,67,.8));background-repeat:repeat,no-repeat;}
body.theme-light .v2-term-card{background-image:var(--v2-hex-tex-light),none;background-repeat:repeat,no-repeat;}
.v2-toc-card{background-image:var(--v2-hex-tex),linear-gradient(180deg,rgba(255,255,255,.022),rgba(255,255,255,.022));background-repeat:repeat,no-repeat;}
body.theme-light .v2-toc-card{background-image:var(--v2-hex-tex-light),none;background-repeat:repeat,no-repeat;}
.v2-risk-tile{background-image:var(--v2-hex-tex),linear-gradient(165deg,rgba(244,180,0,.11),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));background-repeat:repeat,no-repeat;}
.v2-risk-tile.blue{background-image:var(--v2-hex-tex),linear-gradient(165deg,rgba(58,140,214,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
.v2-risk-tile.green{background-image:var(--v2-hex-tex),linear-gradient(165deg,rgba(52,168,120,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
.v2-risk-tile.coral{background-image:var(--v2-hex-tex),linear-gradient(165deg,rgba(224,86,86,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
body.theme-light .v2-risk-tile{background-image:var(--v2-hex-tex-light),linear-gradient(165deg,rgba(244,180,0,.1),#fff 55%,#f5f8fb);background-repeat:repeat,no-repeat;}
.v2-src-card{background-image:var(--v2-hex-tex),linear-gradient(180deg,rgba(14,58,95,.55),rgba(7,39,67,.75));background-repeat:repeat,no-repeat;}
body.theme-light .v2-src-card{background-image:var(--v2-hex-tex-light),none;background-repeat:repeat,no-repeat;}

@media screen and (max-width:820px){
  .v2-cover-grid,.v2-closing,.v2-sep{grid-template-columns:1fr;}
  .v2-summary-top{grid-template-columns:1fr;}
  .v2-summary-tilegroups{flex-direction:column;}
  .v2-port-ovr{grid-template-columns:1fr;}
  .v2-tile-group.raw .v2-num-tiles{grid-template-columns:1fr 1fr;}
  .v2-sep-numeral{font-size:6rem;}
  .v2-sep-side{width:auto;}
  .v2-prov-body{flex-direction:column;align-items:flex-start;}
}
`;
