import type { ExecutiveRenderContext } from "../context";

export function buildAnalyticsMap(_ctx: ExecutiveRenderContext): string {
  return `<section class="page" id="page-analytics-map" data-title="خريطة التحليلات المتقدمة">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">الخريطة</div>
    <div class="rail-tab">الموظفون</div>
    <div class="rail-tab">العوامل</div>
    <div class="rail-tab">القرارات</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">خريطة التحليلات المتقدمة</h2>
    <div class="section-subtitle">الصفحات الموصى بها ضمن الجزء الثالث</div>
    <div class="grid grid-2">
      <div class="card">
        <div class="panel-title">أداء الموظفين</div>
        <p>15 — النظرة العامة لأداء الموظفين</p>
        <p>16 — دقة الموظفين حسب نوع القرار</p>
        <p>17 — أداء الموظفين حسب المنفذ</p>
        <p>18 — مقارنة الموظفين بين المنافذ</p>
      </div>
      <div class="card">
        <div class="panel-title">تحليل العوامل المؤثرة</div>
        <p>19 — استقرار الأداء وعبء العمل</p>
        <p>20 — أثر جودة الصورة والتحديد على الأداء</p>
      </div>
      <div class="card">
        <div class="panel-title">تحليل الأخطاء والأنماط</div>
        <p>21 — تحليل أنواع الأخطاء</p>
        <p>22 — مقارنة المستوى الأول والثاني والتوافق</p>
      </div>
      <div class="card">
        <div class="panel-title">القرارات والتوصيات</div>
        <p>23 — الموظفون ذوو الأولوية والإجراءات المقترحة</p>
        <p>24 — الملاحق والمنهجية</p>
      </div>
    </div>
    <div class="info" style="margin-top:18px">يمكن إبقاء الصفحات ذات الأولوية في النسخة التنفيذية، ونقل الصفحات التفصيلية والمتكررة إلى الملاحق.</div>
    <div class="page-no">14</div>
  </div>
</section>`;
}
