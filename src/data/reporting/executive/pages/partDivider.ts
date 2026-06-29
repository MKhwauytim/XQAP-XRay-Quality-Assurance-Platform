import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

export function buildPartDivider(
  partNum: string, title: string, sub: string, icon: string, pageId: string, pageNum: string,
): (_ctx: ExecutiveRenderContext) => string {
  return (_ctx) => `<section class="xr-page xr-divider" id="${pageId}">
    <div class="xr-divider-inner">
      <div class="xr-divider-icon">${icon}</div>
      <div class="xr-divider-eyebrow">${esc(partNum)}</div>
      <div class="xr-divider-title">${esc(title)}</div>
      <div class="xr-divider-sub">${esc(sub)}</div>
    </div>
    <div class="xr-footer"><span></span><span>${pageNum}</span></div>
  </section>`;
}

export const buildPart1Divider = buildPartDivider(
  "الجزء الأول", "مجتمع الحالات",
  "يستعرض هذا الجزء حجم المجتمع محل الدراسة وتوزيعه حسب نوع المنفذ والمستوى ونمط الحركة.",
  "📦", "page-p1", "07"
);
export const buildPart2Divider = buildPartDivider(
  "الجزء الثاني", "العينة",
  "يستعرض هذا الجزء حجم العينة المسحوبة وتوزيعها على المنافذ والمستويات وبيانات CertScan.",
  "🎯", "page-p2", "11"
);
export const buildPart3Divider = buildPartDivider(
  "الجزء الثالث", "التوزيع والتكليف",
  "يستعرض هذا الجزء توزيع حالات العينة على الموظفين وأعباء العمل وحالة الإنجاز.",
  "📋", "page-p3", "15"
);
export const buildPart4Divider = buildPartDivider(
  "الجزء الرابع", "نتائج المراجعة ومؤشرات الدقة",
  "يستعرض هذا الجزء نتائج مراجعة الدقة على مستوى المنافذ والمستويات ومقارنة الخبراء.",
  "📊", "page-p4", "19"
);
export const buildPart5Divider = buildPartDivider(
  "الجزء الخامس", "الفجوات والملاحظات الجوهرية",
  "يستعرض هذا الجزء أداء الموظفين وتحليل أثر جودة الصورة والتحديد على نتائج الدقة.",
  "🔍", "page-p5", "23"
);
export const buildPart6Divider = buildPartDivider(
  "الجزء السادس", "التوصيات والقرارات المطلوبة",
  "يستعرض هذا الجزء الموظفين ذوي الأولوية والإجراءات التصحيحية المقترحة.",
  "🎖", "page-p6", "29"
);
