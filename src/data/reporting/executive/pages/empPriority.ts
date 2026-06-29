import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc, noticeBox } from "../primitives";
import { buildEmployeeProfiles, buildPriorityList } from "../executiveEmployeeData";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpPriority(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const priority = buildPriorityList(profiles);

  if (priority.length === 0) {
    return `<section class="xr-page" id="page-emp-priority">
      <div class="xr-page-inner">
        ${orgHeader()}
        <h2 class="xr-page-title">الموظفون ذوو الأولوية والإجراءات المقترحة</h2>
        ${noticeBox("لا يوجد موظفون يتطلبون تدخلاً عاجلاً في هذه الدورة.")}
        <div class="xr-page-num">• 30 •</div>
      </div>
    </section>`;
  }

  const cards = priority.slice(0, 6).map((p, i) => `
    <div class="xr-panel" style="border-right:3px solid var(--xr-coral)">
      <div style="font-size:10px;font-weight:800;color:var(--xr-gold);margin-bottom:5px">#${i+1} — ${esc(ctx.displayName(p.username))}</div>
      <div style="font-size:9px;color:var(--xr-muted)">الدقة: ${fmtPct(p.overallAccuracy)} | اشتباه فائت: ${fmtPct(p.missedSuspicionRate)}</div>
      <div style="margin-top:7px;font-size:9px;color:var(--xr-white);font-weight:700">${esc(p.recommendedAction)}</div>
    </div>`).join("");

  return `<section class="xr-page" id="page-emp-priority">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">الموظفون ذوو الأولوية والإجراءات المقترحة</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${cards}</div>
      <div class="xr-page-num">• 30 •</div>
    </div>
  </section>`;
}
