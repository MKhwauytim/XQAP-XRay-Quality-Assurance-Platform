import type { ExecutiveRenderContext } from "../context";

export function buildToc(_ctx: ExecutiveRenderContext): string {
  return `<section class="page toc-page" id="page-toc" data-title="الفهرس">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الفهرس</div>
    <div class="rail-tab">الجزء الأول</div>
    <div class="rail-tab">الجزء الثاني</div>
    <div class="rail-tab">الجزء الثالث</div>
  </div>
  <div class="page-inner">
    <div class="toc-header">
      <div class="toc-title">
        <div class="small-note">التقرير التنفيذي لضمان جودة الأشعة<br>تحليل مجتمع الحالات والنتائج والتحاليل المتقدمة</div>
        <h2 class="section-title">الفهرس</h2>
        <div class="section-subtitle">هيكل التقرير التنفيذي</div>
      </div>
      <div class="org">
        <div class="shield"></div>
        <div class="org-lines">التقرير التنفيذي لضمان جودة الأشعة<br><span class="muted">تحليل مجتمع الحالات والنتائج والتحاليل المتقدمة</span></div>
      </div>
    </div>

    <div class="toc-grid">
      <div class="card">
        <div class="panel-title">المقدمة والمنهجية</div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr><td>المعجم ودلالات المستويات</td><td>03</td></tr>
              <tr><td>الجزء الأول: مجتمع الحالات</td><td>04</td></tr>
              <tr><td>مجتمع حالات المخاطر</td><td>05</td></tr>
              <tr><td>المستويات والمنافذ</td><td>06</td></tr>
              <tr><td>العينة</td><td>07</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="panel-title">النتائج والتحليلات</div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr><td>الجزء الثاني: نتائج الفحص</td><td>08</td></tr>
              <tr><td>نتائج الدقة حسب المنفذ</td><td>09</td></tr>
              <tr><td>نتائج الدقة حسب المستويات</td><td>10</td></tr>
              <tr><td>نتائج جودة الصور</td><td>11</td></tr>
              <tr><td>الأصناف المشبوهة</td><td>12</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card appendix-card">
        <div>
          <div class="panel-title">الملاحق</div>
          <p>تفاصيل المنافذ، القواعد الحسابية، جودة البيانات، معجم التصنيفات، والجداول التشغيلية التفصيلية.</p>
        </div>
        <div class="appendix-list">
          <span>تفاصيل المنافذ</span>
          <span>القواعد الحسابية</span>
          <span>جودة البيانات</span>
          <span>معجم التصنيفات</span>
          <span>الجداول التشغيلية</span>
          <span>التفاصيل الداعمة</span>
        </div>
      </div>

      <div class="card">
        <div class="panel-title">التحليلات المتقدمة</div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr><td>غلاف الجزء الثالث</td><td>13</td></tr>
              <tr><td>خريطة التحليلات المتقدمة</td><td>14</td></tr>
              <tr><td>أداء الموظفين (متغير حسب المنافذ)</td><td>15+</td></tr>
              <tr><td>تحليل الأخطاء والتوافق</td><td>—</td></tr>
              <tr><td>الأولوية والإجراءات</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="page-no">02</div>
  </div>
</section>`;
}
