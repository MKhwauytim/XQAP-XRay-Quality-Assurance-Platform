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
    <div class="notice-centered"><div>لا توجد بيانات كافية لهذه الفترة</div></div>
    <div class="page-no">16</div>
  </div>
</section>`;
  }

  // Global KPIs from ctx.kpis (more accurate than averaging employee-level)
  const { kpis } = ctx;

  const tableRows = reliable.slice(0, 8).map(p => {
    // Per-employee clean/suspicious counts from ctx.rows
    const empStudied = ctx.rows.filter(r => r.assignedTo === p.username && r.verificationCategory !== null);
    const cleanCount  = empStudied.filter(r => r.expertResult === "سليمة").length;
    const suspCount   = empStudied.filter(r => r.expertResult === "اشتباه").length;
    return `<tr>
      <td>${esc(ctx.displayName(p.username))}</td>
      <td>${fmtNum(cleanCount)}</td>
      <td>${p.byDecision.onClean !== null ? fmtPct(p.byDecision.onClean) : "—"}</td>
      <td>${fmtNum(suspCount)}</td>
      <td>${p.suspiciousDetectionRate !== null ? fmtPct(p.suspiciousDetectionRate) : "—"}</td>
      <td>${p.excessSuspicionRate !== null ? fmtPct(p.excessSuspicionRate) : "—"}</td>
    </tr>`;
  }).join("");

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
      <div class="card"><h3>الدقة الكلية</h3><div class="metric green">${fmtPct(kpis.overallAccuracy)}</div></div>
      <div class="card"><h3>اكتشاف الاشتباه</h3><div class="metric blue">${fmtPct(kpis.suspiciousDetectionRate)}</div></div>
      <div class="card"><h3>الاشتباه الفائت</h3><div class="metric purple">${fmtPct(kpis.missedSuspicionRate)}</div></div>
      <div class="card"><h3>الاشتباه الخاطئ</h3><div class="metric coral">${fmtPct(kpis.excessSuspicionRate)}</div></div>
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
    <div class="page-no">16</div>
  </div>
</section>`;
}
