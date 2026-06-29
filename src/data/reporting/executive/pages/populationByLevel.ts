import type { ExecutiveRenderContext } from "../context";
import { dataTable, fmtNum, fmtPct, esc } from "../primitives";

export function buildPopulationByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const rows = kpis.stageProfiles.map(s => [
    esc(s.stageLabel),
    fmtNum(s.population),
    fmtNum(s.sampleSize),
    fmtPct(s.coverage),
    fmtNum(s.studied),
    fmtPct(s.completionRate),
  ]);
  const table = dataTable({
    headers: ["المستوى", "المجتمع", "العينة", "التغطية", "مدروسة", "الإنجاز"],
    rows,
    totalRow: ["الإجمالي", fmtNum(kpis.totalPopulation), fmtNum(kpis.totalSample), fmtPct(kpis.sampleCoverage), fmtNum(kpis.studiedImages), fmtPct(kpis.completionRate)],
  });

  const portRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.sampleSize),
    fmtPct(p.coverage),
    fmtNum(p.studied),
    fmtPct(p.completionRate),
  ]);
  const portTable = dataTable({
    headers: ["المنفذ", "المجتمع", "العينة", "التغطية", "مدروسة", "الإنجاز"],
    rows: portRows,
  });

  return `<section class="xr-page" id="page-pop-level">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مجتمع الحالات حسب المستويات والمنافذ</h2><span class="xr-pg">09</span></div>
      <div class="xr-cols xr-cols-2">
        <div>
          <div class="xr-panel-title">توزيع المستويات</div>
          ${table}
        </div>
        <div>
          <div class="xr-panel-title">توزيع المنافذ</div>
          ${portTable}
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>09</span></div>
    </div>
  </section>`;
}
