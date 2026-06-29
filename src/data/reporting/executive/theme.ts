// Design tokens and CSS for the dark-navy executive report viewer.
// Visual identity from HTML mockup v4 — right-rail sidebar layout, portrait pages.
// v24.0: UI design taste enhancement — refined CSS, anti-AI visual polish, distinct
//         card accents, weighted section titles, premium sidebar, grand part dividers,
//         improved metrics, chips, bar rows, page numbers, and notice states.

export const EXEC_CSS = `
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Regular.woff") format("woff");font-weight:400;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Bold.woff") format("woff");font-weight:700;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Medium.woff") format("woff");font-weight:500;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Light.woff") format("woff");font-weight:300;font-style:normal;font-display:swap;}
:root{
  --navy:#062846;
  --navy-2:#0a3456;
  --navy-3:#0f3d63;
  --panel:#0b3150;
  --panel-2:#0e3a5f;
  --gold:#f4b400;
  --gold-2:#ffc62a;
  --blue:#6ba9f8;
  --slate:#8aa0b5;
  --coral:#ff765f;
  --green:#8bc34a;
  --cyan:#32c5d2;
  --purple:#b07adf;
  --white:#f7fbff;
  --muted:#b9c7d6;
  --line:rgba(255,255,255,.13);
  --shadow:0 22px 55px rgba(0,0,0,.32);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;
  color:var(--white);
  font-family:"Somar","IBM Plex Sans Arabic","Noto Kufi Arabic","Tahoma","Arial",sans-serif;
  background:
    radial-gradient(circle at 15% 0%,rgba(57,136,205,.16),transparent 25%),
    linear-gradient(180deg,#031b31,#061f38 65%,#04182c);
}
button,input,select{font:inherit}
.viewer{
  display:grid;
  grid-template-columns:280px minmax(0,1fr);
  min-height:100vh;
}

/* ── Sidebar — premium, not stock ─────────────────────────────────────── */
.sidebar{
  position:sticky;
  top:0;
  height:100vh;
  background:rgba(2,20,37,.98);
  border-left:1px solid rgba(255,255,255,.07);
  display:flex;
  flex-direction:column;
  overflow:hidden;
  z-index:20;
}
.brand-small{
  display:flex;
  align-items:center;
  gap:10px;
  padding:20px 16px 16px;
  border-bottom:1px solid rgba(255,255,255,.07);
  flex-shrink:0;
}
.brand-mark{
  width:48px;height:48px;border:1px solid var(--gold);border-radius:14px;
  display:grid;place-items:center;color:var(--gold);font-size:22px;
  background:linear-gradient(145deg,rgba(255,255,255,.05),rgba(255,255,255,.01));
  flex-shrink:0;
}
.brand-small strong{display:block;font-size:0.88rem;font-weight:700;color:#fff;line-height:1.2;}
.brand-small span{display:block;color:var(--slate);font-size:0.7rem;margin-top:2px;}
.toolbar{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;}
.btn{
  display:block;width:100%;
  border:1px solid var(--line);background:var(--panel);color:var(--white);
  padding:8px 10px;border-radius:10px;cursor:pointer;font-size:0.8rem;font-weight:600;
  text-align:center;
}
.btn:hover{border-color:var(--gold);color:var(--gold);}
.nav-title{
  font-size:0.65rem;font-weight:700;letter-spacing:0.1em;
  color:var(--slate);text-transform:uppercase;padding:12px 16px 4px;
}
.toc{flex:1;overflow-y:auto;padding:4px 0 16px;}
.toc a{
  display:flex;align-items:center;justify-content:space-between;
  padding:7px 16px;text-decoration:none;color:rgba(255,255,255,.5);
  font-size:0.72rem;font-weight:500;transition:all .15s;
  border-right:2px solid transparent;gap:8px;
}
.toc a:hover{color:rgba(255,255,255,.8);background:rgba(255,255,255,.03);}
.toc a.active{color:var(--gold);border-right-color:var(--gold);background:rgba(244,180,0,.06);}
.toc a span{flex:1;line-height:1.3;}
.toc a b{font-size:0.65rem;color:var(--slate);font-weight:400;flex-shrink:0;}
.toc a.active b{color:var(--gold);}

/* ── Page shell ───────────────────────────────────────────────────────── */
.content{padding:16px 10px 40px;overflow:hidden}
.page{
  width:min(980px,100%);
  aspect-ratio:1055/1491;
  min-height:760px;
  margin:0 auto 34px;
  position:relative;
  overflow:hidden;
  background:
    linear-gradient(145deg,rgba(6,40,70,.98),rgba(4,26,47,.98)),
    var(--navy);
  border:1px solid rgba(255,255,255,.12);
  box-shadow:var(--shadow);
  isolation:isolate;
}
.page::before{
  content:"";
  position:absolute;inset:0;
  background:
    linear-gradient(115deg,transparent 0 52%,rgba(244,180,0,.12) 52.15%,transparent 52.4%),
    repeating-linear-gradient(0deg,transparent 0 34px,rgba(255,255,255,.025) 35px),
    repeating-linear-gradient(90deg,transparent 0 34px,rgba(255,255,255,.02) 35px);
  pointer-events:none;
}
.page::after{
  content:"";
  position:absolute;width:250px;height:180px;left:26px;top:18px;
  border:2px solid rgba(107,169,248,.14);border-radius:34px;
  transform:rotate(-4deg);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.03);
  pointer-events:none;
}
.page-inner{
  position:relative;z-index:2;height:100%;
  width:calc(100% - 44px);margin-right:44px;
  padding:30px 28px 36px 28px;overflow:hidden;
}

/* ── Right rail — reads cleanly ───────────────────────────────────────── */
.right-rail{
  position:absolute;right:0;top:0;bottom:0;width:44px;min-width:44px;
  background:linear-gradient(180deg,rgba(3,23,42,.96),rgba(9,42,69,.96));
  border-left:1px solid rgba(255,255,255,.12);
  display:flex;flex-direction:column;z-index:4;
}
.rail-main{
  writing-mode:vertical-rl;transform:rotate(180deg);
  padding:20px 12px;font-weight:800;letter-spacing:0;color:#fff;font-size:11px;
  border-bottom:1px solid var(--line);min-height:180px;
}
.rail-main em{font-style:normal;color:var(--gold)}
.rail-tab{
  writing-mode:vertical-rl;transform:rotate(180deg);flex:1;min-height:100px;
  display:grid;place-items:center;color:#d3deea;border-bottom:1px solid var(--line);
  font-weight:700;font-size:10px;
}
.rail-tab.active{color:var(--gold);box-shadow:inset -4px 0 0 var(--gold);background:rgba(244,180,0,.08)}

/* ── Org block ────────────────────────────────────────────────────────── */
.org{
  display:flex;align-items:center;gap:14px;font-size:11px;color:#e7eef6;
  width:max-content;max-width:58%;
}
.org .shield{
  width:58px;height:64px;clip-path:polygon(50% 0,95% 18%,85% 72%,50% 100%,15% 72%,5% 18%);
  background:repeating-linear-gradient(135deg,#dbe7f3 0 3px,transparent 3px 7px);
  opacity:.8;flex-shrink:0;
}
.zatca-logo{flex-shrink:0;}
.org-lines{
  border-right:3px solid rgba(244,180,0,.4);
  padding-right:14px;
  line-height:1.7;
  font-size:0.78rem;
  color:rgba(255,255,255,.55);
}

/* ── Page number — refined ────────────────────────────────────────────── */
.page-no{
  position:absolute;bottom:18px;left:50%;transform:translateX(-50%);
  font-size:0.72rem;font-weight:600;color:rgba(255,255,255,.25);
  letter-spacing:0.12em;display:flex;align-items:center;gap:8px;white-space:nowrap;
}
.page-no::before,.page-no::after{
  content:"";width:20px;height:1px;background:rgba(244,180,0,.3);
}

/* ── Typography hierarchy ─────────────────────────────────────────────── */
.title-block{margin-top:46px;text-align:center}
.kicker{color:var(--gold);font-weight:800;font-size:28px;margin-bottom:4px}
h1{font-size:42px;line-height:1.18;margin:6px 0 10px}
.subtitle{font-size:18px;color:var(--gold);font-weight:700}
.rule{height:2px;width:180px;background:linear-gradient(90deg,transparent,var(--gold),transparent);margin:18px auto}
.lead{max-width:760px;margin:22px auto 0;line-height:1.7;color:#dce7f2;font-size:14px}

/* ── Section titles — visual weight contrast ──────────────────────────── */
.section-title{
  font-size:1.55rem;font-weight:700;color:#fff;margin:18px 0 4px;
  position:relative;padding-bottom:10px;
}
.section-title::after{
  content:"";position:absolute;bottom:0;right:0;
  width:40px;height:2px;background:var(--gold);border-radius:1px;
}
.section-subtitle{color:var(--gold);font-size:15px;margin-bottom:12px}
.panel-title{color:var(--gold);font-size:17px;font-weight:800;margin-bottom:8px}

/* ── Badges ───────────────────────────────────────────────────────────── */
.badges{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:28px}
.badge{
  display:inline-flex;align-items:center;gap:6px;
  padding:8px 16px;border:1px solid rgba(244,180,0,.4);border-radius:8px;
  font-size:0.78rem;font-weight:600;color:var(--gold);
  background:rgba(244,180,0,.07);letter-spacing:0.03em;
}

/* ── Grids ────────────────────────────────────────────────────────────── */
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:1fr 1fr}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-5{grid-template-columns:repeat(5,1fr)}

/* ── Cards — distinct, not generic ───────────────────────────────────── */
.card{
  background:linear-gradient(180deg,rgba(14,58,95,.82),rgba(7,39,67,.92));
  border:1px solid rgba(255,255,255,.14);
  border-radius:16px;padding:12px;box-shadow:0 10px 20px rgba(0,0,0,.14);
  position:relative;overflow:hidden;
}
.card::before{
  content:"";position:absolute;top:0;right:0;
  width:3px;height:100%;
  background:var(--gold);border-radius:0 16px 16px 0;
}
.card h3{margin:0 0 6px;font-size:15px}
.card.land::before{background:var(--green);}
.card.sea::before{background:var(--blue);}
.card.stage1::before{background:var(--gold);}
.card.stage2::before{background:var(--blue);}
.card.stage3::before{background:var(--slate);}
.card.stage4::before{background:var(--coral);}

/* ── Metrics — visually dominant ──────────────────────────────────────── */
.metric{
  font-size:2.2rem;font-weight:800;line-height:1;
  letter-spacing:-0.02em;margin:10px 0 4px;
}
.metric.gold{color:var(--gold);text-shadow:0 0 24px rgba(244,180,0,.3);}
.metric.blue{color:var(--blue);text-shadow:0 0 24px rgba(107,169,248,.3);}
.metric.green{color:var(--green);text-shadow:0 0 24px rgba(139,195,74,.3);}
.metric.coral{color:var(--coral);text-shadow:0 0 24px rgba(255,118,95,.3);}
.metric.slate{color:var(--slate);}
.metric.purple{color:var(--purple);}
.metric.cyan{color:var(--cyan);}
.muted{color:var(--muted)}

/* ── Info / note box ──────────────────────────────────────────────────── */
.info{
  background:rgba(107,169,248,.07);
  border:1px solid rgba(107,169,248,.2);
  border-radius:8px;padding:10px 14px;
  font-size:0.8rem;color:rgba(255,255,255,.65);line-height:1.6;
  display:flex;align-items:flex-start;gap:10px;
}

/* ── Tables — zebra with intent, not filler ───────────────────────────── */
.table-wrap{overflow:hidden;width:100%;border:1px solid rgba(255,255,255,.12);border-radius:16px}
table{table-layout:fixed;width:100%;border-collapse:collapse;background:rgba(4,31,54,.72)}
td,th{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 10px}
th,td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.1);border-left:1px solid rgba(255,255,255,.08);text-align:center;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th{
  background:rgba(15,61,99,.92);color:#fff;
  font-size:0.72rem;font-weight:700;letter-spacing:0.03em;
  border-bottom:1px solid rgba(255,255,255,.15);
}
td{font-size:0.8rem;color:rgba(255,255,255,.88);}
td:first-child,th:first-child{text-align:right}
tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:rgba(255,255,255,.025);}
tbody tr:hover{background:rgba(244,180,0,.04);}
.total-row td{background:rgba(244,180,0,.08);font-weight:800;border-top:1px solid rgba(244,180,0,.25);}

/* ── Chips — real status badges ───────────────────────────────────────── */
.chip{
  display:inline-flex;align-items:center;gap:4px;
  padding:3px 10px;border-radius:20px;font-size:0.72rem;font-weight:600;
  background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);
  border:1px solid rgba(255,255,255,.12);
}
.chip.green{background:rgba(139,195,74,.15);color:var(--green);border-color:rgba(139,195,74,.3);}
.chip.blue{background:rgba(107,169,248,.15);color:var(--blue);border-color:rgba(107,169,248,.3);}
.chip.orange{background:rgba(244,180,0,.15);color:var(--gold);border-color:rgba(244,180,0,.3);}
.chip.red{background:rgba(255,118,95,.15);color:var(--coral);border-color:rgba(255,118,95,.3);}

/* ── Bar rows ─────────────────────────────────────────────────────────── */
.bar{height:8px;border-radius:999px;background:rgba(255,255,255,.09);overflow:hidden}
.bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--green));border-radius:inherit}

/* ── Level cards ──────────────────────────────────────────────────────── */
.level-card{min-height:130px;position:relative;overflow:hidden}
.level-card::after{
  content:"";position:absolute;left:0;right:0;bottom:0;height:4px;
  background:var(--accent,var(--gold));
}
.level-card::before{display:none;}
.level-card h3{color:var(--accent,var(--gold));font-size:24px}
.stage1{--accent:var(--gold)} .stage2{--accent:var(--blue)} .stage3{--accent:var(--slate)} .stage4{--accent:var(--coral)}

/* ── Port split ───────────────────────────────────────────────────────── */
.port-split{display:grid;grid-template-columns:1.05fr .95fr;gap:12px}
.land{border-color:rgba(139,195,74,.45)} .sea{border-color:rgba(107,169,248,.45)}
.land .panel-title{color:var(--green)} .sea .panel-title{color:var(--blue)}

/* ── Part divider pages — grand, not a PowerPoint slide ──────────────── */
.big-divider{
  display:flex;flex-direction:column;
  justify-content:center;align-items:flex-end;
  padding:60px 48px;position:relative;overflow:hidden;height:100%;
}
.big-divider::before{
  content:"";position:absolute;
  top:-20%;left:-10%;width:70%;height:140%;
  background:radial-gradient(ellipse,rgba(244,180,0,.04) 0%,transparent 70%);
  pointer-events:none;
}
.big-divider .kicker{
  font-size:0.85rem;font-weight:600;letter-spacing:0.15em;
  color:var(--gold);text-transform:uppercase;margin-bottom:12px;
}
.big-divider h1{
  font-size:3.2rem;font-weight:800;color:#fff;
  line-height:1.05;margin:0 0 20px;letter-spacing:-0.02em;
  text-align:right;
}
.big-divider .rule{
  width:48px;height:3px;background:var(--gold);border-radius:2px;
  margin:0 0 24px auto;
}
.big-divider .lead{
  font-size:0.95rem;color:rgba(255,255,255,.6);
  line-height:1.8;max-width:500px;text-align:right;
}
.big-divider .icon{
  font-size:2.8rem;margin-bottom:16px;opacity:0.8;align-self:flex-end;
}
.big-divider .page-no{
  position:absolute;bottom:24px;left:50%;transform:translateX(-50%);
}

/* ── Feature grid (part 3 cover) ─────────────────────────────────────── */
.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:20px}
.feature{
  border:1px solid rgba(244,180,0,.4);border-radius:12px;padding:12px;
  background:rgba(255,255,255,.025);font-size:13px;font-weight:600;text-align:center;
  transition:border-color .2s;
}
.feature:hover{border-color:rgba(244,180,0,.7);}
.icon{font-size:30px;margin-bottom:8px;color:var(--gold)}

/* ── Heatmap ──────────────────────────────────────────────────────────── */
.heatmap{display:grid;grid-template-columns:160px repeat(6,1fr);gap:2px;background:rgba(255,255,255,.08);padding:2px;border-radius:12px;overflow:hidden}
.heatmap div{padding:10px 7px;background:#0b3150;text-align:center;font-size:12px}
.heatmap .hdr{background:#123f65;font-weight:800}
.hm1{background:#204c69!important}.hm2{background:#336a73!important}.hm3{background:#70824d!important}.hm4{background:#a56c37!important}.hm5{background:#9b4d45!important}

/* ── Quad grid ────────────────────────────────────────────────────────── */
.quad{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;border:1px solid rgba(255,255,255,.14);border-radius:16px;overflow:hidden}
.quad > div{padding:16px;border:1px solid rgba(255,255,255,.08);min-height:110px}
.quad h4{margin:0 0 8px}

/* ── Cover page ───────────────────────────────────────────────────────── */
.cover .page-inner{padding-left:28px}
.cover .title-block{margin-top:48px;text-align:center}
.cover h1{font-size:3.2rem;letter-spacing:-0.02em;}
.cover .org{max-width:70%}
.cover .level-strip{
  display:grid;grid-template-columns:repeat(4,1fr);gap:8px;
  margin:28px auto 0;max-width:720px;
}
.cover .level-strip > div{
  padding:14px 12px;
  border:1px solid rgba(255,255,255,.12);
  border-bottom:4px solid var(--accent,var(--gold));
  border-radius:10px;
  background:rgba(255,255,255,.04);
  text-align:center;font-size:0.82rem;font-weight:600;
  color:rgba(255,255,255,.8);
  position:relative;overflow:hidden;
}
.cover .title-block .kicker{
  font-size:0.8rem;font-weight:600;letter-spacing:0.12em;
  color:var(--gold);text-transform:uppercase;margin-bottom:10px;font-size:0.85rem;
}
.cover .title-block .subtitle{
  font-size:0.95rem;color:rgba(255,255,255,.55);font-weight:400;margin-bottom:20px;
}
.cover .title-block .rule{
  width:40px;height:2px;background:var(--gold);border-radius:1px;margin:0 auto 20px;
}
.cover .title-block .lead{
  font-size:0.82rem;color:rgba(255,255,255,.6);line-height:1.9;
}
.cover-bg-art{
  position:absolute;left:-5%;top:15%;width:55%;height:70%;
  background:radial-gradient(ellipse at center,rgba(107,169,248,.06) 0%,transparent 60%);
  border-radius:50%;pointer-events:none;z-index:1;
}

/* ── Notice / empty state ─────────────────────────────────────────────── */
.notice-centered{
  display:flex;flex-direction:column;align-items:center;
  justify-content:center;flex:1;text-align:center;
  padding:40px 24px;color:var(--slate);font-size:0.875rem;
}
.notice-centered::before{
  content:"◌";font-size:2rem;opacity:.3;display:block;margin-bottom:12px;
}
.notice-centered div{line-height:1.6;max-width:280px;}

/* ── Misc utilities ───────────────────────────────────────────────────── */
.small-note{font-size:12px;color:var(--muted)}
.grid-auto{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;}
.chart-container{width:100%;min-height:220px;display:flex;align-items:center;justify-content:center;}
.bubble-chart{width:100%;aspect-ratio:1.4/1;min-height:200px;}

/* ── Light page variant ───────────────────────────────────────────────── */
.page.light{background:#f2f5f8;color:#0a2d4a;}
.page.light::before{background:repeating-linear-gradient(0deg,transparent 0 34px,rgba(10,45,74,.03) 35px)}
.page.light .card{background:white;color:#0a2d4a;border-color:#dfe6ed}
.page.light .card::before{display:none;}
.page.light .muted{color:#607386}
.page.light .table-wrap{border-color:#d8e0e8}
.page.light table{background:white;color:#0a2d4a}
.page.light th{background:#0e3a5f;color:white}
.page.light td{border-color:#e3e8ee}
.page.light .info{color:#163953}

/* ── Compact pages ────────────────────────────────────────────────────── */
.page-inner{overflow:hidden}
.page.compact .page-inner{padding:24px 26px 30px 26px}
.page.compact h2.section-title{font-size:1.3rem}
.page.compact .section-subtitle{font-size:14px;margin-bottom:10px}
.page.compact .card{padding:10px}
.page.compact th,.page.compact td{padding:7px 5px;font-size:10.5px}
.page.compact .metric{font-size:1.9rem}
.page.compact .grid{gap:10px}

/* ── V4 layout refinements ────────────────────────────────────────────── */
.page *{max-width:100%}
.page-inner > *{max-width:100%}
.page.toc-page::after{width:220px;height:160px;left:24px;top:20px;opacity:.65;}
.page.toc-page .page-inner{padding:20px 24px 30px 24px !important;}
.page.toc-page .org{max-width:100%;width:100%;justify-content:flex-start;margin-bottom:8px;}
.page.toc-page .toc-header{display:grid;grid-template-columns:1fr 260px;gap:12px;align-items:start;margin-bottom:10px;}
.page.toc-page .toc-title{text-align:right;padding-top:2px;}
.page.toc-page .toc-title h2{margin:0;font-size:34px;line-height:1.12;}
.page.toc-page .toc-title .section-subtitle{margin:6px 0 0;font-size:15px;}
.page.toc-page .toc-grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:230px 230px;gap:14px;height:calc(100% - 150px);}
.page.toc-page .toc-grid .card{height:100%;padding:14px 16px;overflow:hidden;}
.page.toc-page .toc-grid .panel-title{margin-bottom:10px;font-size:17px;}
.page.toc-page .toc-grid table{min-width:0;width:100%;table-layout:auto;}
.page.toc-page .toc-grid th,.page.toc-page .toc-grid td{padding:8px 10px;font-size:12px;}
.page.toc-page .appendix-card{display:flex;flex-direction:column;justify-content:space-between;}
.page.toc-page .appendix-card p{margin:0;line-height:1.8;font-size:14px;}
.page.toc-page .appendix-list{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-top:14px;}
.page.toc-page .appendix-list span{display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px;}
.page.toc-page .appendix-list span::before{content:"•";position:absolute;right:0;color:var(--gold);}

/* ── Responsive ───────────────────────────────────────────────────────── */
@media(max-width:980px){
  .viewer{grid-template-columns:1fr}
  .sidebar{position:relative;height:auto;flex-direction:column;}
  .content{padding:14px 4px 40px}
  .page{aspect-ratio:auto;min-height:1050px}
  .page-inner{width:calc(100% - 38px);margin-right:38px;padding:28px 22px 44px 20px}
  .right-rail{width:38px}
  .rail-tab,.rail-main{font-size:10px}
  .grid-4,.grid-5,.feature-grid{grid-template-columns:repeat(2,1fr)}
  .grid-3{grid-template-columns:1fr 1fr}
  .port-split,.grid-2{grid-template-columns:1fr}
  h1,.cover h1{font-size:2.2rem}
  .big-divider h1{font-size:2rem}
  .page.toc-page .toc-header{grid-template-columns:1fr}
  .page.toc-page .toc-grid{grid-template-columns:1fr;grid-template-rows:auto;height:auto;}
}

/* ── Print ────────────────────────────────────────────────────────────── */
@media print{
  @page{size:A4 portrait;margin:0;}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .sidebar{display:none!important;}
  .viewer{display:block;}
  .content{padding:0;background:transparent;}
  .page{page-break-after:always;break-after:page;margin:0;box-shadow:none;border:0;width:210mm;aspect-ratio:auto;min-height:297mm;}
  .page:last-child{page-break-after:auto;break-after:auto;}
  .right-rail{display:none;}
  .page-inner{margin-right:0;width:100%;padding:20mm 20mm 20mm 20mm;}
}
`;
