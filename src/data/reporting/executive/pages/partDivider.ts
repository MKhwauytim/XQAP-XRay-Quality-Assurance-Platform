import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

type TocChip = { n: string; t: string };

export function buildPartDivider(
  partLabel: string, title: string, subtitle: string, icon: string,
  pageId: string, pageNum: string, railTabs: string[], dataTitle: string,
  dividerNum: string, toc: TocChip[],
): (_ctx: ExecutiveRenderContext) => string {
  const tocHtml = toc.map(c =>
    `<div class="toc-chip"><span class="n">${esc(c.n)}</span><span class="t">${esc(c.t)}</span></div>`
  ).join("");
  return (_ctx) => `<section class="page" id="${pageId}" data-title="${esc(dataTitle)}">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    ${railTabs.map((t, i) => `<div class="rail-tab${i === 0 ? ' active' : ''}">${esc(t)}</div>`).join('')}
  </div>
  <div class="page-inner big-divider" style="--divider-num:'${esc(dividerNum)}'">
    <div class="divider-top">
      <span class="shield" aria-hidden="true"></span>
      <span>هيئة الزكاة والضريبة والجمارك — إدارة ضمان جودة الأشعة اللاحقة</span>
    </div>
    <div class="divider-center">
      <div class="icon">${icon}</div>
      <div class="kicker">${esc(partLabel)}</div>
      <h1>${esc(title)}</h1>
      <div class="rule"></div>
      <p class="lead">${esc(subtitle)}</p>
    </div>
    <div class="divider-toc">${tocHtml}</div>
    <div class="page-no">${esc(pageNum)}</div>
  </div>
</section>`;
}

export const buildPart1Divider = buildPartDivider(
  'الجزء الأول', 'مجتمع الحالات',
  'استعراض حجم المجتمع محل الدراسة وتوزيعه حسب المنفذ والمستوى ونمط الحركة تمهيدًا لتحليل النتائج والفجوات.',
  '◫', 'page-p1', '04', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الأول',
  '1', [
    { n: '05', t: 'مجتمع حالات المخاطر' },
    { n: '06', t: 'المجتمع حسب المستويات' },
    { n: '07', t: 'العينة حسب المستويات' },
  ],
);

export const buildPart2Divider = buildPartDivider(
  'الجزء الثاني', 'نتائج الفحص',
  'تحليل نتائج المراجعة ونسب الدقة والفجوات على مستوى المنفذ والمستوى.',
  '⌕', 'page-p2', '08', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الثاني',
  '2', [
    { n: '09', t: 'نتائج الدقة حسب المنفذ' },
    { n: '10', t: 'نتائج الدقة حسب المستويات' },
    { n: '11', t: 'نتائج جودة الصور' },
  ],
);

export const buildPart3Divider = buildPartDivider(
  'الجزء الثالث', 'التحاليل المتقدمة',
  'تحليلات متقدمة للكشف عن الأنماط الخفية في الأداء، وتحديد الفجوات التشغيلية وفرص التحسين.',
  '◈', 'page-p3', '13', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف التحاليل المتقدمة',
  '3', [
    { n: '15', t: 'النظرة العامة لأداء الموظفين' },
    { n: '17', t: 'أداء الموظفين حسب المنفذ' },
    { n: '23', t: 'الأولوية والإجراءات' },
  ],
);

// Alias stubs kept for index.ts compatibility
export const buildPart4Divider = buildPart3Divider;
export const buildPart5Divider = buildPart3Divider;
export const buildPart6Divider = buildPart3Divider;
