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

/* ── Slideshow (single-slide) fullscreen mode ──────────────────────────────
   body.deck-fullscreen now means true one-slide-at-a-time presentation mode
   (DECK_FULLSCREEN_SCRIPT tracks the active index and toggles
   .deck-slide-active). Side-nav and toolbar chrome (brand/theme/print) are
   hidden outright; the fullscreen button and the prev/next/counter cluster
   fade in on mousemove and fade out after ~2.5s idle via
   body.deck-controls-visible, toggled by the same script. Escape always
   exits natively regardless of this state. */
body.deck-fullscreen{overflow:hidden;}
body.deck-fullscreen .deck-nav{display:none;}
body.deck-fullscreen .deck-viewer-v2{
  padding:0;display:flex;align-items:center;justify-content:center;height:100dvh;
}
body.deck-fullscreen .deck-toolbar{
  position:static;background:none;border:none;box-shadow:none;padding:0;margin:0;pointer-events:none;
}
body.deck-fullscreen .deck-toolbar>.deck-brand,
body.deck-fullscreen .deck-toolbar-actions>*:not(.btn-fullscreen){display:none;}
body.deck-fullscreen .btn-fullscreen{
  display:inline-flex;position:fixed;top:16px;inset-inline-end:16px;z-index:95;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen.deck-controls-visible .btn-fullscreen{
  opacity:1;pointer-events:auto;
}
body.deck-fullscreen .slide{display:none;margin:0;}
body.deck-fullscreen .slide.deck-slide-active{
  display:flex;
  width:min(calc(100vw - 32px),calc((100dvh - 32px) * 297 / 167));
}
body.deck-fullscreen .srev-footer{display:none;}
body.deck-fullscreen .slide-controls{display:none;}
body.theme-light .btn-fullscreen{color:#fff;}
.btn-fullscreen:focus-visible{outline:3px solid var(--gold);outline-offset:3px;}
.btn-fullscreen-icon-compress{display:none;}
.btn-fullscreen[aria-pressed="true"] .btn-fullscreen-icon-expand{display:none;}
.btn-fullscreen[aria-pressed="true"] .btn-fullscreen-icon-compress{display:inline-flex;}
.btn-slide-nav,.deck-slide-counter{display:none;}
body.deck-fullscreen .btn-slide-nav{
  display:flex;position:fixed;top:50%;transform:translateY(-50%);z-index:90;
  width:44px;height:44px;border-radius:50%;align-items:center;justify-content:center;
  background:rgba(2,16,30,.55);border:1px solid rgba(255,255,255,.25);color:#fff;cursor:pointer;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen .btn-slide-nav:disabled{cursor:default;}
body.deck-fullscreen .btn-slide-prev{inset-inline-start:20px;}
body.deck-fullscreen .btn-slide-next{inset-inline-end:20px;}
body.deck-fullscreen .btn-slide-prev svg{transform:scaleX(-1);}
body.deck-fullscreen .deck-slide-counter{
  display:block;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:90;
  font-size:.78rem;font-weight:700;color:#fff;background:rgba(2,16,30,.55);
  padding:4px 12px;border-radius:999px;font-variant-numeric:tabular-nums;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen.deck-controls-visible .btn-slide-nav:not(:disabled),
body.deck-fullscreen.deck-controls-visible .deck-slide-counter{
  opacity:1;pointer-events:auto;
}
@media screen and (min-width:1281px){
  .deck-viewer-v2{padding-inline-start:calc(236px + 16px);}
}
@media screen and (max-width:1280px){
  .deck-nav{display:none;}
}
@media print{
  .deck-nav{display:none!important;}
  .btn-fullscreen{display:none!important;}
  .btn-slide-nav,.deck-slide-counter{display:none!important;}
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
/* Column count is set per band via the inline --cols custom property (see
   termBand() in slides.ts) so a band with 3 or 2 terms still fills its row
   instead of leaving a ragged gap where the 4th card used to be. */
.v2-term-grid{
  display:grid;grid-template-columns:repeat(var(--cols,4),1fr);grid-template-rows:1fr;gap:14px;
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

/* ── Risk-level definition cards (one full-height column per level) ───────── */
/* The four levels get their own glossary page rather than one lumped
   "مستويات المخاطر" card, because each level's definition is ~2x the length
   the .v2-term-card grid was sized for (measured: existing terms run 61-86
   chars, a level definition runs ~125). Four columns across the 459px body
   gives each definition a comfortable measure without shrinking type.
   Tone is NOT decoration here: it is the SAME gold/blue/green/coral order as
   STAGE_TONES in slides.ts, so a color means the same level on this page as
   it does on the stage x port pages and the risk-stage tiles. */
.v2-level-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;flex:1;min-height:0;}
.v2-level-card{
  display:flex;flex-direction:column;gap:11px;min-width:0;
  border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:20px 18px 18px;
  background:linear-gradient(180deg,rgba(14,58,95,.62),rgba(7,39,67,.85));
  position:relative;overflow:hidden;
}
/* Bottom keyline — the same device .v2-term-card uses, slightly heavier so the
   level pages read as the "headline" glossary page of the two. */
.v2-level-card::after{content:"";position:absolute;left:0;right:0;bottom:0;height:5px;background:var(--gold);}
.v2-level-card.blue::after{background:var(--blue);}
.v2-level-card.green::after{background:var(--green);}
.v2-level-card.coral::after{background:var(--coral);}
.v2-level-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.v2-level-icon{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:50px;height:50px;border-radius:15px;border:1.6px solid currentColor;
  color:var(--gold);background:rgba(244,180,0,.08);
}
.v2-level-card.blue .v2-level-icon{color:var(--blue);background:rgba(107,169,248,.1);}
.v2-level-card.green .v2-level-icon{color:var(--green);background:rgba(139,195,74,.1);}
.v2-level-card.coral .v2-level-icon{color:var(--coral);background:rgba(255,118,95,.1);}
/* Ordinal marker, set large and low-contrast so it reads as a quiet index
   rather than competing with the level title for attention. */
.v2-level-num{
  font-size:2.5rem;font-weight:900;line-height:1;color:var(--gold);opacity:.22;
  flex-shrink:0;letter-spacing:-.03em;
}
.v2-level-card.blue .v2-level-num{color:var(--blue);}
.v2-level-card.green .v2-level-num{color:var(--green);}
.v2-level-card.coral .v2-level-num{color:var(--coral);}
.v2-level-card h4{margin:0;font-size:1.02rem;font-weight:900;color:#fff;line-height:1.3;}
.v2-level-rule{height:3px;width:44px;border-radius:2px;background:var(--gold);opacity:.8;flex-shrink:0;}
.v2-level-card.blue .v2-level-rule{background:var(--blue);}
.v2-level-card.green .v2-level-rule{background:var(--green);}
.v2-level-card.coral .v2-level-rule{background:var(--coral);}
/* flex:1 makes every definition occupy the same vertical space regardless of
   how many lines it wraps to, which is what puts all four وزن العينة blocks on
   one baseline. Without it each block floats directly under its own paragraph
   and the four land at different heights. */
.v2-level-card p{margin:0;flex:1;font-size:0.79rem;line-height:1.72;color:rgba(255,255,255,.84);}
/* Live per-level share of this month's population. Centred in the slack between
   the definition and the footer — the auto block margin is what claims that
   space, so it grows and shrinks with the definition's line count instead of
   needing a fixed height. Real data on a definitional page, so it carries its
   period label and its base underneath the figure. */
.v2-level-share{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  padding:14px 8px;border-radius:12px;text-align:center;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);
}
.v2-level-share > span{
  font-size:0.6rem;font-weight:700;letter-spacing:.04em;color:var(--slate);text-align:center;
}
.v2-level-share b{
  font-size:2rem;font-weight:900;line-height:1.1;color:var(--gold);
  font-variant-numeric:tabular-nums;
}
.v2-level-card.blue .v2-level-share b{color:var(--blue);}
.v2-level-card.green .v2-level-share b{color:var(--green);}
.v2-level-card.coral .v2-level-share b{color:var(--coral);}
.v2-level-share small{
  display:block;font-size:0.56rem;color:var(--muted);text-align:center;line-height:1.45;
}
.v2-level-share-sample{margin-top:3px;opacity:.85;}
.v2-level-share-empty{font-size:1.4rem;font-weight:900;}
body.theme-light .v2-level-share{background:rgba(10,45,74,.04);border-color:rgba(10,45,74,.12);}
body.theme-light .v2-level-share small{color:#607386;}
body.theme-light .v2-level-share > span{color:#607386;}

/* "ما يقيسه" footer — pushed to the card's bottom edge by the auto margin so
   all four align on one baseline regardless of how many lines each definition
   wraps to. This footer is what carries the "four different goals, not four
   severity tiers" point structurally, so it must not be dropped. */
.v2-level-goal{
  margin-top:auto;padding-top:11px;border-top:1px solid rgba(255,255,255,.12);
  display:flex;flex-direction:column;gap:3px;
}
.v2-level-goal span{
  font-size:0.62rem;font-weight:800;letter-spacing:.06em;color:var(--gold);opacity:.85;
}
.v2-level-card.blue .v2-level-goal span{color:var(--blue);}
.v2-level-card.green .v2-level-goal span{color:var(--green);}
.v2-level-card.coral .v2-level-goal span{color:var(--coral);}
.v2-level-goal b{font-size:0.72rem;font-weight:700;line-height:1.5;color:rgba(255,255,255,.9);}
body.theme-light .v2-level-goal{border-top-color:rgba(10,45,74,.14);}
body.theme-light .v2-level-goal b{color:#0a2d4a;}
body.theme-light .v2-level-card{
  background:linear-gradient(180deg,#f7fafd,#eef3f9);border-color:#dde4ea;
}
body.theme-light .v2-level-card h4{color:#0a2d4a;}
body.theme-light .v2-level-card p{color:#33475b;}

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
/* min-height:0 lets this grid item shrink to its 1fr track instead of the
   default min-height:auto forcing the whole .v2-stage-port-grid row (and so
   the slide itself, which clips via overflow:hidden) to grow past budget
   whenever one card's content is even slightly taller than its slice — the
   classic CSS Grid "item won't shrink below content" trap. Verified live: a
   long port name (e.g. "منفذ جديدة عرعر") wrapping to 2 lines at a narrower
   card width was exactly what pushed one stage's card past its row budget. */
.v2-stage-port-card{padding:12px 12px 10px;min-height:0;overflow:hidden;}
.v2-stage-port-card .v2-stage-head{margin-bottom:8px;}
.v2-stage-port-card .deck-table{width:100%;table-layout:fixed;}
.v2-stage-port-card .deck-table th,.v2-stage-port-card .deck-table td{padding:3px 6px;font-size:0.6rem;}
.v2-stage-port-card .deck-table th{font-size:0.58rem;}
/* Port name never wraps to a 2nd line — that's what actually broke the row
   budget above; truncate long names instead (same convention this deck
   already uses elsewhere, e.g. .v2-cover-meta-value/.v2-risk-tile-titles). */
.v2-stage-port-card .deck-table td:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
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
/* Filler row (see slides.ts's fillerRow()): pure empty space with no border/
   zebra/padding, sized by DECK_TABLE_FILL_SCRIPT (deck2/index.ts) after real
   layout — never assign it a fixed height here. Selectors mirror every
   tbody-td padding rule above so this always wins on specificity, not just
   !important-vs-!important source order. */
.v2-port-col .deck-table tbody tr.v2-fill-row,
.v2-port-col.compact .deck-table tbody tr.v2-fill-row,
.v2-port-col.sample-mode .deck-table tbody tr.v2-fill-row,
.v2-port-col.sample-mode.compact .deck-table tbody tr.v2-fill-row,
.v2-stage-port-card .deck-table tbody tr.v2-fill-row{
  background:transparent!important;
}
.v2-port-col .deck-table tbody tr.v2-fill-row td,
.v2-port-col.compact .deck-table tbody tr.v2-fill-row td,
.v2-port-col.sample-mode .deck-table tbody tr.v2-fill-row td,
.v2-port-col.sample-mode.compact .deck-table tbody tr.v2-fill-row td,
.v2-stage-port-card .deck-table tbody tr.v2-fill-row td{
  padding:0!important;border-bottom:0!important;
}
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

@media screen and (max-width:900px){
  .deck-viewer-v2{padding:12px 8px 36px;}
  .deck-toolbar{position:relative;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;}
  .deck-toolbar .deck-brand span{display:none;}
  .deck-toolbar-actions{gap:8px;flex-wrap:wrap;}
  .deck-toolbar .btn{padding:8px 11px;font-size:.72rem;}
  /* height:auto resets the base .slide rule's fixed 630px — without it, a
     1-column reflow that genuinely needs more than 630px (e.g. two port
     cards stacked instead of side-by-side) still clipped, since min-height
     alone can't relax an already-set fixed height. */
  .slide.v2{aspect-ratio:auto;height:auto;min-height:0;overflow:visible;}
  .slide.v2 .v2-rail{display:none;}
  .slide.v2 .slide-inner{padding:24px 16px 28px;}
  .slide.v2.title-slide.v2-cover .slide-inner{padding:100px 20px 36px;}
  .slide.v2 .slide-body{overflow:visible;}
  .v2-term-grid,.v2-port-split,.v2-cover-meta,.v2-stage-port-grid,.v2-level-grid{grid-template-columns:1fr;grid-template-rows:auto;height:auto;}
  .v2-port-col{overflow-x:auto;}
  .v2-port-col .deck-table{min-width:0;table-layout:fixed;}
  .v2-port-col .deck-table th:first-child,.v2-port-col .deck-table td:first-child{width:34%;overflow-wrap:anywhere;}
  .v2-port-col .deck-table th:not(:first-child),.v2-port-col .deck-table td:not(:first-child){width:auto;}
  .v2-stage-port-card .deck-table{table-layout:fixed;}
  .v2-stage-port-card .deck-table th,.v2-stage-port-card .deck-table td{overflow-wrap:anywhere;}
  /* Cards are height:auto here, so there is no leftover space to absorb —
     the filler's measured inline height (set for the fixed-height 16:9
     layout) would become pure dead space. !important because it has to beat
     an inline style. */
  tr.v2-fill-row td{height:0!important;}
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

/* ── Card background texture hook (hexagon motif REMOVED, owner 2026-07-25) ──
   These two custom properties used to carry a repeating hexagon SVG that every
   card layered as its first background-image. The hexagon is gone from the
   design, so both resolve to none.
   They are kept as properties rather than deleted because ~13 components
   reference them (.v2-num-tile, .v2-term-card, .v2-toc-card, .v2-risk-tile,
   .v2-src-card, …) as two background-image layers, the texture var first and
   their own gradient second. Setting them to none here removes the texture
   from all of them in one place and leaves those declarations valid — a none
   layer simply paints nothing. Do not reintroduce a pattern here without
   asking; it would reappear deck-wide. */
.slide.v2{
  --v2-hex-tex:none;
  --v2-hex-tex-light:none;
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
/* Pure title card: number, name, تعريف. Nothing else (owner, 2026-07-25).
   Centred single column with the section numeral behind the lockup as an
   oversized outlined watermark, so the section NAME is what the eye lands on
   and the number reads as ornament rather than as a competing figure. The old
   3-column grid (numeral | text | stat card) is gone with the stat card. */
.v2-sep{
  position:relative;z-index:1;flex:1;
  display:flex;align-items:center;justify-content:center;text-align:center;
}
.v2-sep-watermark{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-52%);
  font-size:23rem;font-weight:900;line-height:.78;letter-spacing:-.05em;
  color:transparent;-webkit-text-stroke:2px rgba(244,180,0,.16);
  font-variant-numeric:tabular-nums;user-select:none;pointer-events:none;z-index:0;
}
.v2-sep-slide.cyan .v2-sep-watermark{-webkit-text-stroke-color:rgba(50,197,210,.18);}
.v2-sep-lockup{
  position:relative;z-index:1;min-width:0;max-width:660px;
  display:flex;flex-direction:column;align-items:center;
}
.v2-sep-badge{
  display:inline-flex;align-items:center;justify-content:center;
  width:74px;height:74px;border-radius:50%;color:var(--gold);
  border:1.6px solid rgba(244,180,0,.42);background:rgba(244,180,0,.09);
  box-shadow:0 0 0 10px rgba(244,180,0,.045),0 14px 40px rgba(0,0,0,.3);
  margin-bottom:20px;
}
.v2-sep-slide.cyan .v2-sep-badge{
  color:var(--cyan);border-color:rgba(50,197,210,.42);background:rgba(50,197,210,.09);
  box-shadow:0 0 0 10px rgba(50,197,210,.05),0 14px 40px rgba(0,0,0,.3);
}
.v2-sep-eyebrow{
  color:var(--gold);font-weight:800;font-size:0.8rem;letter-spacing:.22em;
}
.v2-sep-slide.cyan .v2-sep-eyebrow{color:var(--cyan);}
.v2-sep h2{
  font-size:3.4rem;color:#fff;margin:10px 0 0;font-weight:900;line-height:1.12;
  text-shadow:0 10px 40px rgba(0,0,0,.35);
}
/* Short centred rule, tapering to transparent at both ends so it reads as a
   divider rather than an underline. */
.v2-sep-rule{
  height:3px;width:96px;border-radius:2px;margin:20px 0;
  background:linear-gradient(90deg,transparent,var(--gold),transparent);
}
.v2-sep-slide.cyan .v2-sep-rule{background:linear-gradient(90deg,transparent,var(--cyan),transparent);}
.v2-sep p{color:var(--muted);font-size:0.96rem;line-height:1.85;margin:0;max-width:620px;}

/* ── Risk-stages slide v3 — proportion bar + tiles with coverage gauges ─────── */
.v2-risk-layout{display:flex;flex-direction:column;gap:16px;height:100%;justify-content:center;}
.v2-prop{display:flex;flex-direction:column;gap:9px;}
.v2-prop-bar{display:flex;height:34px;border-radius:9px;overflow:hidden;border:1px solid rgba(255,255,255,.14);}
.v2-prop-seg{display:flex;align-items:center;justify-content:center;min-width:0;position:relative;border-inline-end:1px solid rgba(2,20,37,.35);-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.v2-prop-seg:last-child{border-inline-end:0;}
.v2-prop-seg.gold{background:var(--gold);}.v2-prop-seg.blue{background:var(--blue);}
.v2-prop-seg.green{background:var(--green);}.v2-prop-seg.coral{background:var(--coral);}
/* Fallback for a stage whose level identity couldn't be resolved
   (levelIndexForStage, slides.ts) — never a wrong neighbor level's color,
   see that function's doc comment. */
.v2-prop-seg.neutral{background:var(--slate);}
.v2-prop-seg-pct{font-size:0.72rem;font-weight:900;color:var(--navy);font-variant-numeric:tabular-nums;}
.v2-prop-legend{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:center;}
.v2-prop-key{display:inline-flex;align-items:center;gap:7px;font-size:0.72rem;font-weight:700;color:rgba(255,255,255,.82);}
.v2-prop-key i{width:11px;height:11px;border-radius:3px;background:var(--gold);flex-shrink:0;}
.v2-prop-key.blue i{background:var(--blue);}.v2-prop-key.green i{background:var(--green);}.v2-prop-key.coral i{background:var(--coral);}
.v2-prop-key.neutral i{background:var(--slate);}
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
/* Fallback for a stage whose level identity couldn't be resolved
   (levelIndexForStage, slides.ts) — a muted slate tint, never a wrong
   neighbor level's color. */
.v2-risk-tile.neutral{background:linear-gradient(165deg,rgba(138,160,181,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
.v2-risk-tile-head{display:flex;align-items:center;gap:9px;padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,.1);}
.v2-risk-tile-titles{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;}
.v2-risk-tile-titles b{font-size:.78rem;color:#fff;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.v2-risk-tile-titles small{font-size:.58rem;color:var(--slate);font-weight:700;}
.v2-risk-tile-share{display:flex;flex-direction:column;align-items:flex-end;gap:0;flex-shrink:0;}
.v2-risk-tile-share b{font-size:1rem;line-height:1;color:var(--gold);font-weight:900;font-variant-numeric:tabular-nums;}
.v2-risk-tile.blue .v2-risk-tile-share b{color:var(--blue);}
.v2-risk-tile.green .v2-risk-tile-share b{color:var(--green);}
.v2-risk-tile.coral .v2-risk-tile-share b{color:var(--coral);}
.v2-risk-tile.neutral .v2-risk-tile-share b{color:var(--slate);}
.v2-risk-tile-share small{font-size:.54rem;color:var(--slate);font-weight:700;}
.v2-risk-tile-main{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:1;padding:8px 14px;}
.v2-risk-tile-figure{display:flex;flex-direction:column;gap:2px;min-width:0;}
.v2-risk-tile-figure b{font-size:1.55rem;line-height:1;color:#fff;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.v2-risk-tile-figure span{font-size:.6rem;color:var(--slate);font-weight:700;}
.v2-risk-tile-main .v2-micro-arc{width:52px;height:auto;color:var(--gold);flex-shrink:0;}
.v2-risk-tile.blue .v2-risk-tile-main .v2-micro-arc{color:var(--blue);}
.v2-risk-tile.green .v2-risk-tile-main .v2-micro-arc{color:var(--green);}
.v2-risk-tile.coral .v2-risk-tile-main .v2-micro-arc{color:var(--coral);}
.v2-risk-tile.neutral .v2-risk-tile-main .v2-micro-arc{color:var(--slate);}
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
.v2-risk-tile.neutral .v2-risk-tile-foot span.accent b{color:var(--slate);}
.v2-risk-layout .v2-totals-band{margin-top:0;gap:10px;}
.v2-risk-layout .v2-totals-item{padding:9px 14px;}
.v2-risk-layout .v2-totals-item b{font-size:1.05rem;}
.v2-risk-layout .v2-totals-item small{font-size:.63rem;}
body.theme-light .v2-risk-tile{background:linear-gradient(165deg,rgba(244,180,0,.1),#fff 55%,#f5f8fb);border-color:#dde4ea;}
body.theme-light .v2-risk-tile-head{border-color:#e4e9ee;}
body.theme-light .v2-risk-tile-titles b,body.theme-light .v2-risk-tile-figure b,body.theme-light .v2-risk-tile-foot b{color:#0a2d4a;}
body.theme-light .v2-risk-tile-foot{background:rgba(10,45,74,.035);border-color:#e4e9ee;}
@media screen and (max-width:900px){
  .v2-risk-tile-grid{grid-template-columns:1fr;grid-template-rows:repeat(4,auto);}
}

/* .v2-cbar* (compare-bars, risk-stages variant 2/4) removed 2026-07-25
   (fan-out plan §5 RECONCILIATION): "a labelled bar with a proportional
   track is a chart by any reading," so it left Ledger and, since
   \`stageCompareBars\` (slides.ts) had no other caller, the function and this
   CSS block are dead code, not just unused-by-default — deleted rather than
   left orphaned. Briefing's \`.v2-bf-rank-row\` below is a PARALLEL
   reimplementation of the same "labeled bar + value" idea, not a repoint of
   this now-gone class — see its own doc comment.
   .v2-level-table-card is the legacy name \`levelFiguresTable\` (slides.ts)
   still renders (aliased to \`.v2-lg-table-card\`'s rules below, design spec
   §4 "keep .v2-level-table-card as an alias of the new .v2-lg-table-card").
   It no longer pins a byte-identical shipped output (that pin was
   deliberately superseded in the same fan-out pass — see
   \`levelFiguresTable\`'s doc comment in slides.ts and this date's edit log)
   — the alias exists purely so this page's table shares the shared Ledger
   table's visual rules, not to freeze its markup. */
.v2-level-table-card,.v2-lg-table-card{margin-top:14px;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:center;}
.v2-level-table-card .deck-table th,.v2-level-table-card .deck-table td,
.v2-lg-table-card .deck-table th,.v2-lg-table-card .deck-table td{padding:9px 10px;font-size:.76rem;text-align:center;}
.v2-level-table-card .deck-table th:nth-child(2),.v2-level-table-card .deck-table td:nth-child(2),
.v2-lg-table-card .deck-table th:nth-child(2),.v2-lg-table-card .deck-table td:nth-child(2){text-align:right;}
/* New 2026-07-25 (fan-out plan §5): the «ما يقيسه» column levelFiguresTable
   added is a sentence, not a number — right-align it too, like the level-name
   column, instead of the numeric-column default (center). Scoped to
   .v2-level-table-card only (not the shared .v2-lg-table-card) since this is
   this ONE page's column order, not a generic 3rd-column rule every future
   Ledger table should inherit. */
.v2-level-table-card .deck-table th:nth-child(3),.v2-level-table-card .deck-table td:nth-child(3){text-align:right;}
.v2-level-row-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:.68rem;font-weight:900;color:var(--navy);background:var(--gold);}
.v2-level-row-num.blue{background:var(--blue);}
.v2-level-row-num.green{background:var(--green);}
.v2-level-row-num.coral{background:var(--coral);}
/* Fallback for a stage whose level identity couldn't be resolved
   (levelIndexForStage, slides.ts) — never a wrong neighbor level's color. */
.v2-level-row-num.neutral{background:var(--slate);}
.v2-level-table-card .deck-table tfoot td,
.v2-lg-table-card .deck-table tfoot td{
  font-weight:900;color:#fff;background:rgba(255,255,255,.07);
  border-top:1px solid rgba(255,255,255,.2);border-bottom:0;
}
/* New 2026-07-25 (fan-out plan §5): the two-basis footnote row
   (LEVEL_WEIGHT_BASIS_FOOTNOTE, slides.ts) sits in the same tfoot as the
   totals row above but must read as a caveat, not a second total — muted,
   normal weight, right-aligned prose, own top hairline instead of the bold
   totals-row treatment the base tfoot rule sets. */
.v2-level-table-card .deck-table tfoot tr.v2-lg-footnote td,
.v2-lg-table-card .deck-table tfoot tr.v2-lg-footnote td{
  font-weight:600;font-size:.62rem;line-height:1.5;color:var(--slate);
  text-align:right;background:transparent;border-top:1px solid rgba(255,255,255,.12);
}
/* New in the new class only — \`ledgerTableCard\`'s optional \`title\` slot
   has no equivalent in the legacy .v2-level-table-card shape
   (levelFiguresTable never passes a title), so it is not part of the alias
   contract above. */
.v2-lg-table-card-title{font-size:.8rem;font-weight:800;color:#fff;margin-bottom:8px;}
body.theme-light .v2-level-table-card .deck-table tfoot tr.v2-lg-footnote td,
body.theme-light .v2-lg-table-card .deck-table tfoot tr.v2-lg-footnote td{
  color:#5b6b7a;border-top-color:rgba(10,45,74,.12);
}
/* No light-theme override for .v2-level-row-num's ink: --gold/--blue/--green/
   --coral don't change value between themes, so var(--navy) (the base rule's
   color) already has good contrast in both — a previous color:#fff override
   here made this ~1.86:1 (barely readable) in light theme; removed as a real
   bug fix, 2026-07-25, alongside the same mistake caught on the new
   .v2-lg-idx/.v2-bf-rank-num (design-systems Task 2). */
body.theme-light .v2-level-table-card .deck-table tfoot td,
body.theme-light .v2-lg-table-card .deck-table tfoot td{color:#0a2d4a;}
body.theme-light .v2-lg-table-card-title{color:#0a2d4a;}

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
/* min-height:0 on both grid items — same "grid item won't shrink below its
   own content" trap fixed for .v2-stage-port-card: without it, wrapping to
   an extra line at a narrower slide width (e.g. inside the admin design
   customizer's iframe, which is rarely exactly the 1120px design width)
   grows the WHOLE .v2-closing row past its height:100% budget instead of
   letting these two columns shrink to what's actually available. */
.v2-closing-main{display:flex;flex-direction:column;justify-content:center;min-height:0;}
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
.v2-closing-side{display:flex;flex-direction:column;justify-content:center;gap:16px;border-inline-start:1px solid rgba(255,255,255,.1);padding-inline-start:26px;min-height:0;}
.v2-closing-badge{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;padding:9px 16px;border:1px solid rgba(244,180,0,.4);border-radius:999px;font-size:0.76rem;font-weight:700;color:var(--gold);background:rgba(244,180,0,.07);}
.v2-closing-org{display:flex;flex-direction:column;gap:4px;}
.v2-closing-org b{font-size:0.92rem;font-weight:800;color:#fff;}
.v2-closing-org span{font-size:0.72rem;color:var(--slate);line-height:1.4;}
.v2-closing-period{font-size:1.5rem;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums;}

/* ── Light-theme parity for the v3 components ───────────────────────────────── */
body.theme-light .slide.v2-cover{background:linear-gradient(150deg,#ffffff,#eef3f8 60%,#e6edf4);}
body.theme-light .v2-cover-title{color:#0a2d4a;}
body.theme-light .v2-cover-lockup-label,body.theme-light .v2-num-hero-label,body.theme-light .v2-num-tile-sub,body.theme-light .v2-toc-figure-label{color:#607386;}
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
body.theme-light .v2-sep-badge{box-shadow:none;}
body.theme-light .v2-sep-watermark{-webkit-text-stroke-color:rgba(244,180,0,.12);}
body.theme-light .v2-sep-slide.cyan .v2-sep-watermark{-webkit-text-stroke-color:rgba(50,197,210,.13);}
body.theme-light .v2-prop-bar{border-color:#dde4ea;}
body.theme-light .v2-prop-key i{outline:1px solid rgba(10,45,74,.08);}
body.theme-light .v2-port-ranked{background:#ffffff;border-color:#dde4ea;box-shadow:0 6px 16px rgba(10,45,74,.05);}
body.theme-light .v2-port-ranked-head{color:#0a2d4a;}
body.theme-light .v2-prov-block{background:#f6f9fc;border-color:#dde4ea;}
body.theme-light .v2-prov-file{color:#0a2d4a;}
body.theme-light .v2-closing-side{border-inline-start-color:#dde4ea;}
body.theme-light .v2-num-hero-value,body.theme-light .v2-cover-lockup-period,body.theme-light .v2-toc-figure,body.theme-light .v2-closing-period{text-shadow:none;}

/* ── Print: keep every new colored element ink-faithful, avoid mid-slide breaks ── */
@media print{
  .v2-bar-cell,.v2-prop-seg,.v2-num-tile,.v2-num-hero,.v2-toc-num,.v2-sep-watermark{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .v2-toc-card,.v2-num-tile,.v2-term-card,.v2-term-band,.v2-level-card,.v2-stage-card,.v2-risk-tile,.v2-port-col,.v2-prov-item{break-inside:avoid;}
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
.v2-risk-tile.neutral{background-image:var(--v2-hex-tex),linear-gradient(165deg,rgba(138,160,181,.13),rgba(14,58,95,.42) 55%,rgba(7,39,67,.72));}
body.theme-light .v2-risk-tile{background-image:var(--v2-hex-tex-light),linear-gradient(165deg,rgba(244,180,0,.1),#fff 55%,#f5f8fb);background-repeat:repeat,no-repeat;}
.v2-src-card{background-image:var(--v2-hex-tex),linear-gradient(180deg,rgba(14,58,95,.55),rgba(7,39,67,.75));background-repeat:repeat,no-repeat;}
body.theme-light .v2-src-card{background-image:var(--v2-hex-tex-light),none;background-repeat:repeat,no-repeat;}

@media screen and (max-width:900px){
  .v2-cover-grid,.v2-closing{grid-template-columns:1fr;}
  .v2-summary-top{grid-template-columns:1fr;}
  .v2-summary-tilegroups{flex-direction:column;}
  .v2-port-ovr{grid-template-columns:1fr;}
  .v2-tile-group.raw .v2-num-tiles{grid-template-columns:1fr 1fr;}
  .v2-sep-watermark{font-size:11rem;}
  .v2-prov-body{flex-direction:column;align-items:flex-start;}
}

/* ═══════════════════════════════════════════════════════════════════════════
   DECK2 DESIGN SYSTEMS (2026-07-25) — three cohesive, deck-wide variant
   grammars (design spec docs/superpowers/specs/2026-07-25-deck2-design-
   systems-design.md). Each block below is a SHARED system, not a page: any
   future page rebuilt in one of these systems reuses these rules directly.
   The exemplar this task proves them on is slide-port-population-1; its own
   page-local classes (.v2-lg-port-population/.v2-bf-port-population/
   .v2-gd-port-population) sit in their own labelled sub-section per system,
   per the namespacing convention (outermost element carries both a system
   class and a page class).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── LEDGER (slot 1 — السجل, verifiability): tables + figure-strips only —
   no charts, arcs, donuts, or tiles. Reuses the existing barCell/threshCell
   numeric vocabulary unchanged; color stays strictly functional. ──────────── */
.v2-sys-ledger{height:100%;}
/* Every numeral in a Ledger table reads as a fixed-width column of digits —
   tabular-nums keeps a totals row's figures vertically aligned with the data
   rows above it even as digit counts vary row to row. */
.v2-sys-ledger .deck-table td{font-variant-numeric:tabular-nums;}
/* Generic 2-up split (today: land/sea) — any future Ledger page with a
   natural pair of tables reuses this instead of redefining its own grid. */
.v2-lg-split{display:grid;grid-template-columns:1fr 1fr;gap:20px;height:100%;align-items:start;}
/* Vertical variant — a caller with two STACKED (not side-by-side) Ledger
   cards adds this modifier instead of composing a new layout primitive.
   Higher specificity than .v2-lg-split alone, so it wins regardless of
   cascade order. First used by slide-s3-quality (fan-out plan §11f, batch B3
   item 4); the plan's own glossary-1 page (§3b) is expected to reuse it. */
.v2-lg-split.stack{display:flex;flex-direction:column;align-items:stretch;}
/* Ordinal badge sitting inside a table's first cell, before the row's label —
   NOT a new column (no column budget to spare on a half-width card). Reuses
   the same small circular-numeral look as .v2-level-row-num (slot 1's own
   precedent on slide-risk-stages) so every Ledger ordinal badge in the deck
   reads the same way. */
.v2-lg-idx{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:20px;height:20px;border-radius:50%;font-size:.66rem;font-weight:900;
  color:var(--navy);background:var(--gold);margin-inline-end:8px;
  font-variant-numeric:tabular-nums;
}
/* Reusable paginated Ledger table card: plain title + deck-table, no icon
   head (see ledgerTableCard's own doc comment — most Ledger tables sit
   inside a page that already has its own headline). A DIFFERENT card class
   from the shared \`.v2-lg-table-card\` levelFiguresTable uses (deliberately —
   a 4-column ranked list needs its own column alignment/compact-tier rules
   that must not bleed into that already-shipped 7-column table), but just as
   reusable for any future paginated Ledger page shaped like this one. */
.v2-lg-port-card{
  background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.1);
  border-radius:14px;padding:14px 16px;
}
.v2-lg-port-card .deck-table th,.v2-lg-port-card .deck-table td{padding:9px 12px;font-size:.78rem;text-align:center;}
.v2-lg-port-card .deck-table th:first-child,.v2-lg-port-card .deck-table td:first-child{text-align:right;}
.v2-lg-port-card .deck-table tfoot td{
  font-weight:900;color:#fff;background:rgba(255,255,255,.06);
  border-top:1px solid rgba(255,255,255,.2);border-bottom:0;
}
/* Compact tier (same \`plan.compact\` signal portTable()'s own \`compact\` param
   already reads from planPortPages) — shrink rows so up to
   BASE_ROWS_PER_PAGE + COMPRESS_OVERFLOW_MAX ports still fit the slide-body
   budget without a pinned filler row to help (see ledgerPortTable() in
   slides.ts — this card opts out of that mechanism entirely). */
.v2-lg-port-card.compact .deck-table th,.v2-lg-port-card.compact .deck-table td{padding:5px 9px;font-size:.68rem;}
.v2-lg-port-card.compact .v2-lg-idx{width:16px;height:16px;font-size:.58rem;margin-inline-end:6px;}
/* No light-theme ink override — same reasoning as .v2-level-row-num above:
   the tone backgrounds don't change value between themes, so var(--navy)
   already has good contrast in both. */
body.theme-light .v2-lg-port-card{background:#fff;border-color:#dde4ea;box-shadow:0 6px 16px rgba(10,45,74,.06);}
body.theme-light .v2-lg-port-card .deck-table tfoot td{color:#0a2d4a;background:rgba(10,45,74,.05);border-top-color:rgba(10,45,74,.15);}
/* Sample-mode (slide-port-sample fan-out, plan §6): frac() cells stack two
   lines ("N" over "من M"), so rows need more room than the plain single-line
   population variant. Unlike .v2-port-col.sample-mode (which SHRINKS its
   padding to hold a fixed measured row height for the pinned-bottom totals
   trick — see that rule's own comment), Ledger port cards pass rowCount:0
   and never pin anything, so there's no fixed budget to protect: growing the
   padding here is simply the correct, simpler fix for this shell. */
.v2-lg-port-card.sample-mode .deck-table tbody td,
.v2-lg-port-card.sample-mode .deck-table tfoot td{padding:12px 12px;}
.v2-lg-port-card.sample-mode.compact .deck-table tbody td,
.v2-lg-port-card.sample-mode.compact .deck-table tfoot td{padding:6px 9px;}

/* Page-local: slide-port-population (Ledger). Nothing bespoke beyond the
   shared components above — this selector exists as the required namespacing
   hook (design spec §3.1) and is where a future visual difference unique to
   this page's Ledger variant would land. */
.v2-lg-port-population{height:100%;}
/* Page-local: slide-risk-stages (Ledger, fan-out plan §5). Same "namespacing
   hook, nothing bespoke" role as .v2-lg-port-population above — the actual
   table markup is levelFiguresTable's .v2-level-table-card, styled earlier
   in this file. */
.v2-lg-risk-stages{height:100%;}
/* Page-local: slide-port-sample / slide-quality-ports / slide-quality-accuracy
   (Ledger, fan-out plan §6/§8/§9, batch B2a — mechanical clones of the
   port-population exemplar). Same "namespacing hook, nothing bespoke" role. */
.v2-lg-port-sample{height:100%;}
.v2-lg-quality-ports{height:100%;}
.v2-lg-quality-accuracy{height:100%;}
/* Page-local: slide-stage-port-population / slide-stage-port-sample (Ledger,
   fan-out plan §7, batch B3 item 1). Unlike every other Ledger page's cards,
   these 4 sit in the existing 2×2 .v2-stage-port-grid (quarter-slide-height
   each) rather than a full-width/half-width card — the wrapper needs an
   actual flex-column layout (not just a namespacing hook) so that grid's own
   \`flex:1;min-height:0\` rule has a flex parent to size against, the same
   role .v2-risk-layout plays for slide-risk-stages' Ledger slot. */
.v2-lg-stage-port-population,.v2-lg-stage-port-sample{display:flex;flex-direction:column;height:100%;}
/* .v2-lg-stage-card cards pass a bespoke cardClass (ledgerTableCard, not the
   ledgerPortCard wrapper — see stagePortPopulationLedgerCard's doc comment)
   that keeps .v2-stage-port-card for DECK_TABLE_FILL_SCRIPT's measurement,
   so this box borrows THAT class's existing compact table sizing (padding
   3px/6px, .6rem/.58rem fonts — tuned to fit 5 rows + header + totals in a
   quarter-slide card) rather than .v2-lg-port-card's much roomier default.
   The compound selector (.v2-lg-stage-card.v2-stage-port-card) is what makes
   this win the cascade over .v2-stage-port-card's own same-specificity rule
   declared earlier in this file — a bare .v2-lg-stage-card selector alone
   would tie on specificity and lose to declaration order. */
.v2-lg-stage-card.v2-stage-port-card{border:1px solid rgba(255,255,255,.13);border-radius:14px;background:rgba(255,255,255,.018);padding:12px 12px 10px;}
.v2-lg-stage-card.v2-stage-port-card .deck-table th,
.v2-lg-stage-card.v2-stage-port-card .deck-table td{padding:3px 6px;font-size:0.6rem;text-align:center;}
.v2-lg-stage-card.v2-stage-port-card .deck-table th{font-size:0.58rem;}
.v2-lg-stage-card.v2-stage-port-card .deck-table th:first-child,
.v2-lg-stage-card.v2-stage-port-card .deck-table td:first-child{text-align:right;}
.v2-lg-stage-card .v2-lg-table-card-title{font-size:.64rem;font-weight:800;color:#fff;margin-bottom:4px;}
/* .v2-lg-idx's deck-wide default (20px/.66rem) is sized for a full/half-width
   Ledger card — too large for this quarter-slide card's 3px/6px-padded rows,
   so it borrows .v2-lg-port-card.compact's own smaller ordinal-badge size. */
.v2-lg-stage-card .v2-lg-idx{width:16px;height:16px;font-size:.58rem;margin-inline-end:6px;}
body.theme-light .v2-lg-stage-card.v2-stage-port-card{background:#fff;border-color:#dde4ea;box-shadow:0 6px 16px rgba(10,45,74,.06);}
body.theme-light .v2-lg-stage-card .v2-lg-table-card-title{color:#0a2d4a;}

/* Page-local: slide-closing (Ledger, fan-out plan §10, batch B3 item 5) —
   a namespacing hook plus the layout the table + verbatim org block (see
   closingOrgBlock, slides.ts, reusing .v2-closing-side's OWN base rules
   declared earlier in this file — border/padding included) need to sit side
   by side instead of stacking, mirroring slot 0's own .v2-closing two-column
   split. */
.v2-lg-closing{height:100%;display:flex;align-items:center;gap:28px;}
.v2-lg-closing .v2-lg-table-card{flex:1.5;margin-top:0;}
.v2-lg-closing .v2-closing-side{flex:1;}
@media screen and (max-width:900px){
  .v2-lg-closing{flex-direction:column;align-items:stretch;}
  .v2-lg-closing .v2-closing-side{border-inline-start:0;padding-inline-start:0;}
}

/* Page-local: slide-toc (Ledger, fan-out plan §1, batch B4). Namespacing
   hook plus a column-alignment override — الهدف (column 3, a goal sentence)
   is prose, not a number, so it needs the same right-align treatment the
   shared .v2-lg-table-card rule already gives column 2 (القسم).
   2026-07-28 fix: the shared base theme's own td,th white-space:nowrap /
   overflow:hidden / text-overflow:ellipsis rule (theme.ts, the OLD deck's
   generic table reset — deck2 never overrode it for this table) combined
   with the bare table{table-layout:fixed} rule split this 5-column table
   into equal fifths and hard-truncated every cell to one line. Column 2
   (القسم) and column 3 (الهدف) are both prose — section names and full
   goal sentences — not short labels, so most of their text was being cut
   off (reported live: "text is outside the border/screen"). Explicit
   column widths give the two prose columns the room the numeric/date
   columns never needed, and both are switched to wrap instead of
   ellipsis-truncate — the whole point of a table of contents is that its
   goal column is actually readable. */
.v2-lg-toc{height:100%;}
.v2-lg-toc-card .deck-table{table-layout:fixed;}
.v2-lg-toc-card .deck-table th:first-child,.v2-lg-toc-card .deck-table td:first-child{width:6%;}
.v2-lg-toc-card .deck-table th:nth-child(2),.v2-lg-toc-card .deck-table td:nth-child(2){width:20%;}
.v2-lg-toc-card .deck-table th:nth-child(3),.v2-lg-toc-card .deck-table td:nth-child(3){width:42%;text-align:right;}
.v2-lg-toc-card .deck-table th:nth-child(4),.v2-lg-toc-card .deck-table td:nth-child(4){width:16%;}
.v2-lg-toc-card .deck-table th:nth-child(5),.v2-lg-toc-card .deck-table td:nth-child(5){width:16%;}
.v2-lg-toc-card .deck-table td:nth-child(2),.v2-lg-toc-card .deck-table td:nth-child(3){
  white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:break-word;line-height:1.35;
}

/* Page-local: slide-glossary-levels (Ledger, fan-out plan §3a, batch B4).
   التعريف (column 3) and ما يقيسه (column 4) are both prose columns needing
   the right-align override; المستوى (column 2) already gets it from the
   shared .v2-lg-table-card rule. */
.v2-lg-glossary-levels{height:100%;}
.v2-lg-glossary-card .deck-table th:nth-child(3),.v2-lg-glossary-card .deck-table td:nth-child(3),
.v2-lg-glossary-card .deck-table th:nth-child(4),.v2-lg-glossary-card .deck-table td:nth-child(4){text-align:right;}

/* Page-local: slide-glossary-1 (Ledger, fan-out plan §3b, batch B4) — two
   stacked .v2-lg-split.stack cards, one per GLOSSARY_CATEGORIES entry (the
   same modifier slide-s3-quality's Ledger already established, reused
   verbatim). Both columns are prose (المصطلح/التعريف), so both are forced
   right — the shared .v2-lg-table-card rule only right-aligns column 2 by
   default, which would leave المصطلح (column 1) centered. */
.v2-lg-glossary-1{height:100%;}
.v2-lg-glossary-terms-card .deck-table th,.v2-lg-glossary-terms-card .deck-table td{text-align:right;}

/* Page-local: slide-cover (Ledger, fan-out plan §4, 2026-07-28) — the issue
   record: a two-column grid (hero title/lockup beside a 7-row table card),
   the SAME shape slot 0's own \`.v2-cover-grid\` uses. \`.v2-lg-cover-card\` is
   a STANDALONE card class (not compounded with the shared \`.v2-lg-table-card\`
   — the same choice \`.v2-lg-port-card\`/\`.v2-lg-stage-card\` already made)
   because THE COVER IS DARK IN BOTH THEMES BY DESIGN — it needs its own
   from-scratch light-theme re-override rather than inheriting the shared
   table's theme-adaptive (light-card-assuming) rules. The deck-wide
   \`body.theme-light .deck-table{background:#fff;color:#0a2d4a}\` rule
   (theme parity section, above) would otherwise paint a white table on the
   cover's dark background in light theme — re-overridden back to dark
   below, scoped under \`.slide.v2-cover\`, the same pattern
   \`.v2-cover-meta-item\`/\`.v2-cover-meta-value\` already established.
   \`.v2-lg-cover-rule\`/\`-hero\` reuse \`var(--line)\`, which is theme-invariant
   (never redefined for light theme — confirmed against every other
   \`var(--line)\` usage in this file), so no re-override is needed for those
   two rules specifically. */
.v2-lg-cover{display:grid;grid-template-columns:1fr 1.15fr;gap:36px;align-items:center;height:100%;}
.v2-lg-cover-hero{display:flex;flex-direction:column;gap:15px;min-width:0;}
.v2-lg-cover-rule{height:1px;width:100%;background:var(--line);}
.v2-lg-cover-record{min-width:0;}
.v2-lg-cover-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 16px;}
.v2-lg-cover-card .deck-table th,.v2-lg-cover-card .deck-table td{padding:8px 10px;font-size:.76rem;text-align:center;}
.v2-lg-cover-card .deck-table th:nth-child(2),.v2-lg-cover-card .deck-table td:nth-child(2){text-align:right;}
.v2-lg-cover-card .deck-table tfoot td{
  font-weight:600;font-size:.66rem;line-height:1.5;color:var(--slate);
  text-align:right;background:transparent;border-top:1px solid rgba(255,255,255,.12);
}
body.theme-light .slide.v2-cover .v2-lg-cover-card{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.12);}
body.theme-light .slide.v2-cover .deck-table{background:transparent;color:#fff;}
body.theme-light .slide.v2-cover .deck-table th{background:rgba(255,255,255,.08);color:#fff;}
body.theme-light .slide.v2-cover .deck-table td{border-color:rgba(255,255,255,.12);color:#fff;}
body.theme-light .slide.v2-cover .v2-lg-cover-card .deck-table tfoot td{color:var(--slate);background:rgba(255,255,255,.03);border-top-color:rgba(255,255,255,.12);}

/* Page-local: slide-sep-1/2/3 (Ledger, fan-out plan §5, 2026-07-28) — a
   ruled document opener (hairline/ordinal/title/hairline/hanging-label
   definition/hairline), DELIBERATELY no table (no data on this page — a
   one-row table would be theatre). The separator follows the theme (unlike
   the cover) — every value below is already theme-safe via \`var(--line)\`/
   \`var(--slate)\`/\`var(--muted)\` (all theme-invariant custom properties) or
   an existing light-theme pattern (\`.v2-sep-title\` mirrors \`.v2-sep h2\`'s
   own light override), so no cover-style dark re-override is needed here. */
.v2-lg-sep{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:14px;max-width:640px;}
.v2-lg-sep-rule{height:1px;width:100%;background:var(--line);}
.v2-lg-sep-head{display:flex;align-items:center;gap:10px;}
.v2-lg-sep-eyebrow{font-size:.72rem;font-weight:700;color:var(--slate);letter-spacing:.08em;}
.v2-lg-sep-title{font-size:2rem;font-weight:800;color:#fff;margin:0;text-align:start;}
.v2-lg-sep-def-line{display:flex;align-items:baseline;gap:14px;width:100%;}
.v2-lg-sep-key{flex:0 0 auto;width:70px;font-size:.72rem;font-weight:700;color:var(--slate);}
.v2-lg-sep-def{flex:1 1 auto;margin:0;font-size:.92rem;line-height:1.85;color:var(--muted);max-width:640px;}
body.theme-light .v2-lg-sep-title{color:#0a2d4a;}
body.theme-light .v2-lg-sep-def,body.theme-light .v2-lg-sep-key,body.theme-light .v2-lg-sep-eyebrow{color:#607386;}

/* ── BRIEFING (slot 2 — الإحاطة, recall): one lede figure per page + a
   ≤3-figure support strip + at most one ranked-bar list. Tables are demoted
   to ranked bars (.v2-bf-rank). One fixed tone per page (this page: gold). ── */
.v2-sys-brief{display:flex;flex-direction:column;height:100%;gap:14px;justify-content:center;}
.v2-bf-lede{text-align:center;}
.v2-bf-lede-figure{font-size:3.2rem;font-weight:900;line-height:1;font-variant-numeric:tabular-nums;}
.v2-bf-lede-figure.gold{color:var(--gold);text-shadow:0 0 30px rgba(244,180,0,.22);}
.v2-bf-lede-figure.blue{color:var(--blue);text-shadow:0 0 30px rgba(107,169,248,.22);}
.v2-bf-lede-figure.green{color:var(--green);text-shadow:0 0 30px rgba(139,195,74,.22);}
.v2-bf-lede-figure.coral{color:var(--coral);text-shadow:0 0 30px rgba(255,118,95,.22);}
/* 2026-07-28 whole-branch-review fix (B2): .insuff has no scoped override
   inside .v2-bf-lede-figure, so a "no data" placeholder (several pages pass
   <span class="insuff">—</span> as the lede figure when a comparison is
   ungated) inherited the full lede treatment — huge size, weight 900, the
   page's gold/blue/green/coral color, and its glow — making "no data" the
   MOST visually prominent element on the page. Muted the same way every
   other out-of-table .insuff usage in this fan-out already is
   (color:var(--slate), e.g. .v2-mark-layout .insuff in markingImpact.ts),
   plus resetting the size/weight/glow this specific parent contributes that
   those other contexts don't. */
.v2-bf-lede-figure .insuff{
  color:var(--slate);font-size:1.6rem;font-weight:700;text-shadow:none;
}
.v2-bf-lede-label{margin-top:4px;font-size:.92rem;font-weight:700;color:#fff;}
.v2-bf-lede-basis{
  display:inline-flex;margin-top:8px;padding:3px 12px;border-radius:999px;
  font-size:.68rem;font-weight:700;color:var(--slate);
  border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.03);
}
/* Ranked-bar list — a labeled-bar-plus-value skeleton originally sketched as a
   parallel reimplementation of \`.v2-cbar-row\` (a peer review, 2026-07-25,
   correctly caught it was a parallel build, not a repoint of that class, and
   deferred a "genuine shared-class repoint" as a follow-up). That follow-up
   landed later the same day (fan-out plan §5 RECONCILIATION):
   \`stageCompareBars\`/\`.v2-cbar*\` were removed outright once
   \`slide-risk-stages\`'s Ledger slot dropped the compare-bars entirely (ruled
   a chart, out of Ledger by contract) — so \`.v2-bf-rank-row\` is now the ONLY
   labeled-bar-plus-value skeleton in the deck, not a parallel one. It still
   adds a rank numeral + a secondary figure that the old \`.v2-cbar-row\`
   never had.
   Density (1-vs-2 columns, row-height tier) is entirely decided by
   \`briefingRankPlan\` (slideKit.ts) and expressed here only as a \`.t-*\` tier
   class plus however many \`.v2-bf-rank-col\` children the caller renders — no
   page-specific CSS. \`flex:0 0 var(--bf-row-h)\` is the 2026-07-25 fix for a
   real bug: \`flex:1\` on a row let flexbox silently squash rows below their
   declared height to make everything fit, which is exactly the "silently
   drops information" failure this whole system was rebuilt to avoid — the
   TS capacity math is what must guarantee no overflow now, not shrinkage. */
.v2-bf-rank{display:flex;gap:18px;flex:1 1 auto;min-height:0;align-items:stretch;}
.v2-bf-rank-col{display:flex;flex-direction:column;gap:5px;flex:1 1 0;min-width:0;justify-content:center;}
.v2-bf-rank-row{display:flex;align-items:center;gap:10px;flex:0 0 var(--bf-row-h);height:var(--bf-row-h);}
.v2-bf-rank.t-comfortable{--bf-row-h:44px;}
.v2-bf-rank.t-compact{--bf-row-h:36px;}
.v2-bf-rank.t-dense{--bf-row-h:30px;gap:14px;}
.v2-bf-rank.t-dense .v2-bf-rank-row{gap:8px;}
.v2-bf-rank-num{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:22px;height:22px;border-radius:50%;font-size:.68rem;font-weight:900;
  color:var(--navy);font-variant-numeric:tabular-nums;
}
.v2-bf-rank-num.gold{background:var(--gold);} .v2-bf-rank-num.blue{background:var(--blue);}
.v2-bf-rank-num.green{background:var(--green);} .v2-bf-rank-num.coral{background:var(--coral);}
.v2-bf-rank.t-compact .v2-bf-rank-num{width:19px;height:19px;font-size:.64rem;}
.v2-bf-rank.t-dense .v2-bf-rank-num{width:17px;height:17px;font-size:.6rem;}
/* Remainder row ("+N أخرى"): muted hollow numeral (visually NOT a rank),
   hatched track fill (visually NOT a peer port) — the printed value is the
   authority, per the design ruling's completeness invariant (Σ shown values
   === the basis chip's total, in both the folded and unfolded case). */
.v2-bf-rank-num:not(.gold):not(.blue):not(.green):not(.coral){
  background:transparent;border:1.5px dashed rgba(255,255,255,.35);color:var(--slate);
}
.v2-bf-rank-label{
  flex:0 0 auto;width:150px;font-size:.78rem;font-weight:700;color:#fff;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.v2-bf-rank.t-compact .v2-bf-rank-label{width:140px;font-size:.74rem;}
.v2-bf-rank.t-dense .v2-bf-rank-label{width:118px;font-size:.7rem;}
.v2-bf-rank-row.rest .v2-bf-rank-label{color:var(--slate);font-style:italic;}
/* bars:false rows (briefingRankList, slideKit.ts) omit .v2-bf-rank-track
   entirely — without this rule the label stayed pinned at its fixed 150px
   (every sibling is flex:0 0 auto too), so removing the track just left dead
   space instead of letting the label expand as the doc comment claimed
   (2026-07-28 fix — no shipping page uses bars:false yet, caught before it
   did). */
.v2-bf-rank-row.no-bars .v2-bf-rank-label{flex:1 1 auto;width:auto;}
.v2-bf-rank-track{
  flex:1 1 auto;height:20px;border-radius:6px;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.12);overflow:hidden;position:relative;
}
.v2-bf-rank.t-compact .v2-bf-rank-track{height:17px;}
.v2-bf-rank.t-dense .v2-bf-rank-track{height:14px;}
.v2-bf-rank-fill{position:absolute;inset-inline-end:0;top:0;height:100%;border-radius:6px;}
.v2-bf-rank-fill.gold{background:var(--gold);} .v2-bf-rank-fill.blue{background:var(--blue);}
.v2-bf-rank-fill.green{background:var(--green);} .v2-bf-rank-fill.coral{background:var(--coral);}
.v2-bf-rank-fill.rest{
  background:repeating-linear-gradient(45deg,var(--slate),var(--slate) 3px,transparent 3px,transparent 7px);
  opacity:.6;
}
.v2-bf-rank-value{
  flex:0 0 auto;min-width:48px;text-align:left;font-size:.8rem;font-weight:900;
  color:#fff;font-variant-numeric:tabular-nums;
}
.v2-bf-rank.t-compact .v2-bf-rank-value{min-width:46px;font-size:.76rem;}
.v2-bf-rank.t-dense .v2-bf-rank-value{min-width:44px;font-size:.7rem;}
.v2-bf-rank-secondary{
  flex:0 0 auto;min-width:74px;text-align:left;font-size:.66rem;font-weight:700;
  color:var(--slate);font-variant-numeric:tabular-nums;
}
.v2-bf-rank.t-compact .v2-bf-rank-secondary{min-width:70px;font-size:.64rem;}
.v2-bf-rank.t-dense .v2-bf-rank-secondary{min-width:66px;font-size:.62rem;}
/* Briefing's own dressing of the shared .v2-totals-band/.v2-totals-item
   support-strip component (design spec: one markup component, restyled per
   system) — tighter than slot 0's risk-stages usage since Briefing's row
   budget is the tightest of the three systems. Unconditional per the design
   ruling (it was previously and wrongly dropped on a signal — planPortPages'
   table-geometry \`compact\` — that had no bearing on Briefing's own budget). */
.v2-sys-brief .v2-totals-band{margin-top:0;gap:10px;}
.v2-sys-brief .v2-totals-item{padding:8px 12px;border-radius:10px;}
.v2-sys-brief .v2-totals-item b{font-size:1rem;}
.v2-sys-brief .v2-totals-item small{font-size:.62rem;}
body.theme-light .v2-bf-lede-label{color:#0a2d4a;}
body.theme-light .v2-bf-lede-basis{color:#607386;border-color:#dde4ea;background:#fff;}
/* No light-theme ink override for the tone-numbered rank badges — same
   reasoning as .v2-level-row-num/.v2-lg-idx above (var(--navy) already
   contrasts well against every tone in both themes). The remainder-row
   numeral (no tone class) keeps its own dedicated override below. */
body.theme-light .v2-bf-rank-num:not(.gold):not(.blue):not(.green):not(.coral){
  background:transparent;border-color:rgba(10,45,74,.3);color:#607386;
}
body.theme-light .v2-bf-rank-label{color:#0a2d4a;}
body.theme-light .v2-bf-rank-row.rest .v2-bf-rank-label{color:#607386;}
body.theme-light .v2-bf-rank-track{background:#eef2f6;border-color:#dde4ea;}
body.theme-light .v2-bf-rank-fill.rest{
  background:repeating-linear-gradient(45deg,#607386,#607386 3px,transparent 3px,transparent 7px);
}
body.theme-light .v2-bf-rank-value{color:#0a2d4a;}
body.theme-light .v2-bf-rank-secondary{color:#607386;}

/* Page-local: slide-port-population (Briefing). Nothing bespoke beyond the
   shared components above — namespacing hook per design spec §3.1. */
.v2-bf-port-population{height:100%;}
/* Page-local: slide-risk-stages (Briefing, fan-out plan §5). Same role as
   .v2-bf-port-population above — per-row tone comes from briefingRankList's
   item.tone override (slideKit.ts), not page-local CSS. */
.v2-bf-risk-stages{height:100%;}
/* Page-local: slide-port-sample / slide-quality-ports / slide-quality-accuracy
   (Briefing, fan-out plan §6/§8/§9, batch B2a). Same "namespacing hook,
   nothing bespoke" role — each page's own tone (blue/coral/green) is set on
   briefingLede/briefingRankList at the call site, not here. */
.v2-bf-port-sample{height:100%;}
.v2-bf-quality-ports{height:100%;}
.v2-bf-quality-accuracy{height:100%;}
/* Page-local: slide-stage-port-population / slide-stage-port-sample
   (Briefing, fan-out plan §7). Nothing bespoke beyond the shared components
   above — the 4 rank rows' per-row tone comes from briefingRankList's
   item.tone override (slideKit.ts), same mechanism slide-risk-stages uses,
   not page-local CSS. Secondary-line length risk (a port name plus a count)
   is handled call-site via truncLabel, not a CSS wrap/overflow rule. */
.v2-bf-stage-port-population{height:100%;}
.v2-bf-stage-port-sample{height:100%;}
/* Page-local: slide-closing (Briefing, fan-out plan §10, batch B3 item 5).
   The verbatim org block (closingOrgBlock, slides.ts) stacks below the rank
   list here (Briefing is a single vertical column, unlike Ledger's two-column
   split), so its side border becomes a top hairline instead of a re-used
   inline-start border. \`.v2-bf-closing-empty\` is the zero-revisions note
   (\`briefingSupport([])\`'s own "return a note, not dead markup" convention,
   applied to the rank-list slot specifically). */
.v2-bf-closing{height:100%;}
.v2-bf-closing .v2-closing-side{
  border-inline-start:0;padding-inline-start:0;
  border-top:1px solid rgba(255,255,255,.1);padding-top:14px;
}
body.theme-light .v2-bf-closing .v2-closing-side{border-top-color:#dde4ea;}
.v2-bf-closing-empty{font-size:.78rem;font-weight:700;color:var(--slate);text-align:center;line-height:1.7;}

/* Page-local: slide-toc (Briefing, fan-out plan §1, batch B4). Nothing
   bespoke beyond the shared components — namespacing hook only. */
.v2-bf-toc{height:100%;}

/* Page-local: slide-glossary-levels (Briefing, fan-out plan §3a, batch B4).
   Each row's secondary line is a full "ما يقيسه" sentence (~40-50 chars),
   far past the shared .v2-bf-rank-secondary's 74px min-width (sized for a
   short "من N صورة"-style figure) — verified against this page's actual
   RISK_LEVELS[i].measures strings, all longer than any other page's
   secondary text. Only 4 rows in a single column (briefingRankPlan(4) picks
   the 1-column comfortable tier), so there is ample unused row width to
   widen into. text-align is also flipped to right — the shared rule's
   "left" is tuned for LTR numerals/percentages, wrong for an Arabic
   sentence. white-space:normal lets it wrap to 2 lines within the 44px
   comfortable row height instead of the shared rule's implicit single-line
   overflow. */
.v2-bf-glossary-levels{height:100%;}
.v2-bf-glossary-levels .v2-bf-rank-secondary{
  min-width:230px;max-width:320px;white-space:normal;text-align:right;line-height:1.32;
}

/* Page-local: slide-glossary-1 (Briefing, fan-out plan §3b, batch B4) —
   bars:false (a definitional list, no magnitude), so the label already
   expands (theme.ts's .v2-bf-rank-row.no-bars .v2-bf-rank-label rule);
   the term's full definition is carried in the secondary slot instead
   (valueText is left empty — there is no figure to show), so it needs the
   same widen+wrap+right-align treatment as slide-glossary-levels above. */
.v2-bf-glossary-1{height:100%;}
.v2-bf-glossary-1 .v2-bf-rank-secondary{
  min-width:230px;max-width:340px;white-space:normal;text-align:right;line-height:1.32;
}

/* Page-local: slide-cover (Briefing, fan-out plan §4, 2026-07-28) — title
   first (a cover's title cannot be demoted below a statistic), then the
   lede (population total — SCOPE, never a finding), then the 3-chip support
   strip. No rank list (nothing on a cover is honestly rankable). Bumped
   lede figure (4.2rem, larger than the deck-wide 3.2rem default — a cover's
   headline figure earns more presence than a body-page lede).
   THE COVER IS DARK IN BOTH THEMES BY DESIGN: \`.v2-bf-lede-label\`/
   \`.v2-bf-lede-basis\`/\`.v2-totals-item\` all have GENERIC light-theme
   overrides elsewhere in this file (assuming every OTHER page's light-theme
   card is a light background) that would otherwise go dark-ink-on-dark
   here — re-overridden back to dark below, scoped under \`.slide.v2-cover\`,
   same pattern as \`.v2-cover-meta-item\`. The tone-colored lede figure itself
   needs no override (\`var(--gold)\` is theme-invariant). */
.v2-bf-cover{align-items:center;text-align:center;}
.v2-bf-cover .v2-bf-lede-figure{font-size:4.2rem;}
.v2-bf-cover .v2-totals-band{width:100%;max-width:560px;}
body.theme-light .slide.v2-cover .v2-bf-lede-label{color:#fff;}
body.theme-light .slide.v2-cover .v2-bf-lede-basis{color:var(--slate);border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.03);}
body.theme-light .slide.v2-cover .v2-totals-item{background:rgba(255,255,255,.02);border-color:rgba(255,255,255,.12);}
body.theme-light .slide.v2-cover .v2-totals-item b{color:#fff;}
body.theme-light .slide.v2-cover .v2-totals-item small{color:var(--slate);}

/* Page-local: slide-sep-1/2/3 (Briefing, fan-out plan §5, 2026-07-28) — the
   cleanest reuse in the whole fan-out: just one \`briefingLede\` call, no
   support strip, no rank list. Bumped to divider scale (6.4rem, vs. the
   deck-wide 3.2rem default) since this is the ONLY content on the slide.
   \`.v2-bf-lede-basis\` is restyled from its default bordered-pill look (wrong
   for a ~30-word blurb) to a plain paragraph — same page-local-restyle
   licence \`slide-glossary-levels\`'s \`.v2-bf-rank-secondary\` override already
   used above. The separator follows the theme (unlike the cover) — no dark
   re-override needed; \`.v2-bf-lede-label\`/\`-basis\`'s existing GENERIC
   light-theme rules (this file, Briefing base section) already apply
   correctly here. */
.v2-bf-sep{height:100%;}
.v2-bf-sep .v2-bf-lede-figure{font-size:6.4rem;}
.v2-bf-sep .v2-bf-lede-basis{
  display:block;border:0;background:transparent;max-width:620px;margin-inline:auto;
  font-size:.96rem;line-height:1.85;
}

/* ── GRID (slot 3 — الشبكة, comparison): every page becomes one matrix of
   metricMatrix cells, each column normalized to its OWN domain, ink always
   navy (theme-invariant — see metricMatrix's own doc comment). ──────────── */
.v2-sys-grid{height:100%;}
/* grid-template-rows:minmax(0,1fr): kept as a defensive declaration, NOT
   because it's currently load-bearing — a peer review (2026-07-25)
   independently re-tested by toggling this property live and found zero
   height/overflow difference with the current \`.v2-gd-panel\`/
   \`.v2-gd-panel-chart\` flex/min-height:0 chain, which already bounds the
   figure correctly on its own. An earlier draft of this comment claimed a
   ~350px clip this rule fixed; that measurement was very likely the same
   348px sr-only accessible-table false-positive this task's own visual-QA
   process separately (and correctly) identified and excluded elsewhere —
   i.e. probably never a real bug. The declaration is harmless and documents
   intent (an explicit row height contract, not an implicit auto-size one),
   so it stays; do not cite it as fixing a reproduced defect without
   re-verifying first. */
.v2-gd-split{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:minmax(0,1fr);gap:20px;height:100%;}
.v2-gd-panel{
  display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;
  border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px 14px;
  background:rgba(255,255,255,.02);
}
.v2-gd-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
.v2-gd-panel-head b{font-size:.9rem;font-weight:800;color:#fff;}
.v2-gd-panel-head span{font-size:.7rem;font-weight:600;color:var(--slate);}
.v2-gd-panel-chart{flex:1;min-height:0;}
.v2-gd-panel-chart figure{height:100%;}
body.theme-light .v2-gd-panel{background:#fff;border-color:#dde4ea;box-shadow:0 6px 16px rgba(10,45,74,.06);}
body.theme-light .v2-gd-panel-head b{color:#0a2d4a;}
body.theme-light .v2-gd-panel-head span{color:#607386;}

/* ── Grid field cells (gridFieldCells, slideKit.ts, fan-out plan §3,
   2026-07-28) — the label/value cell field for pages with real fields but
   NO comparable numeric domain (slide-cover, slide-sep-1/2/3), so a
   metricMatrix would misrepresent them as one comparable scale. Column
   count/geometry (grid-template-columns, .wide's actual span behavior) is
   entirely the caller's own page-local class — see gridFieldCells' own doc
   comment — this block only supplies the shared per-cell chrome: square
   corners, 1px hairlines, uniform padding, label/value typography. No
   magnitude tint (unlike metricMatrix's --w fills): these cells have
   nothing to tint by. ──────────────────────────────────────────────────── */
.v2-gd-field{display:grid;}
.v2-gd-field-cell{
  border-inline-end:1px solid var(--line);border-bottom:1px solid var(--line);
  padding:10px 14px;display:flex;flex-direction:column;gap:4px;justify-content:center;min-width:0;
}
.v2-gd-field-cell.num .v2-gd-field-value{font-variant-numeric:tabular-nums;}
.v2-gd-field-label{font-size:.68rem;font-weight:700;color:var(--slate);letter-spacing:.02em;}
.v2-gd-field-value{
  font-size:.95rem;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;
}
body.theme-light .v2-gd-field-cell{border-color:#dde4ea;}
body.theme-light .v2-gd-field-value{color:#0a2d4a;}

/* Page-local: slide-port-population (Grid) — land/sea tint on the panel
   border + count caption, mirroring every other variant's land=green/
   sea=blue convention in this deck. */
.v2-gd-port-population .v2-gd-panel.land{border-color:rgba(139,195,74,.35);}
.v2-gd-port-population .v2-gd-panel.sea{border-color:rgba(107,169,248,.35);}
.v2-gd-port-population .v2-gd-panel.land .v2-gd-panel-head span{color:var(--green);}
.v2-gd-port-population .v2-gd-panel.sea .v2-gd-panel-head span{color:var(--blue);}
body.theme-light .v2-gd-port-population .v2-gd-panel.land .v2-gd-panel-head span{color:#4a7a1f;}
body.theme-light .v2-gd-port-population .v2-gd-panel.sea .v2-gd-panel-head span{color:#2f6fb0;}

/* Page-local: slide-port-sample / slide-quality-ports / slide-quality-accuracy
   (Grid, fan-out plan §6/§8/§9, batch B2a) — same land=green/sea=blue tint
   convention as slide-port-population above, mechanically repeated per page
   (this file's own established convention: one page-local block per page,
   not a shared selector — see the comment on the port-population block). */
.v2-gd-port-sample .v2-gd-panel.land{border-color:rgba(139,195,74,.35);}
.v2-gd-port-sample .v2-gd-panel.sea{border-color:rgba(107,169,248,.35);}
.v2-gd-port-sample .v2-gd-panel.land .v2-gd-panel-head span{color:var(--green);}
.v2-gd-port-sample .v2-gd-panel.sea .v2-gd-panel-head span{color:var(--blue);}
body.theme-light .v2-gd-port-sample .v2-gd-panel.land .v2-gd-panel-head span{color:#4a7a1f;}
body.theme-light .v2-gd-port-sample .v2-gd-panel.sea .v2-gd-panel-head span{color:#2f6fb0;}

.v2-gd-quality-ports .v2-gd-panel.land{border-color:rgba(139,195,74,.35);}
.v2-gd-quality-ports .v2-gd-panel.sea{border-color:rgba(107,169,248,.35);}
.v2-gd-quality-ports .v2-gd-panel.land .v2-gd-panel-head span{color:var(--green);}
.v2-gd-quality-ports .v2-gd-panel.sea .v2-gd-panel-head span{color:var(--blue);}
body.theme-light .v2-gd-quality-ports .v2-gd-panel.land .v2-gd-panel-head span{color:#4a7a1f;}
body.theme-light .v2-gd-quality-ports .v2-gd-panel.sea .v2-gd-panel-head span{color:#2f6fb0;}

.v2-gd-quality-accuracy .v2-gd-panel.land{border-color:rgba(139,195,74,.35);}
.v2-gd-quality-accuracy .v2-gd-panel.sea{border-color:rgba(107,169,248,.35);}
.v2-gd-quality-accuracy .v2-gd-panel.land .v2-gd-panel-head span{color:var(--green);}
.v2-gd-quality-accuracy .v2-gd-panel.sea .v2-gd-panel-head span{color:var(--blue);}
body.theme-light .v2-gd-quality-accuracy .v2-gd-panel.land .v2-gd-panel-head span{color:#4a7a1f;}
body.theme-light .v2-gd-quality-accuracy .v2-gd-panel.sea .v2-gd-panel-head span{color:#2f6fb0;}

/* Page-local: slide-risk-stages (Grid, fan-out plan §5) — a single
   full-width panel, no land/sea split (so no .v2-gd-split wrapper here);
   these two rules give the wrapper AND its one .v2-gd-panel child the full
   slide-body height .v2-gd-split's grid would otherwise provide. */
.v2-gd-risk-stages{height:100%;}
.v2-gd-risk-stages .v2-gd-panel{height:100%;}

/* Page-local: slide-stage-port-population / slide-stage-port-sample (Grid,
   fan-out plan §7) — a single full-width TRANSPOSED matrix (rows=stages,
   columns=top-5 ports) plus a legend line disclosing the 5 columns' full,
   untruncated port names (see truncLabel's doc comment, slideKit.ts, for why
   that line exists instead of relying on metricMatrix's own sr-table). The
   wrapper is an actual flex column (not just a namespacing hook, unlike
   .v2-gd-risk-stages above) so the panel and the legend line stack instead
   of the legend being squeezed out by the panel's height:100%. */
.v2-gd-stage-port-population,.v2-gd-stage-port-sample{height:100%;display:flex;flex-direction:column;gap:8px;}
.v2-gd-stage-port-population .v2-gd-panel,.v2-gd-stage-port-sample .v2-gd-panel{flex:1;min-height:0;}
.v2-gd-stage-port-legend{flex:0 0 auto;font-size:.64rem;font-weight:600;color:var(--slate);text-align:center;}
body.theme-light .v2-gd-stage-port-legend{color:#607386;}

/* ═══════════════════════════════════════════════════════════════════════
   Degenerate-reuse Grid pages — toc / glossary-levels / glossary-1 / closing
   ─────────────────────────────────────────────────────────────────────────
   2026-07-28 whole-branch-review fix (G1): these 4 pages are the ONLY Grid
   variants that reuse another slot's non-matrix body instead of a real
   metricMatrix (structurally different from the other 13 "real matrix"
   pages, which use .v2-gd-panel's 14px-radius/visible-border/tinted-
   background chrome). Before this fix the 4 disagreed AMONG THEMSELVES too:
   toc/glossary-levels/glossary-1 used 0px radius + 0px border + transparent
   background + hairline dividers between cells, while closing alone kept a
   visible 1px border around its reused table. Per this fan-out's own
   comments (below), "square corners, hairline gridlines" was always meant
   to be ONE shared grammar for this whole group — closing's border was the
   one page that never actually got it. Fixed by dropping closing's outer
   border/background to match the other three, making all 4 pages
   consistent: 0px radius, 0px border, transparent background, hairline
   internal dividers only.
   ═══════════════════════════════════════════════════════════════════════ */

/* Page-local: slide-closing (Grid, fan-out plan §10, batch B3 item 5) — a
   DELIBERATE degenerate case: this page has zero entities × comparable
   metrics (provenance is a key→value record, not a rankable matrix), so
   Grid reuses closingLedgerTable's own table markup (slides.ts's
   closingGrid calls that builder DIRECTLY rather than re-deriving a second,
   duplicate table) instead of dressing a non-matrix as a fake metricMatrix.
   This class supplies ONLY the deck-wide Grid visual grammar — square
   corners, hairline gridlines — on top of that identical markup; it does not
   restyle the table's content. Reuses .v2-lg-closing's own flex/gap/side-block
   layout (declared in the Ledger section above) since the two slots share
   the exact same two-column shape, just with a squared-off table on this
   side. */
.v2-gd-closing{height:100%;display:flex;align-items:center;gap:28px;}
.v2-gd-closing .v2-lg-table-card{flex:1.5;margin-top:0;border:0;border-radius:0;background:transparent;}
.v2-gd-closing .deck-table{border-radius:0;}
.v2-gd-closing .v2-closing-side{flex:1;}
@media screen and (max-width:900px){
  .v2-gd-closing{flex-direction:column;align-items:stretch;}
  .v2-gd-closing .v2-closing-side{border-inline-start:0;padding-inline-start:0;}
}

/* Page-local: slide-toc (Grid, fan-out plan §1, batch B4) — NO real matrix:
   "figure" values are heterogeneous strings across sections (a sample count
   here, an accuracy percentage there), so a metricMatrix normalizing them
   onto one column scale would misrepresent them as comparable. Reuses
   tocCard's own markup (slides.ts) UNCHANGED, CSS-restyled here to the
   deck-wide Grid grammar: gap collapses to 0 and each card's rounded
   border/background give way to a hairline divider between adjacent cells
   (square corners, uniform equal-size rows via flex:1 on a flex-column
   parent that already fills the slide body). Each card's page-span drives a
   --w tint on .v2-toc-side — the SAME "background-image only, ZERO layout
   height" technique .v2-bar-cell uses (see barCell's doc comment,
   slideKit.ts) — via a per-tone --gd-tint custom property so the tint
   color still matches that section's own tone. Cell padding (14px 16px) and
   tint alphas (.18/.22/.22/.24) are the CANONICAL values shared verbatim by
   glossary-levels below (2026-07-28 fix, G2 — these two used to drift by
   ~0.02 alpha and a different padding shorthand for no functional reason). */
.v2-gd-toc .v2-toc-grid{gap:0;}
.v2-gd-toc .v2-toc-card{
  flex:1;min-height:0;border-radius:0;border:0;background:transparent;
  border-bottom:1px solid rgba(255,255,255,.14);padding:14px 16px;
}
.v2-gd-toc .v2-toc-card:last-child{border-bottom:0;}
.v2-gd-toc .v2-toc-card::before{width:3px;}
.v2-gd-toc .v2-toc-side{
  position:relative;padding-inline-end:8px;
  background-image:linear-gradient(to top,var(--gd-tint,rgba(244,180,0,.18)) 0,var(--gd-tint,rgba(244,180,0,.18)) var(--w,0%),transparent var(--w,0%));
  background-repeat:no-repeat;
}
.v2-gd-toc .v2-toc-card.blue .v2-toc-side{--gd-tint:rgba(107,169,248,.22);}
.v2-gd-toc .v2-toc-card.green .v2-toc-side{--gd-tint:rgba(139,195,74,.22);}
.v2-gd-toc .v2-toc-card.coral .v2-toc-side{--gd-tint:rgba(255,118,95,.24);}
/* box-shadow:none (2026-07-28 fix, G2): the unscoped body.theme-light
   .v2-toc-card rule (light-theme parity section, above) sets a box-shadow
   that this Grid override never cleared — background/border went
   transparent, but the shadow floated under an otherwise-invisible card. */
body.theme-light .v2-gd-toc .v2-toc-card{border-bottom-color:#dde4ea;background:transparent;box-shadow:none;}

/* Page-local: slide-glossary-levels (Grid, fan-out plan §3a, batch B4) — NO
   real matrix (one metric — وزن العينة — over four entities); deliberately
   does not import slide-risk-stages' live per-month figures to manufacture
   extra columns (two pages independently asserting the same numbers is
   worse than one honestly degenerate Grid). Reuses levelCardTinted's markup
   (slides.ts) restyled to uniform, square-cornered cells separated by
   hairlines instead of .v2-level-card's own rounded borders; the وزن figure
   drives a --w tint on .v2-level-share via the same per-tone --gd-tint
   technique .v2-gd-toc uses above. Padding/tint alphas match .v2-gd-toc's
   canonical values verbatim (2026-07-28 fix, G2). */
.v2-gd-glossary-levels .v2-level-grid{gap:0;}
.v2-gd-glossary-levels .v2-level-card{
  border-radius:0;border:0;background:transparent;
  border-inline-end:1px solid rgba(255,255,255,.14);padding:14px 16px;
}
.v2-gd-glossary-levels .v2-level-card:last-child{border-inline-end:0;}
.v2-gd-glossary-levels .v2-level-card::after{display:none;}
.v2-gd-glossary-levels .v2-level-share{
  position:relative;
  background-image:linear-gradient(to top,var(--gd-tint,rgba(244,180,0,.18)) 0,var(--gd-tint,rgba(244,180,0,.18)) var(--w,0%),transparent var(--w,0%));
  background-repeat:no-repeat;
}
.v2-gd-glossary-levels .v2-level-card.blue .v2-level-share{--gd-tint:rgba(107,169,248,.22);}
.v2-gd-glossary-levels .v2-level-card.green .v2-level-share{--gd-tint:rgba(139,195,74,.22);}
.v2-gd-glossary-levels .v2-level-card.coral .v2-level-share{--gd-tint:rgba(255,118,95,.24);}
body.theme-light .v2-gd-glossary-levels .v2-level-card{border-inline-end-color:#dde4ea;background:transparent;}

/* Page-local: slide-glossary-1 (Grid, fan-out plan §3b, batch B4) — ZERO
   metrics (a glossary has no numbers at all), so Grid reuses termBand's own
   markup (slides.ts) UNCHANGED instead of dressing a non-matrix as a fake
   metricMatrix. Uniform cells + hairline separators only, matching the two
   pages above — deliberately NO tint (there is no number to tint by). Cell
   padding matches the canonical 14px 16px above (2026-07-28 fix, G2 — used
   to be its own third, slightly different value). */
.v2-gd-glossary-terms .v2-term-grid{gap:0;}
.v2-gd-glossary-terms .v2-term-card{
  border-radius:0;border:0;background:transparent;
  border-inline-end:1px solid rgba(255,255,255,.14);padding:14px 16px;
}
.v2-gd-glossary-terms .v2-term-card:last-child{border-inline-end:0;}
.v2-gd-glossary-terms .v2-term-card::after{display:none;}
/* box-shadow:none (2026-07-28 fix, G2): same box-shadow leak as .v2-gd-toc
   above — the unscoped body.theme-light .v2-term-card rule (theme v3
   section) sets a box-shadow this override never cleared. */
body.theme-light .v2-gd-glossary-terms .v2-term-card{border-inline-end-color:#dde4ea;background:transparent;box-shadow:none;}

/* Page-local: slide-cover (Grid, fan-out plan §4, 2026-07-28) — 8
   gridFieldCells in a 4×2 layout (identification row + scope row), no
   metricMatrix/gridPanel wrapper (see coverSlide's own doc comment for why).
   nth-child border removal: column 4 of each row (4n) drops its vertical
   hairline (nothing to its right); row 2 (n+5) drops its horizontal hairline
   (nothing below it) — the last row/column of an otherwise uniform grid.
   THE COVER IS DARK IN BOTH THEMES BY DESIGN (theme.ts's own
   \`.slide.v2-cover\`/\`body.theme-light .slide.v2-cover\` rules, above) — every
   rule below that touches a shared, theme-adaptive class
   (.v2-gd-field-cell/.v2-gd-field-value assume a light card in light theme
   elsewhere in the deck) is re-overridden back to dark here, the same
   pattern \`.v2-cover-meta-item\`/\`.v2-cover-meta-value\` already established. */
.v2-gd-cover{height:100%;display:flex;flex-direction:column;justify-content:center;gap:18px;}
.v2-gd-cover-rule{height:1px;width:100%;background:var(--line);}
.v2-gd-cover .v2-gd-field{grid-template-columns:repeat(4,1fr);}
.v2-gd-cover .v2-gd-field-cell:nth-child(4n){border-inline-end:0;}
.v2-gd-cover .v2-gd-field-cell:nth-child(n+5){border-bottom:0;}
body.theme-light .slide.v2-cover .v2-gd-field-cell{border-color:rgba(255,255,255,.13);}
body.theme-light .slide.v2-cover .v2-gd-field-value{color:#fff;}

/* Page-local: slide-sep-1/2/3 (Grid, fan-out plan §5, 2026-07-28) — one
   full-width gridPanel (max-width 820px, centered) wrapping gridFieldCells:
   a narrow رقم القسم cell beside a wide التعريف cell via the panel's own
   \`0.6fr 2.4fr\` column template (plain grid auto-flow already puts the
   non-\`wide\` cell in the narrow column and the \`wide\` one in the remaining
   wide column — no span override needed). Both cells sit in the template's
   only row, so both drop their bottom hairline; the last (wide) cell also
   drops its inline-end hairline. Tone-bordered panel variants modelled on
   the existing \`.v2-gd-port-population .v2-gd-panel.land/.sea\` rules. The
   separator DOES follow the theme (unlike the cover) — no dark
   re-override needed here. */
.v2-gd-sep{height:100%;display:flex;align-items:center;justify-content:center;}
.v2-gd-sep .v2-gd-panel{max-width:820px;width:100%;margin:auto;}
.v2-gd-sep .v2-gd-field{grid-template-columns:0.6fr 2.4fr;}
.v2-gd-sep .v2-gd-field-cell{border-bottom:0;}
.v2-gd-sep .v2-gd-field-cell:last-child{border-inline-end:0;}
.v2-gd-sep .v2-gd-field-cell.wide .v2-gd-field-value{white-space:normal;line-height:1.6;font-weight:700;}
.v2-gd-sep .v2-gd-panel.gold{border-color:rgba(244,180,0,.35);}
.v2-gd-sep .v2-gd-panel.cyan{border-color:rgba(50,197,210,.35);}
.v2-gd-sep .v2-gd-panel.gold .v2-gd-panel-head span{color:var(--gold);}
.v2-gd-sep .v2-gd-panel.cyan .v2-gd-panel-head span{color:#32c5d2;}
body.theme-light .v2-gd-sep .v2-gd-panel.gold .v2-gd-panel-head span{color:#8a6d1f;}
body.theme-light .v2-gd-sep .v2-gd-panel.cyan .v2-gd-panel-head span{color:#1f8a94;}
`;
