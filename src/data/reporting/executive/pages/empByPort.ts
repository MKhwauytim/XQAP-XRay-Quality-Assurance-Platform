import type { ExecutiveRenderContext } from "../context";

export function buildEmpByPort(_ctx: ExecutiveRenderContext): string {
  return `<section class="page compact" id="page-emp-port" data-title="أداء الموظفين حسب المنفذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">أداء الموظفين</div>
    <div class="rail-tab active">حسب المنفذ</div>
    <div class="rail-tab">المقارنة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أداء الموظفين حسب المنفذ</h2>
    <div class="section-subtitle">مقارنة أداء الموظفين عبر المنافذ المختلفة</div>
    <div class="card info" style="margin-top:24px">البيانات غير متاحة لهذه الدورة. سيُعرض التحليل عند توفر البيانات الكاملة.</div>
    <div class="page-no">16</div>
  </div>
</section>`;
}
