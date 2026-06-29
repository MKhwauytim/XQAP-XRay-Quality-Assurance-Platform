import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

export function buildPartDivider(
  partLabel: string, title: string, subtitle: string, icon: string,
  pageId: string, pageNum: string, railTabs: string[], dataTitle: string,
): (_ctx: ExecutiveRenderContext) => string {
  return (_ctx) => `<section class="page" id="${pageId}" data-title="${esc(dataTitle)}">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    ${railTabs.map((t, i) => `<div class="rail-tab${i === 0 ? ' active' : ''}">${esc(t)}</div>`).join('')}
  </div>
  <div class="page-inner big-divider">
    <div>
      <div class="icon">${icon}</div>
      <div class="kicker">${esc(partLabel)}</div>
      <h1>${esc(title)}</h1>
      <div class="rule"></div>
      <p class="lead">${esc(subtitle)}</p>
    </div>
    <div class="page-no">${esc(pageNum)}</div>
  </div>
</section>`;
}

export const buildPart1Divider = buildPartDivider(
  'الجزء الأول', 'مجتمع الحالات',
  'استعراض حجم المجتمع محل الدراسة وتوزيعه حسب المنفذ والمستوى ونمط الحركة تمهيدًا لتحليل النتائج والفجوات.',
  '◫', 'page-p1', '04', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الأول',
);

export const buildPart2Divider = buildPartDivider(
  'الجزء الثاني', 'نتائج الفحص',
  'تحليل نتائج المراجعة ونسب الدقة والفجوات على مستوى المنفذ والمستوى.',
  '⌕', 'page-p2', '08', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الثاني',
);

export const buildPart3Divider = buildPartDivider(
  'الجزء الثالث', 'التحاليل المتقدمة',
  'تحليلات متقدمة للكشف عن الأنماط الخفية في الأداء، وتحديد الفجوات التشغيلية وفرص التحسين.',
  '◈', 'page-p3', '12', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف التحاليل المتقدمة',
);

// Alias stubs kept for index.ts compatibility
export const buildPart4Divider = buildPart3Divider;
export const buildPart5Divider = buildPart3Divider;
export const buildPart6Divider = buildPart3Divider;
