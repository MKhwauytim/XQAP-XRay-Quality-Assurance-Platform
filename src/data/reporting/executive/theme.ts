// Design tokens and CSS for the dark-navy executive report viewer.
// Visual identity from HTML mockup v4 — right-rail sidebar layout, portrait pages.
// v22.0: adopted full HTML mockup CSS with overflow/chart/print fixes.

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
.sidebar{
  position:sticky;top:0;height:100vh;overflow:auto;
  background:rgba(2,20,37,.96);
  border-left:1px solid var(--line);
  padding:22px 18px;
  z-index:20;
}
.brand-small{
  display:flex;gap:12px;align-items:center;
  padding-bottom:18px;border-bottom:1px solid var(--line);
}
.brand-mark{
  width:48px;height:48px;border:1px solid var(--gold);border-radius:14px;
  display:grid;place-items:center;color:var(--gold);font-size:24px;
  background:linear-gradient(145deg,rgba(255,255,255,.04),rgba(255,255,255,.01));
}
.brand-small strong{display:block;font-size:16px}
.brand-small span{display:block;color:var(--muted);font-size:12px;margin-top:3px}
.toolbar{display:grid;grid-template-columns:1fr;gap:8px;margin:16px 0}
.btn{
  border:1px solid var(--line);background:var(--panel);color:var(--white);
  padding:8px 10px;border-radius:10px;cursor:pointer;
}
.btn:hover{border-color:var(--gold);color:var(--gold)}
.nav-title{font-size:13px;color:var(--gold);margin:18px 0 8px}
.toc{display:grid;gap:6px}
.toc a{
  color:#dbe7f3;text-decoration:none;padding:8px 10px;border-radius:10px;
  border:1px solid transparent;font-size:12px;display:flex;justify-content:space-between;
}
.toc a:hover,.toc a.active{border-color:rgba(244,180,0,.5);background:rgba(244,180,0,.08);color:var(--gold)}
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
.page-inner{position:relative;z-index:2;height:100%;width:calc(100% - 44px);margin-right:44px;padding:30px 28px 36px 28px;overflow:hidden}
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
.org{
  display:flex;align-items:center;gap:14px;font-size:11px;color:#e7eef6;
  width:max-content;max-width:58%;
}
.org .shield{
  width:58px;height:64px;clip-path:polygon(50% 0,95% 18%,85% 72%,50% 100%,15% 72%,5% 18%);
  background:repeating-linear-gradient(135deg,#dbe7f3 0 3px,transparent 3px 7px);
  opacity:.8;flex-shrink:0;
}
.org-lines{border-right:3px solid var(--gold);padding-right:12px;line-height:1.7}
.page-no{
  position:absolute;bottom:18px;left:50%;transform:translateX(-50%);
  font-size:18px;color:#fff;
}
.page-no::before,.page-no::after{content:"";display:inline-block;width:44px;height:1px;background:linear-gradient(90deg,transparent,var(--gold));vertical-align:middle;margin:0 12px}
.page-no::after{background:linear-gradient(90deg,var(--gold),transparent)}
.title-block{margin-top:46px;text-align:center}
.kicker{color:var(--gold);font-weight:800;font-size:28px;margin-bottom:4px}
h1{font-size:42px;line-height:1.18;margin:6px 0 10px}
.subtitle{font-size:18px;color:var(--gold);font-weight:700}
.rule{height:2px;width:180px;background:linear-gradient(90deg,transparent,var(--gold),transparent);margin:18px auto}
.lead{max-width:760px;margin:22px auto 0;line-height:1.7;color:#dce7f2;font-size:14px}
.badges{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:28px}
.badge{border:1px solid rgba(244,180,0,.65);padding:8px 18px;border-radius:999px;color:var(--gold);background:rgba(244,180,0,.05)}
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:1fr 1fr}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-5{grid-template-columns:repeat(5,1fr)}
.card{
  background:linear-gradient(180deg,rgba(14,58,95,.82),rgba(7,39,67,.92));
  border:1px solid rgba(255,255,255,.14);
  border-radius:16px;padding:12px;box-shadow:0 10px 20px rgba(0,0,0,.14);
}
.card h3{margin:0 0 6px;font-size:15px}
.metric{font-size:34px;font-weight:800;line-height:1;margin:10px 0 4px}
.metric.gold{color:var(--gold)} .metric.blue{color:var(--blue)}
.metric.green{color:var(--green)} .metric.coral{color:var(--coral)}
.metric.slate{color:var(--slate)} .metric.purple{color:var(--purple)}
.metric.cyan{color:var(--cyan)}
.muted{color:var(--muted)}
.section-title{font-size:28px;margin:18px 0 4px}
.section-subtitle{color:var(--gold);font-size:15px;margin-bottom:12px}
.panel-title{color:var(--gold);font-size:17px;font-weight:800;margin-bottom:8px}
.info{
  border:1px solid rgba(107,169,248,.45);
  background:rgba(107,169,248,.06);
  border-radius:14px;padding:8px 10px;color:#dbe8f4;line-height:1.55;font-size:13px;
}
.table-wrap{overflow:hidden;width:100%;border:1px solid rgba(255,255,255,.12);border-radius:16px}
table{table-layout:fixed;width:100%;border-collapse:collapse;background:rgba(4,31,54,.72)}
td,th{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 10px}
th,td{padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.1);border-left:1px solid rgba(255,255,255,.08);text-align:center;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th{background:rgba(15,61,99,.92);color:#fff;font-weight:800}
td:first-child,th:first-child{text-align:right}
tr:last-child td{border-bottom:0}
.total-row td{background:rgba(244,180,0,.12);font-weight:800}
.chip{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;border:1px solid}
.chip.green{color:var(--green);border-color:var(--green)}
.chip.blue{color:var(--blue);border-color:var(--blue)}
.chip.orange{color:var(--gold);border-color:var(--gold)}
.chip.red{color:var(--coral);border-color:var(--coral)}
.bar{height:8px;border-radius:999px;background:rgba(255,255,255,.09);overflow:hidden}
.bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--green));border-radius:inherit}
.level-card{min-height:130px;position:relative;overflow:hidden}
.level-card::after{content:"";position:absolute;left:0;right:0;bottom:0;height:7px;background:var(--accent,var(--gold))}
.level-card h3{color:var(--accent,var(--gold));font-size:24px}
.stage1{--accent:var(--gold)} .stage2{--accent:var(--blue)} .stage3{--accent:var(--slate)} .stage4{--accent:var(--coral)}
.port-split{display:grid;grid-template-columns:1.05fr .95fr;gap:12px}
.land{border-color:rgba(139,195,74,.45)} .sea{border-color:rgba(107,169,248,.45)}
.land .panel-title{color:var(--green)} .sea .panel-title{color:var(--blue)}
.big-divider{display:grid;place-items:center;height:100%;text-align:center;padding-top:80px}
.big-divider h1{font-size:56px}
.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:20px}
.feature{
  border:1px solid rgba(244,180,0,.5);border-radius:16px;padding:12px;
  background:rgba(255,255,255,.025);font-size:14px;font-weight:700;text-align:center;
}
.icon{font-size:30px;margin-bottom:8px;color:var(--gold)}
.heatmap{display:grid;grid-template-columns:160px repeat(6,1fr);gap:2px;background:rgba(255,255,255,.08);padding:2px;border-radius:12px;overflow:hidden}
.heatmap div{padding:10px 7px;background:#0b3150;text-align:center;font-size:12px}
.heatmap .hdr{background:#123f65;font-weight:800}
.hm1{background:#204c69!important}.hm2{background:#336a73!important}.hm3{background:#70824d!important}.hm4{background:#a56c37!important}.hm5{background:#9b4d45!important}
.quad{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;border:1px solid rgba(255,255,255,.14);border-radius:16px;overflow:hidden}
.quad > div{padding:16px;border:1px solid rgba(255,255,255,.08);min-height:110px}
.quad h4{margin:0 0 8px}
.cover .page-inner{padding-left:28px}
.cover .title-block{margin-top:72px}
.cover h1{font-size:56px}
.cover .org{max-width:70%}
.cover .level-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:32px auto 0;max-width:720px}
.cover .level-strip div{padding:12px;border:1px solid rgba(255,255,255,.18);border-bottom:5px solid var(--accent);border-radius:12px;background:rgba(255,255,255,.03)}
.small-note{font-size:12px;color:var(--muted)}
.page.light{
  background:#f2f5f8;color:#0a2d4a;
}
.page.light::before{background:repeating-linear-gradient(0deg,transparent 0 34px,rgba(10,45,74,.03) 35px)}
.page.light .card{background:white;color:#0a2d4a;border-color:#dfe6ed}
.page.light .muted{color:#607386}
.page.light .table-wrap{border-color:#d8e0e8}
.page.light table{background:white;color:#0a2d4a}
.page.light th{background:#0e3a5f;color:white}
.page.light td{border-color:#e3e8ee}
.page.light .info{color:#163953}
@media(max-width:980px){
  .viewer{grid-template-columns:1fr}
  .sidebar{position:relative;height:auto}
  .content{padding:14px 4px 40px}
  .page{aspect-ratio:auto;min-height:1050px}
  .page-inner{width:calc(100% - 38px);margin-right:38px;padding:28px 22px 44px 20px}
  .right-rail{width:38px}
  .rail-tab,.rail-main{font-size:10px}
  .grid-4,.grid-5,.feature-grid{grid-template-columns:repeat(2,1fr)}
  .grid-3{grid-template-columns:1fr 1fr}
  .port-split,.grid-2{grid-template-columns:1fr}
  h1,.cover h1{font-size:42px}
}

.page-inner{overflow:hidden}
.page.compact .page-inner{padding:24px 26px 30px 26px}
.page.compact h2.section-title{font-size:24px}
.page.compact .section-subtitle{font-size:14px;margin-bottom:10px}
.page.compact .card{padding:10px}
.page.compact th,.page.compact td{padding:7px 5px;font-size:10.5px}
.page.compact .metric{font-size:30px}
.page.compact .grid{gap:10px}

/* ===== V4 layout refinements ===== */
.page *{max-width:100%}
.page-inner > *{max-width:100%}
.page.toc-page::after{
  width:220px;height:160px;left:24px;top:20px;opacity:.65;
}
.page.toc-page .page-inner{
  padding:20px 24px 30px 24px !important;
}
.page.toc-page .org{
  max-width:100%;
  width:100%;
  justify-content:flex-start;
  margin-bottom:8px;
}
.page.toc-page .toc-header{
  display:grid;
  grid-template-columns:1fr 260px;
  gap:12px;
  align-items:start;
  margin-bottom:10px;
}
.page.toc-page .toc-title{
  text-align:right;
  padding-top:2px;
}
.page.toc-page .toc-title h2{
  margin:0;
  font-size:34px;
  line-height:1.12;
}
.page.toc-page .toc-title .section-subtitle{
  margin:6px 0 0;
  font-size:15px;
}
.page.toc-page .toc-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  grid-template-rows:230px 230px;
  gap:14px;
  height:calc(100% - 150px);
}
.page.toc-page .toc-grid .card{
  height:100%;
  padding:14px 16px;
  overflow:hidden;
}
.page.toc-page .toc-grid .panel-title{
  margin-bottom:10px;
  font-size:17px;
}
.page.toc-page .toc-grid table{
  min-width:0;
  width:100%;
  table-layout:auto;
}
.page.toc-page .toc-grid th,
.page.toc-page .toc-grid td{
  padding:8px 10px;
  font-size:12px;
}
.page.toc-page .appendix-card{
  display:flex;
  flex-direction:column;
  justify-content:space-between;
}
.page.toc-page .appendix-card p{
  margin:0;
  line-height:1.8;
  font-size:14px;
}
.page.toc-page .appendix-list{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:6px 18px;
  margin-top:14px;
}
.page.toc-page .appendix-list span{
  display:block;
  color:#dce7f2;
  font-size:13px;
  position:relative;
  padding-right:14px;
}
.page.toc-page .appendix-list span::before{
  content:"•";
  position:absolute;
  right:0;
  color:var(--gold);
}
@media(max-width:980px){
  .page.toc-page .toc-header{grid-template-columns:1fr}
  .page.toc-page .toc-grid{
    grid-template-columns:1fr;
    grid-template-rows:auto;
    height:auto;
  }
}
.chart-container{width:100%;min-height:220px;display:flex;align-items:center;justify-content:center;}
.bubble-chart{width:100%;aspect-ratio:1.4/1;min-height:200px;}
.grid-auto{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;}
.notice-centered{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;text-align:center;padding:40px;color:var(--slate);font-size:0.9rem;}
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
