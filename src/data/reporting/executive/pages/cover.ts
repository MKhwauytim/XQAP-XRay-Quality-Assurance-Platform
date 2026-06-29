import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

const ZATCA_LOGO = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="8" width="48" height="48" rx="6" fill="#f4b400" opacity="0.15"/>
  <rect x="8" y="8" width="48" height="48" rx="6" stroke="#f4b400" stroke-width="1.5" fill="none"/>
  <polygon points="32,12 52,32 32,52 12,32" fill="none" stroke="#f4b400" stroke-width="1.5"/>
  <line x1="18" y1="28" x2="46" y2="28" stroke="#f4b400" stroke-width="1.2" opacity="0.7"/>
  <line x1="18" y1="32" x2="46" y2="32" stroke="#f4b400" stroke-width="1.2" opacity="0.7"/>
  <line x1="18" y1="36" x2="46" y2="36" stroke="#f4b400" stroke-width="1.2" opacity="0.7"/>
  <text x="32" y="35" text-anchor="middle" font-family="Somar,Arial" font-size="14" font-weight="700" fill="#f4b400">ز</text>
</svg>`;

export function buildCover(ctx: ExecutiveRenderContext): string {
  return `<section class="page cover" id="page-cover" data-title="الغلاف">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الغلاف</div>
    <div class="rail-tab">الفهرس</div>
    <div class="rail-tab">الأجزاء</div>
  </div>
  <div class="page-inner">
    <div class="org">
      ${ZATCA_LOGO}
      <div class="org-lines">هيئة الزكاة والضريبة والجمارك<br>قطاع الشؤون القانونية<br>الإدارة العامة لضمان الجودة والامتثال<br>إدارة ضمان جودة الأشعة اللاحقة</div>
    </div>
    <div class="title-block">
      <div class="kicker">نسخة تنفيذية</div>
      <h1>التقرير التنفيذي لضمان جودة الأشعة</h1>
      <div class="subtitle">تحليل مجتمع الحالات والعينة والتوزيع ومؤشرات الجودة</div>
      <div class="rule"></div>
      <p class="lead">فترة التقرير: ${esc(ctx.issueDate)}<br>مجتمع الحالات محل الدراسة: ${esc(ctx.monthLabel)}</p>
      <div class="level-strip">
        <div style="--accent:var(--gold)">المستوى الأول</div>
        <div style="--accent:var(--blue)">المستوى الثاني</div>
        <div style="--accent:var(--slate)">المستوى الثالث</div>
        <div style="--accent:var(--coral)">المستوى الرابع</div>
      </div>
      <div class="badges"><span class="badge">تقرير داخلي</span><span class="badge">نسخة تنفيذية</span></div>
    </div>
    <div class="page-no">01</div>
  </div>
</section>`;
}
