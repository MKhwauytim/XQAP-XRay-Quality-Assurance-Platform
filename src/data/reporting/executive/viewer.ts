import { EXEC_CSS } from "./theme";
import { esc } from "./primitives";

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

  function fitPages(){
    [].slice.call(document.querySelectorAll('.page-inner')).forEach(function(inner){
      inner.style.transform='';
      var page=inner.parentElement;
      if(!page) return;
      var avail=page.clientHeight-2;
      var needed=inner.scrollHeight;
      if(needed>avail){
        var scale=Math.max(0.82,avail/needed);
        inner.style.transform='scale('+scale+')';
        inner.style.transformOrigin='top right';
        inner.style.height=(100/scale)+'%';
      }
    });
  }
  window.addEventListener('load',fitPages);
  window.addEventListener('resize',fitPages);
  setTimeout(fitPages,300);
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
      <div class="brand-mark">⌁</div>
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
