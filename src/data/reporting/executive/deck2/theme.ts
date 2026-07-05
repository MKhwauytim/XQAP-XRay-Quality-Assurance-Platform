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
@media(min-width:1281px){
  .deck-viewer-v2{padding-inline-start:calc(236px + 16px);}
}
@media(max-width:1280px){
  .deck-nav{display:none;}
}
@media print{
  .deck-nav{display:none!important;}
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
.v2-term-grid{
  display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);gap:12px;
  align-content:stretch;height:100%;
}
.v2-term-card{
  display:flex;flex-direction:column;gap:8px;min-width:0;
  border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px 14px 12px;
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
  width:36px;height:36px;border-radius:50%;border:1.6px solid currentColor;color:var(--gold);
}
.v2-term-card.blue .v2-term-icon{color:var(--blue);}
.v2-term-card.green .v2-term-icon{color:var(--green);}
.v2-term-card.coral .v2-term-icon{color:var(--coral);}
.v2-term-card.slate .v2-term-icon{color:var(--slate);}
.v2-term-card.purple .v2-term-icon{color:var(--purple);}
.v2-term-card.cyan .v2-term-icon{color:var(--cyan);}
.v2-term-card-head b{font-size:0.86rem;font-weight:800;color:#fff;line-height:1.25;}
.v2-term-card p{margin:0;font-size:0.68rem;line-height:1.5;color:rgba(255,255,255,.78);}

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
/* The sample page's "{sampleSize} / {population}" figure in the card header —
   dir="ltr" on this span (set in slides.ts) prevents the same bidi-reversal
   bug the variant-switcher counter had (EDIT_LOG v40.7: "1 / 4" rendered as
   "4 / 1" without it). */
.v2-stage-port-figure{margin-inline-start:auto;font-size:0.85rem;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums;}
.v2-stage-port-card.blue .v2-stage-port-figure{color:var(--blue);}
.v2-stage-port-card.green .v2-stage-port-figure{color:var(--green);}
.v2-stage-port-card.coral .v2-stage-port-figure{color:var(--coral);}

/* ── Port population tables (land / sea, side by side) ────────────────────── */
/* Tinted cards per the reference design: green = بري, blue = بحري. Both cards
   stretch to equal height; every table ends with an الإجمالي totals row. A
   single invisible ".v2-blank" spacer row (inline height:Npx, computed in
   slides.ts from the exact leftover pixels in the card's budget) pins tfoot
   flush to the card's bottom regardless of how many real ports are here. */
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
/* Invisible spacer rows — push tfoot down to a fixed, consistent bottom position.
   Both the <tr> (zebra-stripe background lives here) and its <td> must be
   overridden, or every other blank row shows a faint stripe bleeding through. */
.v2-port-col .deck-table tbody tr.v2-blank,
.v2-port-col .deck-table tbody tr.v2-blank td{
  border-bottom-color:transparent;color:transparent;background:transparent!important;
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

@media(max-width:820px){
  .v2-term-grid,.v2-port-split,.v2-cover-meta{grid-template-columns:1fr;}
}

/* ── Style-variant switcher (dev-preview only, never in production output) ── */
/* .v2-variant-stack takes over the flex-sizing role of whatever container it
   sits in (\`.slide-body\` or directly \`.slide-inner\`), so wrapping existing
   content in it does not change any pixel-budget math (TABLE_BUDGET_PX etc.)
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
`;
