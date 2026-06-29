import type { ExecutiveRenderContext } from "../context";
import { esc, kpiCard, barRow, dataTable, fmtNum, fmtPct } from "../primitives";

export function buildPopulationByRisk(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const totalPop = kpis.totalPopulation;

  const kpiRow = [
    kpiCard({ label: "إجمالي المجتمع", value: fmtNum(totalPop), tone: "accent" }),
    kpiCard({ label: "الحالات السليمة", value: fmtNum(kpis.cleanCount), tone: "good" }),
    kpiCard({ label: "حالات الاشتباه", value: fmtNum(kpis.suspiciousCount), tone: "risk" }),
    kpiCard({ label: "نسبة الاشتباه", value: fmtPct(kpis.suspicionRate), tone: "" }),
  ].join("");

  const portTableRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.clean),
    fmtNum(p.suspicious),
    fmtPct(p.suspicionRate),
  ]);

  const portTable = dataTable({
    headers: ["المنفذ", "المجتمع", "سليمة", "اشتباه", "نسبة الاشتباه"],
    rows: portTableRows,
    totalRow: ["الإجمالي", fmtNum(totalPop), fmtNum(kpis.cleanCount), fmtNum(kpis.suspiciousCount), fmtPct(kpis.suspicionRate)],
  });

  const bars = kpis.portProfiles.map(p =>
    barRow({ label: p.portName, value: p.suspicionRate, max: 100 })
  ).join("");

  return `<section class="xr-page" id="page-pop-risk">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مجتمع حالات المخاطر</h2><span class="xr-pg">08</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpiRow}</div>
      <div class="xr-cols xr-cols-6-4">
        <div>${portTable}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">نسبة الاشتباه حسب المنفذ</div>
          <div class="xr-bars">${bars}</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>08</span></div>
    </div>
  </section>`;
}
