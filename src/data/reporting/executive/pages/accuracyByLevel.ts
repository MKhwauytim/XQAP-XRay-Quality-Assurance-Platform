import type { ExecutiveRenderContext } from "../context";
import { kpiCard, radarSvg, fmtPct, esc } from "../primitives";

export function buildAccuracyByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const kpisRow = [
    kpiCard({ label: "دقة المستوى الأول", value: fmtPct(kpis.levelOneAccuracy), tone: kpis.levelOneAccuracy !== null && kpis.levelOneAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "دقة المستوى الثاني", value: fmtPct(kpis.levelTwoAccuracy), tone: kpis.levelTwoAccuracy !== null && kpis.levelTwoAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "معدل التصحيح م.ثاني", value: fmtPct(kpis.levelTwoCorrectionRate) }),
    kpiCard({ label: "معدل التراجع م.ثاني", value: fmtPct(kpis.levelTwoRegressionRate), tone: "warn" }),
  ].join("");

  const radarPoints = [
    { label: "دقة م.أول", value: kpis.levelOneAccuracy ?? 0 },
    { label: "دقة م.ثاني", value: kpis.levelTwoAccuracy ?? 0 },
    { label: "اكتشاف الاشتباه", value: kpis.suspiciousDetectionRate ?? 0 },
    { label: "تأكيد السلامة", value: kpis.cleanConfirmationRate ?? 0 },
    { label: "الدقة الإجمالية", value: kpis.overallAccuracy ?? 0 },
    { label: "الجودة المتوازنة", value: kpis.balancedQualityScore ?? 0 },
  ];

  return `<section class="xr-page" id="page-acc-level">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>نتائج الدقة حسب المستويات الأربعة</h2><span class="xr-pg">21</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel" style="height:3.4in">${radarSvg(radarPoints)}</div>
        <div>
          <div class="xr-panel-title">مؤشرات الدقة التفصيلية</div>
          <table class="xr-table"><tbody>
            <tr><td>اشتباه مكتشف</td><td>${kpis.correctSuspicious}</td></tr>
            <tr><td>سليمة مؤكدة</td><td>${kpis.correctClean}</td></tr>
            <tr><td>اشتباه فائت</td><td style="color:var(--xr-coral)">${kpis.missedSuspicious}</td></tr>
            <tr><td>اشتباه زائد</td><td style="color:var(--xr-gold)">${kpis.excessSuspicious}</td></tr>
            <tr><td>صور بتحقق صالح</td><td>${kpis.validStudied}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>21</span></div>
    </div>
  </section>`;
}
