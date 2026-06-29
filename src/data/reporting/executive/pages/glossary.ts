import type { ExecutiveRenderContext } from "../context";

export function buildGlossary(_ctx: ExecutiveRenderContext): string {
  return `<section class="page" id="page-glossary" data-title="المعجم والمستويات">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">المعجم</div>
    <div class="rail-tab">المستويات</div>
    <div class="rail-tab">المصطلحات</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">المعجم ودلالات المستويات</h2>
    <div class="section-subtitle">تعريف المستويات والمصطلحات الرئيسية</div>
    <div class="grid grid-4">
      <div class="card level-card stage1">
        <h3>المستوى الأول</h3>
        <p>حالات تتضمن محجرات مخاطر ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.</p>
      </div>
      <div class="card level-card stage2">
        <h3>المستوى الثاني</h3>
        <p>حالات لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من فريق أمني آخر.</p>
      </div>
      <div class="card level-card stage3">
        <h3>المستوى الثالث</h3>
        <p>حالات تم الاشتباه بها في الأشعة دون مؤشرات من الفرق الأمنية الأخرى.</p>
      </div>
      <div class="card level-card stage4">
        <h3>المستوى الرابع</h3>
        <p>حالات ضبط أمني أو اجتازت الأشعة دون اكتشاف الاشتباه من المسؤولين.</p>
      </div>
    </div>
    <div class="grid grid-4" style="margin-top:18px">
      <div class="card"><h3 style="color:var(--green)">سليمة</h3><p class="muted">حالة لا توجد بها مؤشرات اشتباه بعد المراجعة.</p></div>
      <div class="card"><h3 style="color:var(--coral)">اشتباه</h3><p class="muted">مؤشر أو نمط يستلزم مراجعة إضافية.</p></div>
      <div class="card"><h3 style="color:var(--blue)">مجتمع الحالات</h3><p class="muted">جميع الحالات المشمولة بالتحليل.</p></div>
      <div class="card"><h3 style="color:var(--cyan)">العينة</h3><p class="muted">الجزء المختار للمراجعة والتحليل.</p></div>
      <div class="card"><h3 style="color:var(--purple)">التوزيع</h3><p class="muted">إسناد الحالات إلى الموظفين.</p></div>
      <div class="card"><h3 style="color:var(--cyan)">نظام صور الأشعة المركزية</h3><p class="muted">نظام أو مصدر داعم للمراجعة اللاحقة.</p></div>
      <div class="card"><h3 style="color:var(--gold)">مطابقة BI</h3><p class="muted">مطابقة بيانات الإرساليات بين الأنظمة.</p></div>
      <div class="card"><h3 style="color:var(--blue)">نتيجة المراجعة</h3><p class="muted">المرجع المستخدم لاحتساب مؤشرات الدقة.</p></div>
    </div>
    <div class="page-no">03</div>
  </div>
</section>`;
}
