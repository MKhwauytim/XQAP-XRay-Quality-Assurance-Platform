import type { ExecutiveRenderContext } from "../context";
import { barRow, esc } from "../primitives";

export function buildLevelAgreement(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const bars = [
    barRow({ label: "دقة المستوى الأول", value: kpis.levelOneAccuracy, max: 100, tone: "good" }),
    barRow({ label: "دقة المستوى الثاني", value: kpis.levelTwoAccuracy, max: 100, tone: "blue" }),
    barRow({ label: "معدل الاختلاف م.أول/ثاني", value: kpis.levelDisagreementRate, max: 100, tone: "risk" }),
    barRow({ label: "معدل تصحيح م.ثاني", value: kpis.levelTwoCorrectionRate, max: 100 }),
    barRow({ label: "معدل تراجع م.ثاني", value: kpis.levelTwoRegressionRate, max: 100, tone: "risk" }),
  ].join("");

  return `<section class="xr-page" id="page-level-agree">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مقارنة المستوى الأول والثاني وتوافق الموظفين</h2><span class="xr-pg">22</span></div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">مقارنة المستويين</div>
          <div class="xr-bars" style="margin-top:0.1in">${bars}</div>
        </div>
        <div class="xr-panel">
          <div class="xr-panel-title">توافق أزواج الموظفين</div>
          <div class="xr-notice" style="margin-top:0.1in">هذا الجزء يتطلب وجود حالات راجعها موظفان مختلفان — لم تُرصد حالات كهذه في هذا الشهر.</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>22</span></div>
    </div>
  </section>`;
}
