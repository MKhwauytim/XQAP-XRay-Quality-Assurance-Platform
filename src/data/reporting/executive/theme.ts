// Design tokens and CSS for the dark-navy executive report viewer.
// Visual identity from HTML mockup v4 — right-rail sidebar layout, portrait pages.
// v24.0: UI design taste enhancement — refined CSS, anti-AI visual polish, distinct
//         card accents, weighted section titles, premium sidebar, grand part dividers,
//         improved metrics, chips, bar rows, page numbers, and notice states.

// Fonts are embedded as base64 data URIs so exported reports stay self-contained
// even when the HTML file is moved away from the app folder.
import somarRegular from "../../../assets/fonts/SomarSans-Regular.woff?inline";
import somarBold from "../../../assets/fonts/SomarSans-Bold.woff?inline";
import somarMedium from "../../../assets/fonts/SomarSans-Medium.woff?inline";
import somarLight from "../../../assets/fonts/SomarSans-Light.woff?inline";

export const EXEC_CSS = `
@font-face{font-family:"Somar";src:url("${somarRegular}") format("woff");font-weight:400;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${somarBold}") format("woff");font-weight:700;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${somarMedium}") format("woff");font-weight:500;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${somarLight}") format("woff");font-weight:300;font-style:normal;font-display:swap;}
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
  display:flex;flex-direction:column;
}
/* The last meaningful content band on a data page absorbs leftover height
   so pages never end with a dead empty third. Builders add .page-fill
   to the element that should stretch (usually a table-wrap or a panel grid). */
.page-fill{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.page-fill > .table-wrap{flex:1 1 auto;min-height:0;}
.page-fill .grid{flex:1 1 auto;align-content:start;}
/* Push the page number to the bottom regardless of content height. */
.page-inner > .page-no{margin-top:auto;}

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
/* Grand part divider — three vertical bands (top header / center title / bottom toc),
   anchored by a giant ghost numeral painted across the whole page. */
.big-divider{
  display:flex;flex-direction:column;
  justify-content:space-between;align-items:stretch;
  padding:54px 48px 64px;position:relative;overflow:hidden;height:100%;
}
.big-divider::before{
  content:"";position:absolute;inset:0;
  background:
    radial-gradient(ellipse 70% 60% at 15% 30%,rgba(244,180,0,.07) 0%,transparent 70%),
    radial-gradient(ellipse 60% 50% at 90% 85%,rgba(107,169,248,.06) 0%,transparent 70%);
  pointer-events:none;z-index:0;
}
/* Giant ghost part-number behind everything. Builder sets --divider-num. */
.big-divider::after{
  content:var(--divider-num,"");
  position:absolute;left:-2%;bottom:-14%;
  font-size:30rem;font-weight:900;line-height:.8;
  color:rgba(255,255,255,.035);
  letter-spacing:-0.04em;pointer-events:none;z-index:0;
  font-family:"Somar","Arial",sans-serif;
}
.big-divider > *{position:relative;z-index:1;}
/* Top band: subtle org strip */
.big-divider .divider-top{
  display:flex;align-items:center;gap:14px;
  font-size:0.72rem;color:rgba(255,255,255,.45);
  border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:16px;
}
.big-divider .divider-top .shield{
  width:30px;height:34px;flex-shrink:0;
  clip-path:polygon(50% 0,95% 18%,85% 72%,50% 100%,15% 72%,5% 18%);
  background:repeating-linear-gradient(135deg,rgba(219,231,243,.6) 0 2px,transparent 2px 5px);
}
/* Center band: the actual title, vertically dominant */
.big-divider .divider-center{
  flex:1 1 auto;display:flex;flex-direction:column;
  justify-content:center;align-items:flex-end;text-align:right;
}
.big-divider .icon{
  font-size:3.4rem;margin:0 0 18px;opacity:.85;align-self:flex-end;
  color:var(--gold);
}
.big-divider .kicker{
  font-size:1rem;font-weight:700;letter-spacing:0.22em;
  color:var(--gold);margin-bottom:14px;
}
.big-divider h1{
  font-size:4rem;font-weight:900;color:#fff;
  line-height:1.02;margin:0 0 22px;letter-spacing:-0.02em;text-align:right;
}
.big-divider .rule{
  width:64px;height:3px;background:var(--gold);border-radius:2px;
  margin:0 0 26px auto;
}
.big-divider .lead{
  font-size:1.05rem;color:rgba(255,255,255,.66);
  line-height:1.85;max-width:560px;text-align:right;margin:0 0 0 auto;
}
/* Bottom band: mini table-of-contents for this part */
.big-divider .divider-toc{
  display:grid;grid-template-columns:repeat(3,1fr);gap:12px;
  border-top:1px solid rgba(255,255,255,.08);padding-top:20px;
}
.big-divider .divider-toc .toc-chip{
  border:1px solid rgba(244,180,0,.28);border-radius:12px;
  padding:12px 14px;background:rgba(255,255,255,.025);
  display:flex;flex-direction:column;gap:4px;text-align:right;
}
.big-divider .divider-toc .toc-chip .n{
  font-size:0.7rem;color:var(--gold);font-weight:700;letter-spacing:0.08em;
}
.big-divider .divider-toc .toc-chip .t{
  font-size:0.86rem;color:rgba(255,255,255,.82);font-weight:600;line-height:1.4;
}
.big-divider .page-no{
  position:absolute;bottom:22px;left:50%;transform:translateX(-50%);z-index:2;
}

/* ── Sparse-data context band — fills the lower third of data pages ───── */
.context-band{
  display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:16px;
  flex:1 1 auto;align-items:stretch;
}
.context-band > .card{display:flex;flex-direction:column;}
.context-band .method-list{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:10px;}
.context-band .method-list li{
  position:relative;padding-right:18px;font-size:0.82rem;
  color:rgba(255,255,255,.72);line-height:1.6;
}
.context-band .method-list li::before{
  content:"";position:absolute;right:2px;top:8px;width:6px;height:6px;border-radius:50%;
  background:var(--gold);
}
.context-band .stat-stack{display:grid;gap:12px;margin-top:auto;}
.context-band .stat-stack .stat-pill{
  display:flex;align-items:baseline;justify-content:space-between;
  border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;
  background:rgba(255,255,255,.02);
}
.context-band .stat-stack .stat-pill b{font-size:1.2rem;font-weight:800;}
.context-band .stat-stack .stat-pill span{font-size:0.78rem;color:var(--muted);}
@media(max-width:980px){.context-band{grid-template-columns:1fr;}}

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
.cover-bg-art::after{
  content:"";position:absolute;right:-60%;bottom:-50%;width:120%;height:120%;
  background:radial-gradient(ellipse at center,rgba(244,180,0,.05) 0%,transparent 62%);
  border-radius:50%;
}

/* ── Notice / empty state ─────────────────────────────────────────────── */
.notice-centered{
  display:flex;flex-direction:column;align-items:center;
  justify-content:center;flex:1;text-align:center;
  padding:40px 24px;color:var(--slate);font-size:0.875rem;
}
.notice-centered::before{
  content:"";width:28px;height:28px;border:2px dashed var(--slate);border-radius:50%;
  opacity:.4;display:block;margin:0 auto 12px;
}
.notice-centered.doc-empty::before{display:none;}
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
/* 5 parts, balanced: 3 cards on the top row, 2 wider cards on the bottom row. */
.page.toc-page .toc-grid{display:grid;grid-template-columns:repeat(6,1fr);grid-template-rows:1fr 1fr;gap:14px;height:calc(100% - 150px);}
.page.toc-page .toc-grid .card:nth-child(1){grid-column:1 / 3;}
.page.toc-page .toc-grid .card:nth-child(2){grid-column:3 / 5;}
.page.toc-page .toc-grid .card:nth-child(3){grid-column:5 / 7;}
.page.toc-page .toc-grid .card:nth-child(4){grid-column:1 / 4;grid-row:2;}
.page.toc-page .toc-grid .card:nth-child(5){grid-column:4 / 7;grid-row:2;}
.page.toc-page .toc-grid .card{height:100%;padding:14px 16px;overflow:hidden;display:flex;flex-direction:column;}
.page.toc-page .toc-grid .panel-title{margin-bottom:2px;font-size:17px;}
.page.toc-page .toc-part-blurb{color:var(--gold);font-size:11.5px;font-weight:600;margin-bottom:10px;line-height:1.4;}
.page.toc-page .toc-rows{display:flex;flex-direction:column;gap:7px;overflow:hidden;flex:1;}
.page.toc-page .toc-row{display:flex;align-items:baseline;gap:6px;font-size:12.5px;color:rgba(255,255,255,.86);}
.page.toc-page .toc-row-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:1;}
.page.toc-page .toc-row-leader{flex:1 1 auto;min-width:10px;border-bottom:1px dotted rgba(255,255,255,.24);margin-bottom:3px;}
.page.toc-page .toc-row-num{color:var(--gold);font-weight:700;flex-shrink:0;font-variant-numeric:tabular-nums;}
.page.toc-page .appendix-card{display:flex;flex-direction:column;justify-content:space-between;}
.page.toc-page .appendix-card p{margin:0;line-height:1.8;font-size:14px;}
.page.toc-page .appendix-list{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-top:14px;}
.page.toc-page .appendix-list span{display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px;}
.page.toc-page .appendix-list span::before{content:"";position:absolute;right:0;top:7px;width:5px;height:5px;border-radius:50%;background:var(--gold);}

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
  .big-divider .divider-toc{grid-template-columns:1fr;}
}

/* ── Document renderer (Phase 3) — fixed A4 budget, no runtime scaling ─────── */
/* Eyebrow header (icon + label) above each section title. */
.doc-eyebrow{display:flex;align-items:center;gap:8px;color:var(--gold);
  font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;}
.doc-eyebrow-icon{display:inline-flex;color:var(--gold);}
.doc-eyebrow-icon svg{display:block;}

/* KPI strip — the 5-second headline numbers. */
.doc-kpi-strip{margin-top:14px;}
.doc-kpi{padding:12px 14px;}
.doc-kpi-label{font-size:0.72rem;color:var(--muted);font-weight:600;}
.doc-kpi .metric{font-size:1.7rem;margin:6px 0 2px;}
.doc-kpi-sub{font-size:0.68rem;}
.doc-kpi.green::before{background:var(--green);} .doc-kpi.blue::before{background:var(--blue);}
.doc-kpi.coral::before{background:var(--coral);} .doc-kpi.slate::before{background:var(--slate);}
.doc-kpi.purple::before{background:var(--purple);} .doc-kpi.cyan::before{background:var(--cyan);}

/* Panels with an optional icon title. */
.doc-panel{display:flex;flex-direction:column;min-height:0;}
.doc-panel-title{display:flex;align-items:center;gap:7px;}
.doc-panel-title svg{display:block;}
.doc-panel > .table-wrap{flex:1 1 auto;min-height:0;}

/* Figure box wrapping an SVG chart at a fixed height (no runtime scaling). */
.doc-figure{display:flex;flex-direction:column;align-items:center;gap:6px;}
.doc-figure-svg{width:100%;height:var(--fig-h,200px);display:flex;align-items:center;justify-content:center;}
.doc-figure-svg svg{max-height:100%;width:auto;max-width:100%;}
.doc-figure-cap{font-size:0.7rem;text-align:center;}

/* The fixed 3-line executive close. */
.doc-close{margin-top:14px;display:grid;gap:8px;border-top:1px solid var(--line);padding-top:12px;}
.doc-close-line{display:flex;align-items:flex-start;gap:10px;}
.doc-close-icon{display:inline-flex;flex-shrink:0;margin-top:2px;}
.doc-close-icon svg{display:block;}
.doc-close-line b{display:block;font-size:0.78rem;color:var(--gold);font-weight:700;margin-bottom:1px;}
.doc-close-line span{font-size:0.78rem;color:rgba(255,255,255,.78);line-height:1.5;}

/* Note / caveat box. */
.doc-note{margin-top:12px;}
.doc-note-icon{display:inline-flex;flex-shrink:0;color:var(--gold);}
.doc-note-icon svg{display:block;}

/* Empty-state for unmapped/insufficient data. */
.doc-empty{gap:8px;}
.doc-empty-icon{color:var(--gold);opacity:.7;}
.doc-empty-icon svg{display:block;}
.doc-empty b{font-size:0.95rem;color:#fff;}

/* Bullet list. */
.doc-list{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:8px;}
.doc-list li{position:relative;padding-right:16px;font-size:0.8rem;color:rgba(255,255,255,.78);line-height:1.6;}
.doc-list li::before{content:"";position:absolute;right:2px;top:8px;width:5px;height:5px;border-radius:50%;background:var(--gold);}

/* Correction/regression flow cells. */
.doc-flow{display:grid;gap:10px;margin-top:6px;}
.doc-flow-cell{display:flex;align-items:center;justify-content:space-between;
  border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:rgba(255,255,255,.02);}
.doc-flow-cell .metric{font-size:1.4rem;margin:0;}
.doc-flow-cell.good{border-color:rgba(139,195,74,.35);} .doc-flow-cell.bad{border-color:rgba(255,118,95,.35);}

/* Action / recommendation cards. */
.doc-actions{display:grid;gap:8px;margin-top:4px;}
.doc-action{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;font-size:0.8rem;line-height:1.5;}
.doc-action::before{background:var(--gold);}

/* Legend (glossary outcome chips). */
.doc-legend{display:grid;gap:8px;margin-top:4px;}
.doc-legend-item{display:flex;align-items:flex-start;gap:9px;}
.doc-legend-item b{display:block;font-size:0.8rem;color:#fff;}
.doc-legend-item span{font-size:0.72rem;}
`;

/** Document-viewer-only print rules (A4 portrait, `.sidebar`/`.viewer`/`.content`/`.page`/
 *  `.right-rail`/`.page-inner` — none of these classes exist in the deck editions). Split out of
 *  EXEC_CSS 2026-07-20: EXEC_CSS is shared by the deck too, and an unconditional `@page` here was
 *  fighting deckTheme.ts's own `@page{size:297mm 167mm}`, breaking the deck's printed PDF (wrong
 *  paper size, missing content, white gaps around every slide). Included only by the Document
 *  viewer builders (viewer.ts, reportChrome.ts) that actually use these classes. */
export const EXEC_DOCUMENT_PRINT_CSS = `
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
