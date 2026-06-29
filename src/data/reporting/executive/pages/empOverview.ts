import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

export function buildEmpOverview(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);

  if (profiles.length === 0) {
    return `<section class="xr-page" id="page-emp-overview">
      <div class="xr-page-inner">
        <div class="xr-slide-head"><h2>النظرة العامة لأداء الموظفين</h2><span class="xr-pg">24</span></div>
        <div class="xr-notice">بيانات غير كافية — لا توجد إجابات مقدَّمة لهذا الشهر.</div>
        <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>24</span></div>
      </div>
    </section>`;
  }

  const tableRows = profiles.map(p => [
    esc(ctx.displayName(p.username)),
    fmtNum(p.studied),
    p.reliable ? fmtPct(p.overallAccuracy) : null,
    p.reliable ? fmtPct(p.missedSuspicionRate) : null,
    esc(p.recommendedAction),
  ]);

  const top5 = profiles.filter(p => p.reliable).slice(0, 5);
  const bars = top5.map(p => barRow({ label: ctx.displayName(p.username), value: p.overallAccuracy, max: 100, tone: "good" })).join("");

  return `<section class="xr-page" id="page-emp-overview">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>النظرة العامة لأداء الموظفين</h2><span class="xr-pg">24</span></div>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["الموظف","مدروسة","الدقة","اشتباه فائت","التوصية"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">أفضل 5 موظفين — الدقة</div>
          <div class="xr-bars">${bars}</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>24</span></div>
    </div>
  </section>`;
}
