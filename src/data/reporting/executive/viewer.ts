import { EXEC_CSS } from "./theme";
import { esc } from "./primitives";
import { icon } from "./ui/icons";

// Viewer JS: builds the sidebar TOC and highlights the active page via an
// IntersectionObserver. The legacy `fitPages()` transform:scale() auto-shrink hack
// has been REMOVED (design §4.1): pages are composed to a fixed A4 content budget
// and long tables paginate explicitly (see document/pagination.ts), so nothing is
// ever scaled down at runtime.
const VIEWER_JS = `(function(){
  var pages=[].slice.call(document.querySelectorAll('.page'));
  var toc=document.getElementById('toc');
  if(!toc) return;
  pages.forEach(function(p,i){
    var a=document.createElement('a');
    a.href='#'+p.id;
    var num=String(i+1).padStart(2,'0');
    a.innerHTML='<span>'+p.dataset.title+'</span><b>'+num+'</b>';
    toc.appendChild(a);
  });
  var links=[].slice.call(toc.querySelectorAll('a'));
  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        links.forEach(function(a){
          a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id);
        });
      }
    });
  },{rootMargin:'-35% 0px -55% 0px',threshold:0});
  pages.forEach(function(p){obs.observe(p);});
})();`;

export function buildViewerHtml(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — ${esc(monthLabel)}</title>
<style>${EXEC_CSS}</style>
</head>
<body>
<div class="viewer">
  <aside class="sidebar">
    <div class="brand-small">
      <div class="brand-mark">${icon("shield", 24)}</div>
      <div>
        <strong>التقرير التنفيذي</strong>
        <span>ضمان جودة الأشعة — ${esc(monthLabel)}</span>
      </div>
    </div>
    <div class="toolbar">
      <button class="btn" onclick="window.print()">طباعة / PDF</button>
    </div>
    <div class="nav-title">الصفحات</div>
    <nav class="toc" id="toc"></nav>
  </aside>
  <main class="content">
${slides}
  </main>
</div>
<script>${VIEWER_JS}</script>
</body>
</html>`;
}
