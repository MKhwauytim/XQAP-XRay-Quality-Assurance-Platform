import type { ExecutiveRenderContext } from "../context";
import { barRow, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

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
      ${orgHeader()}
      <h2 class="xr-page-title">مقارنة المستوى الأول والثاني وتوافق الموظفين</h2>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">مقارنة المستويين</div>
          <div class="xr-bars" style="margin-top:10px">${bars}</div>
        </div>
        <div class="xr-panel">
          <div class="xr-panel-title">توافق أزواج الموظفين</div>
          <div class="xr-notice" style="margin-top:10px">هذا الجزء يتطلب وجود حالات راجعها موظفان مختلفان — لم تُرصد حالات كهذه في هذا الشهر.</div>
        </div>
      </div>
      <div class="xr-page-num">• 22 •</div>
    </div>
  </section>`;
}
