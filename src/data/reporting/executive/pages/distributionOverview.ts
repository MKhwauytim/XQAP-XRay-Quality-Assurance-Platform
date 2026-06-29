import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildDistributionOverview(ctx: ExecutiveRenderContext): string {
  const dist = ctx.input.distribution;
  if (!dist || dist.entries.length === 0) {
    return `<section class="xr-page" id="page-dist">
      <div class="xr-page-inner">
        <div class="xr-slide-head"><h2>التوزيع والتكليف</h2><span class="xr-pg">16</span></div>
        <div class="xr-notice">لم يتم التوزيع بعد لهذا الشهر.</div>
        <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>16</span></div>
      </div>
    </section>`;
  }

  const byEmployee = new Map<string, { assigned: number; completed: number; pending: number }>();
  for (const e of dist.entries) {
    const emp = e.assignedTo ?? "غير محدد";
    const rec = byEmployee.get(emp) ?? { assigned: 0, completed: 0, pending: 0 };
    rec.assigned++;
    if (e.status === "completed") rec.completed++;
    else rec.pending++;
    byEmployee.set(emp, rec);
  }

  const totalAssigned = dist.entries.length;
  const totalCompleted = dist.entries.filter(e => e.status === "completed").length;
  const totalPending = totalAssigned - totalCompleted;

  const kpisRow = [
    kpiCard({ label: "إجمالي المكلَّف به", value: fmtNum(totalAssigned), tone: "accent" }),
    kpiCard({ label: "مكتملة", value: fmtNum(totalCompleted), tone: "good" }),
    kpiCard({ label: "متبقية", value: fmtNum(totalPending), tone: totalPending > 0 ? "warn" : "" }),
    kpiCard({ label: "نسبة الإنجاز", value: fmtPct(totalAssigned > 0 ? (totalCompleted / totalAssigned) * 100 : null) }),
  ].join("");

  const rows = [...byEmployee.entries()].map(([emp, r]) => [
    esc(ctx.displayName(emp)),
    fmtNum(r.assigned),
    fmtNum(r.completed),
    fmtNum(r.pending),
    fmtPct(r.assigned > 0 ? (r.completed / r.assigned) * 100 : null),
  ]);

  return `<section class="xr-page" id="page-dist">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>التوزيع والتكليف</h2><span class="xr-pg">16</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-panel-title">أعباء العمل حسب الموظف</div>
      ${dataTable({ headers: ["الموظف","المكلَّف به","مكتمل","متبقٍ","نسبة الإنجاز"], rows })}
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>16</span></div>
    </div>
  </section>`;
}
