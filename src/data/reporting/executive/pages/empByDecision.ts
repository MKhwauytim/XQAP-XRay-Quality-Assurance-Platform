import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

export function buildEmpByDecision(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const reliable = profiles.filter(p => p.reliable);

  if (reliable.length === 0) {
    return `<section class="page compact" id="page-emp-decision" data-title="دقة الموظفين حسب القرار">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">نوع القرار</div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab">تحليل الأخطاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">دقة الموظفين حسب نوع القرار</h2>
    <div class="section-subtitle">الفصل بين الدقة الكلية واكتشاف الاشتباه والإنذارات الخاطئة</div>
    <div class="card info" style="margin-top:24px">البيانات غير متاحة لهذه الدورة. سيُعرض التحليل عند توفر البيانات الكاملة.</div>
    <div class="page-no">14</div>
  </div>
</section>`;
  }

  const avgAcc  = reliable.reduce((s, p) => s + (p.overallAccuracy ?? 0), 0) / reliable.length;
  const avgDet  = reliable.reduce((s, p) => s + (p.suspiciousDetectionRate ?? 0), 0) / reliable.length;
  const avgMiss = reliable.reduce((s, p) => s + (p.missedSuspicionRate ?? 0), 0) / reliable.length;
  const avgExc  = reliable.reduce((s, p) => s + (p.excessSuspicionRate ?? 0), 0) / reliable.length;

  const tableRows = reliable.slice(0, 6).map(p => `<tr>
    <td>${esc(ctx.displayName(p.username))}</td>
    <td>${fmtNum(p.byDecision?.onClean != null ? Math.round(p.studied * (1 - (p.suspiciousDetectionRate ?? 0)/100)) : 0)}</td>
    <td>${p.overallAccuracy != null ? fmtPct(p.overallAccuracy) : '—'}</td>
    <td>${fmtNum(Math.round(p.studied * (p.suspiciousDetectionRate ?? 0) / 100))}</td>
    <td>${p.suspiciousDetectionRate != null ? fmtPct(p.suspiciousDetectionRate) : '—'}</td>
    <td>${p.excessSuspicionRate != null ? fmtPct(p.excessSuspicionRate) : '—'}</td>
  </tr>`).join('');

  return `<section class="page compact" id="page-emp-decision" data-title="دقة الموظفين حسب القرار">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">نوع القرار</div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab">تحليل الأخطاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">دقة الموظفين حسب نوع القرار</h2>
    <div class="section-subtitle">الفصل بين الدقة الكلية واكتشاف الاشتباه والإنذارات الخاطئة</div>
    <div class="grid grid-4">
      <div class="card"><h3>الدقة الكلية</h3><div class="metric green">${fmtPct(avgAcc)}</div></div>
      <div class="card"><h3>اكتشاف الاشتباه</h3><div class="metric blue">${fmtPct(avgDet)}</div></div>
      <div class="card"><h3>الاشتباه الفائت</h3><div class="metric purple">${fmtPct(avgMiss)}</div></div>
      <div class="card"><h3>الاشتباه الخاطئ</h3><div class="metric coral">${fmtPct(avgExc)}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">تصنيف الموظفين حسب نوع الأداء</div>
        <div class="quad">
          <div><h4 style="color:var(--green)">دقة عالية / اكتشاف مرتفع</h4><p>أفضل نمط أداء</p></div>
          <div><h4 style="color:var(--gold)">دقة منخفضة / اكتشاف مرتفع</h4><p>مراجعة الدقة العامة</p></div>
          <div><h4 style="color:var(--blue)">دقة عالية / اكتشاف منخفض</h4><p>خطر خفي رغم الدقة الكلية</p></div>
          <div><h4 style="color:var(--coral)">دقة منخفضة / اكتشاف منخفض</h4><p>أولوية تدخل مرتفعة</p></div>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">ملخص الأداء حسب القرار</div>
        <div class="table-wrap"><table>
          <thead><tr><th>الموظف</th><th>السليمة</th><th>دقة السليمة</th><th>الاشتباه</th><th>الاكتشاف</th><th>الخاطئ</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>
      </div>
    </div>
    <div class="info" style="margin-top:16px">قد تخفي الدقة الكلية المرتفعة ضعفًا في اكتشاف حالات الاشتباه؛ لذلك يعرض التقرير المؤشرين بصورة منفصلة.</div>
    <div class="page-no">14</div>
  </div>
</section>`;
}
