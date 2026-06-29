import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc, noticeBox } from "../primitives";
import { buildEmployeeProfiles, buildPriorityList } from "../executiveEmployeeData";

export function buildEmpPriority(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const priority = buildPriorityList(profiles);

  if (priority.length === 0) {
    return `<section class="xr-page" id="page-emp-priority">
      <div class="xr-page-inner">
        <div class="xr-slide-head"><h2>الموظفون ذوو الأولوية والإجراءات المقترحة</h2><span class="xr-pg">30</span></div>
        ${noticeBox("لا يوجد موظفون يتطلبون تدخلاً عاجلاً في هذه الدورة.")}
        <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>30</span></div>
      </div>
    </section>`;
  }

  const cards = priority.slice(0, 6).map((p, i) => `
    <div class="xr-panel" style="border-right:3px solid var(--xr-coral)">
      <div style="font-size:0.085in;font-weight:800;color:var(--xr-gold);margin-bottom:0.04in">#${i+1} — ${esc(ctx.displayName(p.username))}</div>
      <div style="font-size:0.08in;color:var(--xr-muted)">الدقة: ${fmtPct(p.overallAccuracy)} | اشتباه فائت: ${fmtPct(p.missedSuspicionRate)}</div>
      <div style="margin-top:0.06in;font-size:0.08in;color:var(--xr-white);font-weight:700">${esc(p.recommendedAction)}</div>
    </div>`).join("");

  return `<section class="xr-page" id="page-emp-priority">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>الموظفون ذوو الأولوية والإجراءات المقترحة</h2><span class="xr-pg">30</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.1in">${cards}</div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>30</span></div>
    </div>
  </section>`;
}
