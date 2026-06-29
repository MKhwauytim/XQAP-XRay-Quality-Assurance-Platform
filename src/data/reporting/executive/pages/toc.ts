import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

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

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header">
    <div class="xr-org-text">${lines}</div>
    <div class="xr-org-logo">🛡</div>
  </div>`;
}

export function buildToc(_ctx: ExecutiveRenderContext): string {
  const rows = TOC_ENTRIES.map(e => `
    <a href="#${e.id}" class="xr-toc-row">
      <span class="xr-toc-num">${e.num}</span>
      <span class="xr-toc-label">${esc(e.label)}</span>
      <span class="xr-toc-pg">←</span>
    </a>`).join("");
  return `<section class="xr-page" id="page-toc">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">الفهرس</h2>
      <div class="xr-toc-grid">${rows}</div>
      <div class="xr-page-num">• 02 •</div>
    </div>
  </section>`;
}
