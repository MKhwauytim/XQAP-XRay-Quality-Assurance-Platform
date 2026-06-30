// Deck-specific CSS for the executive Presentation (design §6 / blueprint §3).
// Landscape 16:9 slides, one message + one hero visual + a decision footer each.
// Reuses the navy/gold color CSS variables defined in theme.ts (EXEC_CSS) — this
// module does NOT redefine the palette; it imports EXEC_CSS for the :root vars and
// font faces, then layers deck layout on top. No emoji, no runtime scaling.

import { EXEC_CSS } from "../theme";

/**
 * Deck CSS = the shared theme (palette, fonts, chips, cards) + landscape slide
 * layout. The print rule below overrides theme.ts's A4 portrait `@page` with the
 * 16:9 landscape page box the deck needs (design §6).
 */
export const DECK_CSS = `
${EXEC_CSS}

/* ── Deck shell ───────────────────────────────────────────────────────── */
.deck-viewer{
  display:block;min-height:100vh;
  padding:28px 16px 56px;
}
.deck-toolbar{
  position:sticky;top:0;z-index:30;
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  max-width:1180px;margin:0 auto 22px;padding:14px 20px;
  background:rgba(2,20,37,.94);border:1px solid rgba(255,255,255,.1);
  border-radius:16px;backdrop-filter:blur(8px);
}
.deck-toolbar .deck-brand{display:flex;align-items:center;gap:12px;}
.deck-toolbar .brand-mark{width:42px;height:42px;font-size:18px;}
.deck-toolbar .deck-brand strong{display:block;font-size:0.92rem;font-weight:800;color:#fff;}
.deck-toolbar .deck-brand span{display:block;color:var(--slate);font-size:0.72rem;margin-top:2px;}
.deck-toolbar .btn{width:auto;padding:9px 18px;}

/* A 16:9 landscape slide. 297mm × 167mm ≈ 1.778 aspect. */
.slide{
  width:min(1120px,100%);
  aspect-ratio:297/167;
  margin:0 auto 26px;
  position:relative;overflow:hidden;
  background:
    linear-gradient(150deg,rgba(6,40,70,.99),rgba(4,24,44,.99)),
    var(--navy);
  border:1px solid rgba(255,255,255,.12);
  box-shadow:var(--shadow);
  border-radius:14px;
  isolation:isolate;
  display:flex;flex-direction:column;
}
.slide::before{
  content:"";position:absolute;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(ellipse 60% 55% at 12% 15%,rgba(244,180,0,.06),transparent 70%),
    radial-gradient(ellipse 55% 50% at 92% 88%,rgba(107,169,248,.05),transparent 70%),
    repeating-linear-gradient(0deg,transparent 0 40px,rgba(255,255,255,.018) 41px);
}
.slide-inner{
  position:relative;z-index:1;flex:1 1 auto;min-height:0;
  display:flex;flex-direction:column;
  padding:34px 44px 22px;
}

/* ── Slide head (eyebrow + headline message) ──────────────────────────── */
.slide-eyebrow{
  display:flex;align-items:center;gap:9px;color:var(--gold);
  font-size:0.74rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;
}
.slide-eyebrow .slide-eyebrow-icon{display:inline-flex;color:var(--gold);}
.slide-eyebrow .slide-eyebrow-icon svg{display:block;}
.slide-eyebrow .slide-num{margin-inline-start:auto;color:var(--slate);font-weight:700;letter-spacing:0.08em;}
.slide-headline{
  font-size:2rem;font-weight:900;color:#fff;line-height:1.18;
  margin:10px 0 2px;letter-spacing:-0.01em;
}
.slide-subhead{color:var(--gold);font-size:1rem;font-weight:700;margin-bottom:2px;}

/* ── Slide body — the hero zone ───────────────────────────────────────── */
.slide-body{
  flex:1 1 auto;min-height:0;margin-top:16px;
  display:flex;flex-direction:column;justify-content:center;
}
.slide-split{display:grid;grid-template-columns:1.05fr .95fr;gap:26px;align-items:center;height:100%;}
.slide-split.wide-left{grid-template-columns:1.35fr .65fr;}
.slide-split.even{grid-template-columns:1fr 1fr;}

/* Big hero number (the layered "5-second" headline). */
.hero-figure{display:flex;flex-direction:column;justify-content:center;gap:6px;}
.hero-number{
  font-size:5.2rem;font-weight:900;line-height:.95;letter-spacing:-0.03em;
  color:var(--gold);text-shadow:0 0 36px rgba(244,180,0,.28);
}
.hero-number.blue{color:var(--blue);text-shadow:0 0 36px rgba(107,169,248,.28);}
.hero-number.green{color:var(--green);text-shadow:0 0 36px rgba(139,195,74,.28);}
.hero-number.coral{color:var(--coral);text-shadow:0 0 36px rgba(255,118,95,.28);}
.hero-number.slate{color:var(--slate);}
.hero-caption{font-size:1rem;color:rgba(255,255,255,.82);font-weight:600;line-height:1.5;max-width:420px;}
.hero-sub{font-size:0.84rem;color:var(--muted);line-height:1.6;}

/* The hero chart box — a single large visual, sized, never runtime-scaled. */
.hero-chart{width:100%;height:var(--hero-h,320px);display:flex;align-items:center;justify-content:center;}
.hero-chart svg{max-height:100%;max-width:100%;width:auto;}
.hero-chart-cap{font-size:0.78rem;color:var(--muted);text-align:center;margin-top:6px;}

/* ── KPI band — the executive-summary headline strip ──────────────────── */
.kpi-band{display:grid;gap:16px;}
.kpi-band.n2{grid-template-columns:repeat(2,1fr);}
.kpi-band.n3{grid-template-columns:repeat(3,1fr);}
.kpi-band.n4{grid-template-columns:repeat(4,1fr);}
.kpi-band.n5{grid-template-columns:repeat(5,1fr);}
.kpi-tile{
  background:linear-gradient(180deg,rgba(14,58,95,.8),rgba(7,39,67,.92));
  border:1px solid rgba(255,255,255,.13);border-radius:16px;padding:18px 18px 16px;
  position:relative;overflow:hidden;
}
.kpi-tile::before{content:"";position:absolute;top:0;right:0;width:3px;height:100%;background:var(--gold);}
.kpi-tile.blue::before{background:var(--blue);} .kpi-tile.green::before{background:var(--green);}
.kpi-tile.coral::before{background:var(--coral);} .kpi-tile.slate::before{background:var(--slate);}
.kpi-tile.purple::before{background:var(--purple);} .kpi-tile.cyan::before{background:var(--cyan);}
.kpi-tile .kpi-tile-label{font-size:0.78rem;color:var(--muted);font-weight:600;}
.kpi-tile .kpi-tile-value{font-size:2.4rem;font-weight:900;line-height:1;margin:8px 0 3px;letter-spacing:-0.02em;color:var(--gold);}
.kpi-tile.blue .kpi-tile-value{color:var(--blue);} .kpi-tile.green .kpi-tile-value{color:var(--green);}
.kpi-tile.coral .kpi-tile-value{color:var(--coral);} .kpi-tile.slate .kpi-tile-value{color:var(--slate);}
.kpi-tile.purple .kpi-tile-value{color:var(--purple);} .kpi-tile.cyan .kpi-tile-value{color:var(--cyan);}
.kpi-tile .kpi-tile-sub{font-size:0.72rem;color:var(--slate);line-height:1.5;}

/* ── Curated mini-table (top-N, never the full table) ─────────────────── */
.deck-table{width:100%;border-collapse:collapse;background:rgba(4,31,54,.55);border-radius:12px;overflow:hidden;}
.deck-table th,.deck-table td{
  padding:9px 12px;text-align:center;font-size:0.82rem;
  border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;
}
.deck-table th{background:rgba(15,61,99,.9);color:#fff;font-weight:800;font-size:0.76rem;}
.deck-table td{color:rgba(255,255,255,.88);}
.deck-table td:first-child,.deck-table th:first-child{text-align:right;}
.deck-table tr:last-child td{border-bottom:0;}
.deck-table tbody tr:nth-child(even){background:rgba(255,255,255,.025);}
.deck-table .insuff{color:var(--muted);}

/* ── Cards used for findings / actions / decisions ────────────────────── */
.deck-cards{display:grid;gap:14px;}
.deck-cards.n2{grid-template-columns:repeat(2,1fr);}
.deck-cards.n3{grid-template-columns:repeat(3,1fr);}
.deck-card{
  background:linear-gradient(180deg,rgba(14,58,95,.72),rgba(7,39,67,.9));
  border:1px solid rgba(255,255,255,.13);border-radius:14px;padding:16px 18px;
  position:relative;overflow:hidden;
}
.deck-card::before{content:"";position:absolute;top:0;right:0;width:3px;height:100%;background:var(--gold);}
.deck-card.coral::before{background:var(--coral);} .deck-card.blue::before{background:var(--blue);}
.deck-card.green::before{background:var(--green);} .deck-card.slate::before{background:var(--slate);}
.deck-card .deck-card-icon{display:inline-flex;color:var(--gold);margin-bottom:8px;}
.deck-card .deck-card-icon svg{display:block;}
.deck-card h4{margin:0 0 6px;font-size:0.98rem;color:#fff;font-weight:800;}
.deck-card p{margin:0;font-size:0.84rem;color:rgba(255,255,255,.78);line-height:1.6;}

/* Ordered decision / action list. */
.deck-list{list-style:none;margin:0;padding:0;display:grid;gap:12px;}
.deck-list li{
  display:flex;align-items:flex-start;gap:14px;
  border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;
  background:rgba(255,255,255,.02);font-size:0.9rem;color:rgba(255,255,255,.85);line-height:1.55;
}
.deck-list li .deck-list-num{
  flex-shrink:0;width:30px;height:30px;border-radius:50%;
  display:grid;place-items:center;font-weight:900;font-size:0.92rem;
  color:var(--navy);background:var(--gold);
}

/* Timeline (next-period cadence). */
.deck-timeline{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;}
.deck-timeline .tl-step{
  border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;
  background:rgba(255,255,255,.02);position:relative;
}
.deck-timeline .tl-step .tl-when{font-size:0.72rem;font-weight:800;color:var(--gold);letter-spacing:0.06em;}
.deck-timeline .tl-step .tl-what{font-size:0.84rem;color:rgba(255,255,255,.82);margin-top:6px;line-height:1.5;}

/* ── Insufficient-data centered state (a slide states it plainly) ─────── */
.deck-empty{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;gap:12px;color:var(--slate);
}
.deck-empty .deck-empty-icon{color:var(--gold);opacity:.75;}
.deck-empty .deck-empty-icon svg{display:block;}
.deck-empty b{font-size:1.1rem;color:#fff;font-weight:800;}
.deck-empty span{font-size:0.86rem;color:var(--muted);max-width:520px;line-height:1.7;}

/* ── Decision footer — "the decision this supports" ───────────────────── */
.slide-footer{
  flex-shrink:0;position:relative;z-index:1;
  display:flex;align-items:center;gap:12px;
  margin-top:14px;padding:13px 44px;
  border-top:1px solid rgba(255,255,255,.1);
  background:rgba(2,20,37,.5);
}
.slide-footer .foot-icon{display:inline-flex;color:var(--gold);flex-shrink:0;}
.slide-footer .foot-icon svg{display:block;}
.slide-footer .foot-label{font-size:0.7rem;font-weight:800;color:var(--gold);letter-spacing:0.1em;text-transform:uppercase;white-space:nowrap;}
.slide-footer .foot-text{font-size:0.86rem;color:rgba(255,255,255,.82);line-height:1.45;}

/* ── Title slide ──────────────────────────────────────────────────────── */
.slide.title-slide .slide-inner{justify-content:center;align-items:center;text-align:center;}
.slide.title-slide .title-mark{
  width:74px;height:74px;border:1px solid var(--gold);border-radius:20px;
  display:grid;place-items:center;color:var(--gold);margin:0 auto 22px;
  background:linear-gradient(145deg,rgba(255,255,255,.05),rgba(255,255,255,.01));
}
.slide.title-slide .title-mark svg{display:block;}
.slide.title-slide .title-kicker{color:var(--gold);font-weight:800;font-size:0.92rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:14px;}
.slide.title-slide h1{font-size:3rem;font-weight:900;line-height:1.12;margin:0 0 14px;color:#fff;}
.slide.title-slide .title-sub{font-size:1.1rem;color:var(--gold);font-weight:700;margin-bottom:6px;}
.slide.title-slide .title-meta{font-size:0.92rem;color:var(--muted);}
.slide.title-slide .title-rule{height:3px;width:90px;background:var(--gold);border-radius:2px;margin:22px auto;}
.slide.title-slide .title-classify{
  display:inline-flex;align-items:center;gap:8px;margin-top:6px;
  padding:8px 18px;border:1px solid rgba(244,180,0,.4);border-radius:999px;
  font-size:0.78rem;font-weight:700;color:var(--gold);background:rgba(244,180,0,.07);
}
.slide.title-slide .title-levels{
  display:grid;grid-template-columns:repeat(4,1fr);gap:10px;
  margin:26px auto 0;max-width:760px;width:100%;
}
.slide.title-slide .title-levels > div{
  padding:12px 10px;border:1px solid rgba(255,255,255,.12);
  border-bottom:4px solid var(--accent,var(--gold));border-radius:10px;
  background:rgba(255,255,255,.04);font-size:0.82rem;font-weight:700;color:rgba(255,255,255,.82);
}
.slide.title-slide .title-levels .l1{--accent:var(--gold);} .slide.title-slide .title-levels .l2{--accent:var(--blue);}
.slide.title-slide .title-levels .l3{--accent:var(--slate);} .slide.title-slide .title-levels .l4{--accent:var(--coral);}

/* ── Print: 16:9 landscape, one slide per page, no toolbar ────────────── */
@media print{
  @page{size:297mm 167mm;margin:0;}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff;}
  .deck-toolbar{display:none!important;}
  .deck-viewer{padding:0;background:transparent;}
  .slide{
    width:297mm;height:167mm;aspect-ratio:auto;margin:0;border:0;border-radius:0;
    box-shadow:none;page-break-after:always;break-after:page;
  }
  .slide:last-child{page-break-after:auto;break-after:auto;}
}

/* ── Responsive (on-screen review) ────────────────────────────────────── */
@media(max-width:820px){
  .slide-split,.slide-split.wide-left,.slide-split.even{grid-template-columns:1fr;}
  .kpi-band.n4,.kpi-band.n5{grid-template-columns:repeat(2,1fr);}
  .kpi-band.n3{grid-template-columns:1fr 1fr;}
  .deck-cards.n3,.deck-cards.n2{grid-template-columns:1fr;}
  .slide{aspect-ratio:auto;min-height:520px;}
  .slide-headline{font-size:1.5rem;}
  .slide.title-slide h1{font-size:2rem;}
  .hero-number{font-size:3.4rem;}
}
`;
