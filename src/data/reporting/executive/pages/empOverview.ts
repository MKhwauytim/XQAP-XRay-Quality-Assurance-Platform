import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpOverview(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);

  if (profiles.length === 0) {
    return `<section class="xr-page" id="page-emp-overview">
      <div class="xr-page-inner">
        ${orgHeader()}
        <h2 class="xr-page-title">النظرة العامة لأداء الموظفين</h2>
        <div class="xr-notice">بيانات غير كافية — لا توجد إجابات مقدَّمة لهذا الشهر.</div>
        <div class="xr-page-num">• 24 •</div>
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
      ${orgHeader()}
      <h2 class="xr-page-title">النظرة العامة لأداء الموظفين</h2>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["الموظف","مدروسة","الدقة","اشتباه فائت","التوصية"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">أفضل 5 موظفين — الدقة</div>
          <div class="xr-bars">${bars}</div>
        </div>
      </div>
      <div class="xr-page-num">• 24 •</div>
    </div>
  </section>`;
}
