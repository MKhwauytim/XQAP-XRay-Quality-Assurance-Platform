import type { ExecutiveRenderContext } from "../context";
import { kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildExecIntro(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const cards = [
    kpiCard({ label: "إجمالي الصور", value: fmtNum(kpis.totalPopulation), tone: "accent" }),
    kpiCard({ label: "حجم العينة", value: fmtNum(kpis.totalSample) }),
    kpiCard({ label: "نسبة التغطية", value: fmtPct(kpis.sampleCoverage), tone: kpis.sampleCoverage !== null && kpis.sampleCoverage >= ctx.input.config.coverageTarget ? "good" : "warn" }),
    kpiCard({ label: "الحالات المدروسة", value: fmtNum(kpis.studiedImages) }),
    kpiCard({ label: "نسبة الإنجاز", value: fmtPct(kpis.completionRate), tone: kpis.completionRate !== null && kpis.completionRate >= ctx.input.config.completionTarget ? "good" : "warn" }),
    kpiCard({ label: "الدقة الإجمالية", value: fmtPct(kpis.overallAccuracy), tone: kpis.overallAccuracy === null ? "" : kpis.overallAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
  ].join("");

  const sectionStatus = [
    { label: "مجتمع الحالات", ok: kpis.totalPopulation > 0 },
    { label: "العينة", ok: kpis.totalSample > 0 },
    { label: "التوزيع", ok: kpis.studiedImages > 0 },
    { label: "نتائج الدقة", ok: kpis.overallAccuracy !== null },
    { label: "أداء الموظفين", ok: kpis.validStudied > 0 },
  ].map(s => `<div class="xr-kpi" style="text-align:center">
    <div style="font-size:0.22in">${s.ok ? "✅" : "⬜"}</div>
    <div class="xr-kpi-label">${esc(s.label)}</div>
  </div>`).join("");

  return `<section class="xr-page" id="page-intro">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مقدمة تنفيذية</h2><span class="xr-pg">03</span></div>
      <div style="margin-bottom:0.07in;font-size:0.085in;color:var(--xr-muted);font-weight:600">
        ملخص أداء شهر ${esc(ctx.monthLabel)} — بتاريخ ${esc(ctx.issueDate)}
      </div>
      <div class="xr-kpi-grid xr-kpi-grid-6" style="margin-bottom:0.16in">${cards}</div>
      <div class="xr-section-title">حالة الأقسام</div>
      <div class="xr-kpi-grid" style="grid-template-columns:repeat(5,1fr)">${sectionStatus}</div>
      ${kpis.overallAccuracy !== null && kpis.overallAccuracy < ctx.input.config.accuracyTarget
        ? `<div class="xr-notice" style="margin-top:0.12in">⚠️ الدقة الإجمالية (${fmtPct(kpis.overallAccuracy)}) أقل من الهدف المعتمد (${fmtPct(ctx.input.config.accuracyTarget)}). راجع الجزء الرابع والخامس لتفاصيل الفجوات.</div>`
        : ""}
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>03</span></div>
    </div>
  </section>`;
}
