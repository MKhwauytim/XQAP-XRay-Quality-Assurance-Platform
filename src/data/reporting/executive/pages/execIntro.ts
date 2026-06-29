import type { ExecutiveRenderContext } from "../context";
import { kpiCard, fmtNum, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header">
    <div class="xr-org-text">${lines}</div>
    <div class="xr-org-logo">🛡</div>
  </div>`;
}

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
    <div style="font-size:20px">${s.ok ? "✅" : "⬜"}</div>
    <div class="xr-kpi-label">${esc(s.label)}</div>
  </div>`).join("");

  return `<section class="xr-page" id="page-intro">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">المقدمة التنفيذية</h2>
      <div style="margin-bottom:8px;font-size:10px;color:var(--xr-muted);font-weight:600">
        ملخص أداء شهر ${esc(ctx.monthLabel)} — بتاريخ ${esc(ctx.issueDate)}
      </div>
      <div class="xr-kpi-grid xr-kpi-grid-6" style="margin-bottom:16px">${cards}</div>
      <div class="xr-section-title">حالة الأقسام</div>
      <div class="xr-kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:14px">${sectionStatus}</div>
      ${kpis.overallAccuracy !== null && kpis.overallAccuracy < ctx.input.config.accuracyTarget
        ? `<div class="xr-notice">⚠️ الدقة الإجمالية (${fmtPct(kpis.overallAccuracy)}) أقل من الهدف المعتمد (${fmtPct(ctx.input.config.accuracyTarget)}). راجع الجزء الرابع والخامس لتفاصيل الفجوات.</div>`
        : ""}
      <div class="xr-page-num">• 03 •</div>
    </div>
  </section>`;
}
