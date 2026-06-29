import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

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
      <div class="shield"></div>
      <div class="org-lines">هيئة الزكاة والضريبة والجمارك<br>قطاع الشؤون القانونية<br>الإدارة العامة لضمان الجودة والامتثال<br>إدارة ضمان جودة الأشعة اللاحقة</div>
    </div>
    <div class="title-block">
      <div class="kicker">نسخة تنفيذية</div>
      <h1>التقرير التنفيذي لضمان جودة الأشعة</h1>
      <div class="subtitle">تحليل مجتمع الحالات والعينة والتوزيع ومؤشرات الجودة</div>
      <div class="rule"></div>
      <p class="lead">دورة التقرير: ${esc(ctx.issueDate)}<br>مجتمع الحالات محل الدراسة: ${esc(ctx.monthLabel)}</p>
      <div class="level-strip">
        <div style="--accent:var(--gold)">المستوى الأول</div>
        <div style="--accent:var(--blue)">المستوى الثاني</div>
        <div style="--accent:var(--slate)">المستوى الثالث</div>
        <div style="--accent:var(--coral)">المستوى الرابع</div>
      </div>
      <div class="badges"><span class="badge">سري داخليًا</span><span class="badge">نسخة تنفيذية</span></div>
    </div>
    <div class="page-no">01</div>
  </div>
</section>`;
}
