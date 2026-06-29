import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, badgeHtml, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildAccuracyByPort(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const reliable = kpis.portProfiles.filter(p => p.accuracy !== null);

  const kpisRow = [
    kpiCard({ label: "الدقة الإجمالية", value: fmtPct(kpis.overallAccuracy), tone: kpis.overallAccuracy !== null && kpis.overallAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "قوة اكتشاف الاشتباه", value: fmtPct(kpis.suspiciousDetectionRate), tone: "good" }),
    kpiCard({ label: "اشتباه فائت", value: fmtPct(kpis.missedSuspicionRate), tone: kpis.missedSuspicionRate !== null && kpis.missedSuspicionRate <= ctx.input.config.maximumMissedSuspicionRate ? "good" : "risk" }),
    kpiCard({ label: "المنافذ ذات بيانات موثوقة", value: String(reliable.length) + " / " + String(kpis.portProfiles.length) }),
  ].join("");

  const tableRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.studied),
    p.accuracy !== null ? fmtPct(p.accuracy) : null,
    p.suspiciousDetectionRate !== null ? fmtPct(p.suspiciousDetectionRate) : null,
    p.missedSuspicionRate !== null ? fmtPct(p.missedSuspicionRate) : null,
    badgeHtml(p.status),
  ]);

  const bars = reliable.map(p =>
    barRow({ label: p.portName, value: p.accuracy, max: 100, tone: p.accuracy !== null && p.accuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" })
  ).join("");

  return `<section class="xr-page" id="page-acc-port">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>نتائج الدقة حسب المنفذ</h2><span class="xr-pg">20</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["المنفذ","مدروسة","دقة%","اكتشاف اشتباه%","اشتباه فائت%","التصنيف"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">الدقة حسب المنفذ</div>
          <div class="xr-bars">${bars || '<div class="xr-notice">بيانات غير كافية</div>'}</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>20</span></div>
    </div>
  </section>`;
}
