import type { ExecutiveRenderContext } from "../context";

const TOC_ENTRIES = [
  { num: "01", label: "مقدمة تنفيذية", id: "page-intro" },
  { num: "02", label: "المعجم ودلالات المستويات", id: "page-glossary" },
  { num: "03", label: "الجزء الأول: مجتمع الحالات", id: "page-p1" },
  { num: "04", label: "الجزء الثاني: العينة", id: "page-p2" },
  { num: "05", label: "الجزء الثالث: التوزيع والتكليف", id: "page-p3" },
  { num: "06", label: "الجزء الرابع: نتائج المراجعة ومؤشرات الدقة", id: "page-p4" },
  { num: "07", label: "الجزء الخامس: الفجوات والملاحظات الجوهرية", id: "page-p5" },
  { num: "08", label: "الجزء السادس: التوصيات والقرارات المطلوبة", id: "page-p6" },
  { num: "09", label: "الملاحق", id: "page-appendix" },
];

export function buildToc(_ctx: ExecutiveRenderContext): string {
  const rows = TOC_ENTRIES.map(e => `
    <a href="#${e.id}" class="xr-toc-row">
      <span class="xr-toc-num">${e.num}</span>
      <span class="xr-toc-label">${e.label}</span>
      <span class="xr-toc-pg">←</span>
    </a>`).join("");
  return `<section class="xr-page" id="page-toc">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>الفهرس</h2><span class="xr-pg">02</span></div>
      <div class="xr-toc-grid">${rows}</div>
    </div>
  </section>`;
}
