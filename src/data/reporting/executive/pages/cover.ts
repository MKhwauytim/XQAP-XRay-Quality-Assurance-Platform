import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

const ZATCA_LOGO = `<svg class="zatca-logo" width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Shield base -->
  <path d="M28 4 L50 14 L50 32 C50 44 28 52 28 52 C28 52 6 44 6 32 L6 14 Z" fill="rgba(244,180,0,0.12)" stroke="#f4b400" stroke-width="1.5"/>
  <!-- Inner decoration -->
  <path d="M28 10 L44 18 L44 32 C44 40 28 47 28 47 C28 47 12 40 12 32 L12 18 Z" fill="none" stroke="rgba(244,180,0,0.3)" stroke-width="1"/>
  <!-- Horizontal stripes -->
  <line x1="16" y1="26" x2="40" y2="26" stroke="rgba(244,180,0,0.5)" stroke-width="1.2"/>
  <line x1="16" y1="30" x2="40" y2="30" stroke="rgba(244,180,0,0.5)" stroke-width="1.2"/>
  <line x1="16" y1="34" x2="40" y2="34" stroke="rgba(244,180,0,0.5)" stroke-width="1.2"/>
  <!-- Center emblem -->
  <text x="28" y="22" text-anchor="middle" font-family="Somar,Arial" font-size="11" font-weight="700" fill="#f4b400">زكاة</text>
</svg>`;

export function buildCover(ctx: ExecutiveRenderContext): string {
  return `<section class="page cover" id="page-cover" data-title="الغلاف">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الغلاف</div>
    <div class="rail-tab">الفهرس</div>
    <div class="rail-tab">الأجزاء</div>
  </div>
  <div class="cover-bg-art" aria-hidden="true"></div>
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
